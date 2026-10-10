import type { Prisma } from '@lucy-spa/database';
import { recordMediaAsset, type StoredMedia } from '../media-assets.js';
import {
  differenceHash,
  hammingDistance,
  MediaProcessingError,
  processImage,
} from '../media-processing.js';
import { HttpFetchError, IMAGE_MAX_BYTES, type HttpClient } from './http-client.js';
import { plainLine } from './text.js';

/**
 * Phase 9 P9-4: taking ONE picture of ONE supplier product into the library. Owner requirement: pictures are never mixed between
 * products. The rules this module keeps, on top of the database's composite key (a picture can only sit on the candidate that owns the
 * source record it names):
 *
 * - the picture URL comes from that product's own record and was checked against a fresh read of the same product id (the caller);
 * - the file is downloaded through the guarded client (size cap, https, source host only), validated by magic bytes and decoded;
 * - its sha256 and difference hash are stored with the source product id and URL;
 * - the same file, or a near-identical one, on ANOTHER candidate or on a Lucy catalog product flags BOTH sides for a person. Nothing is
 *   ever reassigned, merged or attached automatically.
 */

/** Pictures per product (Owner answer 5). */
export const MAX_IMAGES_PER_PRODUCT = 6;
/**
 * Bits of 256 that may differ for two pictures to count as "near identical" (a flag, never a merge). Measured on the real sample: a
 * re-compressed copy differs in about 9 bits, two different products of one brand in at least 22.
 */
export const NEAR_DUPLICATE_DISTANCE = 12;

export type ImageFlag = 'SAME_FILE' | 'SIMILAR' | 'CATALOG_SAME_FILE';

export interface ImageFailure {
  code: string;
  detail?: string;
}

/** WooCommerce serves a stock "no picture" image for products without one; it says nothing about the product. */
export function isPlaceholderImage(url: string): boolean {
  try {
    return /placeholder/i.test(new URL(url).pathname);
  } catch {
    return true;
  }
}

export interface DownloadedImage {
  image: Awaited<ReturnType<typeof processImage>>;
  phash: string;
}

/** Downloads and validates one picture. Never throws: a failure is a typed code the scan records as a warning. */
export async function downloadImage(
  client: HttpClient,
  url: string,
): Promise<{ ok: true; value: DownloadedImage } | { ok: false; failure: ImageFailure }> {
  let response;
  try {
    response = await client.get(url, { maxBytes: IMAGE_MAX_BYTES, accept: 'image/*' });
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: 'IMAGE_FETCH_FAILED',
        ...(error instanceof HttpFetchError ? { detail: error.code } : {}),
      },
    };
  }
  if (response.status !== 200) {
    return { ok: false, failure: { code: 'IMAGE_HTTP_STATUS', detail: String(response.status) } };
  }
  try {
    const image = await processImage(response.body);
    return { ok: true, value: { image, phash: await differenceHash(response.body) } };
  } catch (error) {
    return {
      ok: false,
      failure: {
        code: error instanceof MediaProcessingError ? error.code : 'IMAGE_INVALID',
      },
    };
  }
}

export interface IntakeInput {
  tx: Prisma.TransactionClient;
  supplierId: string;
  candidateId: string;
  sourceRecordId: string;
  sourceProductKey: string;
  variantKey: string | null;
  sourceUrl: string;
  sortOrder: number;
  filename: string;
  altVi: string | null;
  actorUserId: string;
  downloaded: DownloadedImage;
  stored: StoredMedia;
}

export interface IntakeResult {
  /** The picture row, or null when the candidate already holds this very file (nothing was added). */
  imageId: string | null;
  flag: ImageFlag | null;
  /** Other candidates whose pictures were flagged together with this one. */
  flaggedCandidateIds: string[];
  /** Every picture flagged by this intake: the new one (when flagged) and the others it was flagged with, each once. */
  flaggedImageIds: string[];
  duplicateAsset: boolean;
}

const warningKey = (warning: Record<string, unknown>) =>
  JSON.stringify([warning['code'], warning['imageId'], warning['otherImageId'], warning['kind']]);

/** Adds warnings to a candidate (once each) and, for a flag, puts it in front of a person. Moves the row version, as every update must. */
export async function warnCandidate(
  tx: Prisma.TransactionClient,
  candidateId: string,
  warnings: Record<string, unknown>[],
  options: { needsReview: boolean },
): Promise<void> {
  const rows = await tx.$queryRaw<{ warnings: unknown; state: string }[]>`
    SELECT warnings, state::text AS state FROM import_candidates WHERE id = ${candidateId}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) return;
  const current = (Array.isArray(row.warnings) ? row.warnings : []) as Record<string, unknown>[];
  const known = new Set(current.map(warningKey));
  const added = warnings.filter((warning) => !known.has(warningKey(warning)));
  const moveState =
    options.needsReview &&
    ['DETECTED', 'EXTRACTED', 'NORMALIZED', 'MATCHED', 'READY_FOR_REVIEW'].includes(row.state);
  if (added.length === 0 && !moveState) return;
  await tx.$executeRaw`
    UPDATE import_candidates
       SET warnings = ${JSON.stringify([...current, ...added])}::jsonb,
           state = CASE WHEN ${moveState} THEN 'NEEDS_REVIEW'::"ImportCandidateState" ELSE state END,
           row_version = row_version + 1
     WHERE id = ${candidateId}::uuid`;
}

/**
 * Records the downloaded picture on its candidate inside the caller's transaction: the media asset (or the identical one already in
 * the library), the cross-checks against every other picture of the supplier and against the Lucy catalog, and the picture row.
 */
export async function recordIntake(input: IntakeInput): Promise<IntakeResult> {
  const { tx, downloaded } = input;
  const recorded = await recordMediaAsset(tx, {
    image: downloaded.image,
    stored: input.stored,
    filename: input.filename,
    altVi: input.altVi,
    altEn: null,
    createdByUserId: input.actorUserId,
  });
  const assetId = recorded.id;
  // The candidate may already hold this very file (a variant that reuses the product's picture, a repeated URL): nothing to add.
  const held = await tx.candidateImage.findFirst({
    where: { candidateId: input.candidateId, mediaAssetId: assetId, retiredAt: null },
    select: { id: true },
  });
  if (held) {
    return {
      imageId: null,
      flag: null,
      flaggedCandidateIds: [],
      flaggedImageIds: [],
      duplicateAsset: recorded.duplicate,
    };
  }
  const sameFile = await tx.candidateImage.findMany({
    // Retired pictures of other candidates count too: a file another product held a moment ago is the clearest sign of a mix-up.
    where: { mediaAssetId: assetId, candidateId: { not: input.candidateId } },
    select: { id: true, candidateId: true },
  });
  const catalog = await tx.productImage.findMany({
    where: { mediaAssetId: assetId },
    select: { productId: true },
  });
  const neighbours = await tx.candidateImage.findMany({
    where: {
      retiredAt: null,
      phash: { not: null },
      mediaAssetId: { not: assetId },
      candidateId: { not: input.candidateId },
      candidate: { supplierId: input.supplierId },
    },
    select: { id: true, candidateId: true, phash: true },
  });
  const similar = neighbours.filter(
    (neighbour) =>
      neighbour.phash !== null &&
      hammingDistance(neighbour.phash, downloaded.phash) <= NEAR_DUPLICATE_DISTANCE,
  );
  const flag: ImageFlag | null =
    sameFile.length > 0
      ? 'SAME_FILE'
      : catalog.length > 0
        ? 'CATALOG_SAME_FILE'
        : similar.length > 0
          ? 'SIMILAR'
          : null;

  const created = await tx.candidateImage.create({
    data: {
      candidateId: input.candidateId,
      mediaAssetId: assetId,
      sourceUrl: input.sourceUrl,
      sortOrder: input.sortOrder,
      sha256: downloaded.image.sha256,
      phash: downloaded.phash,
      sourceRecordId: input.sourceRecordId,
      sourceProductKey: input.sourceProductKey,
      variantKey: input.variantKey,
      flag,
    },
    select: { id: true },
  });

  const flaggedCandidates = new Set<string>();
  const others: { id: string; candidateId: string; kind: ImageFlag }[] = [
    ...sameFile.map((other) => ({ ...other, kind: 'SAME_FILE' as const })),
    ...similar.map((other) => ({
      id: other.id,
      candidateId: other.candidateId,
      kind: 'SIMILAR' as const,
    })),
  ];
  for (const other of others) {
    await tx.$executeRaw`
      UPDATE candidate_images SET flag = ${other.kind} WHERE id = ${other.id}::uuid AND flag IS NULL`;
    await warnCandidate(
      tx,
      other.candidateId,
      [{ code: 'IMAGE_SHARED', kind: other.kind, imageId: other.id, otherImageId: created.id }],
      { needsReview: true },
    );
    flaggedCandidates.add(other.candidateId);
    await warnCandidate(
      tx,
      input.candidateId,
      [{ code: 'IMAGE_SHARED', kind: other.kind, imageId: created.id, otherImageId: other.id }],
      { needsReview: true },
    );
  }
  if (catalog.length > 0) {
    await warnCandidate(
      tx,
      input.candidateId,
      [
        {
          code: 'IMAGE_SHARED',
          kind: 'CATALOG_SAME_FILE',
          imageId: created.id,
          productIds: [...new Set(catalog.map((entry) => entry.productId))].slice(0, 5),
        },
      ],
      { needsReview: true },
    );
  }
  return {
    imageId: created.id,
    flag,
    flaggedCandidateIds: [...flaggedCandidates],
    flaggedImageIds: [
      ...new Set([...(flag === null ? [] : [created.id]), ...others.map((other) => other.id)]),
    ],
    duplicateAsset: recorded.duplicate,
  };
}

/** A display filename in the library: `<product name>-<source id>-<n>`, plain text and bounded. */
export function imageFilename(name: string, sourceKey: string, position: number): string {
  const base = plainLine(name, 120)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `${base === '' ? 'product' : base}-${sourceKey}-${String(position + 1).padStart(2, '0')}`;
}

import type {
  MediaAssetDetail,
  MediaAssetSummary,
  MediaListResponse,
  MediaUpdateRequest,
  MediaUsage,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { recordMediaAsset } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide, type AuthorityGraph } from '../authorization/authorization.js';
import type { ProcessedImage, VariantKind } from './media.processing.js';

/**
 * UX/UI Step 11: the website media library (design 16.3). `MANAGE_WEBSITE_CONTENT` is GLOBAL_ONLY, decided
 * inside every command; a branch grant never authorizes any of it. Media is marketing content, not
 * financial or operational history, so a real delete is allowed while nothing references the image (16.8).
 */

export const MEDIA_PAGE_SIZE = 24;
const GLOBAL = { kind: 'GLOBAL' } as const;
const MAX_ALT = 300;
const MAX_SEARCH = 100;

/** GLOBAL only: a branch grant never opens the library. */
export const holdsWebsiteContent = (graph: AuthorityGraph): boolean =>
  decide(graph, 'MANAGE_WEBSITE_CONTENT', GLOBAL);

export function requireWebsiteContent(context: AdminContext): void {
  if (!holdsWebsiteContent(context.actor.graph)) throw new AuthError('FORBIDDEN');
}

/**
 * Phase 6 P6-3 (design 3.5): the people who manage the product catalog (`MANAGE_PRODUCTS`, GLOBAL_ONLY) also list, view and upload
 * pictures to choose product images from, and (Owner, 2026-10-07) edit their captions and alt text. Deleting stays with
 * `MANAGE_WEBSITE_CONTENT` only.
 */
export const holdsMediaAccess = (graph: AuthorityGraph): boolean =>
  holdsWebsiteContent(graph) || decide(graph, 'MANAGE_PRODUCTS', GLOBAL);

export function requireMediaAccess(context: AdminContext): void {
  if (!holdsMediaAccess(context.actor.graph)) throw new AuthError('FORBIDDEN');
}

const summarySelect = {
  id: true,
  originalFilename: true,
  mime: true,
  bytes: true,
  width: true,
  height: true,
  altVi: true,
  altEn: true,
  createdAt: true,
  rowVersion: true,
} as const;

type SummaryRow = Prisma.MediaAssetGetPayload<{ select: typeof summarySelect }>;

function summary(row: SummaryRow): MediaAssetSummary {
  return {
    id: row.id,
    originalFilename: row.originalFilename,
    mime: row.mime as MediaAssetSummary['mime'],
    bytes: row.bytes,
    width: row.width,
    height: row.height,
    altVi: row.altVi,
    altEn: row.altEn,
    createdAt: row.createdAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

/**
 * Where an image is used: popups (Step 12), slides, desktop or phone image (Step 13), season decoration slots
 * (S6b) and the shop info hero image (Part 2). Delete protection and the alt-text rule both read this; the public-serving rule reads the
 * same tables through `isPubliclyServed` (popup.core.ts).
 */
export type MediaUsageLookup = (
  tx: Prisma.TransactionClient,
  assetId: string,
) => Promise<MediaUsage[]>;

export const mediaUsages: MediaUsageLookup = async (tx, assetId) => {
  const popups = await tx.websitePopup.findMany({
    where: { mediaId: assetId },
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    select: { id: true, titleVi: true, titleEn: true },
  });
  const slides = await tx.websiteSlide.findMany({
    where: { OR: [{ mediaId: assetId }, { mobileMediaId: assetId }] },
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    select: { id: true, titleVi: true, titleEn: true },
  });
  const hero = await tx.websiteShopInfo.findMany({
    where: { heroMediaId: assetId },
    select: { id: true },
  });
  // A footer image block names its asset inside the JSON (no foreign key), so it is looked up by containment here.
  const footer = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM website_shop_info
    WHERE footer_blocks @> ${JSON.stringify([{ type: 'IMAGE', mediaId: assetId }])}::jsonb`;
  const shopInfo = [...new Set([...hero, ...footer].map((row) => row.id))].map((id) => ({ id }));
  const seasons = await tx.websiteSeason.findMany({
    where: { slotMedia: { some: { mediaId: assetId } } },
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    select: { id: true, label: true },
  });
  // Phase 6 P6-3: a picture a product uses cannot be deleted (the foreign key is RESTRICT).
  const products = await tx.productImage.findMany({
    where: { mediaAssetId: assetId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { product: { select: { id: true, nameVi: true, nameEn: true } } },
  });
  // Phase 6 Wave 4 (P6-23): the banner of a campaign cannot be deleted (the foreign key is RESTRICT).
  const campaigns = await tx.productCampaign.findMany({
    where: { bannerMediaId: assetId },
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    select: { id: true, nameVi: true },
  });
  // Phase 9 P9-4: a picture read from a supplier is kept by its import candidate (the foreign key is RESTRICT).
  const candidates = await tx.candidateImage.findMany({
    where: { mediaAssetId: assetId },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: { candidate: { select: { id: true, nameVi: true } } },
  });
  return [
    ...popups.map((popup) => ({
      kind: 'POPUP' as const,
      id: popup.id,
      title: popup.titleVi ?? popup.titleEn ?? '',
    })),
    ...slides.map((slide) => ({
      kind: 'SLIDE' as const,
      id: slide.id,
      title: slide.titleVi ?? slide.titleEn ?? '',
    })),
    ...shopInfo.map((row) => ({ kind: 'SHOP_INFO' as const, id: row.id, title: '' })),
    ...seasons.map((season) => ({ kind: 'SEASON' as const, id: season.id, title: season.label })),
    ...products.map((row) => ({
      kind: 'PRODUCT' as const,
      id: row.product.id,
      title: row.product.nameVi,
    })),
    ...campaigns.map((row) => ({ kind: 'CAMPAIGN' as const, id: row.id, title: row.nameVi })),
    ...[...new Map(candidates.map((row) => [row.candidate.id, row.candidate])).values()].map(
      (row) => ({
        kind: 'IMPORT_CANDIDATE' as const,
        id: row.id,
        title: row.nameVi,
      }),
    ),
  ];
};

async function detail(tx: Prisma.TransactionClient, row: SummaryRow): Promise<MediaAssetDetail> {
  return { ...summary(row), usedIn: await mediaUsages(tx, row.id) };
}

/** Plain text only: trimmed, whitespace collapsed, empty becomes null; never markup-interpreted. */
function altText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  if ([...text].length > MAX_ALT || /\p{Cc}/u.test(text)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return text;
}

export async function listMedia(
  context: AdminContext,
  query: { search?: string | undefined; page?: number | undefined },
): Promise<MediaListResponse> {
  requireMediaAccess(context);
  const search = (query.search ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if ([...search].length > MAX_SEARCH) throw new AuthError('VALIDATION_FAILED', 'search');
  const page = query.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  // Prisma passes `contains` to LIKE unescaped: make `%`, `_` and `\` plain characters.
  const needle = search.replace(/[\\%_]/g, '\\$&');
  const where: Prisma.MediaAssetWhereInput =
    search === ''
      ? {}
      : {
          OR: [
            { originalFilename: { contains: needle, mode: 'insensitive' } },
            { altVi: { contains: needle, mode: 'insensitive' } },
            { altEn: { contains: needle, mode: 'insensitive' } },
          ],
        };
  const [total, rows] = await Promise.all([
    context.tx.mediaAsset.count({ where }),
    context.tx.mediaAsset.findMany({
      where,
      select: summarySelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (page - 1) * MEDIA_PAGE_SIZE,
      take: MEDIA_PAGE_SIZE,
    }),
  ]);
  return { items: rows.map(summary), total, page, pageSize: MEDIA_PAGE_SIZE };
}

export async function getMedia(context: AdminContext, id: string): Promise<MediaAssetDetail> {
  requireMediaAccess(context);
  const row = await context.tx.mediaAsset.findUnique({ where: { id }, select: summarySelect });
  if (!row) throw new AuthError('NOT_FOUND');
  return detail(context.tx, row);
}

/** A cheap existence probe by content hash, used to skip the image work for a repeated upload. */
export async function findMediaByHash(
  context: AdminContext,
  sha256: string,
): Promise<MediaAssetDetail | null> {
  requireMediaAccess(context);
  const row = await context.tx.mediaAsset.findUnique({
    where: { sha256 },
    select: summarySelect,
  });
  return row ? detail(context.tx, row) : null;
}

export interface StoredMedia {
  readonly originalKey: string;
  readonly variantKeys: Readonly<Record<VariantKind, string>>;
}

/**
 * Records one processed upload whose objects are already in storage. A concurrent upload of the same bytes
 * that won the unique hash returns that asset instead (`duplicate`), and the caller discards its objects.
 */
export async function createMedia(
  context: AdminContext,
  input: {
    image: ProcessedImage;
    stored: StoredMedia;
    filename: string;
    altVi: unknown;
    altEn: unknown;
  },
): Promise<{ asset: MediaAssetDetail; duplicate: boolean }> {
  requireMediaAccess(context);
  const existing = await context.tx.mediaAsset.findUnique({
    where: { sha256: input.image.sha256 },
    select: summarySelect,
  });
  if (existing) return { asset: await detail(context.tx, existing), duplicate: true };
  const altVi = altText(input.altVi, 'altVi');
  const altEn = altText(input.altEn, 'altEn');
  const filename = displayFilename(input.filename);
  const recorded = await recordMediaAsset(context.tx, {
    image: input.image,
    stored: input.stored,
    filename,
    altVi,
    altEn,
    createdByUserId: context.actor.userId,
  });
  const created = await context.tx.mediaAsset.findUniqueOrThrow({
    where: { id: recorded.id },
    select: summarySelect,
  });
  await appendAdminAudit(context, {
    action: 'MEDIA_UPLOADED',
    entityType: 'MediaAsset',
    entityId: created.id,
    after: {
      filename,
      mime: input.image.mime,
      bytes: input.image.original.length,
      width: input.image.width,
      height: input.image.height,
      sha256: input.image.sha256,
    },
  });
  return { asset: await detail(context.tx, created), duplicate: false };
}

/** Only the base name is kept, bounded, without control characters: never a path, never trusted. */
function displayFilename(value: string): string {
  const base = value.normalize('NFC').split(/[\\/]/).pop() ?? '';
  const cleaned = base.replace(/\p{Cc}/gu, '').trim();
  const chars = [...cleaned];
  return chars.length === 0 ? 'image' : chars.slice(-200).join('');
}

export async function updateMediaAlt(
  context: AdminContext,
  id: string,
  request: MediaUpdateRequest,
): Promise<MediaAssetDetail> {
  requireMediaAccess(context);
  const altVi = altText(request.altVi, 'altVi');
  const altEn = altText(request.altEn, 'altEn');
  const [locked] = await context.tx.$queryRaw<{ row_version: number }[]>`
    SELECT row_version FROM media_assets WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if (locked.row_version !== request.expectedVersion) throw new AuthError('CONFLICT');
  const before = await context.tx.mediaAsset.findUniqueOrThrow({
    where: { id },
    select: { altVi: true, altEn: true },
  });
  if (before.altVi === altVi && before.altEn === altEn) {
    return getMedia(context, id);
  }
  // Vietnamese alt text is required before an image is used: it cannot be removed while a popup shows it.
  // A season decoration image is aria-hidden, so only popups and slides need the text.
  if (
    altVi === null &&
    before.altVi !== null &&
    (await mediaUsages(context.tx, id)).some((usage) => usage.kind !== 'SEASON')
  ) {
    throw new AuthError('MEDIA_ALT_REQUIRED', 'altVi');
  }
  const updated = await context.tx.mediaAsset.update({
    where: { id },
    data: { altVi, altEn, rowVersion: { increment: 1 } },
    select: summarySelect,
  });
  await appendAdminAudit(context, {
    action: 'MEDIA_UPDATED',
    entityType: 'MediaAsset',
    entityId: id,
    before: { altVi: before.altVi, altEn: before.altEn },
    after: { altVi, altEn },
  });
  return detail(context.tx, updated);
}

/** Removes the rows and returns the object keys for the caller to delete after the commit. */
export async function deleteMedia(
  context: AdminContext,
  id: string,
  /** Replaceable so the reference protection is testable before the popup and slider tables exist. */
  usages: MediaUsageLookup = mediaUsages,
): Promise<string[]> {
  requireWebsiteContent(context);
  const [locked] = await context.tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM media_assets WHERE id = ${id}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  if ((await usages(context.tx, id)).length > 0) throw new AuthError('MEDIA_IN_USE');
  const asset = await context.tx.mediaAsset.findUniqueOrThrow({
    where: { id },
    select: { ...summarySelect, storageKey: true, sha256: true, variants: true },
  });
  await context.tx.mediaAsset.delete({ where: { id } });
  await appendAdminAudit(context, {
    action: 'MEDIA_DELETED',
    entityType: 'MediaAsset',
    entityId: id,
    before: {
      filename: asset.originalFilename,
      mime: asset.mime,
      bytes: asset.bytes,
      width: asset.width,
      height: asset.height,
      sha256: asset.sha256,
    },
  });
  return [asset.storageKey, ...asset.variants.map((variant) => variant.storageKey)];
}

/**
 * The object to stream for one rendition, with its content hash for the ETag. Authority is decided by the
 * caller (see `MediaService.variant`): a library page asks for dozens of renditions at once, so this read
 * path takes no row locks.
 */
export async function mediaVariantObject(
  tx: Prisma.TransactionClient,
  id: string,
  kind: VariantKind,
): Promise<{ storageKey: string; sha256: string; bytes: number }> {
  const variant = await tx.mediaVariant.findUnique({
    where: { assetId_kind: { assetId: id, kind } },
    select: { storageKey: true, bytes: true, asset: { select: { sha256: true } } },
  });
  if (!variant) throw new AuthError('NOT_FOUND');
  return { storageKey: variant.storageKey, sha256: variant.asset.sha256, bytes: variant.bytes };
}

import { createHash, randomUUID } from 'node:crypto';
import type {
  ProductImageZipItem,
  ProductImageZipReason,
  ProductImageZipResponse,
} from '@lucy-spa/contracts';
import {
  discardMediaObjects,
  MediaProcessingError,
  oversizedPictureNames,
  pictureNameGuesses,
  processImage,
  putProcessedImage,
  readImageZip,
  recordMediaAsset,
  sniffImageType,
  storedKeys,
  type MediaStorage,
  type ZipPicture,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Phase 9 P9-8 (PRD 31.3): pictures from a ZIP named after the SKU. The preview reads the archive and plans (nothing is saved); the
 * apply reads the SAME file again, plans again under locks and adds the pictures. Rules:
 * - A picture is only ever ADDED to a product (after its existing ones, in the order of the number in the file name). Nothing is
 *   replaced or removed, and a file already on the product, or twice in the archive, is skipped.
 * - The SKU must match exactly one active variant; anything unclear (no such SKU, two readings of the name that both exist, the same
 *   file name twice) is skipped and reported, never guessed.
 * - Every file goes through the media library's own pipeline (type sniffed from the bytes, size and pixel limits, WebP renditions).
 * - A picture for a PUBLISHED product changes the live site: it is applied only when the person says so (`allowPublished`).
 * Authority: IMPORT_PRODUCT_DATA and MANAGE_PRODUCTS, both GLOBAL, decided inside the transaction.
 */
const GLOBAL = { kind: 'GLOBAL' } as const;
const ALT_MAX = 200;

function requireAccess(context: AdminContext): void {
  const graph = context.actor.graph;
  if (!decide(graph, 'IMPORT_PRODUCT_DATA', GLOBAL) || !decide(graph, 'MANAGE_PRODUCTS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
}

interface Planned extends ProductImageZipItem {
  picture: ZipPicture | null;
  variantProductId: string | null;
  productName: string;
  published: boolean;
}

const sha256Of = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Reads the archive; every refusal is a field the screen can name. */
export function readZip(bytes: Buffer): { pictures: ZipPicture[]; oversized: string[] } {
  try {
    const oversized = oversizedPictureNames(bytes);
    return { pictures: readImageZip(bytes), oversized };
  } catch (error) {
    const reason = Reflect.get(Object(error), 'reason');
    const field =
      reason === 'too_large'
        ? 'tooLarge'
        : reason === 'empty'
          ? 'empty'
          : reason === 'too_many_files'
            ? 'tooManyFiles'
            : reason === 'too_big_inside'
              ? 'tooBigInside'
              : 'corrupt';
    throw new AuthError('IMPORT_FILE_INVALID', field);
  }
}

async function plan(
  context: AdminContext,
  pictures: readonly ZipPicture[],
  oversized: readonly string[],
  allowPublished: boolean,
): Promise<Planned[]> {
  const { tx } = context;
  const nameCount = new Map<string, number>();
  for (const picture of pictures)
    nameCount.set(picture.name, (nameCount.get(picture.name) ?? 0) + 1);
  const wanted = new Set<string>();
  for (const picture of pictures) {
    for (const guess of pictureNameGuesses(picture.name)) wanted.add(guess.sku);
  }
  const variants = await tx.productVariant.findMany({
    where: { sku: { in: [...wanted] } },
    select: {
      id: true,
      sku: true,
      isActive: true,
      product: {
        select: {
          id: true,
          nameVi: true,
          status: true,
          images: { select: { mediaAsset: { select: { sha256: true } } } },
        },
      },
    },
  });
  const bySku = new Map(variants.map((variant) => [variant.sku, variant]));
  const out: Planned[] = [];
  const seenOnProduct = new Set<string>();
  const skip = (
    picture: ZipPicture | null,
    fileName: string,
    reason: ProductImageZipReason,
    extra: Partial<Planned> = {},
  ): Planned => ({
    fileName,
    status: 'SKIPPED',
    reason,
    sku: null,
    position: null,
    product: null,
    picture,
    variantProductId: null,
    productName: '',
    published: false,
    ...extra,
  });
  for (const name of oversized) out.push(skip(null, name, 'TOO_BIG'));
  for (const picture of [...pictures].sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
    if ((nameCount.get(picture.name) ?? 0) > 1) {
      out.push(skip(picture, picture.name, 'NAME_DUPLICATE'));
      continue;
    }
    if (!sniffImageType(picture.bytes)) {
      out.push(skip(picture, picture.name, 'NOT_AN_IMAGE'));
      continue;
    }
    const readings = pictureNameGuesses(picture.name)
      .map((guess) => ({ guess, variant: bySku.get(guess.sku) }))
      .filter((reading) => reading.variant !== undefined);
    const distinct = new Set(readings.map((reading) => reading.variant!.id));
    if (readings.length === 0) {
      out.push(skip(picture, picture.name, 'SKU_NOT_FOUND'));
      continue;
    }
    if (distinct.size > 1) {
      out.push(skip(picture, picture.name, 'SKU_AMBIGUOUS'));
      continue;
    }
    const { guess, variant } = readings[0]!;
    const product = variant!.product;
    const base = {
      sku: variant!.sku,
      position: guess.position,
      product: { id: product.id, name: product.nameVi, published: product.status === 'PUBLISHED' },
      variantProductId: product.id,
      productName: product.nameVi,
      published: product.status === 'PUBLISHED',
    };
    if (!variant!.isActive) {
      out.push(skip(picture, picture.name, 'VARIANT_INACTIVE', base));
      continue;
    }
    const hash = sha256Of(picture.bytes);
    const key = `${product.id}:${hash}`;
    if (seenOnProduct.has(key)) {
      out.push(skip(picture, picture.name, 'SAME_FILE_IN_ZIP', base));
      continue;
    }
    seenOnProduct.add(key);
    if (product.images.some((image) => image.mediaAsset.sha256 === hash)) {
      out.push(skip(picture, picture.name, 'ALREADY_ON_PRODUCT', base));
      continue;
    }
    if (product.status === 'PUBLISHED' && !allowPublished) {
      out.push({
        ...base,
        fileName: picture.name,
        status: 'READY',
        picture,
      });
      continue;
    }
    out.push({ ...base, fileName: picture.name, status: 'READY', picture });
  }
  return out;
}

const present = (
  items: readonly Planned[],
  sha256: string,
  added: number,
): ProductImageZipResponse => {
  const shown: ProductImageZipItem[] = items.map((item) => ({
    fileName: item.fileName,
    status: item.status,
    ...(item.reason ? { reason: item.reason } : {}),
    sku: item.sku,
    position: item.position,
    product: item.product,
  }));
  const ready = items.filter((item) => item.status === 'READY' || item.status === 'ADDED');
  return {
    sha256,
    items: shown,
    ready: ready.length,
    skipped: items.length - ready.length,
    publishedPictures: ready.filter((item) => item.published).length,
    products: new Set(ready.map((item) => item.variantProductId)).size,
    added,
  };
};

export async function previewZip(
  context: AdminContext,
  bytes: Buffer,
): Promise<ProductImageZipResponse> {
  requireAccess(context);
  const { pictures, oversized } = readZip(bytes);
  const items = await plan(context, pictures, oversized, true);
  return present(items, sha256Of(bytes), 0);
}

export async function applyZip(
  context: AdminContext,
  bytes: Buffer,
  request: { expectedSha256: string; allowPublished: boolean },
  storage: MediaStorage,
): Promise<ProductImageZipResponse> {
  requireAccess(context);
  const sha256 = sha256Of(bytes);
  // The person confirms the file they previewed: a different file is refused.
  if (request.expectedSha256 !== sha256) throw new AuthError('IMPORT_PREVIEW_STALE');
  const { tx } = context;
  const { pictures, oversized } = readZip(bytes);
  // The products' rows are locked in id order, then the plan is read again under those locks.
  const first = await plan(context, pictures, oversized, request.allowPublished);
  const productIds = [
    ...new Set(
      first.map((item) => item.variantProductId).filter((id): id is string => id !== null),
    ),
  ].sort();
  for (const id of productIds) {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
  }
  const items = await plan(context, pictures, oversized, request.allowPublished);
  const todo = items
    .filter(
      (item) => item.status === 'READY' && item.picture !== null && item.variantProductId !== null,
    )
    .sort(
      (a, b) =>
        a.variantProductId!.localeCompare(b.variantProductId!) ||
        (a.position ?? 1) - (b.position ?? 1) ||
        a.fileName.localeCompare(b.fileName, 'en'),
    );
  const nextOrder = new Map<string, number>();
  const newObjects: string[] = [];
  let added = 0;
  try {
    for (const item of todo) {
      if (item.published && !request.allowPublished) {
        item.status = 'SKIPPED';
        item.reason = 'PUBLISHED_NOT_ALLOWED';
        continue;
      }
      const productId = item.variantProductId!;
      let processed;
      try {
        processed = await processImage(Buffer.from(item.picture!.bytes));
      } catch (error) {
        if (!(error instanceof MediaProcessingError)) throw error;
        item.status = 'SKIPPED';
        item.reason = 'IMAGE_INVALID';
        continue;
      }
      const stored = await putProcessedImage(storage, processed);
      const savepoint = `zip_${randomUUID().replaceAll('-', '')}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
      try {
        const recorded = await recordMediaAsset(tx, {
          image: processed,
          stored,
          filename: item.fileName.replace(/\.[^.]+$/, '').slice(0, 120),
          altVi: item.productName.slice(0, ALT_MAX),
          altEn: null,
          createdByUserId: context.actor.userId,
        });
        if (recorded.duplicate) await discardMediaObjects(storage, storedKeys(stored));
        else newObjects.push(...storedKeys(stored));
        const held = await tx.productImage.findUnique({
          where: { productId_mediaAssetId: { productId, mediaAssetId: recorded.id } },
          select: { id: true },
        });
        if (held) {
          item.status = 'SKIPPED';
          item.reason = 'ALREADY_ON_PRODUCT';
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
          continue;
        }
        let order = nextOrder.get(productId);
        if (order === undefined) {
          const last = await tx.productImage.aggregate({
            where: { productId },
            _max: { sortOrder: true },
          });
          order = (last._max.sortOrder ?? -1) + 1;
        }
        const created = await tx.productImage.create({
          data: {
            productId,
            mediaAssetId: recorded.id,
            sortOrder: order,
            createdByUserId: context.actor.userId,
          },
          select: { id: true },
        });
        nextOrder.set(productId, order + 1);
        await appendAdminAudit(context, {
          action: 'PRODUCT_IMAGE_ADDED',
          entityType: 'Product',
          entityId: productId,
          after: {
            imageId: created.id,
            mediaAssetId: recorded.id,
            source: 'ZIP',
            fileName: item.fileName,
          },
        });
        await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
        item.status = 'ADDED';
        added += 1;
      } catch (error) {
        await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        await discardMediaObjects(storage, storedKeys(stored));
        throw error;
      }
    }
  } catch (error) {
    // The transaction rolls back: the objects of the assets it recorded must not be left behind.
    await discardMediaObjects(storage, newObjects);
    throw error;
  }
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMAGES_ZIP_APPLIED',
    entityType: 'Product',
    entityId: context.actor.userId,
    after: { sha256, added, skipped: items.length - added, allowPublished: request.allowPublished },
  });
  return present(items, sha256, added);
}

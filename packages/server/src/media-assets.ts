import type { Prisma } from '@lucy-spa/database';
import type { MediaStorage } from './media-storage.js';
import { newMediaKey } from './media-storage.js';
import type { ProcessedImage, VariantKind } from './media-processing.js';

/**
 * Storing a processed image and recording its media asset rows, shared by the API (uploads) and the worker (supplier images, P9-4).
 * Objects are written first and recorded second; when the rows are not the ones recorded (a concurrent identical upload won the unique
 * hash) the caller discards the objects again.
 */
export interface StoredMedia {
  readonly originalKey: string;
  readonly variantKeys: Readonly<Record<VariantKind, string>>;
}

export const storedKeys = (stored: StoredMedia): string[] => [
  stored.originalKey,
  ...Object.values(stored.variantKeys),
];

/** Writes the original and the three renditions under fresh random keys; on a failure the objects already written are removed. */
export async function putProcessedImage(
  storage: MediaStorage,
  image: ProcessedImage,
  now: Date = new Date(),
): Promise<StoredMedia> {
  const originalKey = newMediaKey(image.extension, now);
  const variantKeys = Object.fromEntries(
    image.variants.map((variant) => [
      variant.kind,
      newMediaKey('webp', now, variant.kind.toLowerCase()),
    ]),
  ) as StoredMedia['variantKeys'];
  const stored: StoredMedia = { originalKey, variantKeys };
  try {
    await storage.put(originalKey, image.original, image.mime);
    for (const variant of image.variants) {
      await storage.put(variantKeys[variant.kind], variant.bytes, 'image/webp');
    }
  } catch (error) {
    await discardMediaObjects(storage, storedKeys(stored));
    throw error;
  }
  return stored;
}

/** Removes objects; a key that cannot be removed is reported to `onFailure` and left orphaned (never an error). */
export async function discardMediaObjects(
  storage: MediaStorage,
  keys: readonly string[],
  onFailure?: () => void,
): Promise<void> {
  for (const key of keys) {
    try {
      await storage.delete(key);
    } catch {
      onFailure?.();
    }
  }
}

/**
 * Records one processed image: the asset with its renditions, or, when the same bytes are already in the library, that asset
 * (`duplicate`). Alt text and the display filename arrive already normalized.
 */
export async function recordMediaAsset(
  tx: Prisma.TransactionClient,
  input: {
    image: ProcessedImage;
    stored: StoredMedia;
    filename: string;
    altVi: string | null;
    altEn: string | null;
    createdByUserId: string;
  },
): Promise<{ id: string; duplicate: boolean }> {
  const existing = await tx.mediaAsset.findUnique({
    where: { sha256: input.image.sha256 },
    select: { id: true },
  });
  if (existing) return { id: existing.id, duplicate: true };
  const created = await tx.mediaAsset.create({
    data: {
      storageKey: input.stored.originalKey,
      originalFilename: input.filename,
      mime: input.image.mime,
      bytes: input.image.original.length,
      width: input.image.width,
      height: input.image.height,
      sha256: input.image.sha256,
      altVi: input.altVi,
      altEn: input.altEn,
      createdByUserId: input.createdByUserId,
      variants: {
        create: input.image.variants.map((variant) => ({
          kind: variant.kind,
          storageKey: input.stored.variantKeys[variant.kind],
          width: variant.width,
          height: variant.height,
          bytes: variant.bytes.length,
        })),
      },
    },
    select: { id: true },
  });
  return { id: created.id, duplicate: false };
}

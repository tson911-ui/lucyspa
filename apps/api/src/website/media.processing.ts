import {
  MediaProcessingError,
  processImage as processSharedImage,
  type ProcessedImage,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';

/**
 * The image pipeline lives in `@lucy-spa/server` (the worker shares it for supplier images, Phase 9 P9-4). The API keeps this module as
 * its entry point: the same names as before, with failures turned into the API's own error codes.
 */
export {
  MEDIA_LIMITS,
  sha256Hex,
  sniffImageType,
  VARIANT_KINDS,
  VARIANT_WIDTHS,
  type MediaMime,
  type ProcessedImage,
  type ProcessedVariant,
  type VariantKind,
} from '@lucy-spa/server';

/** Validates and re-encodes one upload. Every failure is a typed error the uploader can show verbatim. */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  try {
    return await processSharedImage(input);
  } catch (error) {
    if (error instanceof MediaProcessingError) throw new AuthError(error.code);
    throw error;
  }
}

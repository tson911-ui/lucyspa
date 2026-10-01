import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AuthError } from '../auth/auth.error.js';

/** Design 16.3 / Q-CM8: JPEG, PNG or WebP only; 10 MB and 6000 px per side at most. */
export const MEDIA_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, maxSide: 6000 });

/** The three WebP renditions (design 16.2). Never enlarged: a small image keeps its own width. */
export const VARIANT_WIDTHS = Object.freeze({ THUMB: 320, MD: 960, LG: 1920 } as const);
export type VariantKind = keyof typeof VARIANT_WIDTHS;
export const VARIANT_KINDS = Object.freeze(Object.keys(VARIANT_WIDTHS) as VariantKind[]);

export type MediaMime = 'image/jpeg' | 'image/png' | 'image/webp';
interface SniffedType {
  readonly mime: MediaMime;
  readonly extension: 'jpg' | 'png' | 'webp';
  readonly format: 'jpeg' | 'png' | 'webp';
}

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * The type comes from the file's own magic bytes; the client MIME and the filename are never consulted.
 * Anything else (SVG, GIF, PDF, video, HTML, ...) is refused before an image decoder sees a byte.
 */
export function sniffImageType(bytes: Uint8Array): SniffedType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', extension: 'jpg', format: 'jpeg' };
  }
  if (bytes.length >= 8 && PNG.every((value, index) => bytes[index] === value)) {
    return { mime: 'image/png', extension: 'png', format: 'png' };
  }
  if (
    bytes.length >= 12 &&
    Buffer.from(bytes.subarray(0, 4)).toString('latin1') === 'RIFF' &&
    Buffer.from(bytes.subarray(8, 12)).toString('latin1') === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp', format: 'webp' };
  }
  return null;
}

export interface ProcessedVariant {
  readonly kind: VariantKind;
  readonly bytes: Buffer;
  readonly width: number;
  readonly height: number;
}

export interface ProcessedImage {
  readonly mime: MediaMime;
  readonly extension: 'jpg' | 'png' | 'webp';
  readonly original: Buffer;
  readonly sha256: string;
  /** Display dimensions: EXIF orientation applied. */
  readonly width: number;
  readonly height: number;
  readonly variants: readonly ProcessedVariant[];
}

export const sha256Hex = (bytes: Uint8Array): string =>
  createHash('sha256').update(bytes).digest('hex');

/** Pixels an upload may decode: the side limit squared. Stops decompression bombs before decoding. */
const LIMIT_INPUT_PIXELS = MEDIA_LIMITS.maxSide * MEDIA_LIMITS.maxSide;

/**
 * Validates and re-encodes one upload. The original is kept byte for byte (PRD 53) but is never served; the
 * renditions are auto-oriented WebP without any EXIF/GPS metadata (sharp drops it unless asked to keep it).
 * Every failure is a typed error the uploader can show verbatim.
 */
export async function processImage(input: Buffer): Promise<ProcessedImage> {
  if (input.length === 0) throw new AuthError('MEDIA_INVALID_IMAGE');
  if (input.length > MEDIA_LIMITS.maxBytes) throw new AuthError('MEDIA_TOO_LARGE');
  const type = sniffImageType(input);
  if (!type) throw new AuthError('MEDIA_TYPE_UNSUPPORTED');
  try {
    const open = () => sharp(input, { limitInputPixels: LIMIT_INPUT_PIXELS, failOn: 'error' });
    const meta = await open().metadata();
    if (meta.format !== type.format || !meta.width || !meta.height) {
      throw new AuthError('MEDIA_INVALID_IMAGE');
    }
    // Animated images (multi-frame WebP) are not part of this feature.
    if ((meta.pages ?? 1) > 1) throw new AuthError('MEDIA_INVALID_IMAGE');
    const turned = (meta.orientation ?? 1) >= 5;
    const width = turned ? meta.height : meta.width;
    const height = turned ? meta.width : meta.height;
    if (width > MEDIA_LIMITS.maxSide || height > MEDIA_LIMITS.maxSide) {
      throw new AuthError('MEDIA_DIMENSIONS_TOO_LARGE');
    }
    const variants: ProcessedVariant[] = [];
    for (const kind of VARIANT_KINDS) {
      const { data, info } = await open()
        .rotate()
        .resize({ width: VARIANT_WIDTHS[kind], withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer({ resolveWithObject: true });
      variants.push({ kind, bytes: data, width: info.width, height: info.height });
    }
    return {
      mime: type.mime,
      extension: type.extension,
      original: input,
      sha256: sha256Hex(input),
      width,
      height,
      variants,
    };
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // libvips messages can echo file details; the transport only ever sees the typed code.
    throw new AuthError('MEDIA_INVALID_IMAGE');
  }
}

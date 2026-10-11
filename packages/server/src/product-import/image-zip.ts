import { unzipSync, zipSync, type UnzipFileInfo } from 'fflate';

/**
 * Phase 9 P9-8 (PRD 31.3): the pure side of the bulk image workflow. A ZIP of pictures named after the SKU ("WHOO001-1.jpg",
 * "WHOO001-2.jpg", or "WHOO001.jpg" for a single one) is read into entries and each file name is turned into candidate (SKU,
 * position) pairs. Nothing here touches the database or writes a file: names are only text (a zip entry name never becomes a path),
 * and the size limits are checked on what the archive DECLARES before anything is inflated, so a decompression bomb is refused cheaply.
 */
export const IMAGE_ZIP_LIMITS = Object.freeze({
  /** The archive itself. */
  maxBytes: 100 * 1024 * 1024,
  /** Picture files in one archive. */
  maxFiles: 400,
  /** One picture (the media library's own limit). */
  maxFileBytes: 10 * 1024 * 1024,
  /** Everything inflated together. */
  maxTotalBytes: 300 * 1024 * 1024,
});

export type ImageZipFailure =
  'too_large' | 'corrupt' | 'empty' | 'too_many_files' | 'too_big_inside';

export class ImageZipError extends Error {
  constructor(readonly reason: ImageZipFailure) {
    super(`image zip refused: ${reason}`);
    this.name = 'ImageZipError';
  }
}

const IMAGE_EXTENSION = /\.(jpe?g|png|webp)$/i;

/** A zip entry that is a picture the intake can look at: a file (not a folder), not a system file, with a picture extension. */
export function isPictureEntry(name: string): boolean {
  if (name.endsWith('/')) return false;
  const base = baseName(name);
  if (base.startsWith('.') || name.startsWith('__MACOSX/') || name.includes('/__MACOSX/'))
    return false;
  return IMAGE_EXTENSION.test(base);
}

/** The file name of an entry without any folder part (backslashes too: some tools write them). */
export function baseName(name: string): string {
  return name.split(/[\\/]/).pop() ?? '';
}

export interface ZipPicture {
  /** The file name without a folder, normalized to NFC. */
  name: string;
  bytes: Uint8Array;
}

/** Reads the archive. Everything is checked against the declared sizes first; only picture entries are inflated. */
export function readImageZip(bytes: Uint8Array): ZipPicture[] {
  if (bytes.length === 0) throw new ImageZipError('empty');
  if (bytes.length > IMAGE_ZIP_LIMITS.maxBytes) throw new ImageZipError('too_large');
  // The ZIP signature of a non-empty archive.
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) throw new ImageZipError('corrupt');
  let declared = 0;
  let files = 0;
  try {
    // Pass 1: nothing is inflated; the directory is only counted.
    unzipSync(bytes, {
      filter: (info: UnzipFileInfo) => {
        if (isPictureEntry(info.name)) {
          files += 1;
          declared += info.originalSize;
          if (files > IMAGE_ZIP_LIMITS.maxFiles) throw new ImageZipError('too_many_files');
          if (declared > IMAGE_ZIP_LIMITS.maxTotalBytes) throw new ImageZipError('too_big_inside');
        }
        return false;
      },
    });
  } catch (error) {
    if (error instanceof ImageZipError) throw error;
    throw new ImageZipError('corrupt');
  }
  if (files === 0) throw new ImageZipError('empty');
  let entries: Record<string, Uint8Array>;
  try {
    // Pass 2: only the pictures, each one within its own limit (a larger one is kept out and reported by the caller as too big).
    entries = unzipSync(bytes, {
      filter: (info: UnzipFileInfo) =>
        isPictureEntry(info.name) && info.originalSize <= IMAGE_ZIP_LIMITS.maxFileBytes,
    });
  } catch {
    throw new ImageZipError('corrupt');
  }
  return Object.entries(entries).map(([name, data]) => ({
    name: baseName(name).normalize('NFC'),
    bytes: data,
  }));
}

/** The names of the pictures the archive holds that are over the single-file limit (never inflated). */
export function oversizedPictureNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  unzipSync(bytes, {
    filter: (info: UnzipFileInfo) => {
      if (isPictureEntry(info.name) && info.originalSize > IMAGE_ZIP_LIMITS.maxFileBytes) {
        names.push(baseName(info.name).normalize('NFC'));
      }
      return false;
    },
  });
  return names;
}

export interface PictureNameGuess {
  sku: string;
  /** 1-based position among the product's pictures (the file name's number; 1 when it has none). */
  position: number;
}

/**
 * The (SKU, position) readings of a picture file name, best first. "WHOO001-2.jpg" is SKU WHOO001 position 2, and also (when no
 * such SKU exists) a SKU called "WHOO001-2" at position 1: a SKU may itself contain a dash. The caller keeps the reading whose SKU
 * exists and says so when both do (ambiguous: never guessed).
 */
export function pictureNameGuesses(fileName: string): PictureNameGuess[] {
  const stem = fileName.replace(IMAGE_EXTENSION, '').trim();
  if (stem === '') return [];
  const guesses: PictureNameGuess[] = [];
  const numbered = /^(.+?)[-_ ](\d{1,2})$/.exec(stem);
  if (numbered) {
    const position = Number(numbered[2]);
    if (position >= 1) guesses.push({ sku: numbered[1]!.trim().toUpperCase(), position });
  }
  guesses.push({ sku: stem.toUpperCase(), position: 1 });
  return guesses;
}

/** Builds an archive from file name to bytes (the export of pictures and the tests). */
export function buildZip(files: Readonly<Record<string, Uint8Array>>): Uint8Array {
  return zipSync({ ...files });
}

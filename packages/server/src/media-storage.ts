import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { link, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Readable } from 'node:stream';

/**
 * Website media storage (UX/UI design 16.3). Database rows hold only opaque keys, never paths or URLs, so
 * the local-disk implementation below can be replaced by an S3-compatible one by configuration alone.
 */
export interface MediaStorage {
  put(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  get(key: string): Promise<{ stream: Readable; bytes: number }>;
  /** Deleting a missing key is a no-op: a retry after a partial failure must succeed. */
  delete(key: string): Promise<void>;
  /** A directly reachable URL, or null when the object is only served through the API (local disk). */
  publicUrl(key: string): string | null;
}

export class MediaNotFoundError extends Error {
  constructor() {
    super('Media object not found.');
    this.name = 'MediaNotFoundError';
  }
}

/** `{yyyy}/{mm}/{uuid}[-variant].{ext}`: random, never derived from a filename. */
const KEY =
  /^\d{4}\/\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-[a-z]+)?\.[a-z]{3,4}$/;

export function isMediaKey(value: unknown): value is string {
  return typeof value === 'string' && KEY.test(value);
}

/** A fresh random key. `variant` adds a suffix so every rendition of one upload has its own object. */
export function newMediaKey(extension: string, now: Date, variant?: string): string {
  const year = String(now.getUTCFullYear()).padStart(4, '0');
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const key = `${year}/${month}/${randomUUID()}${variant ? `-${variant}` : ''}.${extension}`;
  if (!isMediaKey(key)) throw new Error('Invalid media key parts.');
  return key;
}

export class LocalDiskMediaStorage implements MediaStorage {
  private readonly root: string;

  constructor(directory: string) {
    if (!path.isAbsolute(directory)) throw new Error('Media storage directory must be absolute.');
    this.root = path.resolve(directory);
  }

  /** Resolve a key to a file inside the root; any key that is not one of ours is refused. */
  private locate(key: string): string {
    if (!isMediaKey(key)) throw new MediaNotFoundError();
    const file = path.resolve(this.root, ...key.split('/'));
    if (!file.startsWith(this.root + path.sep)) throw new MediaNotFoundError();
    return file;
  }

  async put(key: string, bytes: Uint8Array): Promise<void> {
    const file = this.locate(key);
    await mkdir(path.dirname(file), { recursive: true });
    // Write a private temp file, then publish it with a hard link: atomic (a reader never sees a
    // half-written object) and it fails with EEXIST instead of replacing an existing key.
    const partial = `${file}.${randomUUID()}.part`;
    try {
      await writeFile(partial, bytes, { flag: 'wx', mode: 0o640 });
      await link(partial, file);
    } finally {
      await rm(partial, { force: true });
    }
  }

  async get(key: string): Promise<{ stream: Readable; bytes: number }> {
    const file = this.locate(key);
    try {
      const info = await stat(file);
      if (!info.isFile()) throw new MediaNotFoundError();
      return { stream: createReadStream(file), bytes: info.size };
    } catch (error) {
      if (Reflect.get(Object(error), 'code') === 'ENOENT') throw new MediaNotFoundError();
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.locate(key), { force: true });
  }

  publicUrl(): string | null {
    return null;
  }
}

/**
 * `MEDIA_STORAGE_DIR`: an absolute path outside the repository and the release folder (so deploys never wipe
 * it). Required in production; development and tests default to a folder under the OS temp directory.
 * Only the variable NAME is ever reported.
 */
export function parseMediaStorageDirectory(
  env: NodeJS.ProcessEnv,
  nodeEnv: 'development' | 'test' | 'production',
): string {
  const value = env['MEDIA_STORAGE_DIR']?.trim() ?? '';
  if (value === '') {
    if (nodeEnv === 'production') {
      throw new Error('Invalid environment configuration: MEDIA_STORAGE_DIR');
    }
    return path.join(tmpdir(), `lucy-spa-media-${nodeEnv}`);
  }
  if (!path.isAbsolute(value))
    throw new Error('Invalid environment configuration: MEDIA_STORAGE_DIR');
  return path.resolve(value);
}

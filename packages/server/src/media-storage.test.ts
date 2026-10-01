import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  isMediaKey,
  LocalDiskMediaStorage,
  MediaNotFoundError,
  newMediaKey,
  parseMediaStorageDirectory,
} from './media-storage.js';

async function chunks(stream: AsyncIterable<Uint8Array>): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  for await (const part of stream) parts.push(part);
  return Buffer.concat(parts);
}

test('keys are random, dated, opaque and never path-like', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const first = newMediaKey('webp', now);
  assert.match(first, /^2026\/10\/[0-9a-f-]{36}\.webp$/);
  assert.notEqual(first, newMediaKey('webp', now));
  assert.match(newMediaKey('webp', now, 'thumb'), /-thumb\.webp$/);
  for (const bad of [
    '../etc/passwd',
    '2026/10/../../x.webp',
    '/abs/path.webp',
    '2026/10/not-a-uuid.webp',
    'C:\\x.webp',
    '',
  ]) {
    assert.equal(isMediaKey(bad), false, bad);
  }
});

test('local disk storage: put, get, idempotent delete, no overwrite, no escape', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'lucy-media-test-'));
  try {
    const storage = new LocalDiskMediaStorage(root);
    const key = newMediaKey('png', new Date('2026-10-01T00:00:00Z'));
    await storage.put(key, Buffer.from('hello'));
    const stored = await storage.get(key);
    assert.equal(stored.bytes, 5);
    assert.equal((await chunks(stored.stream)).toString(), 'hello');
    await assert.rejects(storage.put(key, Buffer.from('again')), /EEXIST/);
    assert.deepEqual(await readdir(path.join(root, '2026', '10')), [path.basename(key)]);
    await storage.delete(key);
    await storage.delete(key);
    await assert.rejects(storage.get(key), MediaNotFoundError);
    await assert.rejects(storage.get('../../outside.png'), MediaNotFoundError);
    await assert.rejects(storage.put('../../outside.png', Buffer.from('x')), MediaNotFoundError);
    assert.equal(storage.publicUrl(), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a relative storage directory is refused', () => {
  assert.throws(() => new LocalDiskMediaStorage('relative/dir'), /absolute/);
});

test('MEDIA_STORAGE_DIR: required and absolute in production, temp default elsewhere, names only', () => {
  assert.throws(
    () => parseMediaStorageDirectory({}, 'production'),
    /Invalid environment configuration: MEDIA_STORAGE_DIR$/,
  );
  assert.throws(
    () => parseMediaStorageDirectory({ MEDIA_STORAGE_DIR: 'relative/secret-path' }, 'production'),
    (error: Error) => !error.message.includes('secret-path'),
  );
  const absolute = path.resolve(tmpdir(), 'lucy-media-prod');
  assert.equal(parseMediaStorageDirectory({ MEDIA_STORAGE_DIR: absolute }, 'production'), absolute);
  assert.equal(
    parseMediaStorageDirectory({}, 'development'),
    path.join(tmpdir(), 'lucy-spa-media-development'),
  );
});

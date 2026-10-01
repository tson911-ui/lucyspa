import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import { AuthError } from '../auth/auth.error.js';
import { MEDIA_LIMITS, processImage, sha256Hex, sniffImageType } from './media.processing.js';

const solid = (width: number, height: number) => ({
  create: { width, height, channels: 3 as const, background: { r: 120, g: 43, b: 55 } },
});
const png = (width: number, height: number) => sharp(solid(width, height)).png().toBuffer();
const jpeg = (width: number, height: number) => sharp(solid(width, height)).jpeg().toBuffer();

async function rejection(input: Buffer): Promise<string | undefined> {
  try {
    await processImage(input);
  } catch (error) {
    return error instanceof AuthError ? error.code : `unexpected: ${String(error)}`;
  }
  return undefined;
}

test('type comes from magic bytes only; SVG, GIF, PDF, HTML and polyglots are refused', async () => {
  assert.equal(sniffImageType(await png(8, 8))?.mime, 'image/png');
  assert.equal(sniffImageType(await jpeg(8, 8))?.mime, 'image/jpeg');
  assert.equal(sniffImageType(await sharp(solid(8, 8)).webp().toBuffer())?.mime, 'image/webp');
  const refused: [string, Buffer][] = [
    ['svg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')],
    ['gif', Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1')],
    ['pdf', Buffer.from('%PDF-1.7\n')],
    ['html', Buffer.from('<!doctype html><script>1</script>')],
    ['riff but not webp', Buffer.from('RIFF\x00\x00\x00\x00WAVEfmt ', 'latin1')],
    ['png prefix too short', Buffer.from([0x89, 0x50, 0x4e, 0x47])],
  ];
  for (const [name, bytes] of refused) {
    assert.equal(await rejection(bytes), 'MEDIA_TYPE_UNSUPPORTED', name);
  }
  assert.equal(await rejection(Buffer.alloc(0)), 'MEDIA_INVALID_IMAGE');
});

test('a file with image magic but corrupt content is an invalid image, not a crash', async () => {
  const good = await png(40, 40);
  assert.equal(await rejection(good.subarray(0, 30)), 'MEDIA_INVALID_IMAGE');
  const truncated = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(64, 1)]);
  assert.equal(await rejection(truncated), 'MEDIA_INVALID_IMAGE');
});

test('limits: 10 MB and 6000 px per side', async () => {
  assert.equal(await rejection(Buffer.alloc(MEDIA_LIMITS.maxBytes + 1, 0xff)), 'MEDIA_TOO_LARGE');
  assert.equal(await rejection(await png(6001, 1)), 'MEDIA_DIMENSIONS_TOO_LARGE');
  assert.equal(await rejection(await png(1, 6001)), 'MEDIA_DIMENSIONS_TOO_LARGE');
  const edge = await processImage(await png(6000, 2));
  assert.equal(edge.width, 6000);
});

test('three WebP renditions, never enlarged, original kept byte for byte, hash of the original', async () => {
  const original = await jpeg(4000, 1000);
  const image = await processImage(original);
  assert.equal(image.mime, 'image/jpeg');
  assert.equal(image.extension, 'jpg');
  assert.equal(image.original, original);
  assert.equal(image.sha256, sha256Hex(original));
  assert.deepEqual([image.width, image.height], [4000, 1000]);
  assert.deepEqual(
    image.variants.map((variant) => [variant.kind, variant.width, variant.height]),
    [
      ['THUMB', 320, 80],
      ['MD', 960, 240],
      ['LG', 1920, 480],
    ],
  );
  for (const variant of image.variants) {
    const meta = await sharp(variant.bytes).metadata();
    assert.equal(meta.format, 'webp');
    assert.equal(meta.width, variant.width);
  }
  const small = await processImage(await png(200, 100));
  assert.deepEqual(
    small.variants.map((variant) => variant.width),
    [200, 200, 200],
    'a small image keeps its own width',
  );
});

test('EXIF orientation is applied to display size and renditions; EXIF and GPS never reach a rendition', async () => {
  const tagged = await sharp(solid(400, 200))
    .jpeg()
    .withExif({ IFD0: { Copyright: 'secret-owner' }, IFD3: { GPSLatitudeRef: 'N' } })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  assert.equal((await sharp(tagged).metadata()).orientation, 6);
  const image = await processImage(tagged);
  assert.deepEqual([image.width, image.height], [200, 400], 'display size is the rotated size');
  for (const variant of image.variants) {
    const meta = await sharp(variant.bytes).metadata();
    assert.deepEqual([meta.width, meta.height], [variant.width, variant.height]);
    assert.ok(variant.height > variant.width, 'rendition is upright');
    assert.equal(meta.exif, undefined, 'no EXIF in a rendition');
    assert.ok(!variant.bytes.includes(Buffer.from('secret-owner')));
  }
  // The original is kept untouched (PRD 53).
  assert.equal(image.original, tagged);
});

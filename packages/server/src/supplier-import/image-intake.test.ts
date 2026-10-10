import assert from 'node:assert/strict';
import { test } from 'node:test';
import sharp from 'sharp';
import {
  differenceHash,
  hammingDistance,
  MediaProcessingError,
  processImage,
} from '../media-processing.js';
import { imageFilename, isPlaceholderImage, NEAR_DUPLICATE_DISTANCE } from './image-intake.js';

/** Blocky grey patches from a seed (64x64): different seeds look different, the same seed is the same picture. */
async function picture(seed: number, format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
  let state = (seed * 2_654_435_761) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const blocks = Array.from({ length: 64 }, () => Math.floor(next() * 256));
  const pixels = Buffer.alloc(64 * 64);
  for (let y = 0; y < 64; y += 1) {
    for (let x = 0; x < 64; x += 1) {
      pixels[y * 64 + x] = blocks[Math.floor(y / 8) * 8 + Math.floor(x / 8)] as number;
    }
  }
  const image = sharp(pixels, { raw: { width: 64, height: 64, channels: 1 } });
  return format === 'png' ? image.png().toBuffer() : image.jpeg({ quality: 70 }).toBuffer();
}

test('the difference hash is 16 hex digits, equal for the same picture, close for a re-compressed copy, far for another picture', async () => {
  const a = await differenceHash(await picture(7));
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await differenceHash(await picture(7)));
  const copy = await differenceHash(await picture(7, 'jpeg'));
  assert.ok(
    hammingDistance(a, copy) <= NEAR_DUPLICATE_DISTANCE,
    `copy ${hammingDistance(a, copy)}`,
  );
  for (const seed of [8, 99, 1234, 5]) {
    const other = await differenceHash(await picture(seed));
    assert.ok(hammingDistance(a, other) > NEAR_DUPLICATE_DISTANCE, `seed ${seed}`);
  }
});

test('hamming distance counts differing bits', () => {
  assert.equal(hammingDistance('0'.repeat(64), '0'.repeat(64)), 0);
  assert.equal(hammingDistance('0'.repeat(64), 'f'.repeat(64)), 256);
  assert.equal(hammingDistance('0'.repeat(63) + '1', '8' + '0'.repeat(63)), 2);
});

test('the shared pipeline refuses what is not a picture, with typed errors', async () => {
  for (const [bytes, code] of [
    [Buffer.alloc(0), 'MEDIA_INVALID_IMAGE'],
    [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), 'MEDIA_TYPE_UNSUPPORTED'],
    [Buffer.from('GIF89a'), 'MEDIA_TYPE_UNSUPPORTED'],
    [Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]), 'MEDIA_INVALID_IMAGE'],
  ] as const) {
    await assert.rejects(
      processImage(bytes),
      (error) => error instanceof MediaProcessingError && error.code === code,
      code,
    );
  }
  const ok = await processImage(await picture(3));
  assert.equal(ok.mime, 'image/png');
  assert.equal(ok.variants.length, 3);
  assert.match(ok.sha256, /^[0-9a-f]{64}$/);
});

test('a stock placeholder is not a picture of the product', () => {
  assert.equal(
    isPlaceholderImage('https://shop.example/wp-content/uploads/woocommerce-placeholder.png'),
    true,
  );
  assert.equal(
    isPlaceholderImage('https://shop.example/wp-content/uploads/2026/10/Placeholder-300x300.jpg'),
    true,
  );
  assert.equal(
    isPlaceholderImage('https://shop.example/wp-content/uploads/2026/10/kem-duong.jpg'),
    false,
  );
  assert.equal(isPlaceholderImage('not a url'), true);
});

test('the library filename is plain ASCII: the product name, the source id and the position', () => {
  assert.equal(
    imageFilename('Kem Dưỡng Ẩm Đặc Biệt <b>50ml</b>', '123', 0),
    'kem-duong-am-dac-biet-50ml-123-01',
  );
  assert.equal(imageFilename('!!!', '9', 5), 'product-9-06');
  assert.ok(imageFilename('x'.repeat(500), '1', 0).length < 140);
});

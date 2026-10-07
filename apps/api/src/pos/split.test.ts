import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cumulativeShare, splitProRata } from './split.js';

/** Phase 6 P6-9 (T18): the one proportional-split primitive (design 6.4). */

function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const abs = (value: bigint) => (value < 0n ? -value : value);

test('design 6.8 case D: nets 90,000 and 180,000 from a 30,000 discount over 100,000 and 200,000', () => {
  assert.deepEqual(splitProRata(30_000n, [100_000n, 200_000n]), [10_000n, 20_000n]);
});

test('design 6.8 case B and C: the shared voucher is split by side amount', () => {
  assert.deepEqual(splitProRata(100_000n, [300_000n, 200_000n]), [60_000n, 40_000n]);
  assert.deepEqual(splitProRata(30_000n, [300_000n, 200_000n]), [18_000n, 12_000n]);
});

test('half up on the cumulative value, parts always add up', () => {
  // 100 over 1:1:1 = 33.33 each; cumulative 33, 67, 100.
  assert.deepEqual(splitProRata(100n, [1n, 1n, 1n]), [33n, 34n, 33n]);
  // An exact half rounds up: 1 over 1:1 = 0.5 -> the first part takes it, the second gets the rest.
  assert.deepEqual(splitProRata(1n, [1n, 1n]), [1n, 0n]);
  assert.deepEqual(splitProRata(3n, [1n, 1n]), [2n, 1n]);
  assert.equal(cumulativeShare(3n, 1n, 2n), 2n);
});

test('a zero weight gets zero; an all-zero list can only split zero', () => {
  assert.deepEqual(splitProRata(10n, [0n, 5n, 0n]), [0n, 10n, 0n]);
  assert.deepEqual(splitProRata(0n, [0n, 0n]), [0n, 0n]);
  assert.deepEqual(splitProRata(0n, []), []);
  assert.throws(() => splitProRata(1n, [0n, 0n]), RangeError);
  assert.throws(() => splitProRata(-1n, [1n]), RangeError);
  assert.throws(() => splitProRata(1n, [-1n, 2n]), RangeError);
});

test('a single weight takes the whole total; the last part takes the remainder', () => {
  assert.deepEqual(splitProRata(12_345n, [7n]), [12_345n]);
  // Refund units: 1,500 over the 3 units of a 3,000 line.
  assert.deepEqual(splitProRata(3_000n, [1n, 1n, 1n]), [1_000n, 1_000n, 1_000n]);
});

test('properties over 5,000 random splits: exact sum, within 1 VND of proportional, deterministic, order-stable', () => {
  const random = mulberry32(20261008);
  for (let round = 0; round < 5_000; round += 1) {
    const count = 1 + Math.floor(random() * 6);
    const weights = Array.from({ length: count }, () =>
      random() < 0.2 ? 0n : BigInt(Math.floor(random() * 5_000_000)),
    );
    const sum = weights.reduce((a, b) => a + b, 0n);
    if (sum === 0n) continue;
    const total = BigInt(Math.floor(random() * 10_000_000));
    const shares = splitProRata(total, weights);
    assert.equal(
      shares.reduce((a, b) => a + b, 0n),
      total,
    );
    assert.deepEqual(splitProRata(total, weights), shares);
    shares.forEach((share, index) => {
      const weight = weights[index] ?? 0n;
      assert.ok(share >= 0n);
      // |share - total * weight / sum| < 1  <=>  |share * sum - total * weight| < sum
      assert.ok(
        abs(share * sum - total * weight) < sum,
        `share ${share} of ${total} over ${weights}`,
      );
      if (weight === 0n) assert.equal(share, 0n);
    });
    // Splitting a prefix of the lines is the prefix of the split (cumulative rounding).
    const prefix = Math.max(1, count - 1);
    let acc = 0n;
    for (let i = 0; i < prefix; i += 1) acc += shares[i] ?? 0n;
    const partial = weights.slice(0, prefix).reduce((a, b) => a + b, 0n);
    assert.equal(acc, cumulativeShare(total, partial, sum));
  }
});

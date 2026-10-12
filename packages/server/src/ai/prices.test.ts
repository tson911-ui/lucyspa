import assert from 'node:assert/strict';
import { test } from 'node:test';
import { costMicroUsd, maxCostMicroUsd, microUsdToVnd, vndToMicroUsd } from './prices.js';

test('cost: tokens x price in micro-USD, rounded up, per model (prices of 2026-10-12)', () => {
  // Opus 5.5: 4 USD in, 20 USD out per million tokens = 4 and 20 micro-USD per token.
  assert.equal(
    costMicroUsd('claude-opus-5-5', {
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    }),
    4_000_000n,
  );
  assert.equal(
    costMicroUsd('claude-opus-5-5', {
      inputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    }),
    20_000_000n,
  );
  // Cache read 0.20 USD, cache write 5 USD per million.
  assert.equal(
    costMicroUsd('claude-opus-5-5', {
      inputTokens: 0,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 1_000_000,
      outputTokens: 0,
    }),
    5_200_000n,
  );
  // Sonnet 5.5: 2 / 10; Haiku 5.5: 0.10 / 0.50 (fractions are kept in hundredths and rounded up).
  assert.equal(
    costMicroUsd('claude-sonnet-5-5', {
      inputTokens: 500_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
    }),
    2_000_000n,
  );
  assert.equal(
    costMicroUsd('claude-haiku-5-5', {
      inputTokens: 1_000_000,
      cacheReadTokens: 1_000_000,
      cacheWriteTokens: 0,
      outputTokens: 1_000_000,
    }),
    600_000n + 10_000n,
  );
  // One token never costs zero in total: a small call rounds up.
  assert.equal(
    costMicroUsd('claude-haiku-5-5', {
      inputTokens: 1,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    }),
    1n,
  );
  // An unknown model counts as the most expensive one (never under-counts).
  assert.equal(
    costMicroUsd('claude-unknown', {
      inputTokens: 1_000_000,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0,
    }),
    4_000_000n,
  );
});

test('the most a call can cost: every input token at full price plus all of max_tokens as output', () => {
  assert.equal(maxCostMicroUsd('claude-opus-5-5', 5_000, 12_000), 5_000n * 4n + 12_000n * 20n);
});

test('VND and USD at the rate the Owner typed: caps round down, spend rounds up; a bad rate is refused', () => {
  assert.equal(vndToMicroUsd(3_000_000n, 26_000), 115_384_615n);
  assert.equal(microUsdToVnd(115_384_615n, 26_000), 3_000_000n);
  assert.equal(microUsdToVnd(1n, 26_000), 1n);
  assert.throws(() => vndToMicroUsd(1n, 0), RangeError);
  assert.throws(() => microUsdToVnd(1n, 1.5), RangeError);
});

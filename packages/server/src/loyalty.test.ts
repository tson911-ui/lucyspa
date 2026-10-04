import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LOYALTY_TIERS_V1, loyaltyPointsForPaidVnd, loyaltyTierFor } from '@lucy-spa/contracts';
import { earnKey, reversalKey } from './loyalty.js';

test('points: 1,000 VND = 1 point, rounded down once per invoice (P5-Q3)', () => {
  assert.equal(loyaltyPointsForPaidVnd(930_500n), 930);
  assert.equal(loyaltyPointsForPaidVnd(999n), 0);
  assert.equal(loyaltyPointsForPaidVnd(1_000n), 1);
  assert.equal(loyaltyPointsForPaidVnd(0n), 0);
  assert.equal(loyaltyPointsForPaidVnd(930_000n), 930);
  // Large amounts stay exact (integer division on BigInt, never floating point).
  assert.equal(loyaltyPointsForPaidVnd(9_007_199_254_740_000_000n), 9_007_199_254_740_000);
  assert.throws(() => loyaltyPointsForPaidVnd(-1n), RangeError);
});

test('tiers: the locked PRD 18.5 table, version 1, at every boundary', () => {
  const at = (balance: number) => {
    const standing = loyaltyTierFor(balance);
    return [standing.tier, standing.memberDiscountBp];
  };
  assert.deepEqual(at(0), ['NONE', 0]);
  assert.deepEqual(at(499), ['NONE', 0]);
  assert.deepEqual(at(500), ['SILVER', 300]);
  assert.deepEqual(at(999), ['SILVER', 300]);
  assert.deepEqual(at(1000), ['GOLD', 400]);
  assert.deepEqual(at(2999), ['GOLD', 400]);
  assert.deepEqual(at(3000), ['PLATINUM', 500]);
  assert.deepEqual(at(4999), ['PLATINUM', 500]);
  assert.deepEqual(at(5000), ['DIAMOND', 700]);
  assert.deepEqual(at(9999), ['DIAMOND', 700]);
  assert.deepEqual(at(10000), ['RUBY', 900]);
  assert.deepEqual(at(1_000_000), ['RUBY', 900]);
  assert.equal(LOYALTY_TIERS_V1.length, 6);
});

test('tiers: distance to the next tier, none at the top; a balance is a non-negative whole number', () => {
  assert.deepEqual(loyaltyTierFor(0).next, { tier: 'SILVER', pointsToGo: 500 });
  assert.deepEqual(loyaltyTierFor(1130).next, { tier: 'PLATINUM', pointsToGo: 1870 });
  assert.deepEqual(loyaltyTierFor(9999).next, { tier: 'RUBY', pointsToGo: 1 });
  assert.equal(loyaltyTierFor(10000).next, null);
  assert.throws(() => loyaltyTierFor(-1), RangeError);
  assert.throws(() => loyaltyTierFor(1.5), RangeError);
});

test('idempotency keys follow design 11.3', () => {
  assert.equal(earnKey('SPA', 'inv', 2), 'SPA_EARN:inv:2');
  assert.equal(reversalKey('entry'), 'EARN_REVERSAL:entry');
});

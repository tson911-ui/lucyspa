import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  PRODUCT_REFUND_REFERENCE,
  productRefundAmount,
  productRefundLineState,
} from '@lucy-spa/contracts';
import { splitProRata } from '../pos/split.js';

/**
 * Phase 6 P6-13 (design 6.4 item 4, Q3, OQ-23): the money of refunding some units of a line is the line's net share of them, by the
 * same cumulative half-up rule as every other split. The refunds of all the units add up to the net exactly, whatever the order and
 * the sizes of the refunds.
 */
test('the refund of units is the sum of their shares in the proportional split of the net over the units', () => {
  const nets = [1n, 2n, 3n, 7n, 100n, 9_999n, 29_129n, 100_001n, 291_000n, 1_234_567n];
  for (const net of nets) {
    for (let units = 1; units <= 9; units += 1) {
      const shares = splitProRata(
        net,
        Array.from({ length: units }, () => 1n),
      );
      for (let before = 0; before < units; before += 1) {
        for (let quantity = 1; before + quantity <= units; quantity += 1) {
          const expected = shares.slice(before, before + quantity).reduce((a, b) => a + b, 0n);
          assert.equal(
            productRefundAmount(net, units, before, quantity),
            expected,
            `net ${net} units ${units} from ${before} take ${quantity}`,
          );
        }
      }
    }
  }
});

test('all the refunds of a line add up to its net exactly, however they are cut', () => {
  const net = 29_129n;
  const units = 5;
  // Every way of cutting 5 units into consecutive refunds (compositions of 5).
  const cuts: number[][] = [];
  const compose = (rest: number, parts: number[]) => {
    if (rest === 0) cuts.push(parts);
    for (let take = 1; take <= rest; take += 1) compose(rest - take, [...parts, take]);
  };
  compose(units, []);
  assert.equal(cuts.length, 16);
  for (const cut of cuts) {
    let before = 0;
    let total = 0n;
    for (const quantity of cut) {
      const amount = productRefundAmount(net, units, before, quantity);
      assert.ok(amount >= 0n, 'never negative');
      total += amount;
      before += quantity;
    }
    assert.equal(total, net, cut.join('+'));
  }
});

test('a refund never exceeds what is left and is never more than the net', () => {
  for (let net = 1n; net <= 50n; net += 1n) {
    for (let units = 1; units <= 6; units += 1) {
      let refunded = 0n;
      for (let unit = 0; unit < units; unit += 1) {
        refunded += productRefundAmount(net, units, unit, 1);
        assert.ok(refunded <= net);
      }
      assert.equal(refunded, net);
    }
  }
  assert.throws(() => productRefundAmount(100n, 3, 3, 1), RangeError);
  assert.throws(() => productRefundAmount(100n, 3, 2, 2), RangeError);
  assert.throws(() => productRefundAmount(100n, 3, -1, 1), RangeError);
  assert.throws(() => productRefundAmount(100n, 3, 0, 1.5), RangeError);
});

test('the example of the design: 2 x 1,500 refunded one unit at a time, and the line states', () => {
  assert.equal(productRefundAmount(3_000n, 2, 0, 1), 1_500n);
  assert.equal(productRefundAmount(3_000n, 2, 1, 1), 1_500n);
  assert.equal(productRefundLineState(0, 2), 'NOT_REFUNDED');
  assert.equal(productRefundLineState(1, 2), 'PARTIALLY_REFUNDED');
  assert.equal(productRefundLineState(2, 2), 'REFUNDED');
});

test('a transfer reference is the bank’s reference: no spaces, no account-like sentences', () => {
  for (const good of ['FT26280123456', 'abcd', 'A1.B2_C3/D4-E5', 'x'.repeat(64)]) {
    assert.ok(PRODUCT_REFUND_REFERENCE.test(good), good);
  }
  for (const bad of [
    '',
    'abc',
    '0123 4567',
    'STK 0123456789',
    'x'.repeat(65),
    'có dấu',
    'a,b,c,d',
    'a\nb\nc\nd',
  ]) {
    assert.ok(!PRODUCT_REFUND_REFERENCE.test(bad), JSON.stringify(bad));
  }
});

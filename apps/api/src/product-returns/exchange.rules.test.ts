import assert from 'node:assert/strict';
import { test } from 'node:test';
import { exchangeAmounts, productRefundAmount } from '@lucy-spa/contracts';
import { applyExchangeCredit } from '../pos/exchange-credit.js';
import { evaluatePricingV3, type V3Line } from '../pos/pricing.v3.js';
import { splitProRata } from '../pos/split.js';

/**
 * Phase 6 P6-14 (OQ-82, PRD 28.5): the money of an exchange is one pure rule. Replacement price on the day minus what the customer
 * paid for the returned units; more expensive: the customer pays it; cheaper: the spa hands it back; the same item has no difference.
 */
test('the difference of an exchange: more, equal, less, and the worked examples of OQ-82 and PRD 28.5', () => {
  // PRD 28.5: an original 500,000 purchase, a 600,000 replacement: 100,000 more; a 400,000 replacement: 100,000 back.
  const more = exchangeAmounts({
    creditVnd: 500_000n,
    replacementGrossVnd: 600_000n,
    sameItem: false,
  });
  assert.equal(more.payableVnd, 100_000n);
  assert.equal(more.refundVnd, 0n);
  assert.equal(more.appliedCreditVnd, 500_000n);
  const less = exchangeAmounts({
    creditVnd: 500_000n,
    replacementGrossVnd: 400_000n,
    sameItem: false,
  });
  assert.equal(less.payableVnd, 0n);
  assert.equal(less.refundVnd, 100_000n);
  assert.equal(less.appliedCreditVnd, 400_000n);
  const equal = exchangeAmounts({
    creditVnd: 500_000n,
    replacementGrossVnd: 500_000n,
    sameItem: false,
  });
  assert.equal(equal.payableVnd, 0n);
  assert.equal(equal.refundVnd, 0n);
  // OQ-82: the customer paid 270,000 (after a discount), the new item lists at 350,000: 80,000 more, not 350,000 - 300,000.
  assert.equal(
    exchangeAmounts({ creditVnd: 270_000n, replacementGrossVnd: 350_000n, sameItem: false })
      .payableVnd,
    80_000n,
  );
});

test('every exchange balances: applied + payable = replacement price, applied + handed back = credit (different item)', () => {
  for (let credit = 0n; credit <= 40n; credit += 1n) {
    for (let gross = 0n; gross <= 40n; gross += 1n) {
      const result = exchangeAmounts({
        creditVnd: credit,
        replacementGrossVnd: gross,
        sameItem: false,
      });
      assert.equal(result.appliedCreditVnd + result.payableVnd, gross);
      assert.equal(result.appliedCreditVnd + result.refundVnd, credit);
      assert.ok(
        result.payableVnd === 0n || result.refundVnd === 0n,
        'never both a payment and money back',
      );
      assert.ok(result.appliedCreditVnd <= gross && result.appliedCreditVnd <= credit);
      const same = exchangeAmounts({
        creditVnd: credit,
        replacementGrossVnd: gross,
        sameItem: true,
      });
      assert.equal(same.payableVnd, 0n);
      assert.equal(same.refundVnd, 0n);
      assert.equal(same.appliedCreditVnd, gross);
      assert.equal(same.rule, 'SAME_ITEM');
    }
  }
  assert.throws(
    () => exchangeAmounts({ creditVnd: -1n, replacementGrossVnd: 0n, sameItem: false }),
    RangeError,
  );
  assert.throws(
    () => exchangeAmounts({ creditVnd: 0n, replacementGrossVnd: -1n, sameItem: true }),
    RangeError,
  );
});

test('the credit of an exchange is the refund share of the returned units, so refunds and exchanges can share one sequence', () => {
  // A line of 3 units for 290,000: whatever mix of refunds and exchanges takes the units, the credits add up to the net.
  const net = 290_000n;
  const mixes = [[1, 1, 1], [2, 1], [1, 2], [3]];
  for (const mix of mixes) {
    let before = 0;
    let total = 0n;
    for (const quantity of mix) {
      total += productRefundAmount(net, 3, before, quantity);
      before += quantity;
    }
    assert.equal(total, net, mix.join('+'));
  }
});

const line = (id: string, sequence: number, gross: bigint): V3Line => ({
  lineId: id,
  sequence,
  side: 'BEAUTY',
  grossVnd: gross,
  serviceId: null,
  serviceCategoryId: null,
  productId: `product-${id}`,
  brandId: null,
  productCategoryId: null,
});
const base = (lines: V3Line[]) =>
  evaluatePricingV3({
    lines,
    promotions: [],
    supplied: [],
    hasMemberPayer: false,
    members: {},
    birthday: null,
    now: new Date('2026-10-08T05:00:00.000Z'),
  });

test('the invoice of an exchange is priced with the credit as its only benefit, line by line, adding up exactly', () => {
  const priced = base([line('a', 1, 300_000n)]);
  const more = applyExchangeCredit(priced, { creditVnd: 200_000n, sameItem: false });
  assert.equal(more.subtotalVnd, 300_000n);
  assert.equal(more.discountTotalVnd, 200_000n);
  assert.equal(more.totalVnd, 100_000n);
  assert.deepEqual(
    more.allocations.map((a) => [a.grossVnd, a.discountShareVnd, a.netVnd]),
    [[300_000n, 200_000n, 100_000n]],
  );
  assert.equal(more.redemptions.length, 0);
  assert.equal(more.sides.BEAUTY?.winner, null);
  assert.equal(more.sides.BEAUTY?.member, null);
  assert.equal(more.sides.SPA, undefined);
  // The credit never exceeds the price: a cheaper replacement is free, the rest is handed back outside the invoice.
  const less = applyExchangeCredit(priced, { creditVnd: 500_000n, sameItem: false });
  assert.equal(less.discountTotalVnd, 300_000n);
  assert.equal(less.totalVnd, 0n);
  // The same item is given against the returned units at no charge, whatever the credit.
  const same = applyExchangeCredit(priced, { creditVnd: 10_000n, sameItem: true });
  assert.equal(same.totalVnd, 0n);
  assert.equal(same.discountTotalVnd, 300_000n);
});

test('the credit is spread over several lines by the shared primitive and the nets add up to the total', () => {
  const lines = [line('a', 1, 100_001n), line('b', 2, 50_000n), line('c', 3, 7n)];
  const priced = base(lines);
  for (const credit of [0n, 1n, 33_333n, 100_000n, 157_008n, 157_009n, 1_000_000n]) {
    const result = applyExchangeCredit(priced, { creditVnd: credit, sameItem: false });
    const applied = credit < 150_008n ? credit : 150_008n;
    assert.equal(result.discountTotalVnd, applied);
    assert.deepEqual(
      result.allocations.map((a) => a.discountShareVnd),
      splitProRata(
        applied,
        lines.map((entry) => entry.grossVnd!),
      ),
    );
    assert.equal(
      result.allocations.reduce((sum, a) => sum + a.netVnd, 0n),
      result.totalVnd,
    );
    for (const allocation of result.allocations) assert.ok(allocation.netVnd >= 0n);
  }
});

test('an exchange invoice with a Spa line, a missing Beauty side or a negative credit is refused', () => {
  assert.throws(() =>
    applyExchangeCredit(
      evaluatePricingV3({
        lines: [{ ...line('s', 1, 1000n), side: 'SPA', serviceId: 'x' }],
        promotions: [],
        supplied: [],
        hasMemberPayer: false,
        members: {},
        birthday: null,
        now: new Date(),
      }),
      { creditVnd: 1n, sameItem: false },
    ),
  );
  assert.throws(
    () => applyExchangeCredit(base([line('a', 1, 10n)]), { creditVnd: -1n, sameItem: false }),
    RangeError,
  );
});

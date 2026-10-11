import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  commissionAmount,
  pickCommissionRule,
  pickSalaryVersion,
  pickTourRule,
  proportionalShare,
  type CommissionRuleRow,
} from './pay-rules.js';

let n = 0;
const rule = (patch: Partial<CommissionRuleRow>): CommissionRuleRow => ({
  id: `r${++n}`,
  scope: 'SHOP',
  brandId: null,
  categoryId: null,
  productId: null,
  employeeUserId: null,
  kind: 'PERCENT',
  value: 500n,
  effectiveFrom: '2026-10-01',
  ...patch,
});
const ctx = { employeeUserId: 'e1', productId: 'p1', categoryId: 'c1', brandId: 'b1' };

test('the most specific commission rule wins, in the agreed order', () => {
  const shop = rule({ id: 'shop' });
  const shopMine = rule({ id: 'shopMine', employeeUserId: 'e1' });
  const brand = rule({ id: 'brand', scope: 'BRAND', brandId: 'b1' });
  const brandMine = rule({ id: 'brandMine', scope: 'BRAND', brandId: 'b1', employeeUserId: 'e1' });
  const category = rule({ id: 'category', scope: 'CATEGORY', categoryId: 'c1' });
  const categoryMine = rule({
    id: 'categoryMine',
    scope: 'CATEGORY',
    categoryId: 'c1',
    employeeUserId: 'e1',
  });
  const product = rule({ id: 'product', scope: 'PRODUCT', productId: 'p1' });
  const productMine = rule({
    id: 'productMine',
    scope: 'PRODUCT',
    productId: 'p1',
    employeeUserId: 'e1',
  });
  const order = [productMine, product, categoryMine, category, brandMine, brand, shopMine, shop];
  for (let index = 0; index < order.length; index += 1) {
    assert.equal(pickCommissionRule(order.slice(index), ctx, '2026-10-11')?.id, order[index]!.id);
  }
  assert.equal(pickCommissionRule([], ctx, '2026-10-11'), null);
});

test("another employee's rule, another product or another brand never applies", () => {
  const rules = [
    rule({ id: 'other-employee', scope: 'PRODUCT', productId: 'p1', employeeUserId: 'e2' }),
    rule({ id: 'other-product', scope: 'PRODUCT', productId: 'p2' }),
    rule({ id: 'other-brand', scope: 'BRAND', brandId: 'b2' }),
    rule({ id: 'other-category', scope: 'CATEGORY', categoryId: 'c2' }),
    rule({ id: 'shop-other', employeeUserId: 'e3' }),
  ];
  assert.equal(pickCommissionRule(rules, ctx, '2026-10-11'), null);
  // A line with no category or brand skips those steps instead of matching "null = null".
  const bare = { employeeUserId: 'e1', productId: 'p1', categoryId: null, brandId: null };
  assert.equal(
    pickCommissionRule(
      [rule({ id: 'cat', scope: 'CATEGORY', categoryId: 'c1' })],
      bare,
      '2026-10-11',
    ),
    null,
  );
});

test('rules are effective-dated: the latest one in force on the date, none before it starts', () => {
  const v1 = rule({ id: 'v1', value: 300n, effectiveFrom: '2026-10-01' });
  const v2 = rule({ id: 'v2', value: 800n, effectiveFrom: '2026-10-15' });
  assert.equal(pickCommissionRule([v1, v2], ctx, '2026-10-14')?.id, 'v1');
  assert.equal(pickCommissionRule([v2, v1], ctx, '2026-10-15')?.id, 'v2');
  assert.equal(pickCommissionRule([v1, v2], ctx, '2026-09-30'), null);
});

test('a zero rule is a real rule: it stops a broader rule from applying', () => {
  const none = rule({ id: 'none', scope: 'BRAND', brandId: 'b1', value: 0n });
  const shop = rule({ id: 'shop', value: 500n });
  assert.equal(pickCommissionRule([none, shop], ctx, '2026-10-11')?.id, 'none');
});

test('percent commission is basis points of the net, half up to 1 dong; fixed is per unit', () => {
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 500n }, 200_000n, 2), 10_000n);
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 333n }, 100_000n, 1), 3_330n);
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 150n }, 1_001n, 1), 15n); // 15.015 -> 15
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 150n }, 1_034n, 1), 16n); // 15.51 -> 16
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 150n }, 1_033n, 1), 15n); // 15.495 -> 15
  assert.equal(commissionAmount({ kind: 'FIXED_PER_UNIT', value: 7_000n }, 999_999n, 3), 21_000n);
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 0n }, 500_000n, 1), 0n);
  assert.equal(commissionAmount({ kind: 'PERCENT', value: 500n }, -5n, 1), 0n);
  assert.equal(commissionAmount({ kind: 'FIXED_PER_UNIT', value: 7_000n }, 10n, -1), 0n);
});

test('a refund takes back its share of the commission: cumulative, never above the original', () => {
  // 100,000 of commission on 3 units: 1 + 1 + 1 refunded adds up exactly, whatever the rounding.
  const shares = [0, 1, 2].map((before) => proportionalShare(100_000n, before, 1, 3));
  assert.deepEqual(shares, [33_333n, 33_334n, 33_333n]);
  assert.equal(
    shares.reduce((sum, value) => sum + value, 0n),
    100_000n,
  );
  // Two units at once equal the sum of one at a time.
  assert.equal(proportionalShare(100_000n, 0, 2, 3), 66_667n);
  assert.equal(proportionalShare(100_000n, 2, 1, 3), 33_333n);
  assert.equal(proportionalShare(100_000n, 0, 3, 3), 100_000n);
  // More than was sold is capped; nothing sold or nothing refunded is zero.
  assert.equal(proportionalShare(100_000n, 2, 5, 3), 33_333n);
  assert.equal(proportionalShare(100_000n, 0, 1, 0), 0n);
  assert.equal(proportionalShare(100_000n, 0, 0, 3), 0n);
  assert.equal(proportionalShare(0n, 0, 1, 3), 0n);
});

test('the tour amount of a service and the salary of a person come from the latest version in force', () => {
  const tour = [
    { id: 't1', serviceId: 's1', amountVnd: 15_000n, effectiveFrom: '2026-10-01' },
    { id: 't2', serviceId: 's1', amountVnd: 20_000n, effectiveFrom: '2026-10-20' },
    { id: 't3', serviceId: 's2', amountVnd: 9_000n, effectiveFrom: '2026-10-01' },
  ];
  assert.equal(pickTourRule(tour, 's1', '2026-10-19')?.id, 't1');
  assert.equal(pickTourRule(tour, 's1', '2026-10-20')?.id, 't2');
  assert.equal(pickTourRule(tour, 's1', '2026-09-30'), null);
  assert.equal(pickTourRule(tour, 's9', '2026-10-30'), null);
  const salary = [
    { employeeUserId: 'e1', amountVnd: 7_000_000n, effectiveFrom: '2026-09-01' },
    { employeeUserId: 'e1', amountVnd: 8_000_000n, effectiveFrom: '2026-11-01' },
    { employeeUserId: 'e1', amountVnd: null, effectiveFrom: '2026-12-01' },
    { employeeUserId: 'e2', amountVnd: 5_000_000n, effectiveFrom: '2026-01-01' },
  ];
  // A raise on the 1st never changes the month before it.
  assert.equal(pickSalaryVersion(salary, 'e1', '2026-10-31')?.amountVnd, 7_000_000n);
  assert.equal(pickSalaryVersion(salary, 'e1', '2026-11-01')?.amountVnd, 8_000_000n);
  assert.equal(pickSalaryVersion(salary, 'e1', '2026-12-15')?.amountVnd, null);
  assert.equal(pickSalaryVersion(salary, 'e1', '2026-08-31'), null);
  assert.equal(pickSalaryVersion(salary, 'e3', '2026-10-31'), null);
});

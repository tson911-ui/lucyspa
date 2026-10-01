import type { DiscountStatusName, DiscountSummaryResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DISCOUNT_LIST_DEFAULTS,
  discountSortValue,
  filterDiscounts,
  normalizeDiscountList,
} from './discounts-list';

function program(
  id: string,
  code: string,
  nameVi: string,
  nameEn: string,
  status: DiscountStatusName,
  validFrom = '2026-10-01T00:00:00.000Z',
  redemptions = 0,
): DiscountSummaryResponse {
  return {
    id,
    code,
    nameVi,
    nameEn,
    requiresCode: false,
    isActive: status !== 'PAUSED',
    terminatedAt: null,
    status,
    current: {
      id: `${id}-v1`,
      versionNo: 1,
      kind: 'PERCENT',
      percentBp: 1000,
      fixedAmountVnd: null,
      validFrom,
      validUntil: '2026-12-31T00:00:00.000Z',
      minSpendVnd: '0',
      scopeMode: 'ALL_SERVICES',
      serviceIds: [],
      categoryIds: [],
      usageLimitTotal: null,
      usageLimitPerCustomer: null,
      createdAt: validFrom,
    },
    redemptions,
    voucherCount: 0,
    version: 1,
  };
}

const programs = [
  program('a', 'TET', 'Khuyến mãi Tết', 'Lunar New Year', 'ACTIVE'),
  program('b', 'HE', 'Ưu đãi mùa hè', 'Summer offer', 'EXPIRED', '2026-05-01T00:00:00.000Z', 7),
  program('c', 'VIP', 'Khách thân thiết', 'Loyal guests', 'PAUSED'),
];

test('search matches code and both names without accents; the status filter narrows further', () => {
  const ids = (state: { q: string; status: string }) =>
    filterDiscounts(programs, state).map((entry) => entry.id);
  assert.deepEqual(ids({ q: 'khuyen mai tet', status: '' }), ['a']);
  assert.deepEqual(ids({ q: 'summer', status: '' }), ['b']);
  assert.deepEqual(ids({ q: 'vip', status: '' }), ['c']);
  assert.deepEqual(ids({ q: '', status: 'EXPIRED' }), ['b']);
  assert.deepEqual(ids({ q: 'tet', status: 'EXPIRED' }), []);
});

test('the address bar cannot put the list in an impossible state', () => {
  const state = normalizeDiscountList({
    ...DISCOUNT_LIST_DEFAULTS,
    status: 'NOPE',
    sort: 'benefit',
    dir: 'sideways',
    page: 0,
    pageSize: 7,
  });
  assert.equal(state.status, '');
  assert.equal(state.sort, 'window');
  assert.equal(state.dir, 'desc');
  assert.equal(state.page, 1);
  assert.equal(state.pageSize, DISCOUNT_LIST_DEFAULTS.pageSize);
  assert.equal(
    normalizeDiscountList({ ...DISCOUNT_LIST_DEFAULTS, status: 'PAUSED' }).status,
    'PAUSED',
  );
});

test('programs sort by localized name, window start, status order and use count', () => {
  const [tet, summer] = programs;
  assert.equal(discountSortValue(tet!, 'name', 'vi'), 'Khuyến mãi Tết');
  assert.equal(discountSortValue(tet!, 'name', 'en'), 'Lunar New Year');
  assert.ok(
    (discountSortValue(summer!, 'window', 'vi') as string) <
      (discountSortValue(tet!, 'window', 'vi') as string),
  );
  assert.ok(
    (discountSortValue(tet!, 'status', 'vi') as number) <
      (discountSortValue(summer!, 'status', 'vi') as number),
    'running programs come before expired ones',
  );
  assert.equal(discountSortValue(summer!, 'used', 'vi'), 7);
});

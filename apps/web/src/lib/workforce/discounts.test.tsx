import type { DiscountDetailResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ReactNode } from 'react';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { DiscountDetailScreen } from '../../components/workforce/screens/discount-detail';
import { DiscountsScreen } from '../../components/workforce/screens/discounts';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner, render } from '../../test/support';
import { ApiError } from './api';
import {
  benefitLabel,
  bpToPercent,
  createRequestOf,
  discountErrorMessage,
  emptyDiscountForm,
  formFromProgram,
  ineligibleText,
  isoToVnLocal,
  percentToBp,
  versionInputOf,
  versionRequestOf,
  vnLocalToIso,
  voucherCodeOf,
  type DiscountForm,
} from './discounts';
import { navigationFor } from './permissions';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

const form = (change: Partial<DiscountForm> = {}): DiscountForm => ({
  ...emptyDiscountForm(),
  code: 'tet2027',
  nameVi: ' Khuyến mãi Tết ',
  nameEn: 'Tet promotion',
  percent: '12.5',
  validFrom: '2027-01-01T00:00',
  validUntil: '2027-02-01T00:00',
  ...change,
});

test('percentages are entered as decimal percent and sent as integer basis points', () => {
  assert.equal(percentToBp('10'), 1000);
  assert.equal(percentToBp('12.5'), 1250);
  assert.equal(percentToBp('0.01'), 1);
  assert.equal(percentToBp('100'), 10_000);
  assert.equal(percentToBp(' 33.33 '), 3333);
  for (const bad of ['', '0', '0.00', '100.01', '101', '1.234', '-5', '1e2', 'abc', '10%', '1,5']) {
    assert.equal(percentToBp(bad), null, bad);
  }
  assert.equal(bpToPercent(1000), '10');
  assert.equal(bpToPercent(1250), '12.5');
  assert.equal(bpToPercent(1), '0.01');
  assert.equal(bpToPercent(10_000), '100');
  for (const bp of [1, 50, 999, 1250, 3333, 10_000]) assert.equal(percentToBp(bpToPercent(bp)), bp);
});

test('validity is entered in Vietnam time (UTC+7) and sent as ISO instants', () => {
  assert.equal(vnLocalToIso('2027-01-01T00:00'), '2026-12-31T17:00:00.000Z');
  assert.equal(vnLocalToIso('2027-03-01T08:30'), '2027-03-01T01:30:00.000Z');
  assert.equal(isoToVnLocal('2026-12-31T17:00:00.000Z'), '2027-01-01T00:00');
  for (const bad of ['', '2027-02-30T10:00', '2027-13-01T00:00', 'tomorrow', '2027-01-01']) {
    assert.equal(vnLocalToIso(bad), null, bad);
  }
  const iso = vnLocalToIso('2027-06-15T23:45')!;
  assert.equal(isoToVnLocal(iso), '2027-06-15T23:45');
});

test('version input: only configuration, never a client total; fixed amounts carry no percentage', () => {
  const percent = versionInputOf(form());
  assert.ok('version' in percent);
  assert.deepEqual(percent.version, {
    kind: 'PERCENT',
    percentBp: 1250,
    validFrom: '2026-12-31T17:00:00.000Z',
    validUntil: '2027-01-31T17:00:00.000Z',
    minSpendVnd: '0',
    scopeMode: 'ALL_SERVICES',
    serviceIds: [],
    categoryIds: [],
    usageLimitTotal: null,
    usageLimitPerCustomer: null,
  });
  const fixed = versionInputOf(
    form({
      kind: 'FIXED_AMOUNT',
      fixedAmount: '50000',
      percent: '99',
      minSpend: '200000',
      scopeMode: 'SELECTED',
      serviceIds: ['s1'],
      categoryIds: ['c1'],
      limitTotal: '100',
      limitPerCustomer: '1',
    }),
  );
  assert.ok('version' in fixed);
  assert.equal(fixed.version.fixedAmountVnd, '50000');
  assert.ok(!('percentBp' in fixed.version), 'a fixed amount never carries a percentage');
  assert.deepEqual(fixed.version.serviceIds, ['s1']);
  assert.equal(fixed.version.usageLimitTotal, 100);
  assert.equal(fixed.version.usageLimitPerCustomer, 1);
  const json = JSON.stringify(percent) + JSON.stringify(fixed);
  for (const forbidden of ['totalVnd', 'discountTotalVnd', 'amountVnd', 'branchId', 'status']) {
    assert.ok(!json.includes(`"${forbidden}"`), forbidden);
  }
  // Scope lists are dropped for ALL_SERVICES.
  const all = versionInputOf(form({ serviceIds: ['s1'], categoryIds: ['c1'] }));
  assert.ok('version' in all && all.version.serviceIds.length === 0);
});

test('version input problems are named (the API validates everything again)', () => {
  const problem = (change: Partial<DiscountForm>) => {
    const result = versionInputOf(form(change));
    return 'problem' in result ? result.problem : null;
  };
  assert.equal(problem({ percent: '' }), 'percent');
  assert.equal(problem({ percent: '150' }), 'percent');
  assert.equal(problem({ kind: 'FIXED_AMOUNT', fixedAmount: '' }), 'amount');
  assert.equal(problem({ kind: 'FIXED_AMOUNT', fixedAmount: '0' }), 'amount');
  assert.equal(problem({ kind: 'FIXED_AMOUNT', fixedAmount: '1.5' }), 'amount');
  assert.equal(problem({ validFrom: '' }), 'window');
  assert.equal(problem({ validUntil: '2027-01-01T00:00' }), 'window', 'the end is after the start');
  assert.equal(problem({ validUntil: '2026-12-01T00:00' }), 'window');
  assert.equal(problem({ minSpend: '-1' }), 'minSpend');
  assert.equal(problem({ minSpend: '1.5' }), 'minSpend');
  assert.equal(problem({ scopeMode: 'SELECTED' }), 'scope');
  assert.equal(problem({ limitTotal: '0' }), 'limit');
  assert.equal(problem({ limitPerCustomer: '1.5' }), 'limit');
  assert.equal(problem({ limitTotal: '99999999999' }), 'limit');
  assert.equal(problem({}), null);
  assert.equal(problem({ minSpend: '' }), null, 'an empty minimum spend is 0');
});

test('create and new-version requests: canonical code, trimmed names, program version echoed', () => {
  const created = createRequestOf(form());
  assert.ok('body' in created);
  assert.equal(created.body.code, 'TET2027');
  assert.equal(created.body.nameVi, 'Khuyến mãi Tết');
  assert.equal(created.body.requiresCode, false);
  assert.equal(created.body.version.percentBp, 1250);
  for (const bad of ['', '1TET', 'TET 27', 'tét']) {
    const result = createRequestOf(form({ code: bad }));
    assert.deepEqual(result, { problem: 'code' }, bad);
  }
  assert.deepEqual(createRequestOf(form({ nameEn: ' ' })), { problem: 'name' });
  const versioned = versionRequestOf(form(), 4);
  assert.ok('body' in versioned);
  assert.equal(versioned.body.expectedVersion, 4);
  assert.ok(!('code' in versioned.body), 'the program code is immutable');
  assert.deepEqual(versionRequestOf(form({ percent: '' }), 4), { problem: 'percent' });
});

test('a new version starts from what is in force; benefits are shown in the reader’s locale', () => {
  const program = {
    id: 'p1',
    code: 'TET',
    nameVi: 'Tết',
    nameEn: 'Tet',
    requiresCode: true,
    isActive: true,
    terminatedAt: null,
    status: 'ACTIVE',
    redemptions: 0,
    voucherCount: 0,
    version: 3,
    terminatedReason: null,
    versions: [],
    vouchers: [],
    permissions: { manage: true, createVouchers: true },
    current: {
      id: 'v1',
      versionNo: 2,
      kind: 'PERCENT',
      percentBp: 1250,
      fixedAmountVnd: null,
      validFrom: '2026-12-31T17:00:00.000Z',
      validUntil: '2027-01-31T17:00:00.000Z',
      minSpendVnd: '100000',
      scopeMode: 'SELECTED',
      serviceIds: ['s1'],
      categoryIds: [],
      usageLimitTotal: 10,
      usageLimitPerCustomer: null,
      createdAt: '2026-12-01T00:00:00.000Z',
    },
  } as DiscountDetailResponse;
  const prefilled = formFromProgram(program);
  assert.equal(prefilled.percent, '12.5');
  assert.equal(prefilled.validFrom, '2027-01-01T00:00');
  assert.equal(prefilled.limitTotal, '10');
  assert.equal(prefilled.limitPerCustomer, '');
  assert.equal(prefilled.requiresCode, true);
  const again = versionInputOf(prefilled);
  assert.ok('version' in again && again.version.percentBp === 1250);
  assert.equal(benefitLabel(program.current, 'vi'), '12,5%');
  assert.equal(benefitLabel(program.current, 'en'), '12.5%');
  assert.equal(
    benefitLabel({ kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: '50000' }, 'vi'),
    '50.000 ₫',
  );
  assert.equal(
    benefitLabel({ kind: 'FIXED_AMOUNT', percentBp: null, fixedAmountVnd: '50000' }, 'en'),
    '50,000 ₫',
  );
});

test('voucher codes: trimmed, non-empty and short before they are sent (the API canonicalizes)', () => {
  assert.equal(voucherCodeOf('  save50 '), 'save50');
  assert.equal(voucherCodeOf('   '), null);
  assert.equal(voucherCodeOf(''), null);
  assert.equal(voucherCodeOf('x'.repeat(65)), null);
});

test('discount navigation follows GLOBAL MANAGE_DISCOUNTS / CREATE_VOUCHERS; never a branch grant or a role name', () => {
  const has = (account: Parameters<typeof navigationFor>[0]) =>
    navigationFor(account).some((item) => item.key === 'discounts');
  assert.ok(has(owner));
  assert.ok(has(employee([['MANAGE_DISCOUNTS']])));
  assert.ok(has(employee([['CREATE_VOUCHERS']])));
  assert.ok(
    !has(employee([['MANAGE_DISCOUNTS', 'A']])),
    'a branch grant never configures discounts',
  );
  assert.ok(
    !has(
      employee([
        ['APPLY_DISCOUNTS', 'A'],
        ['MANAGE_INVOICES', 'A'],
      ]),
    ),
  );
  assert.ok(!has(employee([])));
  assert.ok(!has(employee([['MANAGE_DISCOUNTS']], [['MANAGE_DISCOUNTS']])), 'a deny wins');
});

test('texts exist in both languages, errors are localized and every ineligibility reason is explained', () => {
  assert.deepEqual(Object.keys(vi.discounts).sort(), Object.keys(en.discounts).sort());
  assert.deepEqual(Object.keys(vi.pos).sort(), Object.keys(en.pos).sort());
  assert.notEqual(vi.nav.discounts, en.nav.discounts);
  for (const reason of [
    'NOT_ACTIVE',
    'NOT_STARTED',
    'EXPIRED',
    'VOUCHER_INACTIVE',
    'NO_ELIGIBLE_LINES',
    'BELOW_MIN_SPEND',
    'TOTAL_LIMIT_REACHED',
    'MEMBER_REQUIRED',
    'CUSTOMER_LIMIT_REACHED',
  ] as const) {
    assert.ok(ineligibleText(reason, vi).length > 5, reason);
    assert.notEqual(ineligibleText(reason, vi), ineligibleText(reason, en), reason);
  }
  for (const code of [
    'DISCOUNT_STATE_INVALID',
    'DISCOUNT_CODE_TAKEN',
    'VOUCHER_INVALID',
  ] as const) {
    const error = new ApiError(409, code);
    assert.equal(discountErrorMessage(error, vi), vi.discounts.errors[code]);
    assert.equal(discountErrorMessage(error, en), en.discounts.errors[code]);
  }
  assert.equal(
    discountErrorMessage(new ApiError(409, 'VOUCHER_INVALID'), en),
    en.discounts.errors.VOUCHER_INVALID,
  );
  assert.equal(discountErrorMessage(new Error('x'), en), en.errors.unexpected);
});

test('first paint: the list refuses non-configurators without a request; the detail loads from the server', () => {
  const router = { push: () => undefined } as never;
  const withRouter = (node: ReactNode) => (
    <AppRouterContext.Provider value={router}>{node}</AppRouterContext.Provider>
  );
  const branchOnly = render(withRouter(<DiscountsScreen />), employee([['MANAGE_DISCOUNTS', 'A']]));
  assert.ok(branchOnly.includes(vi.discounts.noAccess));
  const configurator = render(
    withRouter(<DiscountsScreen />),
    employee([['MANAGE_DISCOUNTS']]),
    'en',
  );
  assert.ok(configurator.includes(en.common.loading));
  assert.ok(render(<DiscountDetailScreen id="d1" />, owner).includes(vi.common.loading));
});

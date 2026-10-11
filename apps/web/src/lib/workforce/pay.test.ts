import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import {
  basisPointsToPercent,
  commissionBody,
  commissionProblems,
  commissionScopeText,
  commissionValueText,
  normalizePayPage,
  PAY_PAGE_DEFAULTS,
  payErrorMessage,
  payTabsFor,
  percentToBasisPoints,
  reasonProblem,
  salaryBody,
  salaryProblems,
  startWindow,
  tipBody,
  tipProblems,
  tourBody,
  validStart,
  vndString,
  type CommissionDraft,
} from './pay';
import { employee, owner } from '../../test/support';

const TODAY = '2026-10-11';
const money = (amount: string) => `${amount} ₫`;

test('percentages travel as basis points: 0 to 100 with at most two decimals, comma or dot', () => {
  assert.equal(percentToBasisPoints('5'), '500');
  assert.equal(percentToBasisPoints('2,5'), '250');
  assert.equal(percentToBasisPoints('12.34'), '1234');
  assert.equal(percentToBasisPoints(' 0 '), '0');
  assert.equal(percentToBasisPoints('100'), '10000');
  for (const bad of ['', 'abc', '-1', '100.01', '101', '1.234', '5%', '1e2', '5.', '.5']) {
    assert.equal(percentToBasisPoints(bad), null, bad);
  }
  assert.equal(basisPointsToPercent('500', 'en'), '5');
  assert.equal(basisPointsToPercent('250', 'en'), '2.5');
  assert.equal(basisPointsToPercent('250', 'vi'), '2,5');
  assert.equal(basisPointsToPercent('1234', 'en'), '12.34');
  assert.equal(basisPointsToPercent('5', 'en'), '0.05');
});

test('a commission rule is described in words; a value of 0 says nothing is paid', () => {
  assert.equal(
    commissionValueText({ kind: 'PERCENT', value: '500' }, 'vi', money),
    '5% giá trị dòng hàng',
  );
  assert.equal(
    commissionValueText({ kind: 'FIXED_PER_UNIT', value: '7000' }, 'vi', money),
    '7000 ₫ mỗi sản phẩm',
  );
  assert.equal(commissionValueText({ kind: 'PERCENT', value: '0' }, 'vi', money), 'Không trả');
  assert.equal(commissionScopeText({ scope: 'SHOP', target: null }, 'vi'), 'Cả cửa hàng');
  assert.equal(
    commissionScopeText({ scope: 'BRAND', target: { id: 'b', name: 'Dior' } }, 'en'),
    'Brand: Dior',
  );
});

test('money from the input: whole dong, never negative, never above the limit', () => {
  assert.equal(vndString(0), '0');
  assert.equal(vndString(50_000), '50000');
  assert.equal(vndString(null), null);
  assert.equal(vndString(-1), null);
  assert.equal(vndString(1.5), null);
  assert.equal(vndString(10_000_000_001), null);
});

test('a start date is a real day inside the window: rules may start ahead, a salary may not', () => {
  const rules = startWindow(TODAY, true);
  assert.equal(rules.min, '2026-08-10');
  assert.equal(rules.max, '2027-10-12');
  assert.equal(startWindow(TODAY, false).max, TODAY);
  assert.equal(validStart(TODAY, TODAY, false), true);
  assert.equal(validStart('2026-08-10', TODAY, false), true);
  assert.equal(validStart('2026-08-09', TODAY, false), false);
  assert.equal(validStart('2026-10-12', TODAY, false), false);
  assert.equal(validStart('2026-10-12', TODAY, true), true);
  assert.equal(validStart('2026-02-30', TODAY, true), false);
  assert.equal(validStart('', TODAY, true), false);
});

test('salary and tour forms: an amount and a date are needed, the reason is optional', () => {
  const draft = { amount: 9_000_000, from: TODAY, reason: '  Tăng lương  ' };
  assert.deepEqual(salaryBody('e1', draft, TODAY), {
    employeeUserId: 'e1',
    amountVnd: '9000000',
    effectiveFrom: TODAY,
    reason: 'Tăng lương',
  });
  assert.equal(salaryBody('e1', { ...draft, reason: '   ' }, TODAY)?.reason, null);
  assert.deepEqual(
    salaryProblems({ amount: null, from: '2026-10-12', reason: 'x'.repeat(501) }, TODAY),
    ['amount', 'from', 'reason'],
  );
  assert.equal(salaryBody('e1', { ...draft, amount: null }, TODAY), null);
  // A tour of 0 is allowed: it states that nothing is paid.
  assert.deepEqual(tourBody('s1', { amount: 0, from: '2026-10-12', reason: '' }, TODAY), {
    serviceId: 's1',
    amountVnd: '0',
    effectiveFrom: '2026-10-12',
    reason: null,
  });
  assert.equal(tourBody('s1', { amount: null, from: TODAY, reason: '' }, TODAY), null);
});

test('a commission rule needs a target unless it is for the whole shop, and a valid value for its kind', () => {
  const base: CommissionDraft = {
    scope: 'SHOP',
    targetId: '',
    employeeUserId: '',
    kind: 'PERCENT',
    percent: '5',
    amount: null,
    from: TODAY,
    reason: '',
  };
  assert.deepEqual(commissionBody(base, TODAY), {
    scope: 'SHOP',
    targetId: null,
    employeeUserId: null,
    kind: 'PERCENT',
    value: '500',
    effectiveFrom: TODAY,
    reason: null,
  });
  assert.deepEqual(commissionProblems({ ...base, scope: 'BRAND' }, TODAY), ['target']);
  assert.deepEqual(commissionProblems({ ...base, percent: '101' }, TODAY), ['value']);
  assert.deepEqual(commissionProblems({ ...base, kind: 'FIXED_PER_UNIT' }, TODAY), ['value']);
  assert.deepEqual(
    commissionBody(
      {
        ...base,
        scope: 'PRODUCT',
        targetId: 'p1',
        employeeUserId: 'e1',
        kind: 'FIXED_PER_UNIT',
        amount: 7000,
      },
      TODAY,
    ),
    {
      scope: 'PRODUCT',
      targetId: 'p1',
      employeeUserId: 'e1',
      kind: 'FIXED_PER_UNIT',
      value: '7000',
      effectiveFrom: TODAY,
      reason: null,
    },
  );
  // Changing the scope back to the shop drops the target.
  assert.equal(commissionBody({ ...base, targetId: 'leftover' }, TODAY)?.targetId, null);
});

test('a tip needs a KTV and an amount above 0; reversals and resets need a reason', () => {
  assert.deepEqual(tipProblems({ employeeUserId: '', amount: 0, method: 'CASH' }), [
    'employee',
    'amount',
  ]);
  assert.deepEqual(
    tipBody('inv', { employeeUserId: 'e1', amount: 50_000, method: 'TRANSFER' }, 'req'),
    {
      invoiceId: 'inv',
      employeeUserId: 'e1',
      amountVnd: '50000',
      method: 'TRANSFER',
      clientRequestId: 'req',
    },
  );
  assert.equal(tipBody('inv', { employeeUserId: 'e1', amount: null, method: 'CASH' }, 'req'), null);
  assert.equal(reasonProblem('  '), true);
  assert.equal(reasonProblem('x'.repeat(501)), true);
  assert.equal(reasonProblem('Nhầm'), false);
});

test('the tabs follow the permissions: salaries are open to branch pay permissions, the rest need a shop-wide one', () => {
  assert.deepEqual(payTabsFor(owner), ['salaries', 'tour', 'commission', 'codes']);
  assert.deepEqual(payTabsFor(employee([['MANAGE_PAY_RULES']])), [
    'salaries',
    'tour',
    'commission',
    'codes',
  ]);
  assert.deepEqual(payTabsFor(employee([['VIEW_EMPLOYEE_PAY', 'A']])), ['salaries']);
  assert.deepEqual(payTabsFor(employee([['VIEW_INVOICES', 'A']])), []);
});

test('the page state keeps only a real tab and known filters', () => {
  const tabs = ['salaries', 'tour'] as const;
  assert.equal(normalizePayPage({ ...PAY_PAGE_DEFAULTS, tab: 'codes' }, tabs).tab, 'salaries');
  assert.equal(normalizePayPage({ ...PAY_PAGE_DEFAULTS, tab: 'tour' }, tabs).tab, 'tour');
  assert.equal(
    normalizePayPage({ ...PAY_PAGE_DEFAULTS, scope: 'WRONG', state: 'CURRENT' }, tabs).scope,
    '',
  );
  assert.equal(normalizePayPage({ ...PAY_PAGE_DEFAULTS, state: 'CURRENT' }, tabs).state, 'CURRENT');
  assert.equal(normalizePayPage({ ...PAY_PAGE_DEFAULTS, missing: 'x' }, tabs).missing, '');
});

test('a refusal is shown in the feature’s own words, then the shared ones', () => {
  const t = getWorkforceDictionary('vi');
  assert.match(payErrorMessage(new ApiError(409, 'TIP_CLAIMED'), t, 'vi'), /kỳ lương/);
  assert.match(payErrorMessage(new ApiError(409, 'PAY_VERSION_EXISTS'), t, 'en'), /already starts/);
  assert.ok(payErrorMessage(new ApiError(500, 'SOMETHING_ELSE'), t, 'vi').length > 0);
});

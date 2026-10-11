import type { CashBranchAccess, CashFundItem } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cashDictionary } from '../../i18n/cash';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import {
  CASH_PAGE_DEFAULTS,
  cashErrorMessage,
  closeBody,
  closeProblems,
  closingFigures,
  defaultCloseDate,
  entryBody,
  entryKinds,
  entryProblems,
  fundCan,
  goLiveBody,
  normalizeCashPage,
  signedVnd,
  suggestedWithdrawal,
  transferBody,
  transferProblems,
  transferTargets,
  vndNumber,
  vndString,
  writableFunds,
} from './cash';

const branch = (id: string, manage = true, view = true, deposit = manage): CashBranchAccess => ({
  branch: { id, code: id.toUpperCase(), name: `Chi nhánh ${id}` },
  view,
  manage,
  deposit,
});
const fund = (id: string, kind: 'CASH' | 'BANK', branchId: string | null): CashFundItem => ({
  id,
  kind,
  branch: branchId
    ? { id: branchId, code: branchId.toUpperCase(), name: `Chi nhánh ${branchId}` }
    : null,
  name: kind === 'BANK' ? 'Quỹ ngân hàng' : `Quỹ tiền mặt ${branchId}`,
  openingBalanceVnd: '1000000',
  balanceVnd: '1250000',
  lastClosedDate: null,
});

test('the address-bar state is normalized: tabs, directions, dates and the page', () => {
  assert.deepEqual(normalizeCashPage(CASH_PAGE_DEFAULTS), CASH_PAGE_DEFAULTS);
  assert.equal(normalizeCashPage({ ...CASH_PAGE_DEFAULTS, tab: 'nope' }).tab, 'book');
  assert.equal(normalizeCashPage({ ...CASH_PAGE_DEFAULTS, tab: 'closing' }).tab, 'closing');
  assert.equal(normalizeCashPage({ ...CASH_PAGE_DEFAULTS, direction: 'UP' }).direction, '');
  assert.equal(normalizeCashPage({ ...CASH_PAGE_DEFAULTS, direction: 'OUT' }).direction, 'OUT');
  assert.equal(normalizeCashPage({ ...CASH_PAGE_DEFAULTS, from: 'x' }).from, '');
  assert.equal(
    normalizeCashPage({ ...CASH_PAGE_DEFAULTS, from: '2026-10-10', to: '2026-10-01' }).to,
    '',
  );
  assert.equal(normalizeCashPage({ ...CASH_PAGE_DEFAULTS, page: -4 }).page, 1);
});

test('amounts are whole dong strings; nothing else reaches the API', () => {
  assert.equal(vndString(50_000), '50000');
  assert.equal(vndString(0), '0');
  assert.equal(vndString(null), null);
  assert.equal(vndString(-1), null);
  assert.equal(vndString(1.5), null);
  assert.equal(vndString(10_000_000_001), null);
  assert.equal(vndNumber('1250000'), 1_250_000);
  assert.equal(vndNumber('-5000'), -5000);
  assert.equal(vndNumber('1e9'), 0);
  assert.equal(signedVnd('1250000', 'vi'), '1.250.000 ₫');
  assert.equal(signedVnd(-5000, 'en'), '−5,000 ₫');
  assert.equal(signedVnd('0', 'vi'), '0 ₫');
});

test('who can write where: the bank needs every branch; a collector only deposits', () => {
  const funds = [fund('f1', 'CASH', 'a'), fund('f2', 'CASH', 'b'), fund('fb', 'BANK', null)];
  const both = [branch('a'), branch('b')];
  assert.deepEqual(
    writableFunds(funds, both).map((item) => item.id),
    ['f1', 'f2', 'fb'],
  );
  const one = [branch('a'), branch('b', false, true, false)];
  assert.deepEqual(
    writableFunds(funds, one).map((item) => item.id),
    ['f1'],
  );
  assert.deepEqual(fundCan(funds[0]!, one), { record: true, deposit: true, transfer: true });
  assert.deepEqual(fundCan(funds[1]!, one), { record: false, deposit: false, transfer: false });
  assert.deepEqual(fundCan(funds[2]!, one), { record: false, deposit: false, transfer: false });
  const collector = [branch('a', false, true, true)];
  assert.deepEqual(fundCan(funds[0]!, collector), {
    record: false,
    deposit: true,
    transfer: false,
  });
  assert.deepEqual(entryKinds({ fund: funds[0]!, canRecord: false, canDeposit: true }), [
    'DEPOSIT',
  ]);
  assert.deepEqual(entryKinds({ fund: funds[0]!, canRecord: true, canDeposit: true }), [
    'MANUAL_INCOME',
    'MANUAL_EXPENSE',
    'DEPOSIT',
    'OWNER_WITHDRAWAL',
  ]);
  assert.deepEqual(entryKinds({ fund: funds[2]!, canRecord: true, canDeposit: false }), [
    'MANUAL_INCOME',
    'MANUAL_EXPENSE',
    'OWNER_WITHDRAWAL',
  ]);
});

test('an entry needs an amount and a reason; the bank needs a branch', () => {
  const draft = {
    kind: 'MANUAL_EXPENSE' as const,
    amount: 25_000,
    reason: '  Mua nước ',
    branchId: '',
  };
  assert.deepEqual(entryProblems(draft, false), []);
  assert.deepEqual(entryBody('f1', draft, false, 'r1'), {
    fundId: 'f1',
    kind: 'MANUAL_EXPENSE',
    amountVnd: '25000',
    reason: 'Mua nước',
    clientRequestId: 'r1',
  });
  assert.deepEqual(entryProblems({ ...draft, amount: null, reason: ' ' }, false), [
    'amount',
    'reason',
  ]);
  assert.deepEqual(entryProblems({ ...draft, amount: 0 }, false), ['amount']);
  assert.equal(entryBody('f1', { ...draft, amount: null }, false, 'r1'), null);
  assert.deepEqual(entryProblems(draft, true), ['branch']);
  assert.equal(entryBody('fb', draft, true, 'r1'), null);
  assert.equal(entryBody('fb', { ...draft, branchId: 'a' }, true, 'r1')?.branchId, 'a');
  assert.deepEqual(entryProblems({ ...draft, reason: 'x'.repeat(501) }, false), ['reason']);
});

test('a transfer goes between a cash fund and the bank, never to itself', () => {
  const funds = [fund('f1', 'CASH', 'a'), fund('f2', 'CASH', 'b'), fund('fb', 'BANK', null)];
  assert.deepEqual(
    transferTargets(funds, 'f1').map((item) => item.id),
    ['fb'],
  );
  assert.deepEqual(
    transferTargets(funds, 'fb').map((item) => item.id),
    ['f1', 'f2'],
  );
  assert.deepEqual(transferTargets(funds, 'nope'), []);
  const draft = { fromFundId: 'f1', toFundId: 'fb', amount: 10_000, reason: 'Nộp ngân hàng' };
  assert.deepEqual(transferProblems(draft), []);
  assert.deepEqual(transferBody(draft, 'r2'), {
    fromFundId: 'f1',
    toFundId: 'fb',
    amountVnd: '10000',
    reason: 'Nộp ngân hàng',
    clientRequestId: 'r2',
  });
  assert.deepEqual(transferProblems({ ...draft, toFundId: 'f1' }), ['to']);
  assert.deepEqual(transferProblems({ ...draft, amount: null, reason: '' }), ['amount', 'reason']);
  assert.equal(transferBody({ ...draft, toFundId: '' }, 'r2'), null);
});

test('the go-live asks for every active branch and the bank, whole dong each', () => {
  const draft = { branches: { a: 1_000_000, b: 0 }, bank: 5_000_000 };
  assert.deepEqual(goLiveBody(draft, ['a', 'b']), {
    branches: [
      { branchId: 'a', countedVnd: '1000000' },
      { branchId: 'b', countedVnd: '0' },
    ],
    bankVnd: '5000000',
  });
  assert.equal(goLiveBody({ ...draft, bank: null }, ['a', 'b']), null);
  assert.equal(goLiveBody({ branches: { a: 1 }, bank: 0 }, ['a', 'b']), null);
});

test('the closing shows the difference and what stays; a difference needs a reason', () => {
  const draft = { date: '2026-10-11', counted: 995_000, withdrawal: 200_000, reason: '' };
  assert.deepEqual(closingFigures(1_000_000, draft), {
    difference: -5000,
    nextFloat: 795_000,
    needsReason: true,
    withdrawalTooBig: false,
  });
  assert.deepEqual(closeProblems(1_000_000, draft), ['reason']);
  assert.equal(closeBody(1_000_000, draft, 'r3'), null);
  assert.deepEqual(closeBody(1_000_000, { ...draft, reason: ' Thiếu tiền lẻ ' }, 'r3'), {
    date: '2026-10-11',
    countedVnd: '995000',
    withdrawalVnd: '200000',
    reason: 'Thiếu tiền lẻ',
    clientRequestId: 'r3',
  });
  const exact = { ...draft, counted: 1_000_000, withdrawal: null };
  assert.deepEqual(closeProblems(1_000_000, exact), []);
  assert.deepEqual(closeBody(1_000_000, exact, 'r4'), {
    date: '2026-10-11',
    countedVnd: '1000000',
    withdrawalVnd: '0',
    reason: null,
    clientRequestId: 'r4',
  });
  assert.deepEqual(closeProblems(1_000_000, { ...exact, withdrawal: 2_000_000 }), ['withdrawal']);
  assert.deepEqual(closeProblems(1_000_000, { ...exact, counted: null }), ['counted']);
  assert.deepEqual(closeProblems(1_000_000, { ...exact, date: 'x' }), ['date']);
  assert.equal(closingFigures(1_000_000, { ...exact, counted: null }).needsReason, false);
});

test('days close in order, never ahead of today; the usual float is left', () => {
  assert.equal(defaultCloseDate(null, '2026-10-11'), '2026-10-11');
  assert.equal(defaultCloseDate('2026-10-08', '2026-10-11'), '2026-10-09');
  assert.equal(defaultCloseDate('2026-10-11', '2026-10-11'), '2026-10-11');
  assert.equal(defaultCloseDate('2026-10-31', '2026-11-30'), '2026-11-01');
  assert.equal(suggestedWithdrawal(1_300_000, 1_000_000), 300_000);
  assert.equal(suggestedWithdrawal(800_000, 1_000_000), 0);
  assert.equal(suggestedWithdrawal(null, 1_000_000), 0);
});

test('cash error codes have their own plain text in both languages; others fall back', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getWorkforceDictionary(locale);
    const own = cashDictionary(locale).errors;
    for (const code of Object.keys(own)) {
      const error = new ApiError(409, code, code);
      assert.equal(cashErrorMessage(error, t, locale), own[code as keyof typeof own]);
    }
    assert.equal(
      cashErrorMessage(new ApiError(403, 'FORBIDDEN', 'x'), t, locale),
      t.errors.forbidden,
    );
    assert.equal(cashErrorMessage(new Error('boom'), t, locale), t.errors.unexpected);
  }
});

test('the texts are complete in both languages and never say "khám"', () => {
  const vi = JSON.stringify(cashDictionary('vi'));
  const en = JSON.stringify(cashDictionary('en'));
  assert.doesNotMatch(vi, /khám/i);
  assert.equal(
    Object.keys(cashDictionary('vi').categories).length,
    Object.keys(cashDictionary('en').categories).length,
  );
  assert.equal(vi.match(/\{\w+\}/g)?.length, en.match(/\{\w+\}/g)?.length);
});

import type { BranchSummary, MyIncomeResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MyIncomeView } from '../../components/workforce/screens/my-income';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, json, owner, render, scriptedFetch } from '../../test/support';
import { WorkforceApi } from './api';
import { loadMyIncome, shiftAnchor } from './my-income';
import { navigationFor } from './permissions';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const A = 'branch-a';
const T = 'branch-t';
const branches = new Map<string, BranchSummary>([
  [
    A,
    {
      id: A,
      code: 'A',
      name: 'Lucy Spa Đà Nẵng',
      timezone: 'Asia/Ho_Chi_Minh',
      isActive: true,
      version: 1,
    },
  ],
  [
    T,
    {
      id: T,
      code: 'T',
      name: 'Lucy Spa Tokyo',
      timezone: 'Asia/Tokyo',
      isActive: true,
      version: 1,
    },
  ],
]);
const FUTURE = ['SERVICE_TOUR', 'COMMISSION', 'TIPS', 'ADJUSTMENTS'] as const;
const week = { kind: 'WEEK', date: '2026-10-08', from: '2026-10-05', to: '2026-10-11' } as const;
const ctv: MyIncomeResponse = {
  kind: 'EMPLOYEE',
  title: 'COLLABORATOR',
  classification: 'COLLABORATOR',
  period: week,
  baseSalary: null,
  collaboratorWork: {
    totalAgreedPayVnd: '280000',
    occurrenceCount: 4,
    unagreedCount: 1,
    byBranch: [
      { branchId: A, totalAgreedPayVnd: '130000', occurrenceCount: 3, unagreedCount: 1 },
      { branchId: T, totalAgreedPayVnd: '150000', occurrenceCount: 1, unagreedCount: 0 },
    ],
    items: [
      {
        id: '1',
        workDate: '2026-10-05',
        branchId: A,
        mode: 'SHIFT',
        startTime: '13:00',
        endTime: '18:00',
        agreedPayVnd: '80000',
      },
      {
        id: '2',
        workDate: '2026-10-05',
        branchId: A,
        mode: 'SHIFT',
        startTime: '09:00',
        endTime: '12:00',
        agreedPayVnd: null,
      },
      {
        id: '3',
        workDate: '2026-10-07',
        branchId: T,
        mode: 'FULL_DAY',
        startTime: '09:00',
        endTime: '21:00',
        agreedPayVnd: '150000',
      },
      {
        id: '4',
        workDate: '2026-10-11',
        branchId: A,
        mode: 'SHIFT',
        startTime: '10:00',
        endTime: '12:00',
        agreedPayVnd: '50000',
      },
    ],
  },
  unavailableSources: [...FUTURE],
};
const official: MyIncomeResponse = {
  kind: 'EMPLOYEE',
  title: 'MANAGER',
  classification: 'OFFICIAL_EMPLOYEE',
  period: { kind: 'MONTH', date: '2026-10-08', from: '2026-10-01', to: '2026-10-31' },
  baseSalary: { amountVnd: '12000000', unit: 'MONTH' },
  collaboratorWork: null,
  unavailableSources: [...FUTURE],
};
const view = (income: MyIncomeResponse, locale: 'vi' | 'en' = 'vi') =>
  render(<MyIncomeView income={income} branches={branches} />, employee(), locale);

test('My Income is in every workforce navigation, Owner included', () => {
  for (const account of [owner, employee()]) {
    assert.deepEqual(
      navigationFor(account).find((item) => item.key === 'myIncome'),
      { key: 'myIncome', group: 'home', path: '/income' },
    );
  }
  assert.equal(vi.nav.myIncome, 'Thu nhập của tôi');
  assert.equal(en.nav.myIncome, 'My Income');
});

test('CTV: agreed total, count, unagreed, branch attribution; precise wording', () => {
  const markup = view(ctv);
  for (const text of [
    vi.myIncome.total,
    '280.000 ₫',
    vi.myIncome.count,
    vi.myIncome.unagreed,
    vi.myIncome.unagreedValue,
    '80.000 ₫',
    '150.000 ₫',
    'Lucy Spa Đà Nẵng',
    'Lucy Spa Tokyo',
    'Theo ca',
    'Full ngày',
    '13:00–18:00',
    vi.myIncome.byBranch,
    vi.myIncome.weekNote,
    '05/10/2026',
    '11/10/2026',
  ]) {
    assert.ok(markup.includes(text), text);
  }
  // Never payment wording while payroll does not exist; never "0 ₫" for unagreed pay.
  for (const wrong of ['Đã nhận', 'Thực nhận', 'Đã thanh toán']) {
    assert.ok(!markup.includes(wrong), wrong);
  }
  assert.ok(!markup.includes('>0 ₫<'));
  // Future sources are named as not yet available, not as zero amounts.
  assert.ok(markup.includes(vi.myIncome.unavailableTitle));
  for (const source of FUTURE) assert.ok(markup.includes(vi.myIncome.sources[source]), source);
  const english = view(ctv, 'en');
  for (const text of [
    'Total agreed work pay',
    '280,000 ₫',
    'Not agreed yet',
    'Pay not yet agreed',
  ]) {
    assert.ok(english.includes(text), text);
  }
  // No unagreed row when every occurrence has agreed pay.
  const allAgreed = view({
    ...ctv,
    collaboratorWork: { ...ctv.collaboratorWork!, unagreedCount: 0 },
  });
  assert.ok(!allAgreed.includes(vi.myIncome.unagreed));
});

test('official / manager: configured monthly base salary only; no derived or fake amounts', () => {
  const markup = view(official);
  assert.ok(markup.includes(vi.myIncome.baseSalary));
  assert.ok(markup.includes('12.000.000 ₫ / tháng'));
  assert.ok(markup.includes(vi.myIncome.baseSalaryNote));
  assert.ok(!markup.includes(vi.myIncome.ctvTitle));
  assert.ok(!/(^|[^0-9.])0 ₫/.test(markup), 'no zero amounts');
  assert.ok(
    view({ ...official, baseSalary: { amountVnd: null, unit: 'MONTH' } }).includes(
      vi.myIncome.baseSalaryNotSet,
    ),
  );
  assert.ok(view(official, 'en').includes('12,000,000 ₫ / month'));
});

test('trainee and Owner: honest empty states', () => {
  const trainee = view({
    ...official,
    title: 'TRAINEE',
    classification: 'TRAINEE',
    baseSalary: null,
    unavailableSources: [],
  });
  assert.ok(trainee.includes(vi.myIncome.empty));
  assert.ok(!trainee.includes('₫'));
  const ownerView = render(
    <MyIncomeView
      income={{
        ...official,
        kind: 'OWNER',
        title: 'OWNER',
        classification: null,
        baseSalary: null,
        unavailableSources: [],
      }}
      branches={branches}
    />,
    owner,
  );
  assert.ok(ownerView.includes(vi.myIncome.ownerNote));
  assert.ok(!ownerView.includes('₫'));
});

test('the request carries only the period and date; navigation shifts by the period', async () => {
  const { fetcher, calls } = scriptedFetch([() => json(200, ctv), () => json(200, official)]);
  const api = new WorkforceApi({ fetch: fetcher });
  await loadMyIncome(api, 'WEEK', '2026-10-08');
  await loadMyIncome(api, 'MONTH', null);
  assert.equal(calls[0]?.url, '/api/v1/me/income?period=WEEK&date=2026-10-08');
  assert.equal(calls[1]?.url, '/api/v1/me/income?period=MONTH');
  assert.equal(shiftAnchor('2026-10-08', 'DAY', 1), '2026-10-09');
  assert.equal(shiftAnchor('2026-10-08', 'WEEK', -1), '2026-10-01');
  assert.equal(shiftAnchor('2026-10-31', 'MONTH', 1), '2026-11-01');
  assert.equal(shiftAnchor('2026-01-15', 'MONTH', -1), '2025-12-01');
});

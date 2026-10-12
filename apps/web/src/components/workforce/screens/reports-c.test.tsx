import type {
  AdvancesReport,
  CashDailyReport,
  CashDifferencesReport,
  CashFundsReport,
  LabourCostReport,
  PayrollMonthlyReport,
  ProfitReport,
  ReportRegistryResponse,
  TipsReport,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reportsCDictionary } from '../../../i18n/reports-c';
import { owner, render } from '../../../test/support';
import { cashTabs, DailyBody, DifferencesBody, FundsBody } from './reports-cash';
import { ReportView } from './reports-kit';
import { AdvancesBody, LabourBody, PayrollBody, payTabs, TipsBody } from './reports-pay';
import { ProfitBody } from './reports-profit';

const c = reportsCDictionary('vi');
const at = '2026-10-12T03:00:00.000Z';
const period = { from: '2026-10-01', to: '2026-10-12', previous: null };
const branchA = { id: 'a', code: 'A', name: 'Nguyễn Quang Bích' };
const branchB = { id: 'b', code: 'B', name: 'Quận 1' };
const base = { generatedAt: at, branches: [branchA, branchB], started: true, startedAt: at };

const registry = (ids: string[]): ReportRegistryResponse => ({
  generatedAt: at,
  branches: [branchA, branchB],
  reports: ids.map((id) => ({
    id,
    area: 'money',
    wave: 'C',
    available: true,
    exportable: true,
    exportReauth: ['tips', 'payroll-monthly', 'labour-cost', 'advances', 'profit'].includes(id),
    branchIds: ['a', 'b'],
  })),
});

test('the cash page: one h1, the three tabs, one export action; shop-wide tabs of the pay page have no branch choice', () => {
  const html = render(
    <ReportView
      title={c.cash.title}
      intro={c.cash.intro}
      tabs={cashTabs(c)}
      registry={registry(['cash-daily', 'cash-funds', 'cash-differences'])}
    />,
    owner,
  );
  assert.match(html, /<h1[^>]*>Báo cáo quỹ<\/h1>/);
  for (const label of Object.values(c.cash.tabs)) assert.match(html, new RegExp(label));
  assert.equal(html.match(/ls-btn-primary/g)?.length, 1);
  // The pay page opens on its first tab (tips, per branch); a person who may open only the shop-wide ones gets the branch-less toolbar.
  const pay = render(
    <ReportView
      title={c.pay.title}
      intro={c.pay.intro}
      tabs={payTabs(c)}
      registry={registry(['payroll-monthly'])}
    />,
    owner,
  );
  assert.match(pay, /<h1[^>]*>Báo cáo lương<\/h1>/);
  assert.doesNotMatch(pay, /Tất cả chi nhánh/);
});

const day = (
  patch: Partial<CashDailyReport['rows'][number]> = {},
): CashDailyReport['rows'][number] => ({
  branch: branchA,
  date: '2026-10-11',
  closed: true,
  openingFloatVnd: '1000000',
  cashInVnd: '400000',
  cashOutVnd: '50000',
  expectedVnd: '1350000',
  countedVnd: '1330000',
  differenceVnd: '-20000',
  reason: 'Thiếu tiền lẻ',
  withdrawalVnd: '330000',
  ...patch,
});

test('daily cash: before the book starts the page says so (never zeros); then closed and open days, signed differences, kinds of entry', () => {
  const empty: CashDailyReport = {
    ...base,
    started: false,
    startedAt: null,
    period,
    rows: [],
    byCategory: [],
    totals: { cashInVnd: '0', cashOutVnd: '0', differenceVnd: '0', closedDays: 0, openDays: 0 },
    truncated: false,
  };
  const before = render(<DailyBody data={empty} />, owner);
  assert.match(before, new RegExp(c.cash.notStarted));
  assert.doesNotMatch(before, /ls-kpi/);
  const data: CashDailyReport = {
    ...empty,
    started: true,
    startedAt: at,
    rows: [
      day(),
      day({
        date: '2026-10-12',
        closed: false,
        countedVnd: null,
        differenceVnd: null,
        reason: null,
        withdrawalVnd: null,
        expectedVnd: '1280000',
      }),
    ],
    byCategory: [{ category: 'SALE_CASH', inVnd: '700000', outVnd: '0' }],
    totals: {
      cashInVnd: '800000',
      cashOutVnd: '70000',
      differenceVnd: '-20000',
      closedDays: 1,
      openDays: 1,
    },
  };
  const html = render(<DailyBody data={data} />, owner);
  assert.match(html, new RegExp(c.cash.status.closed));
  assert.match(html, new RegExp(c.cash.status.open));
  assert.match(html, /-20\.000/);
  assert.match(html, /Bán hàng thu tiền mặt/);
  assert.match(html, new RegExp(c.cash.kpi.difference));
});

test('funds: balances with the kind in words; the bank note when the bank is not shown', () => {
  const data = (bankIncluded: boolean): CashFundsReport => ({
    ...base,
    period,
    bankIncluded,
    rows: [
      {
        fundId: 'f1',
        kind: 'CASH',
        branch: branchA,
        name: 'Quỹ A',
        openingBalanceVnd: '1000000',
        inVnd: '700000',
        outVnd: '420000',
        balanceVnd: '1280000',
        lastClosedDate: '2026-10-11',
      },
      ...(bankIncluded
        ? [
            {
              fundId: 'f2',
              kind: 'BANK' as const,
              branch: null,
              name: 'Ngân hàng',
              openingBalanceVnd: '2000000',
              inVnd: '250000',
              outVnd: '200000',
              balanceVnd: '2050000',
              lastClosedDate: null,
            },
          ]
        : []),
    ],
  });
  const withBank = render(<FundsBody data={data(true)} />, owner);
  assert.match(withBank, /2\.050\.000/);
  assert.match(withBank, /Ngân hàng/);
  assert.doesNotMatch(withBank, new RegExp(c.cash.bankNote.slice(0, 20)));
  const without = render(<FundsBody data={data(false)} />, owner);
  assert.match(without, new RegExp(c.cash.bankNote.slice(0, 20)));
  assert.match(without, /1\.280\.000/);
});

test('differences: the amount signed, and a day over the threshold is marked in words', () => {
  const data: CashDifferencesReport = {
    ...base,
    period,
    alertThresholdVnd: '50000',
    totals: { differenceVnd: '280000', days: 2, alerts: 1 },
    truncated: false,
    rows: [
      {
        branch: branchA,
        date: '2026-10-11',
        expectedVnd: '1350000',
        countedVnd: '1330000',
        differenceVnd: '-20000',
        reason: 'Thiếu tiền lẻ',
        closedByName: 'Chủ spa',
        alert: false,
      },
      {
        branch: branchB,
        date: '2026-10-09',
        expectedVnd: '500000',
        countedVnd: '800000',
        differenceVnd: '300000',
        reason: 'Nhập thiếu',
        closedByName: 'Chủ spa',
        alert: true,
      },
    ],
  };
  const html = render(<DifferencesBody data={data} />, owner);
  assert.match(html, /\+300\.000/);
  assert.match(html, /-20\.000/);
  assert.equal(html.match(new RegExp(c.cash.alert, 'g'))?.length, 1);
  assert.match(html, new RegExp(c.cash.kpi.alerts));
});

test('tips and advances: the amounts, what is still owed, and nothing before the books start', () => {
  const tips: TipsReport = {
    ...base,
    period,
    truncated: false,
    totals: { cashVnd: '30000', transferVnd: '10000', totalVnd: '40000', owedVnd: '25000' },
    rows: [
      {
        userId: 'u1',
        name: 'Thu Hà',
        employeeCode: 'NV01',
        cashVnd: '15000',
        transferVnd: '10000',
        totalVnd: '25000',
        inRunVnd: '0',
        owedVnd: '25000',
        entries: 3,
      },
    ],
  };
  const html = render(<TipsBody data={tips} />, owner);
  assert.match(html, /Thu Hà/);
  assert.match(html, new RegExp(c.pay.kpi.tipsOwed));
  assert.match(html, /25\.000/);
  const advances: AdvancesReport = {
    ...base,
    totals: { outstandingVnd: '180000', pendingVnd: '50000' },
    rows: [
      {
        userId: 'u1',
        name: 'Thu Hà',
        employeeCode: null,
        paidVnd: '200000',
        recoveredVnd: '20000',
        outstandingVnd: '180000',
        pendingCount: 0,
        pendingVnd: '0',
      },
    ],
  };
  assert.match(render(<AdvancesBody data={advances} />, owner), /180\.000/);
  const notStarted = render(
    <AdvancesBody data={{ ...advances, started: false, startedAt: null, rows: [] }} />,
    owner,
  );
  assert.match(notStarted, new RegExp(c.pay.notStarted));
});

test('payroll by month: status in words, the kinds of pay as columns, tips apart; labour share or "no revenue"', () => {
  const payroll: PayrollMonthlyReport = {
    ...base,
    period,
    totals: { netVnd: '370000', tipsVnd: '20000' },
    rows: [
      {
        month: '2026-10-01',
        status: 'DRAFT',
        paymentDay: null,
        people: 2,
        byKind: {
          BASE_SALARY: '250000',
          CTV_WORK: '0',
          TOUR: '30000',
          COMMISSION: '5000',
          BONUS: '10000',
          ADJUSTMENT: '0',
          DEDUCTION: '-5000',
          ADVANCE_RECOVERY: '-20000',
        },
        netVnd: '270000',
        tipsVnd: '20000',
      },
    ],
  };
  const html = render(<PayrollBody data={payroll} />, owner);
  assert.match(html, /10\/2026/);
  assert.match(html, new RegExp(c.pay.status.DRAFT));
  assert.match(html, /270\.000/);
  assert.match(html, new RegExp(c.pay.kinds['BASE_SALARY']!));
  const labour: LabourCostReport = {
    ...base,
    period,
    rows: [
      {
        month: '2026-10-01',
        status: 'DRAFT',
        labourVnd: '290000',
        revenueVnd: '300000',
        shareBp: 9667,
      },
      { month: '2026-09-01', status: 'PAID', labourVnd: '100000', revenueVnd: '0', shareBp: null },
    ],
  };
  const labourHtml = render(<LabourBody data={labour} />, owner);
  assert.match(labourHtml, /96,7%/);
  assert.match(labourHtml, new RegExp(c.pay.noRevenue));
  assert.match(labourHtml, new RegExp(c.pay.labourNote.slice(0, 25)));
});

const profit = (patch: Partial<ProfitReport> = {}): ProfitReport => ({
  generatedAt: at,
  period,
  branches: [branchA, branchB],
  started: true,
  lines: {
    revenueVnd: '400000',
    costOfGoodsVnd: '40000',
    tourVnd: '25000',
    commissionVnd: '5000',
    salariesVnd: '255000',
    manualExpensesVnd: '70000',
    profitVnd: '5000',
  },
  goods: { unitsSold: 2, unitsWithCost: 1, coverageBp: 5000 },
  salaries: { monthsCounted: 2, monthsPartial: 1, monthsMissing: 1, monthsDraft: 1 },
  withoutCost: [
    {
      variantId: 'v1',
      sku: 'KG-01',
      nameVi: 'Kem không giá vốn',
      nameEn: 'Cream',
      unitsWithoutCost: 1,
    },
  ],
  ...patch,
});

test('provisional profit: every line, deductions with a minus sign, the disclaimer, the cost coverage and the salary months in words', () => {
  const html = render(<ProfitBody data={profit()} />, owner);
  assert.match(html, new RegExp(c.profit.lines.revenue));
  assert.match(html, /-40\.000/);
  assert.match(html, /-255\.000/);
  assert.match(html, /5\.000/);
  assert.match(html, new RegExp(c.profit.disclaimerTitle));
  assert.match(html, /không phải báo cáo thuế/);
  assert.match(html, /50% số lượng bán có giá vốn/);
  assert.match(html, /1 tháng chưa có kỳ lương/);
  assert.match(html, /1 tháng chỉ nằm một phần/);
  assert.match(html, /1 tháng là bảng lương nháp/);
  assert.match(html, new RegExp(c.profit.coverageWarning.slice(0, 30)));
  assert.match(html, /Kem không giá vốn/);
});

test('profit: no warning when every unit sold had a cost; a loud note before the books start', () => {
  const complete = render(
    <ProfitBody
      data={profit({
        goods: { unitsSold: 2, unitsWithCost: 2, coverageBp: 10000 },
        withoutCost: [],
      })}
    />,
    owner,
  );
  assert.doesNotMatch(complete, new RegExp(c.profit.coverageWarning.slice(0, 30)));
  const early = render(<ProfitBody data={profit({ started: false })} />, owner);
  assert.match(early, new RegExp(c.profit.notStarted.slice(0, 30)));
});

test('English: the cash page in English', () => {
  const en = reportsCDictionary('en');
  const html = render(
    <ReportView
      title={en.cash.title}
      intro={en.cash.intro}
      tabs={cashTabs(en)}
      registry={registry(['cash-daily'])}
    />,
    owner,
    'en',
  );
  assert.match(html, /<h1[^>]*>Cash report<\/h1>/);
  assert.match(html, /Export/);
});

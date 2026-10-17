import type {
  PayRunDetailResponse,
  PayRunListResponse,
  PayslipListResponse,
  PayslipView,
  SalaryAdvancesResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { payrollDictionary } from '../../../i18n/payroll';
import { owner, render } from '../../../test/support';
import { AdvancesView } from './advances';
import { PayrollList } from './payroll';
import { RunView } from './payroll-run';
import { PayslipDocument } from './payroll-slip';

const text = payrollDictionary('vi');
const noop = () => undefined;
const buttons = (html: string, cls: string) =>
  html.match(new RegExp(`ls-btn-${cls}`, 'g'))?.length ?? 0;

const list = (patch: Partial<PayRunListResponse> = {}): PayRunListResponse => ({
  today: '2026-10-11',
  firstMonth: '2026-09',
  suggestedMonth: '2026-09',
  canManage: true,
  items: [
    {
      id: 'r10',
      month: '2026-10',
      status: 'DRAFT',
      paymentDay: '2026-11-05',
      version: 3,
      people: 12,
      payVnd: '85200000',
      tipsVnd: '640000',
    },
  ],
  ...patch,
});

test('the payroll list: one primary action to create a month, the runs as a table, not live explained', () => {
  const html = render(<PayrollList list={list()} reload={noop} />, owner, 'vi');
  assert.match(html, /<h1[^>]*>Bảng lương<\/h1>/);
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(text.list.create));
  assert.match(html, /10\/2026/);
  assert.match(html, /85\.200\.000 ₫/);
  assert.match(html, new RegExp(text.runStatuses.DRAFT));
  // A reader sees the table but no primary action; every month taken means nothing to create.
  assert.equal(
    buttons(
      render(<PayrollList list={list({ canManage: false })} reload={noop} />, owner, 'vi'),
      'primary',
    ),
    0,
  );
  assert.equal(
    buttons(
      render(<PayrollList list={list({ firstMonth: '2026-10' })} reload={noop} />, owner, 'vi'),
      'primary',
    ),
    0,
  );
  const notLive = render(
    <PayrollList list={list({ firstMonth: null, items: [] })} reload={noop} />,
    owner,
    'vi',
  );
  assert.match(notLive, new RegExp(text.list.notLive.slice(0, 30)));
  assert.equal(buttons(notLive, 'primary'), 0);
});

const detail = (patch: Partial<PayRunDetailResponse> = {}): PayRunDetailResponse => ({
  run: {
    id: 'r10',
    month: '2026-10',
    status: 'DRAFT',
    paymentDay: '2026-11-05',
    version: 4,
    people: 2,
    payVnd: '15010000',
    tipsVnd: '40000',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    refreshedAt: '2026-10-11T03:00:00.000Z',
    createdBy: { id: 'o', name: 'Chủ spa' },
    closedAt: null,
  },
  lines: [
    {
      id: 'l1',
      employee: { id: 'e1', name: 'Hoàng Quốc Nguyệt', code: 'NV0002' },
      classification: 'OFFICIAL_EMPLOYEE',
      items: [
        {
          id: 'i1',
          kind: 'BASE_SALARY',
          amountVnd: '9000000',
          generated: true,
          quantity: null,
          lateVnd: '0',
          flag: null,
          note: null,
          advanceId: null,
          reason: null,
          voided: false,
          voidReason: null,
          createdBy: null,
          createdAt: '2026-10-11T03:00:00.000Z',
        },
        {
          id: 'i2',
          kind: 'COMMISSION',
          amountVnd: '10000',
          generated: true,
          quantity: 1,
          lateVnd: '0',
          flag: null,
          note: null,
          advanceId: null,
          reason: null,
          voided: false,
          voidReason: null,
          createdBy: null,
          createdAt: '2026-10-11T03:00:00.000Z',
        },
      ],
      netVnd: '9010000',
      tipsVnd: '0',
      warnings: [],
      context: { attendanceDays: 20, leaveDays: 1 },
    },
    {
      id: 'l2',
      employee: { id: 'e2', name: 'Lý Ngọc Yến', code: 'NV0011' },
      classification: 'OFFICIAL_EMPLOYEE',
      items: [
        {
          id: 'i3',
          kind: 'BASE_SALARY',
          amountVnd: '6000000',
          generated: true,
          quantity: null,
          lateVnd: '0',
          flag: 'UNCONFIRMED_BASE',
          note: null,
          advanceId: null,
          reason: null,
          voided: false,
          voidReason: null,
          createdBy: null,
          createdAt: '2026-10-11T03:00:00.000Z',
        },
      ],
      netVnd: '6000000',
      tipsVnd: '40000',
      warnings: ['UNCONFIRMED_BASE'],
      context: { attendanceDays: 0, leaveDays: 0 },
    },
  ],
  totals: { payVnd: '15010000', tipsVnd: '40000', people: 2, byKind: {} },
  warnings: {
    unconfirmedBase: 1,
    noBase: 0,
    ctvUnagreed: 0,
    negativeNet: 0,
    noPaymentDay: false,
    cashDifferences: 2,
  },
  stale: false,
  canManage: true,
  canApprove: true,
  ...patch,
});

test('a draft run: totals, the warnings to look at, the lines, one primary action (close) for the person who approves', () => {
  const html = render(<RunView view={detail()} slips={null} reload={noop} />, owner, 'vi');
  assert.match(html, /<h1[^>]*>Bảng lương tháng 10\/2026<\/h1>/);
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(text.run.closeButton));
  assert.match(html, /15\.010\.000 ₫/);
  assert.match(html, /05\/11\/2026/);
  assert.match(html, new RegExp(text.run.warningsTitle));
  assert.match(html, /1 người chưa xác nhận lương cơ bản/);
  assert.match(html, /2 ngày trong tháng có chênh lệch khi đếm quỹ/);
  assert.match(html, /Hoàng Quốc Nguyệt/);
  assert.match(html, new RegExp(text.run.refresh));
  // The heading of a card is text only.
  assert.doesNotMatch(html, /<h2[^>]*>[^<]*[0-9][^<]*<\/h2>/);
  // A manager who may not approve sees the draft but no primary action; a stale draft says so.
  const manager = render(
    <RunView view={detail({ canApprove: false, stale: true })} slips={null} reload={noop} />,
    owner,
    'vi',
  );
  assert.equal(buttons(manager, 'primary'), 0);
  assert.match(manager, new RegExp(text.run.stale.slice(0, 30)));
});

test('a closed run: the next step is paying; the payslips show their status; no draft actions', () => {
  const closed = detail({
    run: { ...detail().run, status: 'CLOSED', closedAt: '2026-10-11T04:00:00.000Z' },
  });
  const slips: PayslipListResponse = {
    run: { ...closed.run, closedAt: closed.run.closedAt },
    items: [
      {
        id: 's1',
        runId: 'r10',
        month: '2026-10',
        employee: { id: 'e1', name: 'Hoàng Quốc Nguyệt', code: 'NV0002' },
        netVnd: '9010000',
        tipsVnd: '0',
        status: 'PENDING',
        paymentDay: '2026-11-05',
        paidAt: null,
        version: 1,
      },
      {
        id: 's2',
        runId: 'r10',
        month: '2026-10',
        employee: { id: 'e2', name: 'Lý Ngọc Yến', code: 'NV0011' },
        netVnd: '6000000',
        tipsVnd: '40000',
        status: 'PAID',
        paymentDay: '2026-11-05',
        paidAt: '2026-11-05T02:00:00.000Z',
        version: 2,
      },
    ],
    funds: [{ id: 'f1', name: 'Quỹ tiền mặt', kind: 'CASH', balanceVnd: '20000000' }],
    canPay: true,
    payable: true,
  };
  const html = render(<RunView view={closed} slips={slips} reload={noop} />, owner, 'vi');
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(text.run.payButton));
  assert.doesNotMatch(html, new RegExp(text.run.closeButton));
  assert.doesNotMatch(html, new RegExp(text.run.refresh));
  assert.match(html, new RegExp(text.slipStatuses.PENDING));
  assert.match(html, new RegExp(text.slipStatuses.PAID));
  assert.doesNotMatch(html, new RegExp(text.run.warningsTitle));
  // Nothing pending: nothing to pay.
  const paid = render(
    <RunView
      view={{ ...closed, run: { ...closed.run, status: 'PAID' } }}
      slips={{ ...slips, items: slips.items.map((slip) => ({ ...slip, status: 'PAID' as const })) }}
      reload={noop}
    />,
    owner,
    'vi',
  );
  assert.equal(buttons(paid, 'primary'), 0);
});

test('a payslip: the person, the month, net pay, and tips apart from it', () => {
  const slip: PayslipView = {
    id: 's2',
    runId: 'r10',
    month: '2026-10',
    employee: { id: 'e2', name: 'Lý Ngọc Yến', code: 'NV0011' },
    netVnd: '6015000',
    tipsVnd: '40000',
    status: 'PAID',
    paymentDay: '2026-11-05',
    paidAt: '2026-11-05T02:00:00.000Z',
    version: 2,
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    items: [
      {
        id: 'a',
        kind: 'BASE_SALARY',
        amountVnd: '6000000',
        generated: true,
        quantity: null,
        lateVnd: '0',
        flag: null,
        note: null,
        advanceId: null,
        reason: null,
        voided: false,
        voidReason: null,
        createdBy: null,
        createdAt: '2026-10-11T03:00:00.000Z',
      },
      {
        id: 'b',
        kind: 'TOUR',
        amountVnd: '15000',
        generated: true,
        quantity: 1,
        lateVnd: '0',
        flag: null,
        note: null,
        advanceId: null,
        reason: null,
        voided: false,
        voidReason: null,
        createdBy: null,
        createdAt: '2026-10-11T03:00:00.000Z',
      },
      {
        id: 'c',
        kind: 'TIP',
        amountVnd: '40000',
        generated: true,
        quantity: 1,
        lateVnd: '0',
        flag: null,
        note: null,
        advanceId: null,
        reason: null,
        voided: false,
        voidReason: null,
        createdBy: null,
        createdAt: '2026-10-11T03:00:00.000Z',
      },
    ],
    paidBy: { id: 'o', name: 'Chủ spa' },
    paidFund: { id: 'f1', name: 'Quỹ tiền mặt' },
    reversedAt: null,
    reversedBy: null,
    reversalReason: null,
  };
  const html = render(<PayslipDocument slip={slip} />, owner, 'vi');
  assert.match(html, /LUCY SPA/);
  assert.match(html, /Phiếu lương tháng 10\/2026/);
  assert.match(html, /Lý Ngọc Yến/);
  assert.match(html, /6\.015\.000 ₫/);
  assert.ok(html.includes(text.slip.tips.slice(0, 20)));
  assert.match(html, /40\.000 ₫/);
  assert.match(html, new RegExp(text.slipStatuses.PAID));
  // The tip line is not in the item table: it is shown apart from net pay.
  assert.equal(
    (html.match(new RegExp(text.kinds.TIP, 'g')) ?? []).length,
    1,
    'only the separate tips line names the tips',
  );
  const reversed = render(
    <PayslipDocument slip={{ ...slip, status: 'REVERSED', reversalReason: 'Chuyển nhầm' }} />,
    owner,
    'vi',
  );
  assert.match(reversed, /Chuyển nhầm/);
});

const advances = (patch: Partial<SalaryAdvancesResponse> = {}): SalaryAdvancesResponse => ({
  items: [
    {
      id: 'x1',
      employee: { id: 'e1', name: 'Hoàng Quốc Nguyệt', code: 'NV0002' },
      amountVnd: '3000000',
      status: 'REQUESTED',
      reason: 'Việc gấp',
      requestedBy: { id: 'm', name: 'Quản lý' },
      requestedAt: '2026-10-11T03:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      paidBy: null,
      paidAt: null,
      paidFund: null,
      recoveredVnd: '0',
      writtenOffVnd: null,
      writeOffReason: null,
      cancelReason: null,
      outstandingVnd: '0',
      version: 1,
    },
    {
      id: 'x2',
      employee: { id: 'e2', name: 'Lý Ngọc Yến', code: 'NV0011' },
      amountVnd: '1000000',
      status: 'PAID',
      reason: 'Việc gấp',
      requestedBy: { id: 'm', name: 'Quản lý' },
      requestedAt: '2026-10-01T03:00:00.000Z',
      approvedBy: null,
      approvedAt: null,
      paidBy: null,
      paidAt: null,
      paidFund: { id: 'f1', name: 'Quỹ' },
      recoveredVnd: '400000',
      writtenOffVnd: null,
      writeOffReason: null,
      cancelReason: null,
      outstandingVnd: '600000',
      version: 3,
    },
  ],
  eligible: [
    { employee: { id: 'e3', name: 'Phạm Thị Linh', code: 'NV0007' }, limitVnd: '4500000' },
  ],
  funds: [{ id: 'f1', name: 'Quỹ tiền mặt', kind: 'CASH', balanceVnd: '20000000' }],
  canRequest: true,
  canApprove: true,
  ...patch,
});

test('advances: the table with the stage and what is still owed; one primary action to request, none for a reader', () => {
  const html = render(<AdvancesView data={advances()} reload={noop} />, owner, 'vi');
  assert.match(html, /<h1[^>]*>Tạm ứng lương<\/h1>/);
  assert.equal(buttons(html, 'primary'), 1);
  assert.match(html, new RegExp(text.advances.request));
  assert.match(html, new RegExp(text.advances.status.REQUESTED));
  assert.match(html, new RegExp(text.advances.status.PAID));
  // Intl grouping, the ₫ kept on the amount's line by a no-break space.
  assert.match(html, /600\.000\s₫/);
  assert.equal(
    buttons(
      render(
        <AdvancesView data={advances({ canRequest: false, canApprove: false })} reload={noop} />,
        owner,
        'vi',
      ),
      'primary',
    ),
    0,
  );
  assert.match(
    render(<AdvancesView data={advances({ items: [] })} reload={noop} />, owner, 'vi'),
    new RegExp(text.advances.none),
  );
});

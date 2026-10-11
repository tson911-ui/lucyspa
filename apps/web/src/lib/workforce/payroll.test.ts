import type {
  PayRunDetailResponse,
  PayRunSummary,
  PayslipSummary,
  SalaryAdvanceItem,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import {
  advanceBody,
  advanceCan,
  advanceProblems,
  closeBlockers,
  itemBody,
  itemProblems,
  monthLabel,
  monthsToCreate,
  parseVnd,
  paymentDayWindow,
  payTotal,
  payrollErrorMessage,
  reasonMissing,
  validPaymentDay,
} from './payroll';

const run = (month: string): PayRunSummary => ({
  id: month,
  month,
  status: 'DRAFT',
  paymentDay: null,
  version: 1,
  people: 0,
  payVnd: '0',
  tipsVnd: '0',
});

test('months: shown as MM/YYYY; a new run is offered for every month since the start that has none', () => {
  assert.equal(monthLabel('2026-10'), '10/2026');
  assert.deepEqual(monthsToCreate({ today: '2026-10-11', firstMonth: null, items: [] }), []);
  assert.deepEqual(
    monthsToCreate({ today: '2026-10-11', firstMonth: '2026-08', items: [run('2026-09')] }),
    ['2026-08', '2026-10'],
  );
  assert.deepEqual(
    monthsToCreate({ today: '2026-10-11', firstMonth: '2026-10', items: [run('2026-10')] }),
    [],
  );
  assert.deepEqual(monthsToCreate({ today: '2027-01-02', firstMonth: '2026-11', items: [] }), [
    '2026-11',
    '2026-12',
    '2027-01',
  ]);
});

test('the payment day is a real day from the first of the month to 120 days after its end', () => {
  assert.deepEqual(paymentDayWindow('2026-10'), { min: '2026-10-01', max: '2027-02-28' });
  assert.equal(validPaymentDay('2026-10-01', '2026-10'), true);
  assert.equal(validPaymentDay('2026-09-30', '2026-10'), false);
  assert.equal(validPaymentDay('2027-02-28', '2026-10'), true);
  assert.equal(validPaymentDay('2027-03-01', '2026-10'), false);
  assert.equal(validPaymentDay('2026-02-30', '2026-02'), false);
  assert.equal(validPaymentDay('', '2026-10'), false);
});

test('amounts: whole dong with separators; a minus only where it is allowed; never 0 or above the limit', () => {
  assert.equal(parseVnd('1.500.000'), '1500000');
  assert.equal(parseVnd(' 2,000,000 '), '2000000');
  assert.equal(parseVnd('300000'), '300000');
  assert.equal(parseVnd('-5000'), null);
  assert.equal(parseVnd('-5000', { negative: true }), '-5000');
  assert.equal(parseVnd('−5.000', { negative: true }), '-5000');
  for (const bad of ['', '0', '-0', 'abc', '10000000001', '1e3', '0100']) {
    assert.equal(parseVnd(bad, { negative: true }), null, bad);
  }
});

test('a manual item needs a person, a valid amount for its kind and a reason; a deduction is typed positive', () => {
  const draft = {
    employeeUserId: 'e1',
    kind: 'BONUS' as const,
    amount: '200.000',
    reason: ' Chuyên cần ',
  };
  assert.deepEqual(itemBody(draft, 'req'), {
    employeeUserId: 'e1',
    kind: 'BONUS',
    amountVnd: '200000',
    reason: 'Chuyên cần',
    clientRequestId: 'req',
  });
  assert.deepEqual(itemProblems({ ...draft, employeeUserId: '', amount: '-5', reason: '' }), [
    'employee',
    'amount',
    'reason',
  ]);
  assert.equal(
    itemBody({ ...draft, kind: 'ADJUSTMENT', amount: '-50.000' }, 'req')?.amountVnd,
    '-50000',
  );
  assert.equal(itemBody({ ...draft, kind: 'DEDUCTION', amount: '-50.000' }, 'req'), null);
  assert.equal(itemBody({ ...draft, reason: 'x'.repeat(501) }, 'req'), null);
  assert.equal(reasonMissing('  '), true);
  assert.equal(reasonMissing('Lý do'), false);
});

const view = (
  patch: Partial<PayRunDetailResponse> = {},
): Pick<PayRunDetailResponse, 'run' | 'lines' | 'warnings' | 'stale'> => ({
  run: {
    ...run('2026-10'),
    paymentDay: '2026-11-05',
    periodFrom: '2026-10-01',
    periodTo: '2026-10-31',
    refreshedAt: null,
    createdBy: { id: 'o', name: 'Chủ' },
    closedAt: null,
  },
  lines: [
    {
      id: 'l',
      employee: { id: 'e', name: 'A', code: 'NV1' },
      classification: 'OFFICIAL_EMPLOYEE',
      items: [],
      netVnd: '1',
      tipsVnd: '0',
      warnings: [],
      context: { attendanceDays: 0, leaveDays: 0 },
    },
  ],
  warnings: {
    unconfirmedBase: 0,
    noBase: 0,
    ctvUnagreed: 0,
    negativeNet: 0,
    noPaymentDay: false,
    cashDifferences: 0,
  },
  stale: false,
  ...patch,
});

test('a draft can be closed only when the API would let it: every blocker is named', () => {
  assert.deepEqual(closeBlockers(view()), []);
  assert.deepEqual(closeBlockers({ ...view(), stale: true }), ['stale']);
  assert.deepEqual(closeBlockers({ ...view(), lines: [] }), ['lines']);
  const bad = view();
  assert.deepEqual(
    closeBlockers({
      ...bad,
      run: { ...bad.run, paymentDay: null },
      warnings: { ...bad.warnings, noBase: 1, negativeNet: 1 },
    }),
    ['paymentDay', 'base', 'negative'],
  );
  // CTV work without agreed pay and a cash difference are only context.
  assert.deepEqual(
    closeBlockers({ ...bad, warnings: { ...bad.warnings, ctvUnagreed: 2, cashDifferences: 3 } }),
    [],
  );
});

const slip = (
  id: string,
  net: string,
  tips: string,
  status: PayslipSummary['status'] = 'PENDING',
): PayslipSummary => ({
  id,
  runId: 'r',
  month: '2026-10',
  employee: { id: id, name: id, code: id },
  netVnd: net,
  tipsVnd: tips,
  status,
  paymentDay: null,
  paidAt: null,
  version: 1,
});

test('what paying takes out: pending payslips only, net and tips together, chosen ones or all', () => {
  const list = [
    slip('a', '1000000', '40000'),
    slip('b', '2000000', '0'),
    slip('c', '500000', '0', 'PAID'),
  ];
  assert.equal(payTotal(list, null), 3_040_000n);
  assert.equal(payTotal(list, new Set(['a'])), 1_040_000n);
  assert.equal(payTotal(list, new Set()), 0n);
});

const advance = (status: SalaryAdvanceItem['status'], outstanding = '0'): SalaryAdvanceItem => ({
  id: 'x',
  employee: { id: 'e', name: 'A', code: 'NV1' },
  amountVnd: '1000000',
  status,
  reason: 'r',
  requestedBy: { id: 'm', name: 'M' },
  requestedAt: '2026-10-11T01:00:00.000Z',
  approvedBy: null,
  approvedAt: null,
  paidBy: null,
  paidAt: null,
  paidFund: null,
  recoveredVnd: '0',
  writtenOffVnd: null,
  writeOffReason: null,
  cancelReason: null,
  outstandingVnd: outstanding,
  version: 1,
});

test('the actions of an advance follow its stage and the person: approve and pay and write off need approval authority', () => {
  const manager = { canRequest: true, canApprove: false };
  const owner = { canRequest: true, canApprove: true };
  assert.deepEqual(advanceCan(advance('REQUESTED'), manager), {
    approve: false,
    cancel: true,
    pay: false,
    writeOff: false,
  });
  assert.deepEqual(advanceCan(advance('REQUESTED'), owner), {
    approve: true,
    cancel: true,
    pay: false,
    writeOff: false,
  });
  assert.deepEqual(advanceCan(advance('APPROVED'), owner), {
    approve: false,
    cancel: true,
    pay: true,
    writeOff: false,
  });
  assert.deepEqual(advanceCan(advance('PAID', '400000'), owner), {
    approve: false,
    cancel: false,
    pay: false,
    writeOff: true,
  });
  assert.deepEqual(advanceCan(advance('PAID', '0'), owner), {
    approve: false,
    cancel: false,
    pay: false,
    writeOff: false,
  });
  assert.deepEqual(advanceCan(advance('RECOVERED'), owner), {
    approve: false,
    cancel: false,
    pay: false,
    writeOff: false,
  });
});

test('an advance request needs a person, an amount within the limit and a reason', () => {
  const draft = { employeeUserId: 'e', amount: '3.000.000', reason: 'Việc gấp' };
  assert.deepEqual(advanceProblems(draft, '4500000'), []);
  assert.deepEqual(advanceProblems({ ...draft, amount: '4.500.001' }, '4500000'), ['amount']);
  assert.deepEqual(advanceProblems({ employeeUserId: '', amount: '', reason: ' ' }, null), [
    'employee',
    'amount',
    'reason',
  ]);
  assert.deepEqual(advanceBody(draft, '4500000', 'req'), {
    employeeUserId: 'e',
    amountVnd: '3000000',
    reason: 'Việc gấp',
    clientRequestId: 'req',
  });
  assert.equal(advanceBody({ ...draft, amount: '9.000.000' }, '4500000', 'req'), null);
});

test('refusals are shown in the payroll words first, then the shared ones', () => {
  const t = getWorkforceDictionary('vi');
  assert.match(
    payrollErrorMessage(new ApiError(409, 'PAY_RUN_BLOCKED'), t, 'vi'),
    /Chưa chốt được/,
  );
  assert.match(payrollErrorMessage(new ApiError(409, 'ADVANCE_LIMIT'), t, 'en'), /half/);
  assert.ok(payrollErrorMessage(new ApiError(500, 'OTHER'), t, 'vi').length > 0);
});

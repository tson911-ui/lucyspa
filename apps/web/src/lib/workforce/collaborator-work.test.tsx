import type { BranchSummary, CollaboratorWorkOccurrence } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ScheduleTable } from '../../components/workforce/screens/collaborator-schedule';
import { MyScheduleView } from '../../components/workforce/screens/my-account';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, json, owner, render, scriptedFetch, context } from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  collaboratorWorkCommands,
  createRequest,
  EMPTY_WORK_FORM,
  payLabel,
  scheduleRange,
  updateRequest,
  workErrorMessage,
  workFormOf,
  workFormProblem,
} from './collaborator-work';
import { navigationFor } from './permissions';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const A = 'branch-a';
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
]);
const hidePay = (row: CollaboratorWorkOccurrence): CollaboratorWorkOccurrence => {
  const copy = { ...row };
  delete copy.agreedPayVnd;
  return copy;
};
const shift: CollaboratorWorkOccurrence = {
  id: 'w1',
  employeeId: 'ctv-1',
  employeeCode: 'CTV-01',
  employeeName: 'Lê Cộng Tác',
  branchId: A,
  workDate: '2026-09-26',
  mode: 'SHIFT',
  startTime: '13:00',
  endTime: '18:00',
  agreedPayVnd: '80000',
  status: 'SCHEDULED',
  note: null,
  cancelledAt: null,
  cancelReason: null,
  createdAt: '2026-09-20T02:00:00.000Z',
  updatedAt: '2026-09-20T02:00:00.000Z',
  version: 1,
};
const fullDay: CollaboratorWorkOccurrence = {
  ...shift,
  id: 'w2',
  workDate: '2026-09-27',
  mode: 'FULL_DAY',
  startTime: '09:00',
  endTime: '21:00',
  agreedPayVnd: '150000',
};
const table = (items: CollaboratorWorkOccurrence[], account = owner, locale: 'vi' | 'en' = 'vi') =>
  render(
    <ScheduleTable
      items={items}
      branches={branches}
      today="2026-09-20"
      onChanged={() => Promise.resolve()}
    />,
    account,
    locale,
  );

test('schedule table: CTV, date, branch, mode, hours, agreed pay, status', () => {
  const markup = table([shift, fullDay]);
  for (const text of [
    'Lê Cộng Tác',
    '26/09/2026',
    'Lucy Spa Đà Nẵng',
    'Theo ca',
    'Full ngày',
    '13:00–18:00',
    '09:00–21:00',
    '80.000 ₫',
    '150.000 ₫',
    vi.collaboratorWork.statuses.SCHEDULED,
    vi.collaboratorWork.pay,
  ]) {
    assert.ok(markup.includes(text), text);
  }
  assert.ok(table([shift], owner, 'en').includes('80,000 ₫'));
  assert.ok(table([]).includes(vi.collaboratorWork.empty));
  // Pay hidden (no pay visibility): a dash; not agreed yet: "Chưa nhập".
  const withoutPay = hidePay(shift);
  assert.equal(payLabel(withoutPay, vi, 'vi'), '—');
  assert.equal(payLabel({ ...shift, agreedPayVnd: null }, vi, 'vi'), vi.collaboratorWork.payNotSet);
  // No hourly-rate calculator anywhere.
  assert.doesNotMatch(markup, /giờ ×|hourly|\/ giờ|per hour/i);
});

test('schedule actions follow MANAGE_WORK_SCHEDULE at the branch; pay needs the pay permission', () => {
  const manager = employee([
    ['MANAGE_WORK_SCHEDULE', A],
    ['VIEW_WORK_SCHEDULE', A],
  ]);
  const managed = table([shift], manager);
  assert.ok(managed.includes(`<summary>${vi.collaboratorWork.edit}</summary>`));
  assert.ok(
    managed.includes(vi.collaboratorWork.payNoPermission),
    'no pay field without pay permission',
  );
  assert.doesNotMatch(managed, /id="edit-w1-pay"/);
  const payManager = employee([
    ['MANAGE_WORK_SCHEDULE', A],
    ['MANAGE_EMPLOYEE_PAY', A],
  ]);
  assert.match(table([shift], payManager), /id="edit-w1-pay"/);
  const viewer = employee([['VIEW_WORK_SCHEDULE', A]]);
  assert.ok(!table([shift], viewer).includes(`<summary>${vi.collaboratorWork.edit}</summary>`));
  assert.ok(
    !table([{ ...shift, status: 'CANCELLED', cancelReason: 'Khách hủy' }]).includes(
      `<summary>${vi.collaboratorWork.edit}</summary>`,
    ),
  );
  // Navigation: only with a schedule permission.
  const has = (account: typeof owner) =>
    navigationFor(account).some((item) => item.key === 'collaboratorSchedule');
  assert.equal(has(viewer), true);
  assert.equal(has(manager), true);
  assert.equal(has(employee()), false);
  assert.equal(vi.nav.collaboratorSchedule, 'Lịch làm CTV');
  assert.equal(en.nav.collaboratorSchedule, 'Collaborator schedule');
});

test('requests: pay only when entered (never computed); FULL_DAY sends no times', async () => {
  const form = {
    ...EMPTY_WORK_FORM,
    employeeId: 'ctv-1',
    branchId: A,
    workDate: '2026-09-26',
    startTime: '13:00',
    endTime: '18:00',
  };
  assert.equal(workFormProblem(EMPTY_WORK_FORM), 'employeeId');
  assert.equal(workFormProblem({ ...form, endTime: '13:00' }), 'times');
  assert.equal(workFormProblem({ ...form, agreedPayVnd: '80.000' }), 'pay');
  assert.equal(workFormProblem(form, true), 'reason', 'past dates need a reason');
  assert.equal(workFormProblem(form), null);
  assert.deepEqual(createRequest(form), {
    employeeId: 'ctv-1',
    branchId: A,
    workDate: '2026-09-26',
    mode: 'SHIFT',
    startTime: '13:00',
    endTime: '18:00',
  });
  assert.deepEqual(createRequest({ ...form, mode: 'FULL_DAY', agreedPayVnd: '150000' }), {
    employeeId: 'ctv-1',
    branchId: A,
    workDate: '2026-09-26',
    mode: 'FULL_DAY',
    agreedPayVnd: '150000',
  });
  // Edits send only what changed; a pay-only edit keeps the FULL_DAY snapshot.
  assert.deepEqual(updateRequest(fullDay, { ...workFormOf(fullDay), agreedPayVnd: '160000' }), {
    expectedVersion: 1,
    agreedPayVnd: '160000',
  });
  const withoutPay = hidePay(shift);
  assert.deepEqual(updateRequest(withoutPay, { ...workFormOf(withoutPay), startTime: '14:00' }), {
    expectedVersion: 1,
    startTime: '14:00',
    endTime: '18:00',
  });
  assert.deepEqual(scheduleRange('2026-09-26'), { from: '2026-09-19', to: '2026-11-19' });
  const { fetcher, calls } = scriptedFetch([
    () => json(200, { items: [] }),
    context('c', true),
    () => json(201, shift),
    () => json(200, { items: [] }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await collaboratorWorkCommands.list(api, { from: '2026-09-19', to: '2026-11-19' });
  await collaboratorWorkCommands.create(api, createRequest(form));
  await collaboratorWorkCommands.mine(api, '2026-09-19', '2026-11-19');
  assert.deepEqual(
    calls.map((call) => [call.method, call.url.split('?')[0]]),
    [
      ['GET', '/api/v1/collaborator-work'],
      ['GET', '/api/v1/auth/context'],
      ['POST', '/api/v1/collaborator-work'],
      ['GET', '/api/v1/me/collaborator-work'],
    ],
  );
  const texts = vi.collaboratorWork.errors;
  for (const [error, message] of [
    [new ApiError(409, 'CONFLICT', 'overlap'), texts.overlap],
    [new ApiError(409, 'CONFLICT', 'branchHours'), texts.branchHours],
    [new ApiError(409, 'CONFLICT', 'branchClosed'), texts.branchClosed],
    [new ApiError(409, 'CONFLICT', 'classification'), texts.classification],
    [new ApiError(409, 'CONFLICT', 'branchAssignment'), texts.branchAssignment],
    [new ApiError(400, 'VALIDATION_FAILED', 'reason'), texts.reason],
    [new ApiError(403, 'FORBIDDEN', 'agreedPayVnd'), texts.pay],
  ] as const) {
    assert.equal(workErrorMessage(error, vi), message);
  }
});

test('My Account: a CTV sees their own schedule and agreed pay, read-only', () => {
  const view = render(<MyScheduleView items={[shift, fullDay]} branches={branches} />, employee());
  for (const text of [
    vi.myAccount.schedule.title,
    'Theo ca',
    'Full ngày',
    '80.000 ₫',
    '150.000 ₫',
  ]) {
    assert.ok(view.includes(text), text);
  }
  assert.doesNotMatch(view, /<form|<input|<button/, 'no edit controls');
  assert.ok(
    render(<MyScheduleView items={[]} branches={branches} />, employee()).includes(
      vi.myAccount.schedule.empty,
    ),
  );
});

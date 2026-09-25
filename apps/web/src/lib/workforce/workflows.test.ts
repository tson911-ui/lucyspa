import type { AttendanceRecordResponse, LeaveRequestResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../i18n/workforce';
import {
  context,
  customer,
  employee,
  failure,
  json,
  owner,
  scriptedFetch,
} from '../../test/support';
import { ApiError, WorkforceApi } from './api';
import {
  attendanceState,
  canCorrectAttendance,
  errorMessage,
  leaveActions,
  loadSession,
  runMutation,
  workforceLogin,
  workforceLogout,
} from './workflows';

test('workforce login: anonymous CSRF, WORKFORCE realm, then a fresh CSRF for the new session', async () => {
  const account = employee();
  const { fetcher, calls } = scriptedFetch([
    context('anon'),
    () => json(200, account),
    context('authed', true),
    () => json(200, { ok: true }),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  assert.deepEqual(
    await workforceLogin(api, {
      identifierType: 'EMPLOYEE_ID',
      identifier: 'KTV01',
      password: 'secret',
    }),
    account,
  );
  assert.deepEqual(calls[1]?.body, {
    realm: 'WORKFORCE',
    identifierType: 'EMPLOYEE_ID',
    identifier: 'KTV01',
    password: 'secret',
  });
  assert.equal(calls[1]?.headers['X-CSRF-Token'], 'anon');
  await api.post('/api/v1/x', {});
  assert.equal(calls[3]?.headers['X-CSRF-Token'], 'authed', 'rotated session uses its own token');
});

test('session resolution separates anonymous, customer and workforce sessions', async () => {
  const anonymous = scriptedFetch([context('a')]);
  assert.deepEqual(await loadSession(new WorkforceApi({ fetch: anonymous.fetcher })), {
    kind: 'anonymous',
  });
  const shopper = scriptedFetch([context('a', true), () => json(200, customer)]);
  assert.equal((await loadSession(new WorkforceApi({ fetch: shopper.fetcher }))).kind, 'customer');
  const staff = scriptedFetch([context('a', true), () => json(200, owner)]);
  assert.equal((await loadSession(new WorkforceApi({ fetch: staff.fetcher }))).kind, 'workforce');
  const expired = scriptedFetch([context('a', true), failure(401, 'AUTHENTICATION_REQUIRED')]);
  assert.deepEqual(await loadSession(new WorkforceApi({ fetch: expired.fetcher })), {
    kind: 'anonymous',
  });
});

test('logout ends the session server-side and forgets the CSRF token', async () => {
  const { fetcher, calls } = scriptedFetch([
    context('t1', true),
    () => json(204, null),
    context('t2'),
    () => json(200, {}),
  ]);
  const api = new WorkforceApi({ fetch: fetcher });
  await workforceLogout(api);
  assert.equal(calls[1]?.url, '/api/v1/auth/logout');
  assert.deepEqual(calls[1]?.body, {});
  await api.post('/api/v1/x', {});
  assert.equal(calls[2]?.url, '/api/v1/auth/context', 'a new anonymous context is fetched');
});

const record = (overrides: Partial<AttendanceRecordResponse>): AttendanceRecordResponse => ({
  id: 'r1',
  employeeId: 'emp-1',
  branchId: 'A',
  businessDate: '2026-09-25',
  checkInAt: '2026-09-25T01:00:00.000Z',
  checkOutAt: null,
  version: 1,
  ...overrides,
});

test('attendance state comes from backend records by the branch-timezone business date', () => {
  // 2026-09-25T20:00Z is already 2026-09-26 in Ho Chi Minh City (UTC+7).
  const now = new Date('2026-09-25T20:00:00Z');
  const zone = 'Asia/Ho_Chi_Minh';
  assert.equal(attendanceState([], 'A', zone, now).kind, 'none');
  const open = record({ businessDate: '2026-09-26' });
  assert.equal(attendanceState([open], 'A', zone, now).kind, 'in');
  assert.equal(attendanceState([open], 'B', zone, now).kind, 'none', 'per branch');
  const closed = record({ businessDate: '2026-09-26', checkOutAt: '2026-09-26T10:00:00Z' });
  assert.equal(attendanceState([closed], 'A', zone, now).kind, 'out');
  // Yesterday (by branch date) was never closed; today nothing yet.
  assert.equal(attendanceState([record({})], 'A', zone, now).kind, 'openPast');
  // The same instant is still 2026-09-25 in UTC: that record is "today" there.
  assert.equal(attendanceState([record({})], 'A', 'UTC', now).kind, 'in');
});

test('correction is offered only with MANAGE_ATTENDANCE at the branch, never on own records', () => {
  const manager = employee([['MANAGE_ATTENDANCE', 'A']], [], 'mgr');
  assert.equal(canCorrectAttendance(manager, record({})), true);
  assert.equal(canCorrectAttendance(manager, record({ branchId: 'B' })), false);
  assert.equal(canCorrectAttendance(manager, record({ employeeId: 'mgr' })), false);
  assert.equal(canCorrectAttendance(employee([['VIEW_ATTENDANCE', 'A']]), record({})), false);
  assert.equal(canCorrectAttendance(owner, record({})), true);
});

const leave = (
  status: LeaveRequestResponse['status'],
  employeeId = 'emp-1',
): LeaveRequestResponse => ({
  id: 'l1',
  employeeId,
  leaveType: 'SICK',
  startDate: '2027-03-10',
  endDate: '2027-03-10',
  days: 1,
  reason: 'Fever',
  status,
  requestedAt: '2027-03-01T00:00:00Z',
  decidedByUserId: null,
  decidedAt: null,
  decisionReason: null,
  cancelledByUserId: null,
  cancelledAt: null,
  cancellationReason: null,
  version: 1,
});

test('leave actions: cancel own PENDING only; decide others’ PENDING only with scope', () => {
  assert.deepEqual(leaveActions(leave('PENDING'), 'emp-1', false), { cancel: true, decide: false });
  assert.deepEqual(leaveActions(leave('APPROVED'), 'emp-1', true), {
    cancel: false,
    decide: false,
  });
  assert.deepEqual(leaveActions(leave('PENDING', 'other'), 'emp-1', false), {
    cancel: false,
    decide: false,
  });
  assert.deepEqual(leaveActions(leave('PENDING', 'other'), 'emp-1', true), {
    cancel: false,
    decide: true,
  });
  assert.deepEqual(
    leaveActions(leave('PENDING'), 'emp-1', true),
    { cancel: true, decide: false },
    'no self-decision',
  );
  for (const status of ['REJECTED', 'CANCELLED'] as const) {
    assert.deepEqual(leaveActions(leave(status, 'other'), 'emp-1', true), {
      cancel: false,
      decide: false,
    });
  }
});

test('409 conflicts reload the resource instead of overwriting; messages stay safe', async () => {
  let reloads = 0;
  const conflict = await runMutation(
    () => Promise.reject(new ApiError(409, 'CONFLICT')),
    () => {
      reloads += 1;
    },
  );
  assert.deepEqual([conflict.ok, !conflict.ok && conflict.reloaded, reloads], [false, true, 1]);
  const forbidden = await runMutation(
    () => Promise.reject(new ApiError(403, 'FORBIDDEN')),
    () => {
      reloads += 1;
    },
  );
  assert.deepEqual([forbidden.ok, reloads], [false, 1]);
  const ok = await runMutation(
    () => Promise.resolve(5),
    () => undefined,
  );
  assert.deepEqual(ok, { ok: true, value: 5 });

  const t = getWorkforceDictionary('en');
  assert.equal(errorMessage(new ApiError(409, 'CONFLICT'), t), t.errors.conflict);
  assert.equal(errorMessage(new ApiError(403, 'FORBIDDEN'), t), t.errors.forbidden);
  assert.equal(errorMessage(new ApiError(404, 'NOT_FOUND'), t), t.errors.notFound);
  assert.equal(
    errorMessage(new ApiError(401, 'AUTHENTICATION_REQUIRED'), t),
    t.errors.unauthenticated,
  );
  assert.equal(
    errorMessage(new ApiError(400, 'VALIDATION_FAILED', 'reason'), t),
    'The “reason” value is not valid.',
  );
  assert.equal(errorMessage(new ApiError(500, 'HTTP_500'), t), t.errors.unexpected);
  assert.equal(errorMessage(new Error('stack trace at x.ts:1'), t), t.errors.unexpected);
});

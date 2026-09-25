import type { LeaveRequestResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { employee, owner, render } from '../../../test/support';
import { AttendanceScreen } from './attendance';
import { editableHours } from './branch-detail';
import { BranchesScreen } from './branches';
import { LeaveScreen, LeaveTable, LeaveTypeOptions } from './leave';
import { safeNext } from './login';
import { ServicesScreen } from './services';
import { SkillsScreen } from './skills';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');

test('attendance: self-service for employees; branch view and corrections need permissions', () => {
  const plain = render(<AttendanceScreen />, employee());
  assert.match(plain, new RegExp(vi.attendance.self));
  assert.doesNotMatch(
    plain,
    new RegExp(vi.attendance.team),
    'no branch view without VIEW_ATTENDANCE',
  );
  const viewer = render(<AttendanceScreen />, employee([['VIEW_ATTENDANCE', 'A']]));
  assert.match(viewer, new RegExp(vi.attendance.team));
  const ownerView = render(<AttendanceScreen />, owner);
  assert.doesNotMatch(
    ownerView,
    new RegExp(vi.attendance.self),
    'the Owner has no attendance of its own',
  );
  assert.match(ownerView, new RegExp(vi.attendance.team));
});

test('leave: request form for employees; approvals only with APPROVE_LEAVE', () => {
  const plain = render(<LeaveScreen />, employee());
  assert.match(plain, new RegExp(vi.leave.newRequest));
  assert.match(
    plain,
    new RegExp(vi.leave.baseline.slice(0, 30)),
    '1 day/month shown as baseline text only',
  );
  assert.doesNotMatch(plain, /còn lại:|remaining:/i, 'no balance is claimed');
  assert.doesNotMatch(plain, new RegExp(vi.leave.decisions));
  const approver = render(<LeaveScreen />, employee([['APPROVE_LEAVE', 'A']]), 'en');
  assert.match(approver, new RegExp(en.leave.decisions));
});

test('leave types and statuses are shown with localized labels, not raw codes', () => {
  const options = renderToStaticMarkup(
    <select>
      <LeaveTypeOptions t={vi} />
    </select>,
  );
  assert.match(options, /value="FAMILY_EVENT">Hiếu hỷ \/ sự kiện gia đình</);
  assert.match(options, /value="MATERNITY">Thai sản</);
  const request: LeaveRequestResponse = {
    id: 'l1',
    employeeId: 'emp-1',
    leaveType: 'PERSONAL',
    startDate: '2027-03-10',
    endDate: '2027-03-12',
    days: 3,
    reason: 'Việc nhà',
    status: 'APPROVED',
    requestedAt: '2027-03-01T00:00:00Z',
    decidedByUserId: 'm',
    decidedAt: '2027-03-02T00:00:00Z',
    decisionReason: null,
    cancelledByUserId: null,
    cancelledAt: null,
    cancellationReason: null,
    version: 2,
  };
  const table = renderToStaticMarkup(<LeaveTable requests={[request]} t={en} locale="en" />);
  assert.match(table, /Personal \/ family matter/);
  assert.match(table, /Approved/);
  assert.doesNotMatch(table, />PERSONAL</);
  assert.doesNotMatch(table, />APPROVED</);
  const viTable = renderToStaticMarkup(<LeaveTable requests={[request]} t={vi} locale="vi" />);
  assert.match(viTable, /10\/03\/2027/);
  assert.match(viTable, /Đã duyệt/);
});

test('management pages offer create actions only with the matching GLOBAL permission', () => {
  assert.match(
    render(<BranchesScreen />, employee([['MANAGE_BRANCHES']])),
    new RegExp(vi.branches.create),
  );
  assert.doesNotMatch(
    render(<BranchesScreen />, employee([['MANAGE_BRANCHES', 'A']])),
    new RegExp(vi.branches.create),
    'branch-scoped managers edit their branch but cannot create branches',
  );
  assert.match(
    render(<SkillsScreen />, employee([['MANAGE_SKILLS']])),
    new RegExp(vi.skills.create),
  );
  assert.doesNotMatch(
    render(<SkillsScreen />, employee([['MANAGE_SKILLS', 'A']])),
    new RegExp(vi.skills.create),
  );
  const services = render(<ServicesScreen />, employee([['MANAGE_SERVICES']]));
  assert.match(services, new RegExp(vi.services.createCategory));
  assert.doesNotMatch(
    services,
    new RegExp(vi.services.noCategories),
    'service creation also needs the price permission',
  );
  const pricing = render(
    <ServicesScreen />,
    employee([['MANAGE_SERVICES'], ['MANAGE_SERVICE_PRICES']]),
  );
  assert.match(pricing, new RegExp(vi.services.noCategories));
  assert.doesNotMatch(
    render(<ServicesScreen />, employee([['MANAGE_SERVICES', 'A']])),
    new RegExp(vi.services.createCategory),
  );
});

test('business hours editor covers all seven weekdays; login redirects stay inside the area', () => {
  const days = editableHours([
    { isoWeekday: 2, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
  ]);
  assert.deepEqual(
    days.map((day) => [day.isoWeekday, day.isClosed]),
    [
      [1, true],
      [2, false],
      [3, true],
      [4, true],
      [5, true],
      [6, true],
      [7, true],
    ],
  );
  const base = '/vi/workforce';
  assert.equal(safeNext('/vi/workforce/leave', base), '/vi/workforce/leave');
  for (const hostile of [
    'https://evil.example',
    '//evil.example',
    '/vi/workforcex',
    '/vi/workforce/login',
    null,
  ]) {
    assert.equal(safeNext(hostile, base), base, String(hostile));
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isLeaveEventType,
  leaveDecidedPayload,
  leaveRequestedPayload,
  parseLeaveEventPayload,
} from './leave-events.js';

const employee = '11111111-1111-4111-8111-111111111111';

test('payload builders carry only the minimal structured facts', () => {
  assert.deepEqual(leaveRequestedPayload(employee), { employeeUserId: employee });
  assert.deepEqual(leaveDecidedPayload(employee, 'REJECTED'), {
    employeeUserId: employee,
    decision: 'REJECTED',
  });
});

test('the payload parser is strict: exact keys, account id, decision enum', () => {
  assert.deepEqual(
    parseLeaveEventPayload('LEAVE_REQUESTED', { employeeUserId: employee.toUpperCase() }),
    {
      employeeUserId: employee,
    },
  );
  assert.deepEqual(
    parseLeaveEventPayload('LEAVE_DECIDED', { employeeUserId: employee, decision: 'APPROVED' }),
    { employeeUserId: employee, decision: 'APPROVED' },
  );
  const bad = (type: 'LEAVE_REQUESTED' | 'LEAVE_DECIDED', value: unknown) =>
    assert.throws(() => parseLeaveEventPayload(type, value));
  bad('LEAVE_REQUESTED', null);
  bad('LEAVE_REQUESTED', []);
  bad('LEAVE_REQUESTED', {});
  // A reason or note (free text) or any extra key is refused.
  bad('LEAVE_REQUESTED', { employeeUserId: employee, reason: 'sick child' });
  bad('LEAVE_DECIDED', { employeeUserId: employee, decision: 'APPROVED', note: 'ok' });
  bad('LEAVE_DECIDED', { employeeUserId: employee });
  bad('LEAVE_DECIDED', { employeeUserId: employee, decision: 'CANCELLED' });
  bad('LEAVE_REQUESTED', { employeeUserId: 'Nguyen Van A' });
});

test('only the two Leave event types are recognised', () => {
  assert.ok(isLeaveEventType('LEAVE_REQUESTED'));
  assert.ok(isLeaveEventType('LEAVE_DECIDED'));
  // The Phase 3 conflict event is deliberately not a Leave notification event.
  assert.ok(!isLeaveEventType('EMPLOYEE_LEAVE_APPROVED'));
  assert.ok(!isLeaveEventType('BOOKING_CREATED'));
});

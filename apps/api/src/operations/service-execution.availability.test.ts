import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateExecutionStart, type AvailabilityFacts } from '../availability/availability.engine.js';

function facts(): AvailabilityFacts {
  const midnight = Date.parse('2026-10-10T00:00:00Z');
  return {
    context: 'OPERATIONAL', now: midnight + 600 * 60_000 + 12_345,
    serviceDate: '2026-10-10', today: '2026-10-10', branchActive: true,
    window: { startMinute: 480, endMinute: 1200 },
    settings: { maxAdvanceDays: 30, slotIntervalMinutes: 15, serviceBufferMinutes: 60 },
    // The current catalog/settings differ intentionally from the execution snapshots.
    services: [{ id: 'service', offered: true, durationMinutes: 180, skillIds: new Set(['skill']) }],
    employees: [{
      userId: 'ktv', accountActive: true, classification: 'OFFICIAL_EMPLOYEE',
      assigned: true, skillIds: new Set(['skill']), onLeave: false, collaboratorWork: [],
      checkedIn: true, occupied: [], running: [],
    }],
    customerBookings: [], minuteInstants: Array.from({ length: 1501 }, (_, m) => midnight + m * 60_000),
  };
}
const line = { employeeUserId: 'ktv', durationMinutes: 30, bufferMinutes: 5 };

test('START uses exact actual time and snapshotted duration/buffer, not catalog or booking-grid rounding', () => {
  const f = facts();
  const boundary = f.now + 35 * 60_000;
  f.employees[0]!.occupied = [{ start: boundary, end: boundary + 60_000 }];
  assert.equal(evaluateExecutionStart(f, line).eligible, true);
  f.employees[0]!.occupied[0]!.start -= 1;
  assert.deepEqual(evaluateExecutionStart(f, line).reasons, ['CONFLICT']);
});

test('unfinished execution blocks even far beyond expected end; actual END buffer remains occupied', () => {
  const f = facts();
  f.employees[0]!.running = [{ start: f.now - 86_400_000, end: Infinity }];
  assert.deepEqual(evaluateExecutionStart(f, line).reasons, ['SERVICE_RUNNING']);
  f.employees[0]!.running = [];
  f.employees[0]!.occupied = [{ start: f.now - 60_000, end: f.now + 1 }];
  assert.deepEqual(evaluateExecutionStart(f, line).reasons, ['CONFLICT']);
});

test('START retains branch-local today, attendance, employment, skills and branch assignment checks', () => {
  const f = facts();
  f.serviceDate = '2026-10-11';
  Object.assign(f.employees[0]!, { checkedIn: false, classification: 'ENDED', assigned: false, skillIds: new Set() });
  const reasons = evaluateExecutionStart(f, line).reasons;
  for (const reason of ['NOT_SAME_DAY', 'NOT_CHECKED_IN', 'EMPLOYEE_INACTIVE', 'NOT_ASSIGNED', 'NOT_QUALIFIED']) {
    assert.ok(reasons.includes(reason as (typeof reasons)[number]));
  }
});

test('late START must still fit hours and collaborator coverage using the actual window', () => {
  const f = facts();
  f.window = { startMinute: 480, endMinute: 620 };
  f.employees[0]!.classification = 'COLLABORATOR';
  f.employees[0]!.collaboratorWork = [{ startMinute: 480, endMinute: 610 }];
  const reasons = evaluateExecutionStart(f, line).reasons;
  assert.ok(reasons.includes('OUTSIDE_HOURS'));
  assert.ok(reasons.includes('CTV_NOT_SCHEDULED'));
});

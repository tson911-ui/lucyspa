import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ReassignServicesRequest } from '@lucy-spa/contracts';
import { evaluateReassignmentWindow, type AvailabilityFacts } from '../availability/availability.engine.js';
import { AuthError } from '../auth/auth.error.js';
import { normalizeReassignment } from './reassignment.service.js';

// Source coverage for the final Phase 3 gate; NOT EXECUTED during Step 8.
const body = (): ReassignServicesRequest => ({
  scope: 'LINE', targets: [{ id: randomUUID(), expectedVersion: 2 }], employeeUserId: randomUUID(),
  context: 'LEAVE', reason: ' Approved leave ', acknowledgeSpecific: true,
});
test('manual reason is meaningful and bounded; versions/scope/acknowledgement are explicit', () => {
  assert.equal(normalizeReassignment(body()).reason, 'Approved leave');
  for (const reason of ['', '  ', '..!', 'a', 'x'.repeat(501)]) {
    assert.throws(() => normalizeReassignment({ ...body(), reason }), (e: unknown) => e instanceof AuthError && e.code === 'VALIDATION_FAILED');
  }
  const duplicate = body(); duplicate.targets.push(duplicate.targets[0]!);
  assert.throws(() => normalizeReassignment(duplicate));
  assert.throws(() => normalizeReassignment({ ...body(), targets: [{ id: randomUUID(), expectedVersion: 0 }] }));
  assert.throws(() => normalizeReassignment({ ...body(), acknowledgeSpecific: undefined as unknown as boolean }));
});

function facts(): AvailabilityFacts {
  const midnight = Date.parse('2026-10-10T00:00:00Z');
  return {
    context: 'REVALIDATION', now: midnight - 86_400_000, serviceDate: '2026-10-10', today: '2026-10-09',
    branchActive: true, window: { startMinute: 480, endMinute: 1200 },
    settings: { maxAdvanceDays: 30, slotIntervalMinutes: 15, serviceBufferMinutes: 60 },
    services: [{ id: 's', offered: true, durationMinutes: 180, skillIds: new Set(['qualified']) }],
    employees: [{ userId: 'ktv', accountActive: true, classification: 'OFFICIAL_EMPLOYEE', assigned: true,
      skillIds: new Set(['qualified']), onLeave: false, collaboratorWork: [], checkedIn: false, occupied: [], running: [] }],
    customerBookings: [], minuteInstants: Array.from({ length: 1501 }, (_, m) => midnight + m * 60_000),
  };
}
const window = () => ({ startsAt: new Date('2026-10-10T10:00:12.345Z'), endsAt: new Date('2026-10-10T10:30:12.345Z'), durationMinutes: 30, bufferMinutes: 5 });

test('future reassignment preserves exact planned snapshot and buffer, without requiring future attendance', () => {
  const f = facts();
  const w = window();
  f.employees[0]!.occupied = [{ start: w.endsAt.getTime() + 5 * 60_000, end: w.endsAt.getTime() + 6 * 60_000 }];
  const result = evaluateReassignmentWindow(f, w);
  assert.equal(result.feasible, true);
  assert.equal(result.lines[0]!.startsAt.toISOString(), w.startsAt.toISOString());
  assert.equal(result.lines[0]!.durationMinutes, 30);
  f.employees[0]!.occupied[0]!.start -= 1;
  assert.equal(evaluateReassignmentWindow(f, w).feasible, false);
});

test('same-day operational replacement requires attendance, and an unfinished execution blocks even an elapsed planned window', () => {
  const f = facts(); f.context = 'OPERATIONAL'; f.today = f.serviceDate;
  assert.ok(evaluateReassignmentWindow(f, window()).lines[0]!.verdicts[0]!.reasons.includes('NOT_CHECKED_IN'));
  f.employees[0]!.checkedIn = true;
  f.employees[0]!.running = [{ start: Date.parse('2026-10-10T12:00:00Z'), end: Infinity }];
  assert.ok(evaluateReassignmentWindow(f, window()).lines[0]!.verdicts[0]!.reasons.includes('SERVICE_RUNNING'));
});

test('replacement checks approved leave, qualification, trainee state, branch assignment, CTV coverage and customer conflicts', () => {
  const f = facts();
  Object.assign(f.employees[0]!, { onLeave: true, assigned: false, skillIds: new Set(), classification: 'TRAINEE' });
  const reasons = evaluateReassignmentWindow(f, window()).lines[0]!.verdicts[0]!.reasons;
  for (const reason of ['ON_LEAVE', 'NOT_ASSIGNED', 'NOT_QUALIFIED', 'TRAINEE'] as const) assert.ok(reasons.includes(reason));
  f.employees[0]!.classification = 'COLLABORATOR';
  assert.ok(evaluateReassignmentWindow(f, window()).lines[0]!.verdicts[0]!.reasons.includes('CTV_NOT_SCHEDULED'));
  f.customerBookings = [{ start: window().startsAt.getTime(), end: window().endsAt.getTime() }];
  assert.ok(evaluateReassignmentWindow(f, window()).reasons.includes('CUSTOMER_CONFLICT'));
});

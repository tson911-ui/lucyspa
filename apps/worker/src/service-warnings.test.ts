import assert from 'node:assert/strict';
import { test } from 'node:test';
import { warningDueAt, warningTarget, type WarningLine } from './service-warnings.js';

// Added for Step 10; NOT EXECUTED during Step 9.
const startedAt = new Date('2030-01-02T10:00:00Z');
const expectedEndAt = new Date('2030-01-02T11:30:00Z');
function line(overrides: Record<string, unknown> = {}): WarningLine {
  return {
    id: 'line',
    employeeUserId: 'ktv',
    status: 'PLANNED',
    plannedStartAt: startedAt,
    startOverdueWarnedAt: null,
    visit: { status: 'OPEN' },
    execution: null,
    ...overrides,
  } as unknown as WarningLine;
}
function running(overrides: Record<string, unknown> = {}) {
  return line({
    status: 'IN_PROGRESS',
    execution: {
      status: 'IN_PROGRESS',
      employeeUserId: 'ktv',
      startedAt,
      expectedEndAt,
      endedAt: null,
      preEndWarnedAt: null,
      endOverdueWarnedAt: null,
      ...overrides,
    },
  });
}
test('three five-minute timings use START-derived expected end, independently of planned end', () => {
  assert.equal(
    warningDueAt(startedAt, 'START_OVERDUE', 5).toISOString(),
    '2030-01-02T10:05:00.000Z',
  );
  assert.equal(warningDueAt(expectedEndAt, 'PRE_END', 5).toISOString(), '2030-01-02T11:25:00.000Z');
  assert.equal(
    warningDueAt(expectedEndAt, 'END_OVERDUE', 5).toISOString(),
    '2030-01-02T11:35:00.000Z',
  );
  assert.equal(warningTarget(running(), 'PRE_END'), expectedEndAt);
  assert.equal(warningTarget(running(), 'END_OVERDUE'), expectedEndAt);
});
test('an early START (before the planned start) raises no START warning; END warnings follow the actual start', () => {
  const plannedLater = new Date('2030-01-02T10:30:00Z'); // booked 30 minutes after the actual start
  const early = running({ startedAt, expectedEndAt });
  Object.assign(early, { plannedStartAt: plannedLater });
  assert.equal(warningTarget(early, 'START_OVERDUE'), null);
  assert.equal(warningTarget(early, 'PRE_END'), expectedEndAt);
  assert.equal(warningTarget(early, 'END_OVERDUE'), expectedEndAt);
});
test('START, cancellation, waiting and closed visit make START warnings stale', () => {
  assert.equal(warningTarget(line(), 'START_OVERDUE'), startedAt);
  for (const work of [
    running(),
    line({ status: 'CANCELLED' }),
    line({ status: 'WAITING' }),
    line({ visit: { status: 'CANCELLED' } }),
    line({ employeeUserId: null }),
    line({ startOverdueWarnedAt: startedAt }),
  ]) {
    assert.equal(warningTarget(work, 'START_OVERDUE'), null);
  }
});
test('END and per-kind warning facts silence retries; evaluating never auto-ENDs', () => {
  for (const kind of ['PRE_END', 'END_OVERDUE'] as const) {
    assert.equal(warningTarget(running({ status: 'ENDED', endedAt: expectedEndAt }), kind), null);
    assert.equal(
      warningTarget(
        running({ preEndWarnedAt: expectedEndAt, endOverdueWarnedAt: expectedEndAt }),
        kind,
      ),
      null,
    );
    const work = running();
    const before = structuredClone(work);
    warningTarget(work, kind);
    assert.deepEqual(work, before);
  }
});

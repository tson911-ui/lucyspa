import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SequenceEvaluation, SequenceReason } from '../availability/availability.types.js';
import { AuthError } from '../auth/auth.error.js';
import { compareByTieBreak, planAssignment, type TieBreakFacts } from './booking.planner.js';
import { runCustomerCommand } from './customer-command.js';

/** An engine result with the given eligible employees per line (other fields are not used). */
function evaluation(eligible: string[][], reasons: SequenceReason[] = []): SequenceEvaluation {
  return {
    feasible: reasons.length === 0,
    reasons,
    unavailableServiceIndexes: [],
    lines: eligible.map((ids, index) => ({
      index,
      serviceId: `s${index}`,
      durationMinutes: 30,
      bufferMinutes: 0,
      startMinute: 600 + index * 30,
      endMinute: 630 + index * 30,
      startsAt: new Date(0),
      endsAt: new Date(0),
      occupiedUntil: new Date(0),
      verdicts: [],
      eligibleEmployeeUserIds: ids,
    })),
    wholeSequenceEmployeeUserIds: [],
    everyLineCovered: eligible.every((ids) => ids.length > 0),
  };
}

const tie = (minutes: Record<string, number>, codes: Record<string, string>): TieBreakFacts => ({
  bookedMinutes: new Map(Object.entries(minutes)),
  employeeCode: new Map(Object.entries(codes)),
});
const any = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ serviceId: `s${index}`, employeeUserId: null }));

test('tie-break: fewest booked minutes, then employee code, then user id', () => {
  const order = compareByTieBreak(
    tie({ a: 60, b: 30, c: 30, d: 30 }, { a: 'A1', b: 'B2', c: 'B1', d: 'B1' }),
  );
  assert.deepEqual(['a', 'b', 'd', 'c'].sort(order), ['c', 'd', 'b', 'a']);
});

test('Any KTV: one employee for the whole sequence is preferred over a split', () => {
  // x is best for line 1 alone, but only y can take both lines.
  const plan = planAssignment(
    evaluation([
      ['x', 'y'],
      ['y', 'z'],
    ]),
    any(2),
    tie({ x: 0, y: 500, z: 0 }, { x: 'A', y: 'B', z: 'C' }),
  );
  assert.deepEqual(plan, {
    ok: true,
    assignments: [
      { employeeUserId: 'y', mode: 'ANY' },
      { employeeUserId: 'y', mode: 'ANY' },
    ],
  });
});

test('Any KTV: among whole-sequence candidates the tie-break decides', () => {
  const plan = planAssignment(
    evaluation([
      ['p', 'q'],
      ['p', 'q'],
    ]),
    any(2),
    tie({ p: 90, q: 30 }, { p: 'A', q: 'B' }),
  );
  assert.ok(plan.ok);
  assert.deepEqual(
    plan.assignments.map((entry) => entry.employeeUserId),
    ['q', 'q'],
  );
});

test('Any KTV split only when nobody covers every line; prefers the previous employee', () => {
  // Nobody takes all three lines. Line 1 → a (only candidate); line 2 keeps a (the previous
  // employee, although b and c have fewer booked minutes); line 3: tie-break among b, c → c (code).
  const plan = planAssignment(
    evaluation([['a'], ['a', 'b', 'c'], ['b', 'c']]),
    any(3),
    tie({ a: 50, b: 10, c: 10 }, { a: 'Z', b: 'M', c: 'C' }),
  );
  assert.ok(plan.ok);
  assert.deepEqual(
    plan.assignments.map((entry) => entry.employeeUserId),
    ['a', 'a', 'c'],
  );
  const none = planAssignment(evaluation([['a'], []]), any(2), tie({}, {}));
  assert.deepEqual(none, { ok: false, failure: 'NO_SUITABLE_KTV' });
});

test('split: minutes provisionally assigned in the same booking count toward workload', () => {
  // Nobody takes all three lines. Line 1: a (10) beats b (20) and now carries 10 + 30 = 40.
  // Line 2: only c. Line 3: the previous employee (c) is not eligible, so the tie-break
  // compares a (40, provisional included) with b (20) → b. Ignoring provisional minutes would
  // wrongly pick a again (10 < 20).
  const plan = planAssignment(
    evaluation([['a', 'b'], ['c'], ['a', 'b']]),
    any(3),
    tie({ a: 10, b: 20 }, { a: 'A', b: 'B', c: 'C' }),
  );
  assert.ok(plan.ok);
  assert.deepEqual(
    plan.assignments.map((entry) => entry.employeeUserId),
    ['a', 'c', 'b'],
  );
});

test('specific-line minutes count too; Q3 single-KTV still decides before workload', () => {
  // x is fixed on line 1 (+30). For the Any line, x (0 + 30) now has more than y (20).
  const mixed = planAssignment(
    evaluation([['x'], ['x', 'y']]),
    [
      { serviceId: 's0', employeeUserId: 'x' },
      { serviceId: 's1', employeeUserId: null },
    ],
    tie({ x: 0, y: 20 }, { x: 'A', y: 'B' }),
  );
  assert.ok(mixed.ok);
  assert.deepEqual(
    mixed.assignments.map((entry) => entry.employeeUserId),
    ['x', 'y'],
  );
  // Whole sequence: q is the only one eligible for both lines and gets both, although p has
  // far fewer minutes; workload never breaks up a feasible single-KTV plan.
  const whole = planAssignment(
    evaluation([['p', 'q'], ['q']]),
    any(2),
    tie({ p: 0, q: 900 }, { p: 'A', q: 'B' }),
  );
  assert.ok(whole.ok);
  assert.deepEqual(
    whole.assignments.map((entry) => entry.employeeUserId),
    ['q', 'q'],
  );
});

test('equal workload falls through to employee code, then user id', () => {
  const byCode = planAssignment(
    evaluation([['m', 'n']]),
    any(1),
    tie({ m: 30, n: 30 }, { m: 'B', n: 'A' }),
  );
  assert.ok(byCode.ok);
  assert.equal(byCode.assignments[0]?.employeeUserId, 'n');
  const byId = planAssignment(evaluation([['n2', 'n1']]), any(1), tie({}, { n1: 'A', n2: 'A' }));
  assert.ok(byId.ok);
  assert.equal(byId.assignments[0]?.employeeUserId, 'n1');
});

test('a specific KTV is never replaced; mixed lines plan Any around it', () => {
  const lines = [
    { serviceId: 's0', employeeUserId: 'k' },
    { serviceId: 's1', employeeUserId: null },
  ];
  const kept = planAssignment(
    evaluation([
      ['k', 'm'],
      ['k', 'm'],
    ]),
    lines,
    tie({ m: 0, k: 500 }, {}),
  );
  assert.ok(kept.ok);
  assert.deepEqual(kept.assignments, [
    { employeeUserId: 'k', mode: 'SPECIFIC' },
    { employeeUserId: 'm', mode: 'ANY' },
  ]);
  const gone = planAssignment(evaluation([['m'], ['k', 'm']]), lines, tie({}, {}));
  assert.deepEqual(gone, { ok: false, failure: 'KTV_UNAVAILABLE' });
});

test('sequence reasons map to one stable outcome; locked-set limits Any candidates', () => {
  assert.deepEqual(planAssignment(evaluation([['a']], ['HORIZON']), any(1), tie({}, {})), {
    ok: false,
    failure: 'OUTSIDE_HORIZON',
  });
  assert.deepEqual(planAssignment(evaluation([['a']], ['INVALID_SLOT']), any(1), tie({}, {})), {
    ok: false,
    failure: 'INVALID_TIME',
  });
  assert.deepEqual(
    planAssignment(evaluation([['a']], ['CUSTOMER_CONFLICT']), any(1), tie({}, {})),
    { ok: false, failure: 'CUSTOMER_CONFLICT' },
  );
  assert.deepEqual(planAssignment(evaluation([['a']]), any(1), tie({}, {}), new Set(['b'])), {
    ok: false,
    failure: 'NO_SUITABLE_KTV',
  });
});

test('the customer frame maps the Step 2 overlap backstop (23P01) to a safe conflict', async () => {
  const overlap = Object.assign(new Error('Database error'), {
    meta: { driverAdapterError: { cause: { originalCode: '23P01' } } },
  });
  const failing = {
    sessions: {
      withTransaction: () => Promise.reject(overlap),
      resolveForMutation: () => Promise.resolve(null),
    },
    throttle: { now: () => Promise.resolve(new Date()) },
  };
  const token = 'A'.repeat(43);
  await assert.rejects(
    runCustomerCommand(failing, token, () => Promise.resolve(1)),
    (error: unknown) => error instanceof AuthError && error.code === 'BOOKING_SLOT_UNAVAILABLE',
  );
  const other = {
    ...failing,
    sessions: { ...failing.sessions, withTransaction: () => Promise.reject(new Error('x')) },
  };
  await assert.rejects(
    runCustomerCommand(other, token, () => Promise.resolve(1)),
    (error: unknown) => error instanceof AuthError && error.code === 'SERVICE_UNAVAILABLE',
  );
  await assert.rejects(
    runCustomerCommand(failing, undefined, () => Promise.resolve(1)),
    (error: unknown) => error instanceof AuthError && error.code === 'AUTHENTICATION_REQUIRED',
  );
});

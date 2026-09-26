import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  arrivalAllowed,
  freeNow,
  maskPhone,
  noShowAllowed,
  operationalState,
  orderQueue,
  preArrivalState,
  queueGroup,
  punctuality,
  type WaitingLine,
} from './operations.state.js';

const T = new Date('2027-03-01T03:00:00.000Z'); // 10:00 in Asia/Ho_Chi_Minh
const minutes = (value: number) => new Date(T.getTime() + value * 60_000);
const defaults = { checkInWindowMinutes: 60, lateHoldMinutes: 20 };

test('arrival window (O2): 61 minutes early refused, exactly 60 allowed, late never blocks', () => {
  assert.equal(arrivalAllowed(T, minutes(-61), defaults), false);
  assert.equal(arrivalAllowed(T, minutes(-60), defaults), true);
  assert.equal(arrivalAllowed(T, minutes(-5), defaults), true);
  assert.equal(arrivalAllowed(T, minutes(90), defaults), true);
  // The setting decides, not a constant.
  assert.equal(arrivalAllowed(T, minutes(-61), { ...defaults, checkInWindowMinutes: 90 }), true);
  assert.equal(arrivalAllowed(T, minutes(-31), { ...defaults, checkInWindowMinutes: 30 }), false);
});

test('pre-arrival states and the 20-minute hold boundaries', () => {
  assert.equal(preArrivalState(T, minutes(-61), defaults), 'UPCOMING');
  assert.equal(preArrivalState(T, minutes(-60), defaults), 'ARRIVAL_WINDOW_OPEN');
  assert.equal(preArrivalState(T, T, defaults), 'ARRIVAL_WINDOW_OPEN', 'not late at the start');
  assert.equal(preArrivalState(T, minutes(0.5), defaults), 'LATE_HOLD');
  assert.equal(preArrivalState(T, minutes(20), defaults), 'LATE_HOLD', 'the hold includes its end');
  assert.equal(preArrivalState(T, minutes(20.01), defaults), 'HOLD_EXPIRED');
  assert.equal(preArrivalState(T, minutes(25), { ...defaults, lateHoldMinutes: 30 }), 'LATE_HOLD');
  // NO_SHOW / release only after the hold; nothing ever happens automatically.
  assert.equal(noShowAllowed(T, minutes(20), defaults), false);
  assert.equal(noShowAllowed(T, minutes(20.01), defaults), true);
  assert.equal(noShowAllowed(T, minutes(25), { ...defaults, lateHoldMinutes: 30 }), false);
  assert.equal(
    operationalState({ status: 'CONFIRMED', startsAt: T, visit: null }, minutes(600), defaults),
    'HOLD_EXPIRED',
    'hours later a missing customer is still not auto no-show',
  );
});

test('arrived bookings: state from the visit, punctuality from arrival', () => {
  const arrived = (status: 'OPEN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED') =>
    operationalState(
      { status: 'CHECKED_IN', startsAt: T, visit: { status, arrivedAt: T } },
      minutes(5),
      defaults,
    );
  assert.equal(arrived('OPEN'), 'ARRIVED');
  assert.equal(arrived('IN_SERVICE'), 'IN_SERVICE');
  assert.equal(arrived('COMPLETED'), 'COMPLETED');
  assert.equal(arrived('CANCELLED'), 'CANCELLED');
  assert.equal(punctuality(T, T, defaults), 'ON_TIME');
  assert.equal(punctuality(T, minutes(10), defaults), 'LATE_IN_HOLD');
  assert.equal(punctuality(T, minutes(21), defaults), 'LATE_AFTER_HOLD');
});

const line = (overrides: Partial<WaitingLine> & { lineId: string }): WaitingLine => ({
  employeeUserId: 'k',
  plannedStartAt: T,
  visitId: `v-${overrides.lineId}`,
  visitOrigin: 'BOOKING',
  arrivedAt: minutes(-10),
  queueOverrideAt: null,
  bookingStartsAt: T,
  ...overrides,
});

test('hybrid queue (Q4, Owner decision 3): booked priority only while protected', () => {
  // Appointment at T (10:00), hold 20 minutes. All arrivals are for the same KTV.
  const lines = [
    // Late within the hold (10:10): keeps booked priority, after on-time, by planned start.
    line({
      lineId: 'lateInHold',
      plannedStartAt: minutes(-30),
      bookingStartsAt: minutes(-30),
      arrivedAt: minutes(-20),
    }),
    // Exactly at the hold end (start + 20): still protected.
    line({
      lineId: 'atHoldEnd',
      plannedStartAt: minutes(-20),
      bookingStartsAt: minutes(-20),
      arrivedAt: minutes(0),
    }),
    // On time (arrived exactly at the start), and another on time later in the day.
    line({
      lineId: 'onTime',
      plannedStartAt: minutes(0),
      bookingStartsAt: minutes(0),
      arrivedAt: minutes(0),
    }),
    line({
      lineId: 'onTimeLater',
      plannedStartAt: minutes(60),
      bookingStartsAt: minutes(60),
      arrivedAt: minutes(5),
    }),
    // After the hold: priority lost, ordered by actual arrival with walk-ins, not by plan.
    line({
      lineId: 'afterHoldEarlyPlan',
      plannedStartAt: minutes(-120),
      bookingStartsAt: minutes(-120),
      arrivedAt: minutes(8),
    }),
    line({
      lineId: 'walkIn',
      visitOrigin: 'WALK_IN',
      bookingStartsAt: null,
      arrivedAt: minutes(4),
    }),
    line({
      lineId: 'afterHold',
      plannedStartAt: minutes(-60),
      bookingStartsAt: minutes(-60),
      arrivedAt: minutes(2),
    }),
    // A Manager advance leads everything, by override time.
    line({
      lineId: 'advanced',
      plannedStartAt: minutes(-90),
      bookingStartsAt: minutes(-90),
      arrivedAt: minutes(9),
      queueOverrideAt: minutes(10),
    }),
  ];
  const ordered = orderQueue(lines, defaults);
  assert.deepEqual(
    ordered.map((entry) => [entry.lineId, entry.group]),
    [
      ['advanced', 'OVERRIDE'],
      ['onTime', 'ON_TIME'],
      ['onTimeLater', 'ON_TIME'],
      ['lateInHold', 'LATE_IN_HOLD'],
      ['atHoldEnd', 'LATE_IN_HOLD'],
      ['afterHold', 'LATE_AFTER_HOLD'],
      ['walkIn', 'WALK_IN'],
      ['afterHoldEarlyPlan', 'LATE_AFTER_HOLD'],
    ],
  );
  assert.deepEqual(
    orderQueue([...lines].reverse(), defaults),
    ordered,
    'input order never matters',
  );
  // One instant past the hold end loses protection; the hold setting decides.
  const justAfter = line({
    lineId: 'x',
    bookingStartsAt: T,
    plannedStartAt: T,
    arrivedAt: minutes(20.001),
  });
  assert.equal(queueGroup(justAfter, defaults), 'LATE_AFTER_HOLD');
  assert.equal(queueGroup(justAfter, { ...defaults, lateHoldMinutes: 30 }), 'LATE_IN_HOLD');
  assert.equal(queueGroup({ ...justAfter, arrivedAt: minutes(20) }, defaults), 'LATE_IN_HOLD');
  assert.equal(queueGroup({ ...justAfter, arrivedAt: T }, defaults), 'ON_TIME');
});

test('free capacity and masked phones', () => {
  const occupied = [{ start: minutes(0), end: minutes(60) }];
  assert.equal(freeNow(occupied, false, minutes(-1)), true);
  assert.equal(freeNow(occupied, false, minutes(0)), false);
  assert.equal(freeNow(occupied, false, minutes(60)), true, 'half-open like the Step 2 ranges');
  assert.equal(freeNow([], true, minutes(0)), false, 'a running service is never free');
  assert.equal(maskPhone('+84905123456'), '•••••••456');
  assert.equal(maskPhone(null), null);
});

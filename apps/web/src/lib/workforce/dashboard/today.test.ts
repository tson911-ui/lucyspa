import type { OperationalBooking, OperationalTodayResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NEXT_BOOKINGS,
  bookingGroup,
  servingNow,
  summarizeBookings,
  waitingSummary,
} from './today';

const booking = (code: string, state: OperationalBooking['state'], startsAt: string) =>
  ({ code, state, startsAt }) as OperationalBooking;

test('booking states fold into six groups', () => {
  assert.equal(bookingGroup('UPCOMING'), 'upcoming');
  assert.equal(bookingGroup('ARRIVAL_WINDOW_OPEN'), 'upcoming');
  assert.equal(bookingGroup('LATE_HOLD'), 'late');
  assert.equal(bookingGroup('HOLD_EXPIRED'), 'late');
  assert.equal(bookingGroup('ARRIVED'), 'arrived');
  assert.equal(bookingGroup('IN_SERVICE'), 'inService');
  assert.equal(bookingGroup('COMPLETED'), 'completed');
  assert.equal(bookingGroup('CANCELLED'), 'closed');
  assert.equal(bookingGroup('NO_SHOW'), 'closed');
});

test('summary counts by group and lists the next five bookings that have not arrived', () => {
  const bookings = [
    booking('B7', 'UPCOMING', '2026-09-30T09:00:00Z'),
    booking('B1', 'LATE_HOLD', '2026-09-30T02:00:00Z'),
    booking('B2', 'ARRIVED', '2026-09-30T01:00:00Z'),
    booking('B3', 'UPCOMING', '2026-09-30T03:00:00Z'),
    booking('B4', 'ARRIVAL_WINDOW_OPEN', '2026-09-30T04:00:00Z'),
    booking('B5', 'UPCOMING', '2026-09-30T05:00:00Z'),
    booking('B6', 'UPCOMING', '2026-09-30T06:00:00Z'),
    booking('B8', 'NO_SHOW', '2026-09-30T00:00:00Z'),
    booking('B9', 'COMPLETED', '2026-09-29T23:00:00Z'),
  ];
  const summary = summarizeBookings(bookings);
  assert.equal(summary.total, 9);
  assert.deepEqual(summary.counts, {
    upcoming: 5,
    late: 1,
    arrived: 1,
    inService: 0,
    completed: 1,
    closed: 1,
  });
  assert.equal(summary.next.length, NEXT_BOOKINGS);
  assert.deepEqual(
    summary.next.map((entry) => entry.code),
    ['B1', 'B3', 'B4', 'B5', 'B6'],
  );
  assert.deepEqual(summarizeBookings([]).next, []);
});

const line = (id: string, status: string, participantName: string | null, ktv: string | null) => ({
  id,
  status,
  participantName,
  serviceNameVi: 'Massage',
  serviceNameEn: 'Massage',
  employee: ktv ? { id: `e-${ktv}`, displayName: ktv } : null,
});

const today = (over: Partial<OperationalTodayResponse>): OperationalTodayResponse =>
  ({
    now: '2026-09-30T10:00:00.000Z',
    bookings: [],
    queue: [],
    waitingPool: [],
    activeVisits: [],
    ...over,
  }) as unknown as OperationalTodayResponse;

test('serving now: running lines only; one customer with two lines counts once', () => {
  const result = servingNow(
    today({
      activeVisits: [
        {
          id: 'v1',
          lines: [
            line('l1', 'IN_PROGRESS', 'An', 'Hoa'),
            line('l2', 'IN_PROGRESS', 'An', 'Mai'),
            line('l3', 'DONE', 'An', 'Hoa'),
          ],
        },
        {
          id: 'v2',
          lines: [line('l4', 'IN_PROGRESS', null, 'Lan'), line('l5', 'WAITING', 'Bo', null)],
        },
      ],
    } as unknown as Partial<OperationalTodayResponse>),
  );
  assert.equal(result.count, 2);
  assert.deepEqual(
    result.rows.map((row) => row.lineId),
    ['l1', 'l2', 'l4'],
  );
  assert.equal(servingNow(today({})).count, 0);
});

test('waiting: pool plus each KTV list; the longest wait counts from arrival against the server clock', () => {
  const result = waitingSummary(
    today({
      waitingPool: [{ arrivedAt: '2026-09-30T09:40:00.000Z' }],
      queue: [{ waiting: [{ visitId: 'v1' }, { visitId: 'v-unknown' }] }, { waiting: [] }],
      activeVisits: [{ id: 'v1', arrivedAt: '2026-09-30T09:15:30.000Z' }],
    } as unknown as Partial<OperationalTodayResponse>),
  );
  assert.equal(result.count, 3);
  assert.equal(result.longestMinutes, 44);
  const none = waitingSummary(today({}));
  assert.deepEqual(none, { count: 0, longestMinutes: null });
});

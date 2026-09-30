import type { OperationalBooking, OperationalTodayResponse } from '@lucy-spa/contracts';

// Summaries of `GET operations/branches/:id/today` for the booking widgets. The server derives every state
// and time; this only counts and orders what it returned.

/** How many upcoming bookings the widget lists. */
export const NEXT_BOOKINGS = 5;

export type BookingGroup = 'upcoming' | 'late' | 'arrived' | 'inService' | 'completed' | 'closed';

export const BOOKING_GROUPS: readonly BookingGroup[] = [
  'upcoming',
  'late',
  'arrived',
  'inService',
  'completed',
  'closed',
];

export function bookingGroup(state: OperationalBooking['state']): BookingGroup {
  switch (state) {
    case 'UPCOMING':
    case 'ARRIVAL_WINDOW_OPEN':
      return 'upcoming';
    case 'LATE_HOLD':
    case 'HOLD_EXPIRED':
      return 'late';
    case 'ARRIVED':
      return 'arrived';
    case 'IN_SERVICE':
      return 'inService';
    case 'COMPLETED':
      return 'completed';
    case 'CANCELLED':
    case 'NO_SHOW':
      return 'closed';
  }
}

const NOT_ARRIVED: ReadonlySet<BookingGroup> = new Set(['upcoming', 'late']);

export interface BookingSummary {
  total: number;
  counts: Record<BookingGroup, number>;
  /** Bookings whose customer has not arrived yet, earliest start first. */
  next: OperationalBooking[];
}

export function summarizeBookings(bookings: readonly OperationalBooking[]): BookingSummary {
  const counts: Record<BookingGroup, number> = {
    upcoming: 0,
    late: 0,
    arrived: 0,
    inService: 0,
    completed: 0,
    closed: 0,
  };
  for (const booking of bookings) counts[bookingGroup(booking.state)] += 1;
  const next = bookings
    .filter((booking) => NOT_ARRIVED.has(bookingGroup(booking.state)))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.code.localeCompare(b.code))
    .slice(0, NEXT_BOOKINGS);
  return { total: bookings.length, counts, next };
}

export interface ServingRow {
  lineId: string;
  participant: string | null;
  serviceNameVi: string;
  serviceNameEn: string;
  ktv: string | null;
}

/** Customers with a service running now: one row per running line, and the number of distinct customers. */
export function servingNow(today: OperationalTodayResponse): { count: number; rows: ServingRow[] } {
  const people = new Set<string>();
  const rows: ServingRow[] = [];
  for (const visit of today.activeVisits) {
    for (const line of visit.lines) {
      if (line.status !== 'IN_PROGRESS') continue;
      people.add(`${visit.id}:${line.participantName ?? line.id}`);
      rows.push({
        lineId: line.id,
        participant: line.participantName,
        serviceNameVi: line.serviceNameVi,
        serviceNameEn: line.serviceNameEn,
        ktv: line.employee?.displayName ?? null,
      });
    }
  }
  return { count: people.size, rows };
}

const MINUTE_MS = 60_000;

/**
 * Customers who have arrived and wait for a service: the unassigned pool plus each KTV's waiting list.
 * The longest wait counts from the visit's arrival, measured against the server's `now`.
 */
export function waitingSummary(today: OperationalTodayResponse): {
  count: number;
  longestMinutes: number | null;
} {
  const arrival = new Map(today.activeVisits.map((visit) => [visit.id, visit.arrivedAt]));
  const waits: string[] = [];
  let count = 0;
  for (const entry of today.waitingPool) {
    count += 1;
    waits.push(entry.arrivedAt);
  }
  for (const ktv of today.queue) {
    for (const entry of ktv.waiting) {
      count += 1;
      const arrivedAt = arrival.get(entry.visitId);
      if (arrivedAt) waits.push(arrivedAt);
    }
  }
  const now = Date.parse(today.now);
  const minutes = waits
    .map((iso) => Math.floor((now - Date.parse(iso)) / MINUTE_MS))
    .filter((value) => Number.isFinite(value));
  return { count, longestMinutes: minutes.length ? Math.max(0, ...minutes) : null };
}

import type { ArrivalPunctuality, OperationalBookingState, QueueGroup } from '@lucy-spa/contracts';

/**
 * Phase 3 Step 5: the single place where operational booking states and the hybrid queue
 * (Q4, contract section 8) are computed. Everything here is a pure function of stored facts,
 * the two settings and an explicit `now`; nothing is persisted except the Manager override
 * (`visit.queue_override_at`) and the booking/visit lifecycle itself.
 */

export interface TimingSettings {
  checkInWindowMinutes: number;
  lateHoldMinutes: number;
}

const MINUTE = 60_000;

export function arrivalOpensAt(startsAt: Date, settings: TimingSettings): Date {
  return new Date(startsAt.getTime() - settings.checkInWindowMinutes * MINUTE);
}

export function holdUntil(startsAt: Date, settings: TimingSettings): Date {
  return new Date(startsAt.getTime() + settings.lateHoldMinutes * MINUTE);
}

/**
 * Pre-arrival state of a CONFIRMED booking. Boundaries (half-open where it matters):
 * - UPCOMING: now < start − window;
 * - ARRIVAL_WINDOW_OPEN: start − window ≤ now ≤ start (arriving exactly at the start is on time);
 * - LATE_HOLD: start < now ≤ start + hold (the reservation is protected);
 * - HOLD_EXPIRED: now > start + hold (still reserved; only a Manager releases it).
 */
export function preArrivalState(
  startsAt: Date,
  now: Date,
  settings: TimingSettings,
): 'UPCOMING' | 'ARRIVAL_WINDOW_OPEN' | 'LATE_HOLD' | 'HOLD_EXPIRED' {
  const at = now.getTime();
  if (at < arrivalOpensAt(startsAt, settings).getTime()) return 'UPCOMING';
  if (at <= startsAt.getTime()) return 'ARRIVAL_WINDOW_OPEN';
  if (at <= holdUntil(startsAt, settings).getTime()) return 'LATE_HOLD';
  return 'HOLD_EXPIRED';
}

/** Arrival is allowed from the window opening until cancellation or no-show; late never blocks. */
export function arrivalAllowed(startsAt: Date, now: Date, settings: TimingSettings): boolean {
  return now.getTime() >= arrivalOpensAt(startsAt, settings).getTime();
}

/** NO_SHOW (or releasing the slot) is a Manager decision after the hold; never inside it. */
export function noShowAllowed(startsAt: Date, now: Date, settings: TimingSettings): boolean {
  return now.getTime() > holdUntil(startsAt, settings).getTime();
}

export function punctuality(
  startsAt: Date,
  arrivedAt: Date,
  settings: TimingSettings,
): ArrivalPunctuality {
  if (arrivedAt.getTime() <= startsAt.getTime()) return 'ON_TIME';
  return arrivedAt.getTime() <= holdUntil(startsAt, settings).getTime()
    ? 'LATE_IN_HOLD'
    : 'LATE_AFTER_HOLD';
}

export interface BookingFacts {
  status: 'CONFIRMED' | 'CHECKED_IN' | 'CANCELLED' | 'NO_SHOW';
  startsAt: Date;
  visit: { status: 'OPEN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED'; arrivedAt: Date } | null;
}

export function operationalState(
  booking: BookingFacts,
  now: Date,
  settings: TimingSettings,
): OperationalBookingState {
  switch (booking.status) {
    case 'CANCELLED':
      return 'CANCELLED';
    case 'NO_SHOW':
      return 'NO_SHOW';
    case 'CONFIRMED':
      return preArrivalState(booking.startsAt, now, settings);
    case 'CHECKED_IN':
      switch (booking.visit?.status) {
        case 'IN_SERVICE':
          return 'IN_SERVICE';
        case 'COMPLETED':
          return 'COMPLETED';
        case 'CANCELLED':
          return 'CANCELLED';
        default:
          return 'ARRIVED';
      }
  }
}

// ------------------------------------------------------------------ the hybrid queue

/** A PLANNED line of an OPEN or IN_SERVICE visit (arrived, not started). */
export interface WaitingLine {
  lineId: string;
  employeeUserId: string;
  plannedStartAt: Date;
  visitId: string;
  visitOrigin: 'BOOKING' | 'WALK_IN';
  arrivedAt: Date;
  queueOverrideAt: Date | null;
  /** The booking start for a booked visit (punctuality); null for a walk-in. */
  bookingStartsAt: Date | null;
}

/** LATE_AFTER_HOLD and WALK_IN share one rank: both are ordered by actual arrival time. */
const GROUP_RANK: Record<QueueGroup, number> = {
  OVERRIDE: 0,
  ON_TIME: 1,
  LATE_IN_HOLD: 2,
  LATE_AFTER_HOLD: 3,
  WALK_IN: 3,
};

/**
 * Contract section 8 with Owner decision 3, "ordering of waiting lines for a KTV":
 * 1. OVERRIDE: lines of visits a Manager advanced, by override time (above everything);
 * 2. ON_TIME: booked visits that arrived at or before the start, by planned start;
 * 3. LATE_IN_HOLD: booked visits that arrived after the start but by the end of the hold
 *    (the end itself included): they keep appointment priority, by planned start;
 * 4. then everyone else by actual arrival time: LATE_AFTER_HOLD (arrived after the hold had
 *    expired; the booking stays valid but its protected priority is lost and is not restored by
 *    arriving) and WALK_IN (Step 6, served only in genuinely free capacity).
 * Final tie-breaks for determinism: visit id, then line id.
 */
export function queueGroup(line: WaitingLine, settings: TimingSettings): QueueGroup {
  if (line.queueOverrideAt) return 'OVERRIDE';
  if (line.visitOrigin === 'WALK_IN' || !line.bookingStartsAt) return 'WALK_IN';
  switch (punctuality(line.bookingStartsAt, line.arrivedAt, settings)) {
    case 'ON_TIME':
      return 'ON_TIME';
    case 'LATE_IN_HOLD':
      return 'LATE_IN_HOLD';
    default:
      return 'LATE_AFTER_HOLD';
  }
}

export function orderQueue(
  lines: readonly WaitingLine[],
  settings: TimingSettings,
): (WaitingLine & { group: QueueGroup })[] {
  const key = (line: WaitingLine, group: QueueGroup): number => {
    switch (group) {
      case 'OVERRIDE':
        return line.queueOverrideAt?.getTime() ?? 0;
      case 'ON_TIME':
      case 'LATE_IN_HOLD':
        return line.plannedStartAt.getTime();
      default:
        return line.arrivedAt.getTime();
    }
  };
  return lines
    .map((line) => ({ ...line, group: queueGroup(line, settings) }))
    .sort(
      (a, b) =>
        GROUP_RANK[a.group] - GROUP_RANK[b.group] ||
        key(a, a.group) - key(b, b.group) ||
        (a.visitId < b.visitId ? -1 : a.visitId > b.visitId ? 1 : 0) ||
        (a.lineId < b.lineId ? -1 : a.lineId > b.lineId ? 1 : 0),
    );
}

/** A half-open occupied interval [start, end) of one KTV (planned or running). */
export interface Occupied {
  start: Date;
  end: Date;
}

/** Genuinely free now: nothing running and no planned or reserved interval covering now. */
export function freeNow(occupied: readonly Occupied[], running: boolean, now: Date): boolean {
  if (running) return false;
  const at = now.getTime();
  return !occupied.some(
    (interval) => interval.start.getTime() <= at && at < interval.end.getTime(),
  );
}

/** `+84905123456` → `•••••••456`: enough for staff to confirm with the customer. */
export function maskPhone(phone: string | null): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  return digits.length <= 3
    ? '•••'
    : `${'•'.repeat(Math.min(7, digits.length - 3))}${digits.slice(-3)}`;
}

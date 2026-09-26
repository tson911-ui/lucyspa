import { randomBytes } from 'node:crypto';
import type {
  BookingRecipientRelationName,
  CustomerBookingCreateRequest,
  CustomerBookingDetail,
  CustomerBookingDisplayStatus,
  CustomerBookingSummary,
} from '@lucy-spa/contracts';
import {
  appendOutboxEvent,
  BOOKING_SETTINGS,
  isValidBookingSetting,
  type Prisma,
} from '@lucy-spa/database';
import {
  evaluateSequenceAt,
  loadAvailabilityFacts,
  lockAvailabilitySubjects,
} from '../availability/availability.engine.js';
import { AuthError } from '../auth/auth.error.js';
import { parseTime, parseWorkDate } from '../collaborator-work/collaborator-work.rules.js';
import {
  planAssignment,
  type PlanFailure,
  type PlanLine,
  type TieBreakFacts,
} from './booking.planner.js';

export const BOOKING_LIMITS = Object.freeze({
  maxLines: 10,
  maxRecipients: 10,
  displayNameMaxCodePoints: 200,
  reasonMaxCodePoints: 500,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{1,32}$/;
const PHONE = /^\+?[0-9]{6,20}$/;
const RELATIONS: readonly BookingRecipientRelationName[] = ['SELF', 'CHILD', 'FAMILY', 'OTHER'];

export interface NormalizedBookingRequest {
  idempotencyKey: string;
  branchId: string;
  date: string;
  startMinute: number;
  recipients: {
    key: string;
    relation: BookingRecipientRelationName;
    displayName: string | null;
    phone: string | null;
  }[];
  lines: { serviceId: string; recipientKey: string; employeeUserId: string | null }[];
}

const invalid = (field: string): never => {
  throw new AuthError('VALIDATION_FAILED', field);
};

/** Strict shape checks; business rules are the engine's. Unknown fields are refused by the DTO. */
export function normalizeCreateRequest(
  input: CustomerBookingCreateRequest,
): NormalizedBookingRequest {
  if (!UUID.test(input.idempotencyKey)) invalid('idempotencyKey');
  if (!UUID.test(input.branchId)) invalid('branchId');
  parseWorkDate(input.date, 'date');
  const startMinute = parseTime(input.startTime, 'startTime');
  if (startMinute >= 1440) invalid('startTime');
  if (!Array.isArray(input.recipients) || input.recipients.length === 0) invalid('recipients');
  if (input.recipients.length > BOOKING_LIMITS.maxRecipients) invalid('recipients');
  if (!Array.isArray(input.lines) || input.lines.length === 0) invalid('lines');
  if (input.lines.length > BOOKING_LIMITS.maxLines) invalid('lines');

  const keys = new Set<string>();
  let selfCount = 0;
  const recipients = input.recipients.map((recipient) => {
    if (!KEY.test(recipient.key) || keys.has(recipient.key)) invalid('recipientKey');
    keys.add(recipient.key);
    if (!RELATIONS.includes(recipient.relation)) invalid('relation');
    if (recipient.relation === 'SELF') {
      selfCount += 1;
      if (recipient.displayName !== undefined || recipient.phone !== undefined) {
        invalid('displayName');
      }
      return { key: recipient.key, relation: recipient.relation, displayName: null, phone: null };
    }
    const displayName = (recipient.displayName ?? '').normalize('NFC').trim().replace(/\s+/g, ' ');
    if (!displayName || [...displayName].length > BOOKING_LIMITS.displayNameMaxCodePoints) {
      invalid('displayName');
    }
    const phone = recipient.phone?.replace(/[\s().-]/g, '') || null;
    if (phone !== null && !PHONE.test(phone)) invalid('phone');
    return { key: recipient.key, relation: recipient.relation, displayName, phone };
  });
  if (selfCount > 1) invalid('relation');

  const used = new Set<string>();
  const lines = input.lines.map((line) => {
    if (!UUID.test(line.serviceId)) invalid('serviceId');
    if (!keys.has(line.recipientKey)) invalid('recipientKey');
    if (line.employeeUserId !== null && !UUID.test(line.employeeUserId)) invalid('employeeUserId');
    used.add(line.recipientKey);
    return {
      serviceId: line.serviceId.toLowerCase(),
      recipientKey: line.recipientKey,
      employeeUserId: line.employeeUserId?.toLowerCase() ?? null,
    };
  });
  if (used.size !== keys.size) invalid('recipients');
  return {
    idempotencyKey: input.idempotencyKey.toLowerCase(),
    branchId: input.branchId.toLowerCase(),
    date: input.date,
    startMinute,
    recipients,
    lines,
  };
}

const FAILURE_ERRORS: Record<PlanFailure, ConstructorParameters<typeof AuthError>[0]> = {
  SERVICE_UNAVAILABLE: 'BOOKING_SERVICE_UNAVAILABLE',
  OUTSIDE_HORIZON: 'BOOKING_OUTSIDE_HORIZON',
  INVALID_TIME: 'BOOKING_INVALID_TIME',
  CUSTOMER_CONFLICT: 'BOOKING_CUSTOMER_CONFLICT',
  KTV_UNAVAILABLE: 'BOOKING_KTV_UNAVAILABLE',
  NO_SUITABLE_KTV: 'BOOKING_NO_SUITABLE_KTV',
};

export function failureError(failure: PlanFailure): AuthError {
  return new AuthError(FAILURE_ERRORS[failure]);
}

/** Tie-break facts (contract section 6) for these employees at a branch on a date. */
export async function loadTieBreakFacts(
  tx: Prisma.TransactionClient,
  input: { branchId: string; date: Date; employeeUserIds: readonly string[] },
): Promise<TieBreakFacts> {
  const ids = [...new Set(input.employeeUserIds)];
  if (ids.length === 0) return { bookedMinutes: new Map(), employeeCode: new Map() };
  const [profiles, minutes] = await Promise.all([
    tx.employeeProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, employeeCodeCanonical: true },
    }),
    // Booked minutes (Owner-locked): the duration snapshots (`duration_minutes`, never the
    // buffer) of the employee's lines on CONFIRMED or CHECKED_IN bookings at this branch on this
    // branch-local business date. CANCELLED, NO_SHOW, other branches and dates never count.
    tx.bookingServiceLine.groupBy({
      by: ['employeeUserId'],
      where: {
        employeeUserId: { in: ids },
        booking: {
          branchId: input.branchId,
          serviceDate: input.date,
          status: { in: ['CONFIRMED', 'CHECKED_IN'] },
        },
      },
      _sum: { durationMinutes: true },
    }),
  ]);
  return {
    employeeCode: new Map(profiles.map((row) => [row.userId, row.employeeCodeCanonical])),
    bookedMinutes: new Map(
      minutes.map((row) => [row.employeeUserId, row._sum.durationMinutes ?? 0]),
    ),
  };
}

/** One registry setting, validated (missing → registry default; invalid stored value → error). */
export async function settingValue(tx: Prisma.TransactionClient, key: string): Promise<number> {
  const definition = BOOKING_SETTINGS.find((entry) => entry.key === key);
  if (!definition) throw new Error(`Unknown booking setting ${key}.`);
  const row = await tx.appSetting.findUnique({ where: { key }, select: { value: true } });
  const value = row ? row.value : definition.defaultValue;
  if (!isValidBookingSetting(key, value)) throw new Error(`Invalid stored booking setting ${key}.`);
  return value as number;
}

function bookingCode(date: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = [...randomBytes(6)].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `BK-${date.slice(2, 4)}${date.slice(5, 7)}${date.slice(8, 10)}-${random}`;
}

/**
 * Creates a CONFIRMED booking (O4) for the customer, in the caller's transaction:
 * 1. an existing booking for (customer, idempotency key) is returned unchanged (replay);
 * 2. a first engine read finds the KTVs involved (specific ones, and every Any-KTV candidate);
 * 3. those employee rows and the customer row are locked FOR UPDATE in sorted UUID order;
 * 4. the replay check and the engine run again under the locks, and the plan is chosen from
 *    that result only (Any-KTV candidates limited to the locked rows);
 * 5. the booking, recipients and lines (with duration, buffer, time and catalog snapshots)
 *    are inserted and BOOKING_CREATED is appended to the outbox.
 * The Step 2 exclusion constraint stays the last backstop (mapped by the command frame).
 */
export async function createCustomerBooking(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  request: NormalizedBookingRequest,
  now: Date,
): Promise<string> {
  const replay = () =>
    tx.booking.findUnique({
      where: {
        createdByUserId_idempotencyKey: {
          createdByUserId: customerUserId,
          idempotencyKey: request.idempotencyKey,
        },
      },
      select: { id: true },
    });
  const earlier = await replay();
  if (earlier) return earlier.id;

  const planLines: PlanLine[] = request.lines.map((line) => ({
    serviceId: line.serviceId,
    employeeUserId: line.employeeUserId,
  }));
  const sequence = {
    branchId: request.branchId,
    serviceDate: request.date,
    serviceIds: request.lines.map((line) => line.serviceId),
    context: 'BOOKING' as const,
    now,
    customerUserId,
  };
  const branch = await tx.branch.findUnique({
    where: { id: request.branchId },
    select: { id: true },
  });
  if (!branch) throw new AuthError('VALIDATION_FAILED', 'branchId');

  const before = evaluateSequenceAt(await loadAvailabilityFacts(tx, sequence), request.startMinute);
  const involved = new Set<string>([customerUserId]);
  for (const [index, line] of planLines.entries()) {
    if (line.employeeUserId !== null) involved.add(line.employeeUserId);
    else for (const id of before.lines[index]?.eligibleEmployeeUserIds ?? []) involved.add(id);
  }
  await lockAvailabilitySubjects(tx, [...involved]);

  const concurrent = await replay();
  if (concurrent) return concurrent.id;

  const evaluation = evaluateSequenceAt(
    await loadAvailabilityFacts(tx, sequence),
    request.startMinute,
  );
  const date = parseWorkDate(request.date, 'date');
  const tie = await loadTieBreakFacts(tx, {
    branchId: request.branchId,
    date,
    employeeUserIds: [...involved].filter((id) => id !== customerUserId),
  });
  const plan = planAssignment(evaluation, planLines, tie, involved);
  if (!plan.ok) {
    // Availability shown earlier but gone now is "slot taken", not a generic rejection.
    const lostAfterLookup = plan.failure === 'NO_SUITABLE_KTV' && before.everyLineCovered;
    throw lostAfterLookup ? new AuthError('BOOKING_SLOT_UNAVAILABLE') : failureError(plan.failure);
  }

  const services = await tx.service.findMany({
    where: { id: { in: [...new Set(planLines.map((line) => line.serviceId))] } },
    select: {
      id: true,
      code: true,
      nameVi: true,
      nameEn: true,
      priceVnd: true,
      priceMaxVnd: true,
      pricingUnit: true,
    },
  });
  const serviceById = new Map(services.map((row) => [row.id, row]));
  const first = evaluation.lines[0];
  const last = evaluation.lines[evaluation.lines.length - 1];
  if (!first || !last) throw new Error('A booking has at least one line.');

  const booking = await tx.booking.create({
    data: {
      code: bookingCode(request.date),
      branchId: request.branchId,
      ownerUserId: customerUserId,
      channel: 'ONLINE',
      startsAt: first.startsAt,
      endsAt: last.endsAt,
      serviceDate: date,
      idempotencyKey: request.idempotencyKey,
      createdByUserId: customerUserId,
    },
    select: { id: true, branchId: true },
  });
  const recipientIds = new Map<string, string>();
  for (const recipient of request.recipients) {
    const row = await tx.bookingRecipient.create({
      data: {
        bookingId: booking.id,
        relation: recipient.relation,
        displayName: recipient.displayName,
        phone: recipient.phone,
      },
      select: { id: true },
    });
    recipientIds.set(recipient.key, row.id);
  }
  const lineIds: string[] = [];
  for (const [index, line] of request.lines.entries()) {
    const planned = evaluation.lines[index];
    const service = serviceById.get(line.serviceId);
    const assignment = plan.assignments[index];
    const recipientId = recipientIds.get(line.recipientKey);
    if (!planned || !service || !assignment || !recipientId) throw new Error('Incomplete plan.');
    const row = await tx.bookingServiceLine.create({
      data: {
        bookingId: booking.id,
        recipientId,
        sequence: index + 1,
        serviceId: service.id,
        employeeUserId: assignment.employeeUserId,
        assignmentMode: assignment.mode,
        plannedStartAt: planned.startsAt,
        plannedEndAt: planned.endsAt,
        durationMinutes: planned.durationMinutes,
        bufferMinutes: planned.bufferMinutes,
        serviceCode: service.code,
        serviceNameVi: service.nameVi,
        serviceNameEn: service.nameEn,
        catalogPriceMinVnd: service.priceVnd,
        catalogPriceMaxVnd: service.priceMaxVnd,
        catalogPricingUnit: service.pricingUnit,
      },
      select: { id: true },
    });
    lineIds.push(row.id);
  }
  await appendOutboxEvent(tx, {
    branchId: booking.branchId,
    aggregateType: 'Booking',
    aggregateId: booking.id,
    eventType: 'BOOKING_CREATED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      bookingId: booking.id,
      channel: 'ONLINE',
      startsAt: first.startsAt.toISOString(),
      lines: plan.assignments.map((assignment, index) => ({
        lineId: lineIds[index] ?? null,
        employeeUserId: assignment.employeeUserId,
        assignmentMode: assignment.mode,
      })),
    },
  });
  return booking.id;
}

/**
 * Customer cancellation (O3), allowed until service START:
 * - CONFIRMED: the booking becomes CANCELLED (its KTV occupancy is released by the Step 2
 *   trigger); `cancelled_late` is set when less than `booking.lateCancelAlertMinutes` remain;
 * - CHECKED_IN with no line started: the linked visit and its planned lines are cancelled
 *   instead and the booking stays CHECKED_IN (its display status is derived as cancelled);
 * - anything started, a no-show, or another owner's booking: refused.
 * Repeating a completed cancellation returns the same state (idempotent). BOOKING_CANCELLED is
 * appended with the `late` flag; the manager alert is delivered later from that event (Step 9).
 */
export async function cancelCustomerBooking(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  bookingId: string,
  reason: string | null,
  now: Date,
): Promise<void> {
  const booking = await tx.booking.findFirst({
    where: { id: bookingId, ownerUserId: customerUserId },
    select: { id: true, branchId: true, status: true, startsAt: true, rowVersion: true },
  });
  if (!booking) throw new AuthError('NOT_FOUND');
  await tx.$queryRaw`SELECT id FROM bookings WHERE id = ${booking.id}::uuid FOR UPDATE`;
  const current = await tx.booking.findUniqueOrThrow({
    where: { id: booking.id },
    select: {
      status: true,
      rowVersion: true,
      startsAt: true,
      visit: {
        select: {
          id: true,
          status: true,
          rowVersion: true,
          lines: { select: { id: true, status: true, rowVersion: true } },
        },
      },
    },
  });
  if (current.status === 'CANCELLED') return;
  const threshold = await settingValue(tx, 'booking.lateCancelAlertMinutes');
  const late = current.startsAt.getTime() - now.getTime() < threshold * 60_000;

  if (current.status === 'CONFIRMED') {
    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledByUserId: customerUserId,
        cancelReason: reason,
        cancelledLate: late,
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
  } else if (current.status === 'CHECKED_IN' && current.visit) {
    const visit = current.visit;
    if (visit.status === 'CANCELLED') return;
    const started = visit.lines.some(
      (line) => line.status === 'IN_PROGRESS' || line.status === 'DONE',
    );
    if (visit.status !== 'OPEN' || started) throw new AuthError('BOOKING_CANCEL_NOT_ALLOWED');
    // Every unstarted line: PLANNED, and WAITING (Step 6 amendment; a waiting line has no KTV).
    for (const line of visit.lines.filter(
      (entry) => entry.status === 'PLANNED' || entry.status === 'WAITING',
    )) {
      await tx.visitServiceLine.update({
        where: { id: line.id },
        data: {
          status: 'CANCELLED',
          cancelledAt: now,
          cancelledByUserId: customerUserId,
          cancelReason: reason,
          rowVersion: { increment: 1 },
        },
        select: { id: true },
      });
    }
    await tx.visit.update({
      where: { id: visit.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledByUserId: customerUserId,
        cancelReason: reason,
        rowVersion: { increment: 1 },
      },
      select: { id: true },
    });
  } else {
    throw new AuthError('BOOKING_CANCEL_NOT_ALLOWED');
  }
  await appendOutboxEvent(tx, {
    branchId: booking.branchId,
    aggregateType: 'Booking',
    aggregateId: booking.id,
    eventType: 'BOOKING_CANCELLED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      bookingId: booking.id,
      cancelledByUserId: customerUserId,
      actor: 'CUSTOMER',
      late,
      afterCheckIn: current.status === 'CHECKED_IN',
    },
  });
}

// ------------------------------------------------------------------ customer read models

const bookingSelect = {
  id: true,
  code: true,
  status: true,
  serviceDate: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  cancelledAt: true,
  cancelledLate: true,
  branch: { select: { id: true, name: true, timezone: true } },
  recipients: {
    select: { id: true, relation: true, displayName: true },
    orderBy: { createdAt: 'asc' },
  },
  lines: {
    orderBy: { sequence: 'asc' },
    select: {
      sequence: true,
      recipientId: true,
      serviceNameVi: true,
      serviceNameEn: true,
      durationMinutes: true,
      plannedStartAt: true,
      plannedEndAt: true,
      assignmentMode: true,
      catalogPriceMinVnd: true,
      catalogPriceMaxVnd: true,
      catalogPricingUnit: true,
      employee: { select: { userId: true, user: { select: { fullName: true } } } },
    },
  },
  visit: { select: { status: true, lines: { select: { status: true } } } },
} satisfies Prisma.BookingSelect;

type BookingRow = Prisma.BookingGetPayload<{ select: typeof bookingSelect }>;

function displayStatus(row: BookingRow): CustomerBookingDisplayStatus {
  if (row.status !== 'CHECKED_IN') return row.status;
  switch (row.visit?.status) {
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

function canCancel(row: BookingRow): boolean {
  if (row.status === 'CONFIRMED') return true;
  if (row.status !== 'CHECKED_IN' || row.visit?.status !== 'OPEN') return false;
  return !row.visit.lines.some((line) => line.status === 'IN_PROGRESS' || line.status === 'DONE');
}

function summary(row: BookingRow): CustomerBookingSummary {
  return {
    id: row.id,
    code: row.code,
    branch: { id: row.branch.id, name: row.branch.name, timezone: row.branch.timezone },
    date: row.serviceDate.toISOString().slice(0, 10),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: displayStatus(row),
    serviceNames: row.lines.map((line) => ({ vi: line.serviceNameVi, en: line.serviceNameEn })),
    canCancel: canCancel(row),
  };
}

function detail(row: BookingRow): CustomerBookingDetail {
  return {
    ...summary(row),
    createdAt: row.createdAt.toISOString(),
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledLate: row.cancelledLate,
    recipients: row.recipients.map((recipient) => ({
      key: recipient.id,
      relation: recipient.relation,
      displayName: recipient.displayName,
    })),
    lines: row.lines.map((line) => ({
      sequence: line.sequence,
      serviceNameVi: line.serviceNameVi,
      serviceNameEn: line.serviceNameEn,
      durationMinutes: line.durationMinutes,
      startsAt: line.plannedStartAt.toISOString(),
      endsAt: line.plannedEndAt.toISOString(),
      recipientKey: line.recipientId,
      assignmentMode: line.assignmentMode,
      employee: { id: line.employee.userId, displayName: line.employee.user.fullName },
      priceMinVnd: line.catalogPriceMinVnd.toString(),
      priceMaxVnd: line.catalogPriceMaxVnd.toString(),
      pricingUnit: line.catalogPricingUnit,
    })),
  };
}

/** One of the customer's own bookings; another owner's booking is indistinguishable from none. */
export async function customerBookingDetail(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  bookingId: string,
): Promise<CustomerBookingDetail> {
  const row = await tx.booking.findFirst({
    where: { id: bookingId, ownerUserId: customerUserId },
    select: bookingSelect,
  });
  if (!row) throw new AuthError('NOT_FOUND');
  return detail(row);
}

/** The customer's bookings: upcoming (soonest first) and history (latest first). */
export async function customerBookingList(
  tx: Prisma.TransactionClient,
  customerUserId: string,
  now: Date,
): Promise<{ upcoming: CustomerBookingSummary[]; history: CustomerBookingSummary[] }> {
  const rows = await tx.booking.findMany({
    where: { ownerUserId: customerUserId },
    orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    take: 200,
    select: bookingSelect,
  });
  const upcoming: CustomerBookingSummary[] = [];
  const history: CustomerBookingSummary[] = [];
  for (const row of rows) {
    const item = summary(row);
    const active =
      (item.status === 'CONFIRMED' && row.endsAt > now) ||
      item.status === 'ARRIVED' ||
      item.status === 'IN_SERVICE';
    (active ? upcoming : history).push(item);
  }
  upcoming.reverse();
  return { upcoming, history };
}

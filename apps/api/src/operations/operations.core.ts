import type {
  BookingRecipientRelationName,
  OperationalActiveVisit,
  OperationalBooking,
  OperationalQueueKtv,
  OperationalWaitingEntry,
  VisitParticipantKindName,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { settingValue } from '../booking/booking.core.js';
import {
  arrivalAllowed,
  arrivalOpensAt,
  freeNow,
  holdUntil,
  maskPhone,
  noShowAllowed,
  operationalState,
  orderQueue,
  preArrivalState,
  punctuality,
  type Occupied,
  type TimingSettings,
  type WaitingLine,
} from './operations.state.js';

/** The two settings Step 5 consumes, from the Step 2 registry (never hard-coded). */
export async function loadTimingSettings(tx: Prisma.TransactionClient): Promise<TimingSettings> {
  return {
    checkInWindowMinutes: await settingValue(tx, 'booking.checkInWindowMinutes'),
    lateHoldMinutes: await settingValue(tx, 'booking.lateHoldMinutes'),
  };
}

/** Authorization is decided at transaction time for the record's own branch. */
export type BranchCheck = (branchId: string) => void;

async function lockBooking(tx: Prisma.TransactionClient, bookingId: string) {
  // Both arrival and no-show lock the booking row first, so they serialize (contract §16).
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
  if (!row) throw new AuthError('NOT_FOUND');
  return tx.booking.findUniqueOrThrow({
    where: { id: bookingId },
    select: {
      id: true,
      code: true,
      branchId: true,
      ownerUserId: true,
      status: true,
      startsAt: true,
      rowVersion: true,
      visit: { select: { id: true } },
    },
  });
}

/**
 * Customer arrival (contract §4 and §8, O2). In one transaction, after locking the booking:
 * - CHECKED_IN already → the existing visit is returned (idempotent: two devices, one visit);
 * - CANCELLED or NO_SHOW → refused; before the check-in window → refused, nothing written;
 * - otherwise the visit is created OPEN at `now`; each recipient becomes a participant (the
 *   owner a MEMBER; a child a CHILD guarded by the owner's participant when the owner is a
 *   recipient, otherwise a GUEST; family and others GUESTs); each booking line becomes a PLANNED
 *   visit line for its recipient with the same KTV, times, assignment mode and snapshots, which
 *   moves its KTV occupancy (Step 2 trigger). The booking becomes CHECKED_IN.
 * Arrival is a lifecycle transition, not a new booking: no availability re-run, no new
 * occupancy, no KTV change, no START. Audited (BOOKING_CHECKED_IN); CUSTOMER_ARRIVED is appended.
 */
export async function arriveBooking(
  context: AdminContext,
  bookingId: string,
  authorize: BranchCheck,
): Promise<string> {
  const { tx, now } = context;
  const booking = await lockBooking(tx, bookingId);
  authorize(booking.branchId);
  if (booking.status === 'CHECKED_IN' && booking.visit) return booking.visit.id;
  if (booking.status !== 'CONFIRMED') throw new AuthError('BOOKING_ARRIVAL_NOT_ALLOWED');
  const settings = await loadTimingSettings(tx);
  if (!arrivalAllowed(booking.startsAt, now, settings)) {
    throw new AuthError('BOOKING_ARRIVAL_TOO_EARLY');
  }

  const [day] = await tx.$queryRaw<{ day: string }[]>`
    SELECT to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD') AS day
    FROM branches b WHERE b.id = ${booking.branchId}::uuid`;
  if (!day) throw new AuthError('SERVICE_UNAVAILABLE');
  const visit = await tx.visit.create({
    data: {
      code: `VS-${booking.code.replace(/^BK-/, '')}`.slice(0, 32),
      branchId: booking.branchId,
      origin: 'BOOKING',
      bookingId: booking.id,
      ownerUserId: booking.ownerUserId,
      serviceDate: new Date(day.day),
      arrivedAt: now,
      createdByUserId: context.actor.userId,
    },
    select: { id: true, code: true },
  });

  const recipients = await tx.bookingRecipient.findMany({
    where: { bookingId: booking.id },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, relation: true, displayName: true, phone: true },
  });
  const participantOf = new Map<string, string>();
  const self = recipients.find((recipient) => recipient.relation === 'SELF');
  // The owner first, so a child can name them as guardian.
  for (const recipient of [...(self ? [self] : []), ...recipients.filter((r) => r !== self)]) {
    const guardian = self ? participantOf.get(self.id) : undefined;
    const kind =
      recipient.relation === 'SELF'
        ? 'MEMBER'
        : recipient.relation === 'CHILD' && guardian
          ? 'CHILD'
          : 'GUEST';
    const row = await tx.visitParticipant.create({
      data: {
        visitId: visit.id,
        kind,
        bookingRecipientId: recipient.id,
        ...(kind === 'MEMBER'
          ? { customerUserId: booking.ownerUserId }
          : { displayName: recipient.displayName, phone: recipient.phone }),
        ...(kind === 'CHILD' ? { guardianParticipantId: guardian ?? null } : {}),
      },
      select: { id: true },
    });
    participantOf.set(recipient.id, row.id);
  }

  const lines = await tx.bookingServiceLine.findMany({
    where: { bookingId: booking.id },
    orderBy: { sequence: 'asc' },
  });
  const sequenceOf = new Map<string, number>();
  for (const line of lines) {
    const participantId = participantOf.get(line.recipientId);
    if (!participantId) throw new Error('Every booking line has a recipient participant.');
    const sequence = (sequenceOf.get(participantId) ?? 0) + 1;
    sequenceOf.set(participantId, sequence);
    await tx.visitServiceLine.create({
      data: {
        visitId: visit.id,
        participantId,
        sequence,
        bookingServiceLineId: line.id,
        serviceId: line.serviceId,
        employeeUserId: line.employeeUserId,
        assignmentMode: line.assignmentMode,
        plannedStartAt: line.plannedStartAt,
        plannedEndAt: line.plannedEndAt,
        durationMinutes: line.durationMinutes,
        bufferMinutes: line.bufferMinutes,
        serviceCode: line.serviceCode,
        serviceNameVi: line.serviceNameVi,
        serviceNameEn: line.serviceNameEn,
        catalogPriceMinVnd: line.catalogPriceMinVnd,
        catalogPriceMaxVnd: line.catalogPriceMaxVnd,
        catalogPricingUnit: line.catalogPricingUnit,
        // OP-1: arrival carries the booking line's snapshot; the catalog is not read again.
        maxQuantitySnapshot: line.maxQuantitySnapshot,
        // Phase 4 Step 6: the historical category is copied too (NULL stays NULL: unknown, never guessed).
        serviceCategoryId: line.serviceCategoryId,
        assignmentConflict: line.assignmentConflict,
      },
      select: { id: true },
    });
  }
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: 'CHECKED_IN',
      checkedInAt: now,
      checkedInByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  const late = punctuality(booking.startsAt, now, settings);
  await appendAdminAudit(context, {
    action: 'BOOKING_CHECKED_IN',
    entityType: 'Booking',
    entityId: booking.id,
    subjectUserId: booking.ownerUserId,
    branchId: booking.branchId,
    before: { status: 'CONFIRMED' },
    after: { status: 'CHECKED_IN', visitId: visit.id, punctuality: late },
  });
  await appendOutboxEvent(tx, {
    branchId: booking.branchId,
    aggregateType: 'Booking',
    aggregateId: booking.id,
    eventType: 'CUSTOMER_ARRIVED',
    schemaVersion: 1,
    occurredAt: now,
    payload: { bookingId: booking.id, visitId: visit.id, punctuality: late },
  });
  return visit.id;
}

/**
 * NO_SHOW, which is also how a Manager releases a late booking's slot (contract §8: "release the
 * slot, same effect for capacity"; there is no separate stored state). Only for a CONFIRMED
 * booking after the late hold; inside the hold the reservation stays protected. The booking
 * becomes NO_SHOW (terminal) and the Step 2 trigger releases its planned KTV occupancy. A
 * checked-in booking (arrived, possibly started) is refused. Repeating returns quietly. Audited
 * with the required reason; BOOKING_NO_SHOW is appended. No penalty, no billing.
 */
export async function markNoShow(
  context: AdminContext,
  bookingId: string,
  reason: string,
  authorize: BranchCheck,
): Promise<void> {
  const { tx, now } = context;
  const booking = await lockBooking(tx, bookingId);
  authorize(booking.branchId);
  if (booking.status === 'NO_SHOW') return;
  if (booking.status !== 'CONFIRMED') throw new AuthError('BOOKING_NO_SHOW_NOT_ALLOWED');
  const settings = await loadTimingSettings(tx);
  if (!noShowAllowed(booking.startsAt, now, settings)) throw new AuthError('BOOKING_HOLD_ACTIVE');
  await tx.booking.update({
    where: { id: booking.id },
    data: {
      status: 'NO_SHOW',
      noShowAt: now,
      noShowByUserId: context.actor.userId,
      noShowReason: reason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'BOOKING_NO_SHOW',
    entityType: 'Booking',
    entityId: booking.id,
    subjectUserId: booking.ownerUserId,
    branchId: booking.branchId,
    reason,
    before: { status: 'CONFIRMED' },
    after: { status: 'NO_SHOW' },
  });
  await appendOutboxEvent(tx, {
    branchId: booking.branchId,
    aggregateType: 'Booking',
    aggregateId: booking.id,
    eventType: 'BOOKING_NO_SHOW',
    schemaVersion: 1,
    occurredAt: now,
    payload: { bookingId: booking.id, markedByUserId: context.actor.userId },
  });
}

/**
 * "Advance queue" (contract §8): the Manager override fact on an arrived, waiting (OPEN) visit,
 * the single stored ordering field. Its lines then lead their KTVs' queues, in override time.
 * Repeating keeps the first override (idempotent). Audited with the required reason; the
 * contract defines no outbox event for it.
 */
export async function advanceVisit(
  context: AdminContext,
  visitId: string,
  reason: string,
  authorize: BranchCheck,
): Promise<void> {
  const { tx, now } = context;
  const [row] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  if (!row) throw new AuthError('NOT_FOUND');
  const visit = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    select: { id: true, branchId: true, status: true, queueOverrideAt: true, ownerUserId: true },
  });
  authorize(visit.branchId);
  if (visit.queueOverrideAt) return;
  if (visit.status !== 'OPEN') throw new AuthError('QUEUE_ADVANCE_NOT_ALLOWED');
  await tx.visit.update({
    where: { id: visit.id },
    data: {
      queueOverrideAt: now,
      queueOverrideByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'QUEUE_ADVANCED',
    entityType: 'Visit',
    entityId: visit.id,
    subjectUserId: visit.ownerUserId,
    branchId: visit.branchId,
    reason,
    after: { queueOverrideAt: now.toISOString() },
  });
}

// ------------------------------------------------------------------ the operational board

const bookingSelect = {
  id: true,
  code: true,
  status: true,
  startsAt: true,
  endsAt: true,
  owner: { select: { fullName: true, phoneCanonical: true } },
  recipients: {
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, relation: true, displayName: true },
  },
  lines: {
    orderBy: { sequence: 'asc' },
    select: {
      sequence: true,
      recipientId: true,
      serviceNameVi: true,
      serviceNameEn: true,
      plannedStartAt: true,
      plannedEndAt: true,
      assignmentConflict: true,
      employee: { select: { userId: true, user: { select: { fullName: true } } } },
    },
  },
  visit: {
    select: { id: true, code: true, status: true, arrivedAt: true, queueOverrideAt: true },
  },
} satisfies Prisma.BookingSelect;

/**
 * Today's bookings and computed queue for one branch (branch-local `date`, explicit `now`).
 * `canArrive` / `canManageQueue` only shape which actions are offered; every command is
 * authorized again in its own transaction.
 */
export async function operationalToday(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    date: Date;
    now: Date;
    settings: TimingSettings;
    canArrive: boolean;
    canManageQueue: boolean;
    /** Phase 4 Step 2: shape the per-line actions only; each command re-authorizes. */
    actorUserId: string;
    canCancelLine: boolean;
    canResolveExecution: boolean;
  },
): Promise<{
  bookings: OperationalBooking[];
  queue: OperationalQueueKtv[];
  waitingPool: OperationalWaitingEntry[];
  activeVisits: OperationalActiveVisit[];
}> {
  const { now, settings } = input;
  const rows = await tx.booking.findMany({
    where: { branchId: input.branchId, serviceDate: input.date },
    orderBy: [{ startsAt: 'asc' }, { code: 'asc' }],
    select: bookingSelect,
  });
  const bookings: OperationalBooking[] = rows.map((row) => {
    const state = operationalState(
      { status: row.status, startsAt: row.startsAt, visit: row.visit },
      now,
      settings,
    );
    const recipient = new Map(row.recipients.map((entry) => [entry.id, entry]));
    return {
      id: row.id,
      code: row.code,
      startsAt: row.startsAt.toISOString(),
      endsAt: row.endsAt.toISOString(),
      state,
      arrivalOpensAt: arrivalOpensAt(row.startsAt, settings).toISOString(),
      holdUntil: holdUntil(row.startsAt, settings).toISOString(),
      owner: { displayName: row.owner.fullName, phoneMasked: maskPhone(row.owner.phoneCanonical) },
      recipients: row.recipients.map((entry) => ({
        relation: entry.relation as BookingRecipientRelationName,
        displayName: entry.displayName,
      })),
      lines: row.lines.map((line) => ({
        sequence: line.sequence,
        serviceNameVi: line.serviceNameVi,
        serviceNameEn: line.serviceNameEn,
        startsAt: line.plannedStartAt.toISOString(),
        endsAt: line.plannedEndAt.toISOString(),
        recipientRelation: (recipient.get(line.recipientId)?.relation ??
          'SELF') as BookingRecipientRelationName,
        recipientName: recipient.get(line.recipientId)?.displayName ?? null,
        employee: { id: line.employee.userId, displayName: line.employee.user.fullName },
        conflict: line.assignmentConflict,
      })),
      visit: row.visit
        ? {
            id: row.visit.id,
            code: row.visit.code,
            arrivedAt: row.visit.arrivedAt.toISOString(),
            punctuality: punctuality(row.startsAt, row.visit.arrivedAt, settings),
            queueOverrideAt: row.visit.queueOverrideAt?.toISOString() ?? null,
          }
        : null,
      actions: {
        arrive:
          input.canArrive &&
          row.status === 'CONFIRMED' &&
          arrivalAllowed(row.startsAt, now, settings),
        noShow:
          input.canManageQueue &&
          row.status === 'CONFIRMED' &&
          noShowAllowed(row.startsAt, now, settings),
        advance:
          input.canManageQueue &&
          row.visit?.status === 'OPEN' &&
          row.visit.queueOverrideAt === null,
      },
    };
  });
  return {
    bookings,
    queue: await computeQueue(tx, { ...input, rows }),
    waitingPool: await computeWaitingPool(tx, input),
    activeVisits: await computeActiveVisits(tx, input),
  };
}

/**
 * Open visits of the branch with their lines (Phase 4 Step 2): today's arrived visits, plus any
 * older visit that still has a running service so a forgotten END stays reachable. `overdue` and the
 * offered actions come from the server clock and the caller's permissions; the commands re-check
 * everything (state, branch authority, the no-self-resolution rule) under locks.
 */
async function computeActiveVisits(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    date: Date;
    now: Date;
    actorUserId: string;
    canCancelLine: boolean;
    canResolveExecution: boolean;
  },
): Promise<OperationalActiveVisit[]> {
  const visits = await tx.visit.findMany({
    where: {
      branchId: input.branchId,
      status: { in: ['OPEN', 'IN_SERVICE'] },
      OR: [{ serviceDate: input.date }, { lines: { some: { status: 'IN_PROGRESS' } } }],
    },
    orderBy: [{ arrivedAt: 'asc' }, { code: 'asc' }],
    take: 100,
    select: {
      id: true,
      code: true,
      status: true,
      origin: true,
      arrivedAt: true,
      participants: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, displayName: true, customer: { select: { fullName: true } } },
      },
      lines: {
        orderBy: [{ participantId: 'asc' }, { sequence: 'asc' }],
        select: {
          id: true,
          sequence: true,
          status: true,
          serviceNameVi: true,
          serviceNameEn: true,
          plannedStartAt: true,
          employeeUserId: true,
          employee: { select: { user: { select: { fullName: true } } } },
          participant: { select: { displayName: true, customer: { select: { fullName: true } } } },
          execution: { select: { status: true, startedAt: true, expectedEndAt: true } },
        },
      },
    },
  });
  return visits.map((visit) => ({
    id: visit.id,
    code: visit.code,
    status: visit.status as 'OPEN' | 'IN_SERVICE',
    origin: visit.origin,
    arrivedAt: visit.arrivedAt.toISOString(),
    participants: visit.participants.map((participant) => ({
      id: participant.id,
      name: participant.displayName ?? participant.customer?.fullName ?? null,
    })),
    // Adding a service on behalf of the customer is a desk action (MANAGE_BOOKINGS); the command re-authorizes.
    actions: { addService: input.canCancelLine },
    lines: visit.lines.map((line) => {
      const running = line.execution?.status === 'IN_PROGRESS' ? line.execution : null;
      return {
        id: line.id,
        sequence: line.sequence,
        status: line.status,
        participantName:
          line.participant.displayName ?? line.participant.customer?.fullName ?? null,
        serviceNameVi: line.serviceNameVi,
        serviceNameEn: line.serviceNameEn,
        employee:
          line.employeeUserId && line.employee
            ? { id: line.employeeUserId, displayName: line.employee.user.fullName }
            : null,
        plannedStartAt: line.plannedStartAt?.toISOString() ?? null,
        execution: running
          ? {
              startedAt: running.startedAt.toISOString(),
              expectedEndAt: running.expectedEndAt.toISOString(),
              overdue: input.now >= running.expectedEndAt,
            }
          : null,
        actions: {
          cancel:
            input.canCancelLine &&
            !line.execution &&
            (line.status === 'WAITING' || line.status === 'PLANNED'),
          resolve:
            input.canResolveExecution &&
            running !== null &&
            line.status === 'IN_PROGRESS' &&
            line.employeeUserId !== input.actorUserId,
        },
      };
    }),
  }));
}

async function computeQueue(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    date: Date;
    now: Date;
    settings: TimingSettings;
    rows: { id: string; code: string; status: string; startsAt: Date }[];
  },
): Promise<OperationalQueueKtv[]> {
  // Assigned visit lines of today's visits at this branch (booked arrivals and walk-ins).
  const assignedLines = await tx.visitServiceLine.findMany({
    where: {
      visit: { branchId: input.branchId, serviceDate: input.date },
      status: { in: ['PLANNED', 'IN_PROGRESS'] },
    },
    select: {
      id: true,
      status: true,
      employeeUserId: true,
      plannedStartAt: true,
      plannedEndAt: true,
      bufferMinutes: true,
      serviceNameVi: true,
      serviceNameEn: true,
      participant: { select: { displayName: true, customer: { select: { fullName: true } } } },
      visit: {
        select: {
          id: true,
          code: true,
          origin: true,
          status: true,
          arrivedAt: true,
          queueOverrideAt: true,
          booking: { select: { code: true, startsAt: true } },
        },
      },
    },
  });
  // PLANNED / IN_PROGRESS lines always carry their assignment (database CHECK); narrow the types.
  const visitLines = assignedLines.flatMap((line) =>
    line.employeeUserId && line.plannedStartAt && line.plannedEndAt && line.bufferMinutes !== null
      ? [
          {
            ...line,
            employeeUserId: line.employeeUserId,
            plannedStartAt: line.plannedStartAt,
            plannedEndAt: line.plannedEndAt,
            bufferMinutes: line.bufferMinutes,
          },
        ]
      : [],
  );
  // Reservations of bookings not arrived yet (still CONFIRMED): they keep blocking capacity.
  const reservedLines = await tx.bookingServiceLine.findMany({
    where: { booking: { branchId: input.branchId, serviceDate: input.date, status: 'CONFIRMED' } },
    select: {
      employeeUserId: true,
      plannedStartAt: true,
      plannedEndAt: true,
      bufferMinutes: true,
      booking: { select: { id: true, code: true, startsAt: true, endsAt: true } },
    },
  });
  const employeeIds = [
    ...new Set([
      ...visitLines.map((line) => line.employeeUserId),
      ...reservedLines.map((line) => line.employeeUserId),
    ]),
  ].sort();
  const names = new Map(
    (
      await tx.user.findMany({
        where: { id: { in: employeeIds } },
        select: { id: true, fullName: true },
      })
    ).map((row) => [row.id, row.fullName]),
  );
  const byLine = new Map(visitLines.map((line) => [line.id, line]));
  const until = (end: Date, buffer: number) => new Date(end.getTime() + buffer * 60_000);

  return employeeIds.map((employeeUserId) => {
    const mine = visitLines.filter((line) => line.employeeUserId === employeeUserId);
    const waiting: WaitingLine[] = mine
      .filter((line) => line.status === 'PLANNED' && line.visit.status !== 'CANCELLED')
      .map((line) => ({
        lineId: line.id,
        employeeUserId,
        plannedStartAt: line.plannedStartAt,
        visitId: line.visit.id,
        visitOrigin: line.visit.origin,
        arrivedAt: line.visit.arrivedAt,
        queueOverrideAt: line.visit.queueOverrideAt,
        bookingStartsAt: line.visit.booking?.startsAt ?? null,
      }));
    const reserved = reservedLines.filter((line) => line.employeeUserId === employeeUserId);
    const occupied: Occupied[] = [
      ...mine
        .filter((line) => line.status === 'PLANNED')
        .map((line) => ({
          start: line.plannedStartAt,
          end: until(line.plannedEndAt, line.bufferMinutes),
        })),
      ...reserved.map((line) => ({
        start: line.plannedStartAt,
        end: until(line.plannedEndAt, line.bufferMinutes),
      })),
    ];
    const participantName = (line: (typeof visitLines)[number]) =>
      line.participant.customer?.fullName ?? line.participant.displayName ?? '';
    return {
      employee: { id: employeeUserId, displayName: names.get(employeeUserId) ?? '' },
      freeNow: freeNow(
        occupied,
        mine.some((line) => line.status === 'IN_PROGRESS'),
        input.now,
      ),
      serving: mine
        .filter((line) => line.status === 'IN_PROGRESS')
        .map((line) => ({
          visitCode: line.visit.code,
          participantName: participantName(line),
          serviceNameVi: line.serviceNameVi,
          serviceNameEn: line.serviceNameEn,
        })),
      waiting: orderQueue(waiting, input.settings).map((entry, index) => {
        const line = byLine.get(entry.lineId)!;
        return {
          position: index + 1,
          group: entry.group,
          visitId: line.visit.id,
          visitCode: line.visit.code,
          bookingCode: line.visit.booking?.code ?? null,
          participantName: participantName(line),
          serviceNameVi: line.serviceNameVi,
          serviceNameEn: line.serviceNameEn,
          plannedStartAt: line.plannedStartAt.toISOString(),
        };
      }),
      reserved: reserved
        .sort((a, b) => a.plannedStartAt.getTime() - b.plannedStartAt.getTime())
        .map((line) => ({
          bookingId: line.booking.id,
          bookingCode: line.booking.code,
          startsAt: line.plannedStartAt.toISOString(),
          endsAt: line.plannedEndAt.toISOString(),
          state: preArrivalState(line.booking.startsAt, input.now, input.settings),
        })),
    };
  });
}

/**
 * Step 6: the branch waiting pool. One entry per participant with WAITING lines (no KTV, no
 * time, no occupancy) in today's OPEN / IN_SERVICE visits. It is ordered with the same
 * `orderQueue` rules as the per-KTV queues: a Manager-advanced visit first (OVERRIDE, by override
 * time), then walk-ins by actual arrival time. The order is advisory: staff may assign any entry
 * whose services and KTV fit the capacity that is free.
 */
async function computeWaitingPool(
  tx: Prisma.TransactionClient,
  input: {
    branchId: string;
    date: Date;
    now: Date;
    settings: TimingSettings;
    canArrive: boolean;
    canManageQueue: boolean;
  },
): Promise<OperationalWaitingEntry[]> {
  const lines = await tx.visitServiceLine.findMany({
    where: {
      status: 'WAITING',
      visit: {
        branchId: input.branchId,
        serviceDate: input.date,
        status: { in: ['OPEN', 'IN_SERVICE'] },
      },
    },
    orderBy: [{ participantId: 'asc' }, { sequence: 'asc' }],
    select: {
      id: true,
      sequence: true,
      serviceId: true,
      serviceNameVi: true,
      serviceNameEn: true,
      durationMinutes: true,
      assignmentMode: true,
      requestedEmployee: { select: { userId: true, user: { select: { fullName: true } } } },
      participant: {
        select: {
          id: true,
          kind: true,
          displayName: true,
          customer: { select: { fullName: true } },
        },
      },
      visit: {
        select: {
          id: true,
          code: true,
          origin: true,
          status: true,
          arrivedAt: true,
          queueOverrideAt: true,
          booking: { select: { startsAt: true } },
        },
      },
    },
  });
  const byParticipant = new Map<string, typeof lines>();
  for (const line of lines) {
    const group = byParticipant.get(line.participant.id) ?? [];
    group.push(line);
    byParticipant.set(line.participant.id, group);
  }
  // One representative per participant; an unassigned entry is ordered by arrival (its first
  // line id is only the final deterministic tie-break).
  const representatives: WaitingLine[] = [...byParticipant.values()].map((group) => {
    const first = group[0]!;
    return {
      lineId: first.id,
      employeeUserId: '',
      plannedStartAt: first.visit.arrivedAt,
      visitId: first.visit.id,
      visitOrigin: first.visit.origin,
      arrivedAt: first.visit.arrivedAt,
      queueOverrideAt: first.visit.queueOverrideAt,
      bookingStartsAt: first.visit.booking?.startsAt ?? null,
    };
  });
  const participantOfLine = new Map(lines.map((line) => [line.id, line.participant.id]));
  return orderQueue(representatives, input.settings).map((entry, index) => {
    const group = byParticipant.get(participantOfLine.get(entry.lineId)!)!;
    const first = group[0]!;
    return {
      position: index + 1,
      group: entry.group,
      visitId: first.visit.id,
      visitCode: first.visit.code,
      participantId: first.participant.id,
      participantName: first.participant.customer?.fullName ?? first.participant.displayName ?? '',
      participantKind: first.participant.kind as VisitParticipantKindName,
      arrivedAt: first.visit.arrivedAt.toISOString(),
      lines: group.map((line) => ({
        id: line.id,
        sequence: line.sequence,
        serviceId: line.serviceId,
        serviceNameVi: line.serviceNameVi,
        serviceNameEn: line.serviceNameEn,
        durationMinutes: line.durationMinutes,
        assignmentMode: line.assignmentMode,
        requestedEmployee: line.requestedEmployee
          ? { id: line.requestedEmployee.userId, displayName: line.requestedEmployee.user.fullName }
          : null,
      })),
      actions: {
        assign: input.canArrive,
        changeIntent: input.canArrive,
        advance:
          input.canManageQueue &&
          first.visit.status === 'OPEN' &&
          first.visit.queueOverrideAt === null,
        cancel:
          input.canArrive && first.visit.status === 'OPEN' && first.visit.origin === 'WALK_IN',
      },
    };
  });
}

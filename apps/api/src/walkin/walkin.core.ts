import { randomBytes } from 'node:crypto';
import type {
  VisitParticipantKindName,
  WalkInCreateRequest,
  WalkInMemberLookupResponse,
  WalkInParticipantResult,
  WalkInVisitResponse,
  WalkInWaitReason,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import {
  evaluateSequenceAt,
  loadAvailabilityFacts,
  lockAvailabilitySubjects,
} from '../availability/availability.engine.js';
import { AuthError } from '../auth/auth.error.js';
import { normalizeEmail, normalizePhone } from '../auth/identity.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { loadTieBreakFacts } from '../booking/booking.core.js';
import { planAssignment, type PlanFailure } from '../booking/booking.planner.js';
import { sqlStateOf } from '../booking/customer-command.js';
import type { BranchCheck } from '../operations/operations.core.js';
import { maskPhone } from '../operations/operations.state.js';

/*
 * Phase 3 Step 6: walk-in intake, initial assignment and waiting intent (Owner-approved TRUE
 * WAITING WALK-IN amendment). A walk-in visit is created directly (no booking, no account for a
 * guest). Its lines start WAITING: real service, order, duration and catalog snapshot, the
 * assignment intent (ANY, or SPECIFIC with the requested KTV), but no KTV, no times, no buffer and
 * no occupancy. Initial assignment turns one participant's WAITING sequence into PLANNED lines
 * with a real KTV and times, after the Step 3 engine re-checks capacity under locks.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z0-9_-]{1,32}$/;
const PHONE = /^\+?[0-9]{6,20}$/;
export const WALKIN_LIMITS = Object.freeze({ participants: 10, lines: 20, nameMaxCodePoints: 200 });

const invalid = (field: string): never => {
  throw new AuthError('VALIDATION_FAILED', field);
};

// ------------------------------------------------------------------ member lookup

/**
 * Front-desk member lookup (contract §9: "phone or email lookup; the match is masked and staff
 * confirm with the customer"). Exact match on the normalized phone or email only, active
 * customers only, at most one result: no partial search and no enumeration. Only what staff need
 * to confirm the person is returned; no credentials, sessions or other account data.
 */
export async function lookupMember(
  tx: Prisma.TransactionClient,
  query: { phone?: string; email?: string },
): Promise<WalkInMemberLookupResponse> {
  let where: Prisma.UserWhereInput;
  try {
    if (query.phone && !query.email) {
      where = { phoneCanonical: normalizePhone(query.phone).phoneCanonical };
    } else if (query.email && !query.phone) {
      where = { emailCanonical: normalizeEmail(query.email).emailCanonical };
    } else {
      return invalid('query');
    }
  } catch (error) {
    if (error instanceof AuthError) throw error;
    return invalid(query.phone ? 'phone' : 'email');
  }
  const row = await tx.user.findFirst({
    where: { ...where, kind: 'CUSTOMER', status: 'ACTIVE' },
    select: { id: true, fullName: true, phoneCanonical: true, emailCanonical: true },
  });
  return {
    members: row
      ? [
          {
            id: row.id,
            displayName: row.fullName,
            phoneMasked: maskPhone(row.phoneCanonical),
            emailMasked: maskEmail(row.emailCanonical),
          },
        ]
      : [],
  };
}

export function maskEmail(email: string | null): string | null {
  if (!email) return null;
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}•••@${domain}`;
}

// ------------------------------------------------------------------ intake

export interface NormalizedWalkIn {
  idempotencyKey: string;
  participants: {
    key: string;
    kind: VisitParticipantKindName;
    customerUserId: string | null;
    displayName: string | null;
    phone: string | null;
    guardianKey: string | null;
  }[];
  lines: { participantKey: string; serviceId: string; requestedEmployeeUserId: string | null }[];
}

/**
 * Shape checks. Participants follow the locked Step 5 model: MEMBER is an existing customer
 * account; GUEST a name (and optional phone), never an account; CHILD a name guarded by another
 * participant of the same walk-in (without an adult participant the child is entered as a
 * GUEST). Nothing here can create, invent or complete an account.
 */
export function normalizeWalkIn(input: WalkInCreateRequest): NormalizedWalkIn {
  if (!UUID.test(input.idempotencyKey)) invalid('idempotencyKey');
  if (!Array.isArray(input.participants) || input.participants.length === 0)
    invalid('participants');
  if (input.participants.length > WALKIN_LIMITS.participants) invalid('participants');
  if (!Array.isArray(input.lines) || input.lines.length === 0) invalid('lines');
  if (input.lines.length > WALKIN_LIMITS.lines) invalid('lines');
  const keys = new Set<string>();
  const members = new Set<string>();
  const participants = input.participants.map((participant) => {
    if (!KEY.test(participant.key) || keys.has(participant.key)) invalid('participantKey');
    keys.add(participant.key);
    if (participant.kind === 'MEMBER') {
      if (!participant.customerUserId || !UUID.test(participant.customerUserId)) {
        invalid('customerUserId');
      }
      const id = participant.customerUserId!.toLowerCase();
      if (members.has(id)) invalid('customerUserId');
      members.add(id);
      if (participant.displayName !== undefined || participant.guardianKey !== undefined) {
        invalid('displayName');
      }
      return {
        key: participant.key,
        kind: 'MEMBER' as const,
        customerUserId: id,
        displayName: null,
        phone: null,
        guardianKey: null,
      };
    }
    if (participant.kind !== 'GUEST' && participant.kind !== 'CHILD') invalid('kind');
    const displayName = (participant.displayName ?? '')
      .normalize('NFC')
      .trim()
      .replace(/\s+/g, ' ');
    if (!displayName || [...displayName].length > WALKIN_LIMITS.nameMaxCodePoints)
      invalid('displayName');
    const phone = participant.phone?.replace(/[\s().-]/g, '') || null;
    if (phone !== null && !PHONE.test(phone)) invalid('phone');
    if (participant.customerUserId !== undefined) invalid('customerUserId');
    if (participant.kind === 'GUEST' && participant.guardianKey !== undefined)
      invalid('guardianKey');
    return {
      key: participant.key,
      kind: participant.kind,
      customerUserId: null,
      displayName,
      phone,
      guardianKey: participant.kind === 'CHILD' ? (participant.guardianKey ?? null) : null,
    };
  });
  for (const participant of participants) {
    if (participant.kind !== 'CHILD') continue;
    const guardian = participants.find((entry) => entry.key === participant.guardianKey);
    if (!guardian || guardian.kind === 'CHILD') invalid('guardianKey');
  }
  const lines = input.lines.map((line) => {
    if (!keys.has(line.participantKey)) invalid('participantKey');
    if (!UUID.test(line.serviceId)) invalid('serviceId');
    if (line.requestedEmployeeUserId !== null && !UUID.test(line.requestedEmployeeUserId)) {
      invalid('requestedEmployeeUserId');
    }
    return {
      participantKey: line.participantKey,
      serviceId: line.serviceId.toLowerCase(),
      requestedEmployeeUserId: line.requestedEmployeeUserId?.toLowerCase() ?? null,
    };
  });
  return { idempotencyKey: input.idempotencyKey.toLowerCase(), participants, lines };
}

function visitCode(day: string): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = [...randomBytes(6)].map((byte) => alphabet[byte % alphabet.length]).join('');
  return `WI-${day.slice(2, 4)}${day.slice(5, 7)}${day.slice(8, 10)}-${random}`;
}

async function branchToday(tx: Prisma.TransactionClient, branchId: string, now: Date) {
  const [row] = await tx.$queryRaw<{ day: string; timezone: string; active: boolean }[]>`
    SELECT to_char(${now}::timestamptz AT TIME ZONE b.timezone, 'YYYY-MM-DD') AS day,
           b.timezone, b.is_active AS active
    FROM branches b WHERE b.id = ${branchId}::uuid`;
  return row ?? null;
}

export async function requireRequestedEmployee(
  tx: Prisma.TransactionClient,
  employeeUserId: string,
  branchId: string,
): Promise<void> {
  // Intent may only name an employee of this branch (qualification is checked at assignment).
  const assigned = await tx.employeeBranchAssignment.findFirst({
    where: { employeeUserId, branchId, revokedAt: null },
    select: { id: true },
  });
  if (!assigned) invalid('requestedEmployeeUserId');
}

/**
 * Walk-in intake (one transaction): replay by (actor, idempotency key); otherwise the visit
 * (origin WALK_IN, OPEN, no booking, `arrived_at` = the database clock, and no account owner: a
 * member participant is a service recipient, never an inferred owner), its participants and its WAITING lines (snapshots from the catalog). Then
 * every participant's sequence gets one immediate assignment attempt (inside a savepoint): no
 * capacity keeps it WAITING and never fails the intake. Audited (WALK_IN_CREATED) and appended to
 * the outbox (WALK_IN_CREATED, contract §17).
 */
export async function createWalkIn(
  context: AdminContext,
  branchId: string,
  request: NormalizedWalkIn,
): Promise<{ visitId: string; waitReasons: Map<string, WalkInWaitReason | null> }> {
  const { tx, now } = context;
  const replay = () =>
    tx.visit.findUnique({
      where: {
        createdByUserId_idempotencyKey: {
          createdByUserId: context.actor.userId,
          idempotencyKey: request.idempotencyKey,
        },
      },
      select: { id: true },
    });
  const earlier = await replay();
  if (earlier) return { visitId: earlier.id, waitReasons: new Map() };

  const today = await branchToday(tx, branchId, now);
  if (!today?.active) throw new AuthError('NOT_FOUND');
  // Members must be existing active customer accounts; nothing is created for anyone.
  const memberIds = request.participants.flatMap((p) =>
    p.customerUserId ? [p.customerUserId] : [],
  );
  if (memberIds.length > 0) {
    const found = await tx.user.count({
      where: { id: { in: memberIds }, kind: 'CUSTOMER', status: 'ACTIVE' },
    });
    if (found !== memberIds.length) invalid('customerUserId');
  }
  const serviceIds = [...new Set(request.lines.map((line) => line.serviceId))];
  const services = await tx.service.findMany({
    where: {
      id: { in: serviceIds },
      isActive: true,
      branches: { some: { branchId, isActive: true } },
    },
    select: {
      id: true,
      code: true,
      nameVi: true,
      nameEn: true,
      durationMinutes: true,
      priceVnd: true,
      priceMaxVnd: true,
      pricingUnit: true,
      maxQuantity: true,
      categoryId: true,
    },
  });
  if (services.length !== serviceIds.length) throw new AuthError('BOOKING_SERVICE_UNAVAILABLE');
  const serviceById = new Map(services.map((row) => [row.id, row]));
  for (const requested of new Set(
    request.lines.flatMap((l) => (l.requestedEmployeeUserId ? [l.requestedEmployeeUserId] : [])),
  )) {
    await requireRequestedEmployee(tx, requested, branchId);
  }

  const visit = await tx.visit.create({
    data: {
      code: visitCode(today.day),
      branchId,
      origin: 'WALK_IN',
      // Recipients are not owners: a direct walk-in has no inferred account owner (Owner decision).
      ownerUserId: null,
      serviceDate: new Date(today.day),
      arrivedAt: now,
      createdByUserId: context.actor.userId,
      idempotencyKey: request.idempotencyKey,
    },
    select: { id: true },
  });
  const participantIds = new Map<string, string>();
  // Adults first so a child can name its guardian.
  const ordered = [
    ...request.participants.filter((p) => p.kind !== 'CHILD'),
    ...request.participants.filter((p) => p.kind === 'CHILD'),
  ];
  for (const participant of ordered) {
    const row = await tx.visitParticipant.create({
      data: {
        visitId: visit.id,
        kind: participant.kind,
        customerUserId: participant.customerUserId,
        displayName: participant.displayName,
        phone: participant.phone,
        guardianParticipantId: participant.guardianKey
          ? (participantIds.get(participant.guardianKey) ?? null)
          : null,
      },
      select: { id: true },
    });
    participantIds.set(participant.key, row.id);
  }
  const sequenceOf = new Map<string, number>();
  for (const line of request.lines) {
    const participantId = participantIds.get(line.participantKey)!;
    const sequence = (sequenceOf.get(participantId) ?? 0) + 1;
    sequenceOf.set(participantId, sequence);
    const service = serviceById.get(line.serviceId)!;
    await tx.visitServiceLine.create({
      data: {
        visitId: visit.id,
        participantId,
        sequence,
        serviceId: service.id,
        status: 'WAITING',
        assignmentMode: line.requestedEmployeeUserId ? 'SPECIFIC' : 'ANY',
        requestedEmployeeUserId: line.requestedEmployeeUserId,
        durationMinutes: service.durationMinutes,
        serviceCode: service.code,
        serviceNameVi: service.nameVi,
        serviceNameEn: service.nameEn,
        catalogPriceMinVnd: service.priceVnd,
        catalogPriceMaxVnd: service.priceMaxVnd,
        catalogPricingUnit: service.pricingUnit,
        // OP-1: the per-service quantity limit is snapshotted with the other pricing inputs.
        maxQuantitySnapshot: service.maxQuantity,
        // Phase 4 Step 6: the category at this moment, for discount scope.
        serviceCategoryId: service.categoryId,
      },
      select: { id: true },
    });
  }
  await appendAdminAudit(context, {
    action: 'WALK_IN_CREATED',
    entityType: 'Visit',
    entityId: visit.id,
    branchId,
    after: {
      participants: request.participants.length,
      members: memberIds.length,
      lines: request.lines.length,
    },
  });
  await appendOutboxEvent(tx, {
    branchId,
    aggregateType: 'Visit',
    aggregateId: visit.id,
    eventType: 'WALK_IN_CREATED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      visitId: visit.id,
      participants: request.participants.length,
      lines: request.lines.length,
    },
  });
  // Immediate assignment attempt per participant; waiting is a valid outcome, not a failure.
  const waitReasons = new Map<string, WalkInWaitReason | null>();
  for (const participantId of new Set(sequenceOf.keys())) {
    const result = await assignWaitingSequence(context, visit.id, participantId, () => undefined);
    waitReasons.set(participantId, result.waitReason);
  }
  return { visitId: visit.id, waitReasons };
}

// ------------------------------------------------------------------ initial assignment

const WAIT_REASONS: Record<PlanFailure, WalkInWaitReason> = {
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  OUTSIDE_HORIZON: 'OUTSIDE_HOURS',
  INVALID_TIME: 'OUTSIDE_HOURS',
  CUSTOMER_CONFLICT: 'NO_CAPACITY',
  KTV_UNAVAILABLE: 'REQUESTED_KTV_UNAVAILABLE',
  NO_SUITABLE_KTV: 'NO_CAPACITY',
};

let savepointSequence = 0;

/**
 * Initial assignment of one participant's WAITING sequence (Owner-approved Step 6 operation; not
 * Step 8 reassignment). In the caller's transaction:
 * 1. lock the visit row (serializes assignments of this visit); authorize at its branch;
 * 2. load the participant's WAITING lines in order; none left → nothing to do (idempotent);
 * 3. plan from the exact database clock (never in the past), or after the participant's lines
 *    that are already planned or running; the engine evaluates from the next whole minute;
 * 4. read the engine (OPERATIONAL: branch-local today, attendance, employment, branch, skills,
 *    leave, CTV work, bookings, visits, running services, buffers, closing time), lock the KTV
 *    rows involved in sorted order, read the engine again under the locks;
 * 5. plan with the Step 4 planner: SPECIFIC lines only with their requested KTV (never
 *    substituted), ANY lines single-KTV first, split only when needed, the locked tie-break;
 * 6. success: every line WAITING → PLANNED with the KTV, planned times and the buffer snapshot of
 *    the current setting (Owner decision 1); the Step 2 trigger claims the occupancy and the
 *    overlap constraint is the backstop. Audited (VISIT_LINE_ASSIGNED); VISIT_LINE_SCHEDULED
 *    appended (contract §17);
 * 7. no capacity, or a lost race (23P01): the lines stay WAITING, nothing else changes.
 */
export async function assignWaitingSequence(
  context: AdminContext,
  visitId: string,
  participantId: string,
  authorize: BranchCheck,
): Promise<{ assigned: boolean; waitReason: WalkInWaitReason | null }> {
  const { tx, now } = context;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  const visit = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    select: { id: true, branchId: true, status: true },
  });
  authorize(visit.branchId);
  const lines = await tx.visitServiceLine.findMany({
    where: { visitId, participantId },
    orderBy: { sequence: 'asc' },
    select: {
      id: true,
      status: true,
      serviceId: true,
      requestedEmployeeUserId: true,
      plannedEndAt: true,
      bufferMinutes: true,
    },
  });
  if (lines.length === 0) throw new AuthError('NOT_FOUND');
  // A closed (for example cancelled) walk-in takes no assignment, even as a repeat.
  if (visit.status !== 'OPEN' && visit.status !== 'IN_SERVICE') {
    throw new AuthError('WALKIN_NOT_ASSIGNABLE');
  }
  const waiting = lines.filter((line) => line.status === 'WAITING');
  if (waiting.length === 0) return { assigned: true, waitReason: null };
  const today = await branchToday(tx, visit.branchId, now);
  if (!today) throw new AuthError('NOT_FOUND');

  // The origin: now, or after this participant's lines already planned or running.
  const busyUntil = lines
    .filter((line) => line.status === 'PLANNED' || line.status === 'IN_PROGRESS')
    .reduce(
      (latest, line) =>
        Math.max(latest, (line.plannedEndAt?.getTime() ?? 0) + (line.bufferMinutes ?? 0) * 60_000),
      now.getTime(),
    );
  // Planned times start at the exact origin (never earlier than now). The Step 3 engine works in
  // whole branch-local minutes (an application rule, not a database invariant), so it evaluates
  // the sequence from the next whole minute: that covers every stored interval except its first
  // seconds, which the overlap exclusion constraint still guards (a conflict there → WAITING).
  const originMs = busyUntil;
  const engineMs = Math.ceil(originMs / 60_000) * 60_000;
  const [origin] = await tx.$queryRaw<{ minute: number; day: string }[]>`
    SELECT (extract(hour FROM t) * 60 + extract(minute FROM t))::int AS minute,
           to_char(t, 'YYYY-MM-DD') AS day
    FROM (SELECT ${new Date(engineMs)}::timestamptz AT TIME ZONE ${today.timezone} AS t) AS local`;
  if (!origin || origin.day !== today.day) return { assigned: false, waitReason: 'OUTSIDE_HOURS' };

  const sequence = {
    branchId: visit.branchId,
    serviceDate: today.day,
    serviceIds: waiting.map((line) => line.serviceId),
    context: 'OPERATIONAL' as const,
    now,
  };
  const planLines = waiting.map((line) => ({
    serviceId: line.serviceId,
    employeeUserId: line.requestedEmployeeUserId,
  }));
  const before = evaluateSequenceAt(await loadAvailabilityFacts(tx, sequence), origin.minute);
  const involved = new Set<string>();
  for (const [index, line] of planLines.entries()) {
    if (line.employeeUserId) involved.add(line.employeeUserId);
    else for (const id of before.lines[index]?.eligibleEmployeeUserIds ?? []) involved.add(id);
  }
  await lockAvailabilitySubjects(tx, [...involved]);
  const evaluation = evaluateSequenceAt(await loadAvailabilityFacts(tx, sequence), origin.minute);
  const tie = await loadTieBreakFacts(tx, {
    branchId: visit.branchId,
    date: new Date(today.day),
    employeeUserIds: [...involved],
  });
  const plan = planAssignment(evaluation, planLines, tie, involved);
  if (!plan.ok) return { assigned: false, waitReason: WAIT_REASONS[plan.failure] };

  // A concurrent assignment may have claimed the same KTV time: the savepoint keeps the rest of
  // the caller's transaction (for example the walk-in intake) intact.
  // Stored times: the exact origin, then the engine's chaining (durations and buffers).
  const firstMs = evaluation.lines[0]!.startsAt.getTime();
  const startOf = (index: number) =>
    new Date(originMs + evaluation.lines[index]!.startsAt.getTime() - firstMs);
  const endOf = (index: number) =>
    new Date(originMs + evaluation.lines[index]!.endsAt.getTime() - firstMs);
  const savepoint = `walkin_assign_${++savepointSequence}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${savepoint}`);
  try {
    for (const [index, line] of waiting.entries()) {
      const planned = evaluation.lines[index]!;
      await tx.visitServiceLine.update({
        where: { id: line.id },
        data: {
          status: 'PLANNED',
          employeeUserId: plan.assignments[index]!.employeeUserId,
          plannedStartAt: startOf(index),
          plannedEndAt: endOf(index),
          bufferMinutes: planned.bufferMinutes,
          rowVersion: { increment: 1 },
        },
        select: { id: true },
      });
    }
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${savepoint}`);
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    if (sqlStateOf(error) === '23P01') return { assigned: false, waitReason: 'NO_CAPACITY' };
    throw error;
  }
  await appendAdminAudit(context, {
    action: 'VISIT_LINE_ASSIGNED',
    entityType: 'Visit',
    entityId: visit.id,
    branchId: visit.branchId,
    after: {
      participantId,
      lines: waiting.map((line, index) => ({
        lineId: line.id,
        employeeUserId: plan.assignments[index]!.employeeUserId,
        startsAt: startOf(index).toISOString(),
      })),
    },
  });
  await appendOutboxEvent(tx, {
    branchId: visit.branchId,
    aggregateType: 'Visit',
    aggregateId: visit.id,
    eventType: 'VISIT_LINE_SCHEDULED',
    schemaVersion: 1,
    occurredAt: now,
    payload: {
      visitId: visit.id,
      participantId,
      lines: waiting.map((line, index) => ({
        lineId: line.id,
        employeeUserId: plan.assignments[index]!.employeeUserId,
        assignmentMode: plan.assignments[index]!.mode,
      })),
    },
  });
  return { assigned: true, waitReason: null };
}

// ------------------------------------------------------------------ waiting intent

/**
 * Changing the intent of a WAITING line (Owner decision 5): ANY ↔ SPECIFIC, or another
 * requested KTV. It is not reassignment: no KTV is assigned yet and no occupancy is created.
 * Only WAITING lines; a PLANNED (or later) line is refused (changing an assigned KTV is Step 8).
 * Audited with from/to (WAITING_INTENT_CHANGED); a repeat with the same intent changes nothing.
 */
export async function changeWaitingIntent(
  context: AdminContext,
  visitId: string,
  lineId: string,
  requestedEmployeeUserId: string | null,
  authorize: BranchCheck,
): Promise<void> {
  const { tx } = context;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  const line = await tx.visitServiceLine.findFirst({
    where: { id: lineId, visitId },
    select: {
      id: true,
      status: true,
      assignmentMode: true,
      requestedEmployeeUserId: true,
      visit: { select: { branchId: true } },
    },
  });
  if (!line) throw new AuthError('NOT_FOUND');
  authorize(line.visit.branchId);
  if (line.status !== 'WAITING') throw new AuthError('WALKIN_LINE_NOT_WAITING');
  if (requestedEmployeeUserId) {
    await requireRequestedEmployee(tx, requestedEmployeeUserId, line.visit.branchId);
  }
  if (line.requestedEmployeeUserId === requestedEmployeeUserId) return;
  await tx.visitServiceLine.update({
    where: { id: line.id },
    data: {
      assignmentMode: requestedEmployeeUserId ? 'SPECIFIC' : 'ANY',
      requestedEmployeeUserId,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'WAITING_INTENT_CHANGED',
    entityType: 'VisitServiceLine',
    entityId: line.id,
    branchId: line.visit.branchId,
    before: {
      assignmentMode: line.assignmentMode,
      requestedEmployeeUserId: line.requestedEmployeeUserId,
    },
    after: {
      assignmentMode: requestedEmployeeUserId ? 'SPECIFIC' : 'ANY',
      requestedEmployeeUserId,
    },
  });
}

// ------------------------------------------------------------------ read model

export async function walkInVisit(
  tx: Prisma.TransactionClient,
  visitId: string,
  waitReasons: ReadonlyMap<string, WalkInWaitReason | null> = new Map(),
): Promise<WalkInVisitResponse> {
  const visit = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    select: {
      id: true,
      code: true,
      arrivedAt: true,
      branch: { select: { timezone: true } },
      participants: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          kind: true,
          displayName: true,
          customer: { select: { fullName: true } },
          lines: {
            orderBy: { sequence: 'asc' },
            select: {
              id: true,
              sequence: true,
              serviceNameVi: true,
              serviceNameEn: true,
              status: true,
              assignmentMode: true,
              plannedStartAt: true,
              plannedEndAt: true,
              requestedEmployee: { select: { userId: true, user: { select: { fullName: true } } } },
              employee: { select: { userId: true, user: { select: { fullName: true } } } },
            },
          },
        },
      },
    },
  });
  const person = (row: { userId: string; user: { fullName: string } } | null) =>
    row ? { id: row.userId, displayName: row.user.fullName } : null;
  return {
    visitId: visit.id,
    visitCode: visit.code,
    arrivedAt: visit.arrivedAt.toISOString(),
    timezone: visit.branch.timezone,
    participants: visit.participants.map((participant): WalkInParticipantResult => {
      const waitingCount = participant.lines.filter((line) => line.status === 'WAITING').length;
      return {
        participantId: participant.id,
        displayName: participant.customer?.fullName ?? participant.displayName ?? '',
        kind: participant.kind,
        state:
          participant.lines.length === 0
            ? 'NO_SERVICES'
            : waitingCount > 0
              ? 'WAITING'
              : 'ASSIGNED',
        waitReason: waitingCount > 0 ? (waitReasons.get(participant.id) ?? null) : null,
        lines: participant.lines.map((line) => ({
          id: line.id,
          sequence: line.sequence,
          serviceNameVi: line.serviceNameVi,
          serviceNameEn: line.serviceNameEn,
          status: line.status,
          assignmentMode: line.assignmentMode,
          requestedEmployee: person(line.requestedEmployee),
          employee: person(line.employee),
          plannedStartAt: line.plannedStartAt?.toISOString() ?? null,
          plannedEndAt: line.plannedEndAt?.toISOString() ?? null,
        })),
      };
    }),
  };
}

// ------------------------------------------------------------------ cancel a waiting walk-in

/**
 * The customer of a walk-in leaves before any service started (Owner decision 3; not NO_SHOW).
 * Locks the visit row first, like initial assignment, so the two serialize:
 * - cancellation first: every WAITING (and pre-START PLANNED) line → CANCELLED, then the visit →
 *   CANCELLED; a later assignment is refused (WALKIN_NOT_ASSIGNABLE);
 * - assignment first: its PLANNED lines are still before START, so cancellation cancels them too
 *   (the Step 2 trigger releases their occupancy) and closes the visit.
 * Refused (WALKIN_CANCEL_NOT_ALLOWED) for a booked visit (the customer booking path owns those)
 * or once any service started or ended. A repeat on a cancelled walk-in returns quietly. Audited
 * with the required reason (WALK_IN_CANCELLED); the contract defines no outbox event for it.
 */
export async function cancelWaitingWalkIn(
  context: AdminContext,
  visitId: string,
  reason: string,
  authorize: BranchCheck,
): Promise<void> {
  const { tx, now } = context;
  const [locked] = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE`;
  if (!locked) throw new AuthError('NOT_FOUND');
  const visit = await tx.visit.findUniqueOrThrow({
    where: { id: visitId },
    select: {
      id: true,
      branchId: true,
      origin: true,
      status: true,
      lines: { select: { id: true, status: true } },
    },
  });
  authorize(visit.branchId);
  if (visit.origin !== 'WALK_IN') throw new AuthError('WALKIN_CANCEL_NOT_ALLOWED');
  if (visit.status === 'CANCELLED') return;
  const started = visit.lines.some(
    (line) => line.status === 'IN_PROGRESS' || line.status === 'DONE',
  );
  if (visit.status !== 'OPEN' || started) throw new AuthError('WALKIN_CANCEL_NOT_ALLOWED');
  const open = visit.lines.filter((line) => line.status === 'WAITING' || line.status === 'PLANNED');
  for (const line of open) {
    await tx.visitServiceLine.update({
      where: { id: line.id },
      data: {
        status: 'CANCELLED',
        cancelledAt: now,
        cancelledByUserId: context.actor.userId,
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
      cancelledByUserId: context.actor.userId,
      cancelReason: reason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'WALK_IN_CANCELLED',
    entityType: 'Visit',
    entityId: visit.id,
    branchId: visit.branchId,
    reason,
    before: { status: visit.status },
    after: {
      status: 'CANCELLED',
      cancelledLines: open.length,
      waitingLines: open.filter((line) => line.status === 'WAITING').length,
    },
  });
}

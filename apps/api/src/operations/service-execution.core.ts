import type {
  MyServiceWorkResponse,
  ServiceExecutionWork,
  ServiceStartBlock,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import {
  evaluateExecutionStart,
  loadAvailabilityFacts,
} from '../availability/availability.engine.js';
import { startedEarlyMinutes } from './operations.state.js';

const include = {
  visit: true,
  participant: { select: { displayName: true, customer: { select: { fullName: true } } } },
  execution: true,
} as const;
type WorkLine = Prisma.VisitServiceLineGetPayload<{ include: typeof include }>;

/** Same-day is always the branch's local date, including employment effective dates. */
async function branchDay(tx: Prisma.TransactionClient, branchId: string, now: Date) {
  const [clock] = await tx.$queryRaw<{ day: string }[]>`
    SELECT to_char(${now}::timestamptz AT TIME ZONE timezone, 'YYYY-MM-DD') AS day
    FROM branches WHERE id = ${branchId}::uuid`;
  if (!clock) throw new AuthError('NOT_FOUND');
  return clock.day;
}

/** Account access alone is insufficient, including a GLOBAL permission grant. */
export async function requirePerformer(context: AdminContext, branchId: string) {
  const { tx, actor, now } = context;
  if (!decide(actor.graph, 'PERFORM_SERVICES', { kind: 'BRANCH', branchId })) {
    throw new AuthError('FORBIDDEN');
  }
  const day = await branchDay(tx, branchId, now);
  const [employment, assignment] = await Promise.all([
    tx.employmentClassificationChange.findFirst({
      where: { employeeUserId: actor.userId, effectiveDate: { lte: new Date(day) } },
      orderBy: { effectiveDate: 'desc' },
      select: { classification: true },
    }),
    tx.employeeBranchAssignment.findFirst({
      where: { employeeUserId: actor.userId, branchId, revokedAt: null },
      select: { id: true },
    }),
  ]);
  if (!employment || employment.classification === 'ENDED' || !assignment) {
    throw new AuthError('FORBIDDEN');
  }
  return day;
}

async function ownedLine(context: AdminContext, lineId: string): Promise<WorkLine> {
  const line = await context.tx.visitServiceLine.findUnique({ where: { id: lineId }, include });
  // Normal actions never impersonate another KTV, even with Owner/global authority.
  if (!line || line.employeeUserId !== context.actor.userId) throw new AuthError('NOT_FOUND');
  await requirePerformer(context, line.visit.branchId);
  return line;
}

/** Shared by mutation and UI hints; the mutation repeats this under authoritative locks. */
async function startBlock(
  context: AdminContext,
  line: WorkLine,
): Promise<ServiceStartBlock | null> {
  const { tx, now } = context;
  if (
    line.status !== 'PLANNED' ||
    line.execution ||
    !line.employeeUserId ||
    !line.plannedStartAt ||
    !line.plannedEndAt ||
    line.bufferMinutes === null ||
    (line.visit.status !== 'OPEN' && line.visit.status !== 'IN_SERVICE')
  )
    return 'SERVICE_START_NOT_ALLOWED';
  const date = line.visit.serviceDate.toISOString().slice(0, 10);
  if (date !== (await branchDay(tx, line.visit.branchId, now))) return 'SERVICE_NOT_TODAY';
  // Early START (Owner decision 2026-10-07): a planned start still ahead no longer blocks. The same facts
  // below decide it (checked-in customer = the visit exists, KTV free, no overlap with other work, CTV shift),
  // evaluated for the actual interval [now, now + duration + buffer). There is no extra cap: the customer could
  // only check in inside `booking.checkInWindowMinutes`.
  const early = line.plannedStartAt > now;
  const preceding = await tx.visitServiceLine.findFirst({
    where: {
      participantId: line.participantId,
      id: { not: line.id },
      OR: [
        { sequence: { lt: line.sequence }, status: { notIn: ['DONE', 'CANCELLED'] } },
        { status: 'IN_PROGRESS' },
      ],
    },
    select: { id: true },
  });
  if (preceding) return 'SERVICE_SEQUENCE_BLOCKED';
  const running = await tx.serviceExecution.findFirst({
    where: { employeeUserId: line.employeeUserId, status: 'IN_PROGRESS' },
    select: { id: true },
  });
  if (running) return 'SERVICE_KTV_BUSY';
  const facts = await loadAvailabilityFacts(tx, {
    branchId: line.visit.branchId,
    serviceDate: date,
    serviceIds: [line.serviceId],
    employeeUserIds: [line.employeeUserId],
    context: 'OPERATIONAL',
    now,
    exclude: {
      visitServiceLineIds: [line.id],
      bookingServiceLineIds: line.bookingServiceLineId ? [line.bookingServiceLineId] : [],
    },
  });
  const eligibility = evaluateExecutionStart(facts, {
    employeeUserId: line.employeeUserId,
    durationMinutes: line.durationMinutes,
    bufferMinutes: line.bufferMinutes,
  });
  if (line.assignmentConflict) return 'SERVICE_START_UNAVAILABLE';
  if (!eligibility.eligible) {
    // For an early START say what is in the way, but only when that is the whole story.
    const only = (...allowed: string[]) =>
      eligibility.reasons.every((reason) => allowed.includes(reason));
    if (early && only('CONFLICT', 'SERVICE_RUNNING')) return 'SERVICE_EARLY_START_CONFLICT';
    if (early && only('CTV_NOT_SCHEDULED')) return 'SERVICE_EARLY_START_OUTSIDE_SHIFT';
    return 'SERVICE_START_UNAVAILABLE';
  }
  return null;
}

async function present(context: AdminContext, line: WorkLine): Promise<ServiceExecutionWork> {
  const blocked = await startBlock(context, line);
  const execution = line.execution;
  return {
    lineId: line.id,
    visitId: line.visitId,
    visitCode: line.visit.code,
    visitStatus: line.visit.status,
    branchId: line.visit.branchId,
    serviceDate: line.visit.serviceDate.toISOString().slice(0, 10),
    participantId: line.participantId,
    participantName: line.participant.displayName ?? line.participant.customer?.fullName ?? null,
    sequence: line.sequence,
    service: {
      code: line.serviceCode,
      nameVi: line.serviceNameVi,
      nameEn: line.serviceNameEn,
      durationMinutes: line.durationMinutes,
    },
    status: line.status,
    plannedStartAt: line.plannedStartAt?.toISOString() ?? null,
    plannedEndAt: line.plannedEndAt?.toISOString() ?? null,
    execution: execution
      ? {
          id: execution.id,
          status: execution.status,
          startedAt: execution.startedAt.toISOString(),
          expectedEndAt: execution.expectedEndAt.toISOString(),
          endedAt: execution.endedAt?.toISOString() ?? null,
          endKind: execution.endKind,
          startedEarlyMinutes: startedEarlyMinutes(line.plannedStartAt, execution.startedAt),
        }
      : null,
    actions: {
      start: blocked === null,
      end: line.status === 'IN_PROGRESS' && execution?.status === 'IN_PROGRESS',
      startBlockedBy: blocked,
      // Phase 4 Step 3: the performer serving this visit may add a catalog service to it.
      addService:
        (line.visit.status === 'OPEN' || line.visit.status === 'IN_SERVICE') &&
        line.status !== 'CANCELLED',
    },
  };
}

export async function myServiceWork(
  context: AdminContext,
  branchId: string,
): Promise<MyServiceWorkResponse> {
  const date = await requirePerformer(context, branchId);
  const branch = await context.tx.branch.findUnique({
    where: { id: branchId },
    select: { id: true, name: true, timezone: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  const lines = await context.tx.visitServiceLine.findMany({
    where: {
      employeeUserId: context.actor.userId,
      visit: { branchId },
      OR: [
        { visit: { serviceDate: new Date(date) } },
        { execution: { is: { status: 'IN_PROGRESS' } } },
      ],
    },
    orderBy: [{ plannedStartAt: 'asc' }, { participantId: 'asc' }, { sequence: 'asc' }],
    include,
  });
  return {
    branch,
    date,
    now: context.now.toISOString(),
    lines: await Promise.all(lines.map((line) => present(context, line))),
  };
}

export async function serviceWork(
  context: AdminContext,
  lineId: string,
): Promise<ServiceExecutionWork> {
  return present(context, await ownedLine(context, lineId));
}

/**
 * The admin frame holds the actor's user row (the assigned KTV) before the session.
 * Visit -> line -> execution serialize sequence decisions, cancellation and final completion.
 * NOWAIT on the visit avoids an inversion with Step 6's visit -> candidate-user locks:
 * a contending request rolls back and can safely retry; no partial facts escape.
 */
async function lockWork(context: AdminContext, lineId: string) {
  const hint = await ownedLine(context, lineId);
  await context.tx
    .$queryRaw`SELECT id FROM visits WHERE id = ${hint.visitId}::uuid FOR UPDATE NOWAIT`;
  await context.tx
    .$queryRaw`SELECT id FROM visit_service_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
  await context.tx.$queryRaw`
    SELECT id FROM service_executions WHERE visit_service_line_id = ${lineId}::uuid FOR UPDATE`;
  // Sample time after locks, never transaction-start time or any client timestamp.
  const [clock] = await context.tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  const lockedContext = { ...context, now: clock.now };
  return { context: lockedContext, line: await ownedLine(lockedContext, lineId) };
}

/**
 * The single Visit-completion rule, shared by a normal END, a management-resolved END (Phase 4
 * Step 2) and the cancellation of an unstarted line. Called after a line just became DONE or
 * CANCELLED, under the visit row lock:
 * - some line is still WAITING / PLANNED / IN_PROGRESS -> the visit is unchanged;
 * - every line is DONE or CANCELLED and at least one is DONE -> COMPLETED (completedAt = now);
 * - every line is CANCELLED (nothing was performed) -> CANCELLED, the existing "customer left
 *   before any service" state (only reachable from the cancellation path, which supplies `reason`).
 * The database guard additionally refuses to close a visit that still has an open line. No payment
 * state is ever involved.
 */
export async function settleVisitAfterLineChange(
  tx: Prisma.TransactionClient,
  visit: { id: string; status: string },
  now: Date,
  actorUserId: string,
  cancelReason?: string,
): Promise<'OPEN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED'> {
  const current = visit.status as 'OPEN' | 'IN_SERVICE' | 'COMPLETED' | 'CANCELLED';
  const open = await tx.visitServiceLine.count({
    where: { visitId: visit.id, status: { notIn: ['DONE', 'CANCELLED'] } },
  });
  if (open > 0) return current;
  const done = await tx.visitServiceLine.count({ where: { visitId: visit.id, status: 'DONE' } });
  if (done > 0) {
    await tx.visit.update({
      where: { id: visit.id },
      data: { status: 'COMPLETED', completedAt: now, rowVersion: { increment: 1 } },
      select: { id: true },
    });
    return 'COMPLETED';
  }
  if (!cancelReason) return current;
  await tx.visit.update({
    where: { id: visit.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: now,
      cancelledByUserId: actorUserId,
      cancelReason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  return 'CANCELLED';
}

export async function startService(
  context: AdminContext,
  lineId: string,
): Promise<ServiceExecutionWork> {
  const locked = await lockWork(context, lineId);
  context = locked.context;
  const { line } = locked;
  const { tx, now } = context;
  if (line.status === 'IN_PROGRESS' && line.execution?.status === 'IN_PROGRESS') {
    return present(context, line); // duplicate START: original timestamps, no new audit/event
  }
  const blocked = await startBlock(context, line);
  if (blocked) throw new AuthError(blocked);
  const execution = await tx.serviceExecution.create({
    data: {
      visitServiceLineId: line.id,
      employeeUserId: context.actor.userId,
      startedAt: now,
      expectedEndAt: new Date(now.getTime() + line.durationMinutes * 60_000),
    },
  });
  await tx.visitServiceLine.update({
    where: { id: line.id },
    data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
  });
  if (line.visit.status === 'OPEN') {
    await tx.visit.update({
      where: { id: line.visitId },
      data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
    });
  }
  const facts = {
    visitId: line.visitId,
    serviceLineId: line.id,
    executionId: execution.id,
    employeeUserId: context.actor.userId,
    // Both times are kept: the booked one (never rewritten) and the actual one.
    plannedStartAt: line.plannedStartAt?.toISOString() ?? null,
    startedAt: now.toISOString(),
    startedEarlyMinutes: startedEarlyMinutes(line.plannedStartAt, now),
    expectedEndAt: execution.expectedEndAt.toISOString(),
  };
  await appendAdminAudit(context, {
    action: 'SERVICE_STARTED',
    entityType: 'ServiceExecution',
    entityId: execution.id,
    branchId: line.visit.branchId,
    before: { lineStatus: 'PLANNED' },
    after: { ...facts, lineStatus: 'IN_PROGRESS' },
  });
  await appendOutboxEvent(tx, {
    branchId: line.visit.branchId,
    aggregateType: 'ServiceExecution',
    aggregateId: execution.id,
    eventType: 'SERVICE_STARTED',
    schemaVersion: 1,
    occurredAt: now,
    payload: facts,
  });
  return serviceWork(context, lineId);
}

export async function endService(
  context: AdminContext,
  lineId: string,
): Promise<ServiceExecutionWork> {
  const locked = await lockWork(context, lineId);
  context = locked.context;
  const { line } = locked;
  const { tx, now } = context;
  const execution = line.execution;
  if (line.status === 'DONE' && execution?.status === 'ENDED') return present(context, line);
  if (
    line.status !== 'IN_PROGRESS' ||
    execution?.status !== 'IN_PROGRESS' ||
    now < execution.startedAt
  ) {
    throw new AuthError('SERVICE_END_NOT_ALLOWED');
  }
  // END is allowed after closing, after check-out and across midnight. Requiring START
  // availability here would strand real unfinished work. Workforce authorization still applies.
  await tx.serviceExecution.update({
    where: { id: execution.id },
    data: {
      status: 'ENDED',
      endedAt: now,
      endKind: 'NORMAL',
      endedByUserId: context.actor.userId,
      rowVersion: { increment: 1 },
    },
  });
  await tx.visitServiceLine.update({
    where: { id: line.id },
    data: { status: 'DONE', rowVersion: { increment: 1 } },
  });
  const visitStatus = await settleVisitAfterLineChange(tx, line.visit, now, context.actor.userId);
  const facts = {
    visitId: line.visitId,
    serviceLineId: line.id,
    executionId: execution.id,
    employeeUserId: context.actor.userId,
    startedAt: execution.startedAt.toISOString(),
    endedAt: now.toISOString(),
    endKind: 'NORMAL',
    visitStatus: visitStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_SERVICE',
  };
  await appendAdminAudit(context, {
    action: 'SERVICE_ENDED',
    entityType: 'ServiceExecution',
    entityId: execution.id,
    branchId: line.visit.branchId,
    before: { lineStatus: 'IN_PROGRESS' },
    after: { ...facts, lineStatus: 'DONE' },
  });
  await appendOutboxEvent(tx, {
    branchId: line.visit.branchId,
    aggregateType: 'ServiceExecution',
    aggregateId: execution.id,
    eventType: 'SERVICE_ENDED',
    schemaVersion: 1,
    occurredAt: now,
    payload: facts,
  });
  return serviceWork(context, lineId);
}

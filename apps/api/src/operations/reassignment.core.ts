import type {
  ReassignmentLine,
  ReassignmentLineKind,
  ReassignmentScope,
  ReassignmentWorkResponse,
  ReassignServicesRequest,
  ReassignServicesResponse,
  ReplacementOptionsResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import {
  evaluateReassignmentWindow,
  loadAvailabilityFacts,
} from '../availability/availability.engine.js';
import type { SequenceEvaluation } from '../availability/availability.types.js';
import { loadTieBreakFacts } from '../booking/booking.core.js';
import { compareByTieBreak, planAssignment } from '../booking/booking.planner.js';
import { currentClassification } from '../employees/workforce-title.js';

const firstChange = {
  orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  take: 1,
  select: { fromEmployeeUserId: true },
} satisfies Prisma.ServiceLineAssignmentChangeFindManyArgs;
const person = { select: { user: { select: { fullName: true } } } } as const;
export interface ReassignmentWork {
  view: ReassignmentLine;
  serviceId: string;
  durationMinutes: number;
  bufferMinutes: number;
  bookingId: string | null;
  visitId: string | null;
  ownerId: string | null;
  startable: boolean;
}

export async function reassignmentToday(tx: Prisma.TransactionClient, branchId: string, now: Date) {
  const [row] = await tx.$queryRaw<{ day: string }[]>`
    SELECT to_char(${now}::timestamptz AT TIME ZONE timezone, 'YYYY-MM-DD') AS day
    FROM branches WHERE id = ${branchId}::uuid`;
  if (!row) throw new AuthError('NOT_FOUND');
  return row.day;
}

export async function requireReassignment(context: AdminContext, branchId: string) {
  if (!decide(context.actor.graph, 'REASSIGN_SERVICES', { kind: 'BRANCH', branchId }))
    throw new AuthError('FORBIDDEN');
  if (!context.actor.owner) {
    const classification = await currentClassification(context.tx, context.actor.userId, [
      branchId,
    ]);
    if (classification === null || classification === 'ENDED') throw new AuthError('FORBIDDEN');
  }
}

/** Read the existing assignment and original request, never rewrite intent to follow reality. */
export async function loadReassignmentLine(
  tx: Prisma.TransactionClient,
  kind: ReassignmentLineKind,
  id: string,
): Promise<ReassignmentWork> {
  const booking =
    kind === 'BOOKING'
      ? await tx.bookingServiceLine.findUnique({
          where: { id },
          include: {
            booking: true,
            recipient: true,
            employee: person,
            assignmentChanges: firstChange,
            visitLine: { select: { id: true } },
          },
        })
      : null;
  const visit =
    kind === 'VISIT'
      ? await tx.visitServiceLine.findUnique({
          where: { id },
          include: {
            visit: true,
            employee: person,
            assignmentChanges: firstChange,
            execution: { select: { id: true } },
            participant: {
              select: { displayName: true, customer: { select: { fullName: true } } },
            },
            bookingServiceLine: {
              select: { employeeUserId: true, assignmentChanges: firstChange },
            },
          },
        })
      : null;
  if (!booking && !visit) throw new AuthError('NOT_FOUND');
  const line = booking ?? visit!;
  const parent = booking?.booking ?? visit!.visit;
  const employeeId = line.employeeUserId ?? '';
  const leave = employeeId
    ? await tx.leaveRequest.findFirst({
        where: {
          employeeUserId: employeeId,
          status: 'APPROVED',
          startDate: { lte: parent.serviceDate },
          endDate: { gte: parent.serviceDate },
        },
        select: { id: true },
      })
    : null;
  const requested =
    line.assignmentMode === 'ANY'
      ? null
      : booking
        ? (booking.assignmentChanges[0]?.fromEmployeeUserId ?? booking.employeeUserId)
        : (visit!.requestedEmployeeUserId ??
          visit!.bookingServiceLine?.assignmentChanges[0]?.fromEmployeeUserId ??
          visit!.bookingServiceLine?.employeeUserId ??
          visit!.assignmentChanges[0]?.fromEmployeeUserId ??
          visit!.employeeUserId);
  return {
    view: {
      kind,
      id,
      version: line.rowVersion,
      branchId: parent.branchId,
      parentId: parent.id,
      parentCode: parent.code,
      participantId: booking?.recipientId ?? visit!.participantId,
      participantName: booking
        ? booking.recipient.displayName
        : (visit!.participant.displayName ?? visit!.participant.customer?.fullName ?? null),
      sequence: line.sequence,
      serviceDate: parent.serviceDate.toISOString().slice(0, 10),
      service: { nameVi: line.serviceNameVi, nameEn: line.serviceNameEn },
      plannedStartAt: line.plannedStartAt?.toISOString() ?? '',
      plannedEndAt: line.plannedEndAt?.toISOString() ?? '',
      employee: { id: employeeId, displayName: line.employee?.user.fullName ?? '' },
      assignmentMode: line.assignmentMode,
      requestedEmployeeId: requested,
      leaveConflict: leave !== null,
      leaveRequestId: leave?.id ?? null,
    },
    serviceId: line.serviceId,
    durationMinutes: line.durationMinutes,
    bufferMinutes: line.bufferMinutes ?? 0,
    bookingId: booking?.bookingId ?? visit!.visit.bookingId,
    visitId: visit?.visitId ?? null,
    ownerId: parent.ownerUserId,
    startable: booking
      ? booking.booking.status === 'CONFIRMED' && !booking.visitLine
      : visit!.status === 'PLANNED' &&
        !visit!.execution &&
        Boolean(
          visit!.employeeUserId &&
          visit!.plannedStartAt &&
          visit!.plannedEndAt &&
          visit!.bufferMinutes !== null,
        ) &&
        ['OPEN', 'IN_SERVICE'].includes(visit!.visit.status),
  };
}

/** PARTICIPANT is explicit and bounded: same participant, same current KTV, unstarted only. */
export async function reassignmentScope(
  tx: Prisma.TransactionClient,
  kind: ReassignmentLineKind,
  id: string,
  scope: ReassignmentScope,
) {
  const anchor = await loadReassignmentLine(tx, kind, id);
  if (scope === 'LINE' || !anchor.startable) return [anchor];
  const ids =
    kind === 'BOOKING'
      ? await tx.bookingServiceLine.findMany({
          where: {
            bookingId: anchor.view.parentId,
            recipientId: anchor.view.participantId,
            employeeUserId: anchor.view.employee.id,
          },
          select: { id: true },
          orderBy: { sequence: 'asc' },
          take: 21,
        })
      : await tx.visitServiceLine.findMany({
          where: {
            visitId: anchor.view.parentId,
            participantId: anchor.view.participantId,
            employeeUserId: anchor.view.employee.id,
            status: 'PLANNED',
            execution: { is: null },
          },
          select: { id: true },
          orderBy: { sequence: 'asc' },
          take: 21,
        });
  if (ids.length > 20) throw new AuthError('VALIDATION_FAILED', 'scope');
  return Promise.all(ids.map((line) => loadReassignmentLine(tx, kind, line.id)));
}

async function requireScope(context: AdminContext, lines: ReassignmentWork[]) {
  const first = lines[0];
  if (!first) throw new AuthError('REASSIGNMENT_CONFLICT');
  await requireReassignment(context, first.view.branchId);
  const today = await reassignmentToday(context.tx, first.view.branchId, context.now);
  if (lines.some((line) => !line.startable || line.view.serviceDate < today))
    throw new AuthError('REASSIGNMENT_NOT_ALLOWED');
  return today;
}

export interface WorkQuery {
  from?: string;
  to?: string;
  conflictsOnly?: 'true' | 'false';
  cursor?: string;
}
export async function reassignmentWork(
  context: AdminContext,
  branchId: string,
  query: WorkQuery,
): Promise<ReassignmentWorkResponse> {
  await requireReassignment(context, branchId);
  const today = await reassignmentToday(context.tx, branchId, context.now);
  const from = query.from ?? today;
  const validDate = (value: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value;
  if (!validDate(from)) throw new AuthError('VALIDATION_FAILED', 'from');
  const to = query.to ?? new Date(Date.parse(from) + 30 * 86_400_000).toISOString().slice(0, 10);
  if (
    !validDate(from) ||
    !validDate(to) ||
    from < today ||
    to < from ||
    Date.parse(to) - Date.parse(from) > 92 * 86_400_000
  )
    throw new AuthError('VALIDATION_FAILED', 'from');
  const cursor = query.cursor ?? '';
  if (cursor && !/^(BOOKING|VISIT):[0-9a-f-]{36}$/.test(cursor))
    throw new AuthError('VALIDATION_FAILED', 'cursor');
  const conflictsOnly = query.conflictsOnly !== 'false';
  const found = await context.tx.$queryRaw<
    { kind: ReassignmentLineKind; id: string; cursor: string }[]
  >`
    WITH work AS (
      SELECT 'BOOKING'::text AS kind, l.id, l.employee_user_id, b.service_date, 'BOOKING:' || l.id::text AS cursor
      FROM booking_service_lines l JOIN bookings b ON b.id = l.booking_id
      WHERE b.branch_id = ${branchId}::uuid AND b.status = 'CONFIRMED'
        AND NOT EXISTS (SELECT 1 FROM visit_service_lines v WHERE v.booking_service_line_id = l.id)
      UNION ALL
      SELECT 'VISIT', l.id, l.employee_user_id, v.service_date, 'VISIT:' || l.id::text
      FROM visit_service_lines l JOIN visits v ON v.id = l.visit_id
      WHERE v.branch_id = ${branchId}::uuid AND v.status IN ('OPEN', 'IN_SERVICE') AND l.status = 'PLANNED'
        AND l.employee_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM service_executions e WHERE e.visit_service_line_id = l.id)
    ) SELECT kind, id::text, cursor FROM work w
      WHERE service_date BETWEEN ${new Date(from)}::date AND ${new Date(to)}::date AND cursor > ${cursor}
        AND (NOT ${conflictsOnly} OR EXISTS (SELECT 1 FROM leave_requests r WHERE r.employee_user_id = w.employee_user_id
          AND r.status = 'APPROVED' AND w.service_date BETWEEN r.start_date AND r.end_date))
      ORDER BY cursor LIMIT 101`;
  const branch = await context.tx.branch.findUniqueOrThrow({
    where: { id: branchId },
    select: { id: true, name: true, timezone: true },
  });
  const lines = await Promise.all(
    found.slice(0, 100).map((row) => loadReassignmentLine(context.tx, row.kind, row.id)),
  );
  // A read may race a committed START/cancellation; stale lines are never offered as editable.
  return {
    branch,
    from,
    to,
    lines: lines
      .filter((line) => line.startable && (!conflictsOnly || line.view.leaveConflict))
      .map((line) => line.view),
    nextCursor: found.length > 100 ? found[99]!.cursor : null,
  };
}

async function evaluateScope(
  context: AdminContext,
  lines: ReassignmentWork[],
  employees?: string[],
) {
  const today = await requireScope(context, lines);
  const evaluations: SequenceEvaluation[] = [];
  for (const line of lines) {
    const facts = await loadAvailabilityFacts(context.tx, {
      branchId: line.view.branchId,
      serviceDate: line.view.serviceDate,
      serviceIds: [line.serviceId],
      context: line.visitId || line.view.serviceDate === today ? 'OPERATIONAL' : 'REVALIDATION',
      now: context.now,
      ...(employees ? { employeeUserIds: employees } : {}),
      ...(line.ownerId ? { customerUserId: line.ownerId } : {}),
      exclude: {
        bookingServiceLineIds: lines.filter((l) => l.view.kind === 'BOOKING').map((l) => l.view.id),
        visitServiceLineIds: lines.filter((l) => l.view.kind === 'VISIT').map((l) => l.view.id),
        ...(line.bookingId ? { bookingId: line.bookingId } : {}),
      },
    });
    evaluations.push(
      evaluateReassignmentWindow(facts, {
        startsAt: new Date(line.view.plannedStartAt),
        endsAt: new Date(line.view.plannedEndAt),
        durationMinutes: line.durationMinutes,
        bufferMinutes: line.bufferMinutes,
      }),
    );
  }
  const planned = evaluations.flatMap((e) => e.lines).map((line, index) => ({ ...line, index }));
  const common = (planned[0]?.eligibleEmployeeUserIds ?? []).filter((id) =>
    planned.every((line) => line.eligibleEmployeeUserIds.includes(id)),
  );
  const evaluation: SequenceEvaluation = {
    lines: planned,
    reasons: [...new Set(evaluations.flatMap((e) => e.reasons))],
    unavailableServiceIndexes: evaluations.flatMap((e, index) =>
      e.unavailableServiceIndexes.length ? [index] : [],
    ),
    wholeSequenceEmployeeUserIds: common,
    everyLineCovered: planned.every((line) => line.eligibleEmployeeUserIds.length > 0),
    feasible: evaluations.every((e) => e.feasible),
  };
  return evaluation;
}

export async function replacementOptions(
  context: AdminContext,
  kind: ReassignmentLineKind,
  id: string,
  scope: ReassignmentScope,
): Promise<ReplacementOptionsResponse> {
  const lines = await reassignmentScope(context.tx, kind, id, scope);
  const evaluation = await evaluateScope(context, lines);
  const first = lines[0]!;
  const pool = [
    ...new Set(evaluation.lines.flatMap((line) => line.eligibleEmployeeUserIds)),
  ].filter((employee) => employee !== first.view.employee.id);
  // Do not suggest the unchanged employee, including for non-leave manual reassignment.
  evaluation.lines = evaluation.lines.map((line) => ({
    ...line,
    eligibleEmployeeUserIds: line.eligibleEmployeeUserIds.filter((employee) =>
      pool.includes(employee),
    ),
  }));
  const common = evaluation.wholeSequenceEmployeeUserIds.filter((employee) =>
    pool.includes(employee),
  );
  const tie = await loadTieBreakFacts(context.tx, {
    branchId: first.view.branchId,
    date: new Date(first.view.serviceDate),
    employeeUserIds: pool,
  });
  const targetIds = lines.map((line) => line.view.id);
  const siblings =
    kind === 'BOOKING'
      ? await context.tx.bookingServiceLine.findMany({
          where: {
            bookingId: first.view.parentId,
            recipientId: first.view.participantId,
            id: { notIn: targetIds },
          },
          select: { employeeUserId: true },
        })
      : await context.tx.visitServiceLine.findMany({
          where: {
            visitId: first.view.parentId,
            participantId: first.view.participantId,
            id: { notIn: targetIds },
            status: 'PLANNED',
          },
          select: { employeeUserId: true },
        });
  const retained = [
    ...new Set(siblings.flatMap((line) => (line.employeeUserId ? [line.employeeUserId] : []))),
  ];
  const preserveSequence =
    retained.length === 1 && common.includes(retained[0]!) ? retained[0]! : null;
  const suggestion = planAssignment(
    evaluation,
    lines.map((line) => ({ serviceId: line.serviceId, employeeUserId: preserveSequence })),
    tie,
  );
  const suggested = suggestion.ok
    ? suggestion.assignments.map((assignment, i) => ({
        lineId: lines[i]!.view.id,
        employeeUserId: assignment.employeeUserId,
      }))
    : [];
  const same = suggested[0]?.employeeUserId;
  const users = await context.tx.user.findMany({
    where: { id: { in: common } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((user) => [user.id, user.fullName]));
  return {
    scope,
    lines: lines.map((line) => line.view),
    candidates: common
      .sort((a, b) => Number(b === same) - Number(a === same) || compareByTieBreak(tie)(a, b))
      .map((employee) => ({
        id: employee,
        displayName: names.get(employee) ?? '',
        preferred: employee === same,
      })),
    suggestedAssignments: suggested,
    requiresSpecificAcknowledgement: lines.some((line) => line.view.assignmentMode === 'SPECIFIC'),
  };
}

/** User locks are acquired by the admin frame, sorted together with actor/customer identities. */
export async function reassignServices(
  context: AdminContext,
  kind: ReassignmentLineKind,
  id: string,
  input: ReassignServicesRequest,
  lockedUsers: ReadonlySet<string>,
): Promise<ReassignServicesResponse> {
  const hint = await loadReassignmentLine(context.tx, kind, id);
  await requireReassignment(context, hint.view.branchId);
  if (hint.bookingId)
    await context.tx
      .$queryRaw`SELECT id FROM bookings WHERE id = ${hint.bookingId}::uuid FOR UPDATE NOWAIT`;
  if (hint.visitId)
    await context.tx
      .$queryRaw`SELECT id FROM visits WHERE id = ${hint.visitId}::uuid FOR UPDATE NOWAIT`;
  let lines = await reassignmentScope(context.tx, kind, id, input.scope);
  for (const line of [...lines].sort((a, b) => a.view.id.localeCompare(b.view.id))) {
    if (kind === 'BOOKING')
      await context.tx
        .$queryRaw`SELECT id FROM booking_service_lines WHERE id = ${line.view.id}::uuid FOR UPDATE NOWAIT`;
    else
      await context.tx
        .$queryRaw`SELECT id FROM visit_service_lines WHERE id = ${line.view.id}::uuid FOR UPDATE NOWAIT`;
  }
  lines = await reassignmentScope(context.tx, kind, id, input.scope);
  const [clock] = await context.tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  context = { ...context, now: clock.now };
  await requireScope(context, lines);
  const versions = new Map(input.targets.map((line) => [line.id, line.expectedVersion]));
  if (
    versions.size !== input.targets.length ||
    versions.size !== lines.length ||
    lines.some(
      (line) =>
        versions.get(line.view.id) !== line.view.version ||
        !lockedUsers.has(line.view.employee.id) ||
        (line.ownerId !== null && !lockedUsers.has(line.ownerId)),
    )
  )
    throw new AuthError('REASSIGNMENT_CONFLICT');
  if (!lockedUsers.has(input.employeeUserId)) throw new AuthError('REASSIGNMENT_CONFLICT');
  if (lines.some((line) => line.view.employee.id === input.employeeUserId))
    throw new AuthError('REASSIGNMENT_NOT_ALLOWED');
  if (lines.some((line) => line.view.assignmentMode === 'SPECIFIC') && !input.acknowledgeSpecific)
    throw new AuthError('REASSIGNMENT_SPECIFIC_ACK_REQUIRED');
  if (input.context === 'LEAVE' && !lines.some((line) => line.view.leaveConflict))
    throw new AuthError('REASSIGNMENT_CONFLICT');
  const evaluation = await evaluateScope(context, lines, [input.employeeUserId]);
  if (
    evaluation.reasons.length > 0 ||
    !evaluation.lines.every((line) => line.eligibleEmployeeUserIds.includes(input.employeeUserId))
  )
    throw new AuthError('REASSIGNMENT_KTV_UNAVAILABLE');
  const { tx, now } = context;
  for (const line of lines) {
    const data = {
      employeeUserId: input.employeeUserId,
      assignmentConflict: null,
      rowVersion: { increment: 1 },
    };
    if (kind === 'BOOKING')
      await tx.bookingServiceLine.update({ where: { id: line.view.id }, data });
    else await tx.visitServiceLine.update({ where: { id: line.view.id }, data });
    await tx.serviceLineAssignmentChange.create({
      data: {
        ...(kind === 'BOOKING'
          ? { bookingServiceLineId: line.view.id }
          : { visitServiceLineId: line.view.id }),
        fromEmployeeUserId: line.view.employee.id,
        toEmployeeUserId: input.employeeUserId,
        actorUserId: context.actor.userId,
        reason: input.context,
        note: input.reason,
        occurredAt: now,
      },
    });
    const facts = {
      lineKind: kind,
      lineId: line.view.id,
      bookingId: line.bookingId,
      visitId: line.visitId,
      fromEmployeeUserId: line.view.employee.id,
      toEmployeeUserId: input.employeeUserId,
      assignmentMode: line.view.assignmentMode,
      requestedEmployeeId: line.view.requestedEmployeeId,
      context: input.context,
      leaveRequestId: line.view.leaveRequestId,
    };
    await appendAdminAudit(context, {
      action: 'KTV_REASSIGNED',
      entityType: kind === 'BOOKING' ? 'BookingServiceLine' : 'VisitServiceLine',
      entityId: line.view.id,
      branchId: line.view.branchId,
      reason: input.reason,
      before: { employeeUserId: line.view.employee.id, version: line.view.version },
      after: {
        ...facts,
        version: line.view.version + 1,
        acknowledgedSpecific: input.acknowledgeSpecific,
      },
    });
    await appendOutboxEvent(tx, {
      branchId: line.view.branchId,
      aggregateType: kind === 'BOOKING' ? 'Booking' : 'Visit',
      aggregateId: line.view.parentId,
      eventType: 'KTV_REASSIGNED',
      schemaVersion: 1,
      occurredAt: now,
      payload: { ...facts, actorUserId: context.actor.userId },
    });
  }
  return {
    lines: await Promise.all(
      lines.map(async (line) => (await loadReassignmentLine(tx, kind, line.view.id)).view),
    ),
  };
}

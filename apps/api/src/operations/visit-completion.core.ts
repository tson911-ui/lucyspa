import type {
  CancelledServiceLineResponse,
  ResolvedServiceExecutionResponse,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { settleVisitAfterLineChange } from './service-execution.core.js';

/** Authorization is decided at transaction time for the record's own branch. */
export type BranchCheck = (branchId: string) => void;

const select = {
  id: true,
  visitId: true,
  status: true,
  employeeUserId: true,
  cancelledByUserId: true,
  visit: { select: { id: true, code: true, branchId: true, status: true } },
  execution: true,
} satisfies Prisma.VisitServiceLineSelect;

/**
 * Locks in the existing execution order (the admin frame already holds the actor and the performer
 * user rows): visit `NOWAIT` (a contending START/END/assignment rolls back as a retryable conflict
 * instead of inverting the visit -> candidate-user order), then the line, then its execution. The
 * time is sampled from the database clock only after the locks, never from the client.
 */
async function lockAndSample(context: AdminContext, lineId: string, visitId: string) {
  const { tx } = context;
  await tx.$queryRaw`SELECT id FROM visits WHERE id = ${visitId}::uuid FOR UPDATE NOWAIT`;
  await tx.$queryRaw`SELECT id FROM visit_service_lines WHERE id = ${lineId}::uuid FOR UPDATE`;
  await tx.$queryRaw`
    SELECT id FROM service_executions WHERE visit_service_line_id = ${lineId}::uuid FOR UPDATE`;
  const [clock] = await tx.$queryRaw<
    { now: Date }[]
  >`SELECT clock_timestamp()::timestamptz(3) AS now`;
  if (!clock) throw new AuthError('SERVICE_UNAVAILABLE');
  return { ...context, now: clock.now } satisfies AdminContext;
}

function resolvedResponse(
  line: {
    id: string;
    visit: { id: string; code: string; status: string };
  },
  execution: {
    id: string;
    employeeUserId: string;
    startedAt: Date;
    endedAt: Date;
  },
): ResolvedServiceExecutionResponse {
  return {
    lineId: line.id,
    visitId: line.visit.id,
    visitCode: line.visit.code,
    visitStatus: line.visit.status === 'COMPLETED' ? 'COMPLETED' : 'IN_SERVICE',
    executionId: execution.id,
    employeeUserId: execution.employeeUserId,
    startedAt: execution.startedAt.toISOString(),
    endedAt: execution.endedAt.toISOString(),
    endKind: 'MANAGER_RESOLVED',
  };
}

/**
 * Management resolution of a forgotten END (PRD 13.4, Phase 3 design section 11). The ordinary
 * START/END workflow is unchanged; this is the controlled exception.
 *
 * - Authority: `RESOLVE_SERVICE_EXECUTION` at the visit's own branch (`authorize`), decided inside
 *   the transaction. The performer never resolves their own execution (normal END is their path),
 *   mirroring the repository's no-self-decision rule for leave, attendance corrections and credentials.
 * - Eligibility: an execution that is still IN_PROGRESS on an IN_PROGRESS line of an IN_SERVICE
 *   visit. Nothing else can be resolved; `startedAt` and the planned times are never touched.
 * - `endedAt` (optional, default the server clock) must satisfy startedAt <= endedAt <= server clock
 *   sampled after the locks. It is the only caller-influenced time; a reason is required.
 * - Serialization: performer and actor user rows (admin frame), visit `NOWAIT`, line, execution. A
 *   normal END racing this command, or a second resolution, ends up with one winner; the loser is a
 *   retryable conflict or finds the execution ended.
 * - Replay: the same actor repeating a resolution that already happened gets the original outcome with
 *   no second write, audit or event; any other already-ended execution is refused.
 * - Completion uses the same shared rule as a normal END. One SERVICE_ENDED event is appended (the
 *   logical END happened once); the correction is captured by the SERVICE_EXECUTION_RESOLVED audit.
 */
export async function resolveServiceExecution(
  context: AdminContext,
  lineId: string,
  input: { reason: string; endedAt: Date | null },
  authorize: BranchCheck,
): Promise<ResolvedServiceExecutionResponse> {
  const hint = await context.tx.visitServiceLine.findUnique({ where: { id: lineId }, select });
  if (!hint) throw new AuthError('NOT_FOUND');
  authorize(hint.visit.branchId);
  if (hint.employeeUserId === context.actor.userId) throw new AuthError('FORBIDDEN');

  const locked = await lockAndSample(context, lineId, hint.visitId);
  const { tx, now } = locked;
  const line = await tx.visitServiceLine.findUniqueOrThrow({ where: { id: lineId }, select });
  const execution = line.execution;
  if (!execution) throw new AuthError('SERVICE_RESOLUTION_NOT_ALLOWED');
  if (execution.status === 'ENDED') {
    if (
      execution.endKind === 'MANAGER_RESOLVED' &&
      execution.endedByUserId === context.actor.userId &&
      execution.endedAt
    ) {
      return resolvedResponse(line, { ...execution, endedAt: execution.endedAt });
    }
    throw new AuthError('SERVICE_RESOLUTION_NOT_ALLOWED');
  }
  if (line.status !== 'IN_PROGRESS' || line.visit.status !== 'IN_SERVICE') {
    throw new AuthError('SERVICE_RESOLUTION_NOT_ALLOWED');
  }
  const endedAt = input.endedAt ?? now;
  if (endedAt < execution.startedAt || endedAt > now) {
    throw new AuthError('VALIDATION_FAILED', 'endedAt');
  }

  await tx.serviceExecution.update({
    where: { id: execution.id },
    data: {
      status: 'ENDED',
      endedAt,
      endKind: 'MANAGER_RESOLVED',
      endedByUserId: context.actor.userId,
      resolutionReason: input.reason,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await tx.visitServiceLine.update({
    where: { id: line.id },
    data: { status: 'DONE', rowVersion: { increment: 1 } },
    select: { id: true },
  });
  const visitStatus = await settleVisitAfterLineChange(tx, line.visit, now, context.actor.userId);

  const facts = {
    visitId: line.visitId,
    serviceLineId: line.id,
    executionId: execution.id,
    employeeUserId: execution.employeeUserId,
    startedAt: execution.startedAt.toISOString(),
    endedAt: endedAt.toISOString(),
    endKind: 'MANAGER_RESOLVED',
    endedByUserId: context.actor.userId,
    visitStatus: visitStatus === 'COMPLETED' ? 'COMPLETED' : 'IN_SERVICE',
  };
  await appendAdminAudit(locked, {
    action: 'SERVICE_EXECUTION_RESOLVED',
    entityType: 'ServiceExecution',
    entityId: execution.id,
    subjectUserId: execution.employeeUserId,
    branchId: line.visit.branchId,
    reason: input.reason,
    before: {
      lineStatus: 'IN_PROGRESS',
      executionStatus: 'IN_PROGRESS',
      visitStatus: line.visit.status,
      startedAt: execution.startedAt.toISOString(),
      expectedEndAt: execution.expectedEndAt.toISOString(),
    },
    after: {
      ...facts,
      lineStatus: 'DONE',
      executionStatus: 'ENDED',
      resolvedAt: now.toISOString(),
    },
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
  return resolvedResponse(
    { id: line.id, visit: { ...line.visit, status: visitStatus } },
    {
      id: execution.id,
      employeeUserId: execution.employeeUserId,
      startedAt: execution.startedAt,
      endedAt,
    },
  );
}

/**
 * Cancels ONE unperformed service line of an open visit (the customer no longer wants it). The
 * line is kept (status CANCELLED with server-time `cancelledAt`, the actor and the required
 * reason); nothing is deleted and no performed history is touched.
 *
 * - Authority: `MANAGE_BOOKINGS` at the visit's branch, the permission that already covers
 *   walk-in intake, assignment and walk-in cancellation (Phase 3 design, O8).
 * - Eligibility: the line is WAITING or PLANNED with no execution row, and its visit is OPEN or
 *   IN_SERVICE. A started or performed line, a cancelled line by someone else, and a COMPLETED or
 *   CANCELLED visit are refused; a completed visit is never reopened or mutated.
 * - Effects: the existing database trigger releases the KTV occupancy of a PLANNED line; a cancelled
 *   line no longer blocks the participant's sequence; the shared completion rule then completes
 *   the visit (something was performed) or cancels it (every line cancelled before any start).
 * - Serialization: line KTV user row (admin frame), visit `NOWAIT`, line, execution. START takes
 *   the same order, so START and cancellation can never both win.
 * - Replay: the same actor repeating the cancellation gets the original outcome, without a second
 *   write or audit.
 * No outbox event is defined for it (consistent with cancelling a waiting walk-in); the audit
 * record is the history.
 */
export async function cancelServiceLine(
  context: AdminContext,
  lineId: string,
  reason: string,
  authorize: BranchCheck,
): Promise<CancelledServiceLineResponse> {
  const hint = await context.tx.visitServiceLine.findUnique({ where: { id: lineId }, select });
  if (!hint) throw new AuthError('NOT_FOUND');
  authorize(hint.visit.branchId);

  const locked = await lockAndSample(context, lineId, hint.visitId);
  const { tx, now } = locked;
  const line = await tx.visitServiceLine.findUniqueOrThrow({ where: { id: lineId }, select });
  const response = (visitStatus: CancelledServiceLineResponse['visitStatus']) => ({
    lineId: line.id,
    visitId: line.visit.id,
    visitCode: line.visit.code,
    visitStatus,
  });
  if (line.status === 'CANCELLED') {
    if (line.cancelledByUserId === context.actor.userId) {
      return response(line.visit.status as CancelledServiceLineResponse['visitStatus']);
    }
    throw new AuthError('SERVICE_LINE_CANCEL_NOT_ALLOWED');
  }
  if (
    line.execution ||
    (line.status !== 'WAITING' && line.status !== 'PLANNED') ||
    (line.visit.status !== 'OPEN' && line.visit.status !== 'IN_SERVICE')
  ) {
    throw new AuthError('SERVICE_LINE_CANCEL_NOT_ALLOWED');
  }

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
  const visitStatus = await settleVisitAfterLineChange(
    tx,
    line.visit,
    now,
    context.actor.userId,
    reason,
  );
  await appendAdminAudit(locked, {
    action: 'VISIT_LINE_CANCELLED',
    entityType: 'VisitServiceLine',
    entityId: line.id,
    subjectUserId: line.employeeUserId,
    branchId: line.visit.branchId,
    reason,
    before: { lineStatus: line.status, visitStatus: line.visit.status },
    after: {
      lineStatus: 'CANCELLED',
      visitId: line.visitId,
      visitStatus,
      cancelledAt: now.toISOString(),
    },
  });
  return response(visitStatus);
}

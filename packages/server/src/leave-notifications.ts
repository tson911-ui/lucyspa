import type { NotificationParams } from '@lucy-spa/contracts';
import { parseNotificationParams } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { takeSharedAuthGraphLock } from './auth-lock.js';
import {
  isLeaveEventType,
  LEAVE_AGGREGATE,
  LEAVE_DECIDED_EVENT,
  LEAVE_REQUESTED_EVENT,
  parseLeaveEventPayload,
  type LeaveDecidedPayload,
} from './leave-events.js';
import { branchBusinessDate, resolveSupervisorRecipients } from './notification-routing.js';

/**
 * - `PUBLISHED`: recipients were persisted and the event marked consumed.
 * - `SKIPPED`: the event no longer applies (request already decided or cancelled); consumed, no rows.
 * - `UNROUTABLE`: nobody could be reached (not even the Owner); consumed, no rows. Worth logging.
 * - `NOT_CLAIMED`: already consumed or locked by another worker; nothing changed.
 * - `IGNORED`: not a Leave notification event; untouched (left for its own consumer).
 */
export type LeaveEventOutcome = 'PUBLISHED' | 'SKIPPED' | 'UNROUTABLE' | 'NOT_CLAIMED' | 'IGNORED';

export interface LeaveNotificationDependencies {
  /** Injectable only so failure handling can be tested; production uses the real resolver. */
  readonly resolve?: typeof resolveSupervisorRecipients;
}

const day = (value: Date) => value.toISOString().slice(0, 10);

/**
 * Consumes ONE Leave outbox event inside the caller's transaction:
 *
 * 1. shared authorization-graph lock (as Phase 3 delivery does), then claim the row with
 *    `FOR UPDATE SKIP LOCKED` while `published_at IS NULL`;
 * 2. validate type, schema version and payload strictly; read dates/type from the LeaveRequest;
 * 3. LEAVE_REQUESTED -> managers from `resolveSupervisorRecipients` (lowest eligible level, all
 *    same-level peers, escalation, Owner last), the requester never included, using the same
 *    branch set Leave approval authorizes against; LEAVE_DECIDED -> the employee only;
 * 4. insert the inbox rows (`skipDuplicates`, so `unique(source_event_id, recipient_user_id)` makes a
 *    re-run harmless and never resets read state);
 * 5. mark the event consumed LAST.
 *
 * Any throw leaves nothing behind: the caller's transaction rolls back and the event stays pending
 * for retry. Only Leave events on the `LeaveRequest` aggregate are ever touched, so the Phase 3
 * booking relay and this consumer never claim each other's rows.
 */
export async function processLeaveEvent(
  tx: Prisma.TransactionClient,
  eventId: string,
  dependencies: LeaveNotificationDependencies = {},
): Promise<LeaveEventOutcome> {
  await takeSharedAuthGraphLock(tx);
  const claimed = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM outbox_events WHERE id = ${eventId}::uuid AND published_at IS NULL FOR UPDATE SKIP LOCKED`;
  if (claimed.length === 0) return 'NOT_CLAIMED';
  const event = await tx.outboxEvent.findUniqueOrThrow({ where: { id: eventId } });
  if (event.aggregateType !== LEAVE_AGGREGATE || !isLeaveEventType(event.eventType)) {
    return 'IGNORED';
  }
  if (event.schemaVersion !== 1) throw new Error('Unsupported leave event version');
  const payload = parseLeaveEventPayload(event.eventType, event.payload);
  const leave = await tx.leaveRequest.findUnique({
    where: { id: event.aggregateId },
    select: {
      id: true,
      employeeUserId: true,
      startDate: true,
      endDate: true,
      leaveType: true,
      status: true,
      employee: { select: { employeeCodeCanonical: true } },
    },
  });
  if (!leave || leave.employeeUserId !== payload.employeeUserId) {
    throw new Error('Leave event does not match its request');
  }
  const consume = async (outcome: LeaveEventOutcome) => {
    await tx.outboxEvent.update({ where: { id: eventId }, data: { publishedAt: new Date() } });
    return outcome;
  };
  const deliver = async (
    type: 'LEAVE_REQUESTED' | 'LEAVE_DECIDED',
    recipients: readonly string[],
    params: NotificationParams,
  ) => {
    await tx.notification.createMany({
      skipDuplicates: true,
      data: recipients.map((recipientUserId) => ({
        recipientUserId,
        sourceEventId: event.id,
        branchId: null,
        type,
        entityType: 'LeaveRequest',
        entityId: leave.id,
        contextCode: leave.employee.employeeCodeCanonical,
        actionAt: event.occurredAt,
        params: params as unknown as Prisma.InputJsonObject,
      })),
    });
  };
  const facts = {
    startDate: day(leave.startDate),
    endDate: day(leave.endDate),
    leaveType: leave.leaveType,
  };

  if (event.eventType === LEAVE_REQUESTED_EVENT) {
    // Nothing left to handle once the request is decided or cancelled.
    if (leave.status !== 'PENDING') return consume('SKIPPED');
    // The same set Leave approval authorizes against (non-revoked assignments).
    const branchIds = (
      await tx.employeeBranchAssignment.findMany({
        where: { employeeUserId: leave.employeeUserId, revokedAt: null },
        select: { branchId: true },
        orderBy: { branchId: 'asc' },
      })
    ).map((row) => row.branchId);
    const routing = await (dependencies.resolve ?? resolveSupervisorRecipients)(tx, {
      subjectUserId: leave.employeeUserId,
      permission: 'APPROVE_LEAVE',
      branchIds,
      exclude: [leave.employeeUserId],
    });
    if (routing.recipients.length === 0) return consume('UNROUTABLE');
    await deliver(
      'LEAVE_REQUESTED',
      routing.recipients,
      parseNotificationParams('LEAVE_REQUESTED', {
        subjectUserId: leave.employeeUserId,
        ...facts,
      })!,
    );
    return consume('PUBLISHED');
  }

  // LEAVE_DECIDED: only the employee, only for the decision that is actually recorded.
  const decision = (payload as LeaveDecidedPayload).decision;
  if (event.eventType !== LEAVE_DECIDED_EVENT || leave.status !== decision) {
    return consume('SKIPPED');
  }
  const employee = await tx.user.findUnique({
    where: { id: leave.employeeUserId },
    select: { status: true },
  });
  if (employee?.status !== 'ACTIVE') return consume('SKIPPED');
  const branches = (
    await tx.employeeBranchAssignment.findMany({
      where: { employeeUserId: leave.employeeUserId, revokedAt: null },
      select: { branchId: true },
    })
  ).map((row) => row.branchId);
  const employment = await tx.employmentClassificationChange.findFirst({
    where: {
      employeeUserId: leave.employeeUserId,
      effectiveDate: { lte: await branchBusinessDate(tx, branches) },
    },
    orderBy: { effectiveDate: 'desc' },
    select: { classification: true },
  });
  if (!employment || employment.classification === 'ENDED') return consume('SKIPPED');
  await deliver(
    'LEAVE_DECIDED',
    [leave.employeeUserId],
    parseNotificationParams('LEAVE_DECIDED', { decision, ...facts })!,
  );
  return consume('PUBLISHED');
}

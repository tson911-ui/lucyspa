import type { OutboxEvent, Prisma } from '@lucy-spa/database';
import { decide, loadAuthorityGraph } from '@lucy-spa/server';

export type InboxType = 'BOOKING_CREATED' | 'BOOKING_CANCELLED' | 'LATE_CANCELLATION'
  | 'BOOKING_NO_SHOW' | 'CUSTOMER_ARRIVED' | 'BOOKING_KTV_CONFLICT' | 'KTV_REASSIGNED'
  | 'START_OVERDUE' | 'PRE_END' | 'END_OVERDUE';
const MANAGEMENT = ['MANAGE_QUEUE', 'MANAGE_BOOKINGS'] as const;

/** Caller holds the shared authorization graph lock. No role-name or display-group checks. */
export async function operationalRecipients(
  tx: Prisma.TransactionClient, branchId: string, employeeIds: readonly string[], management: boolean,
): Promise<string[]> {
  const [branch] = await tx.$queryRaw<{ day: Date }[]>`
    SELECT (clock_timestamp() AT TIME ZONE timezone)::date AS day
    FROM branches WHERE id = ${branchId}::uuid AND is_active`;
  if (!branch) return [];
  const candidates = await tx.user.findMany({
    where: { status: 'ACTIVE', OR: [
      { id: { in: [...employeeIds] }, kind: 'EMPLOYEE' },
      ...(management ? [
        { kind: 'OWNER' as const },
        { kind: 'EMPLOYEE' as const, roleAssignments: { some: { role: { isActive: true,
          permissions: { some: { permission: { code: { in: [...MANAGEMENT] } } } },
        } } } },
        { kind: 'EMPLOYEE' as const, permissionOverrides: { some: {
          effect: 'ALLOW' as const, permission: { code: { in: [...MANAGEMENT] } },
        } } },
      ] : []),
    ] }, select: { id: true }, orderBy: { id: 'asc' },
  });
  const recipients: string[] = [];
  for (const candidate of candidates) {
    // NOWAIT avoids inversions with source commands that lock users before visit rows.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${candidate.id}::uuid FOR SHARE NOWAIT`;
    const user = await tx.user.findUnique({ where: { id: candidate.id }, select: { kind: true, status: true } });
    if (user?.status !== 'ACTIVE') continue;
    const graph = await loadAuthorityGraph(tx, candidate.id);
    if (!graph) continue;
    if (user.kind === 'EMPLOYEE') {
      const employment = await tx.employmentClassificationChange.findFirst({
        where: { employeeUserId: candidate.id, effectiveDate: { lte: branch.day } },
        orderBy: { effectiveDate: 'desc' }, select: { classification: true },
      });
      if (!employment || employment.classification === 'ENDED') continue;
    }
    const target = { kind: 'BRANCH', branchId } as const;
    const manager = management && MANAGEMENT.some((permission) => decide(graph, permission, target));
    const performer = employeeIds.includes(candidate.id) && graph.activeBranchIds.has(branchId)
      && decide(graph, 'PERFORM_SERVICES', target);
    if (manager || performer) recipients.push(candidate.id);
  }
  return recipients;
}

export async function deliverInbox(
  tx: Prisma.TransactionClient, event: OutboxEvent,
  source: { type: 'Booking' | 'Visit'; id: string; code: string },
  recipients: readonly { id: string; type: InboxType }[],
) {
  if (!event.branchId || recipients.length === 0) return;
  // INSERT ON CONFLICT DO NOTHING: an already-read notification can never become unread on retry.
  await tx.notification.createMany({ skipDuplicates: true, data: recipients.map((recipient) => ({
    recipientUserId: recipient.id, sourceEventId: event.id, branchId: event.branchId!,
    type: recipient.type, entityType: source.type, entityId: source.id,
    contextCode: source.code, actionAt: event.occurredAt,
  })) });
}

export function eventPayload(event: OutboxEvent): Record<string, Prisma.JsonValue> {
  return event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};
}

/** Only approved booking/visit messages; not a generic notify-every-event consumer. */
export async function consumeBookingNotification(tx: Prisma.TransactionClient, event: OutboxEvent) {
  const type = event.eventType;
  if (!['BOOKING_CREATED', 'BOOKING_CANCELLED', 'BOOKING_NO_SHOW', 'CUSTOMER_ARRIVED',
    'BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED'].includes(type) || !event.branchId) return;
  const payload = eventPayload(event);
  const booking = event.aggregateType === 'Booking' ? await tx.booking.findUnique({
    where: { id: event.aggregateId }, include: { lines: { select: { employeeUserId: true } }, visit: { select: { id: true } } },
  }) : null;
  const visit = event.aggregateType === 'Visit' ? await tx.visit.findUnique({
    where: { id: event.aggregateId }, include: { lines: { select: { employeeUserId: true } } },
  }) : null;
  const source = booking ? { type: 'Booking' as const, id: booking.id, code: booking.code }
    : visit ? { type: 'Visit' as const, id: visit.id, code: visit.code } : null;
  if (!source || (booking?.branchId ?? visit?.branchId) !== event.branchId) return;
  const late = type === 'BOOKING_CANCELLED' && payload.actor === 'CUSTOMER' && payload.late === true;
  const management = late || type === 'BOOKING_KTV_CONFLICT' || type === 'KTV_REASSIGNED';
  let employeeIds = (booking?.lines ?? visit?.lines ?? []).flatMap((line) => line.employeeUserId ? [line.employeeUserId] : []);
  if (type === 'KTV_REASSIGNED') {
    employeeIds = [payload.fromEmployeeUserId, payload.toEmployeeUserId].filter((id): id is string => typeof id === 'string');
  }
  if (type === 'BOOKING_KTV_CONFLICT') employeeIds = []; // customers + operations resolve the conflict
  const recipients = new Map<string, InboxType>();
  for (const id of await operationalRecipients(tx, event.branchId, employeeIds, false)) recipients.set(id, type as InboxType);
  if (management) {
    for (const id of await operationalRecipients(tx, event.branchId, [], true)) recipients.set(id, late ? 'LATE_CANCELLATION' : type as InboxType);
  }
  const customerIds = new Set([booking?.ownerUserId ?? visit?.ownerUserId].filter((id): id is string => Boolean(id)));
  if (visit && typeof payload.lineId === 'string' && ['BOOKING_KTV_CONFLICT', 'KTV_REASSIGNED'].includes(type)) {
    const line = await tx.visitServiceLine.findFirst({ where: { id: payload.lineId, visitId: visit.id },
      select: { participant: { select: { customerUserId: true, guardian: { select: { customerUserId: true } } } } } });
    const member = line?.participant.customerUserId ?? line?.participant.guardian?.customerUserId;
    if (member) customerIds.add(member);
  }
  if (type !== 'CUSTOMER_ARRIVED') {
    for (const id of customerIds) {
      const customer = await tx.user.findFirst({ where: { id, kind: 'CUSTOMER', status: 'ACTIVE' }, select: { id: true } });
      if (customer) recipients.set(customer.id, type as InboxType);
    }
  }
  await deliverInbox(tx, event, source, [...recipients].map(([id, notificationType]) => ({ id, type: notificationType })));
}

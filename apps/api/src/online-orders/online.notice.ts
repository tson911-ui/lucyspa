import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';

type Tx = Prisma.TransactionClient;

export type MemberNoticeType =
  | 'ONLINE_ORDER_SHIPPED'
  | 'ONLINE_ORDER_DELIVERED'
  | 'ONLINE_ORDER_DELIVERY_FAILED'
  | 'ONLINE_ORDER_CANCELLED'
  | 'ONLINE_ORDER_REFUNDED';

/**
 * Phase 6 Wave 4 (OQ-101, approved 2026-10-09): the member is told IN THE APP about their online order (no e-mail: the system has no
 * transactional e-mail yet). The notice is about the member's own invoice (that is where the order page is) and carries the order code
 * as its context; it never carries an address, a phone number, a tracking code, a reason or a name. `eventKey` names the change that
 * is announced (the order and what happened); the commands write a notice only when the change itself happens, so a repeat of a command
 * that finds the change already made writes none.
 *
 * Written in the transaction of the command that made the change: there is no relay step, so the change cannot happen without the notice.
 */
export async function tellMember(
  tx: Tx,
  notice: {
    type: MemberNoticeType;
    userId: string;
    branchId: string;
    invoiceId: string;
    orderCode: string;
    eventKey: string;
    params?: Prisma.InputJsonObject;
  },
): Promise<boolean> {
  const event = await appendOutboxEvent(tx, {
    branchId: notice.branchId,
    aggregateType: 'ProductOrder',
    aggregateId: notice.eventKey,
    eventType: notice.type,
    schemaVersion: 1,
    payload: { entityId: notice.invoiceId },
  });
  // Consumed in this same transaction: no relay has anything left to do with the event.
  await tx.outboxEvent.update({ where: { id: event.id }, data: { publishedAt: event.occurredAt } });
  const created = await tx.notification.createMany({
    skipDuplicates: true,
    data: [
      {
        recipientUserId: notice.userId,
        sourceEventId: event.id,
        branchId: notice.branchId,
        type: notice.type,
        entityType: 'Invoice',
        entityId: notice.invoiceId,
        contextCode: notice.orderCode,
        actionAt: event.occurredAt,
        ...(notice.params ? { params: notice.params } : {}),
      },
    ],
  });
  return created.count > 0;
}

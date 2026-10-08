import type { AllocatedLine } from '@lucy-spa/server';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';

type Tx = Prisma.TransactionClient;

/**
 * Phase 6 P6-17 (OQ-34, approved 2026-10-07): the member is told in-app when the goods of a pre-order arrive. The notice is about the
 * member's own invoice (that is where the ticket is) and carries the order code as its context; no phone number, no name, no product.
 * A customer without an account has no inbox: the staff call the phone number of the order (the list shows it). The EMAIL half of
 * OQ-34 is not built: the system has no transactional-email facility yet (its email code carries sign-in codes only); see the report.
 *
 * Written in the transaction that made the goods arrive (a receipt, the allocation of a sweep): there is no relay step, so the goods
 * cannot arrive without the notice. A repeat writes nothing (the notification key is the event of the line).
 */
export async function tellMembersGoodsArrived(
  tx: Tx,
  arrived: readonly AllocatedLine[],
): Promise<number> {
  let told = 0;
  for (const line of arrived) {
    const order = await tx.productOrder.findUnique({
      where: { id: line.orderId },
      select: {
        code: true,
        branchId: true,
        invoiceId: true,
        customerUserId: true,
      },
    });
    if (!order?.customerUserId) continue;
    const event = await appendOutboxEvent(tx, {
      branchId: order.branchId,
      aggregateType: 'ProductOrder',
      aggregateId: line.orderLineId,
      eventType: 'PRODUCT_ORDER_ARRIVED',
      schemaVersion: 1,
      payload: { entityId: order.invoiceId },
    });
    // Consumed in this same transaction: no relay has anything left to do with the event.
    await tx.outboxEvent.update({
      where: { id: event.id },
      data: { publishedAt: event.occurredAt },
    });
    const created = await tx.notification.createMany({
      skipDuplicates: true,
      data: [
        {
          recipientUserId: order.customerUserId,
          sourceEventId: event.id,
          branchId: order.branchId,
          type: 'PRODUCT_ORDER_ARRIVED',
          entityType: 'Invoice',
          entityId: order.invoiceId,
          contextCode: order.code,
          actionAt: event.occurredAt,
        },
      ],
    });
    told += created.count;
  }
  return told;
}

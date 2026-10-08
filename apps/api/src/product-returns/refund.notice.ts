import {
  parseNotificationParams,
  type ProductRefundMadeParams,
  type ProductRefundMethodName,
} from '@lucy-spa/contracts';
import { appendOutboxEvent, type Prisma } from '@lucy-spa/database';

type Tx = Prisma.TransactionClient;

/**
 * Phase 6 P6-13 follow-up (Owner, 2026-10-08): every product refund tells the Owner in-app: invoice, product, quantity, amount, method
 * and who refunded. P6-14 uses the same notice for the money a cheaper exchange hands back.
 *
 * The recipients are resolved and their user rows locked by the caller BEFORE the invoice and stock rows (the same lock order as the
 * return-case notice), so a notice never waits for a user row that another command holds while it waits for our invoice. The notice is
 * written in the SAME transaction as the refund: there is no relay step, so the refund cannot commit without it.
 */

/** The accounts of the Owner (the only accounts that are told). Sorted, so the user rows are locked in a fixed order. */
export async function ownerRecipients(tx: Tx): Promise<readonly string[]> {
  const owners = await tx.user.findMany({
    where: { kind: 'OWNER', status: 'ACTIVE' },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  return owners.map((owner) => owner.id);
}

/** A person's name as the plain text of a notice: no control or format characters, at most 64 characters. */
export function noticeName(fullName: string): string {
  const clean = fullName
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const cut = Array.from(clean).slice(0, 64).join('').trim();
  return cut === '' ? '-' : cut;
}

export interface RefundNoticeInput {
  branchId: string;
  caseId: string;
  caseCode: string;
  recipients: readonly string[];
  source: ProductRefundMadeParams['source'];
  invoiceCode: string;
  sku: string;
  quantity: number;
  amountVnd: bigint;
  method: ProductRefundMethodName;
  refundedByName: string;
}

export async function tellOwnerAboutRefund(tx: Tx, input: RefundNoticeInput): Promise<void> {
  if (input.recipients.length === 0) return;
  const params = parseNotificationParams('PRODUCT_REFUND_MADE', {
    source: input.source,
    invoiceCode: input.invoiceCode,
    sku: input.sku,
    quantity: input.quantity,
    amountVnd: input.amountVnd.toString(),
    method: input.method,
    refundedBy: noticeName(input.refundedByName),
  });
  const outbox = await appendOutboxEvent(tx, {
    branchId: input.branchId,
    aggregateType: 'ProductReturnCase',
    aggregateId: input.caseId,
    eventType: 'PRODUCT_REFUND_MADE',
    schemaVersion: 1,
    payload: { entityId: input.caseId },
  });
  // Written here, in this transaction: no relay has anything left to do with the event.
  await tx.outboxEvent.update({
    where: { id: outbox.id },
    data: { publishedAt: outbox.occurredAt },
  });
  await tx.notification.createMany({
    skipDuplicates: true,
    data: input.recipients.map((recipientUserId) => ({
      recipientUserId,
      sourceEventId: outbox.id,
      branchId: input.branchId,
      type: 'PRODUCT_REFUND_MADE',
      entityType: 'ProductReturnCase',
      entityId: input.caseId,
      contextCode: input.caseCode,
      actionAt: outbox.occurredAt,
      ...(params === null ? {} : { params: params as unknown as Prisma.InputJsonObject }),
    })),
  });
}

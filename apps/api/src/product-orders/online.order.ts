import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 6 Wave 4 (P6-19; design 2.38; T41, OQ-93, OQ-103): the goods record of an ONLINE order, written by the finalization of its invoice
 * (still a DRAFT, like a stock reservation). One order, one order line for EVERY product line (in stock or pre-order), all AWAITING_PAYMENT;
 * the delivery details of the customer are frozen with it. The database moves the lines with the invoice (PAID, CANCELLED) and keeps
 * every other rule (SQL guards of migration 20261121000001).
 *
 * The recipient's name and phone are personal data: they are written to the order, never to the audit trail or a notification.
 */
export interface OnlineFinalizeInput {
  recipientName: string;
  /** Canonical +84 form. */
  recipientPhone: string;
  provinceCode: string;
  provinceName: string;
  ward: string;
  street: string;
  /** The deadline of the unpaid order (database clock at checkout + the timeout of the settings). */
  deadlineAt: Date;
  policyVersion: number;
  acceptedAt: Date;
  clientRequestId: string;
}

/** The code the customer and the staff quote for an online order: `ON` + six digits (the counter pre-order is `DT`). */
export const ONLINE_ORDER_CODE = /^ON[0-9]{6,}$/;

export async function createOnlineOrderForFinalization(
  context: AdminContext,
  invoice: { id: string; branchId: string; payerUserId: string | null },
  input: OnlineFinalizeInput,
): Promise<{ id: string; code: string }> {
  const { tx } = context;
  if (invoice.payerUserId === null || invoice.payerUserId !== context.actor.userId) {
    throw new AuthError('FORBIDDEN');
  }
  const details = await tx.invoiceLineProduct.findMany({
    where: { invoiceId: invoice.id },
    select: {
      invoiceLineId: true,
      variantId: true,
      fulfilmentMode: true,
      line: { select: { quantity: true, sequence: true } },
    },
    orderBy: { line: { sequence: 'asc' } },
  });
  if (details.length === 0) throw new AuthError('INVOICE_NOT_READY');
  const lines = details.map((detail) => {
    if (detail.line.quantity === null) throw new AuthError('INVOICE_NOT_READY');
    return { ...detail, quantity: detail.line.quantity };
  });
  const [seq] = await tx.$queryRaw<
    { n: string }[]
  >`SELECT nextval('product_order_code_seq')::text AS n`;
  if (!seq) throw new AuthError('SERVICE_UNAVAILABLE');
  const code = `ON${seq.n.padStart(6, '0')}`;
  const order = await tx.productOrder.create({
    data: {
      code,
      invoiceId: invoice.id,
      branchId: invoice.branchId,
      channel: 'ONLINE',
      customerUserId: invoice.payerUserId,
      contactPhone: input.recipientPhone,
      contactName: input.recipientName,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  for (const line of lines) {
    await tx.productOrderLine.create({
      data: {
        orderId: order.id,
        invoiceId: invoice.id,
        invoiceLineId: line.invoiceLineId,
        branchId: invoice.branchId,
        variantId: line.variantId,
        quantity: line.quantity,
      },
      select: { id: true },
    });
  }
  await tx.onlineOrderDetail.create({
    data: {
      orderId: order.id,
      recipientName: input.recipientName,
      recipientPhone: input.recipientPhone,
      provinceCode: input.provinceCode,
      provinceName: input.provinceName,
      ward: input.ward,
      street: input.street,
      deadlineAt: input.deadlineAt,
      policyVersion: input.policyVersion,
      policyAcceptedAt: input.acceptedAt,
      clientRequestId: input.clientRequestId,
    },
    select: { orderId: true },
  });
  await appendAdminAudit(context, {
    action: 'ONLINE_ORDER_PLACED',
    entityType: 'ProductOrder',
    entityId: order.id,
    subjectUserId: invoice.payerUserId,
    branchId: invoice.branchId,
    classification: 'FINANCIAL',
    after: {
      code,
      invoiceId: invoice.id,
      policyVersion: input.policyVersion,
      deadlineAt: input.deadlineAt.toISOString(),
      lines: lines.map((line) => ({
        invoiceLineId: line.invoiceLineId,
        variantId: line.variantId,
        quantity: line.quantity,
        mode: line.fulfilmentMode,
      })),
    },
  });
  return { id: order.id, code };
}

import type { OnlineReturnCostRequest } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../inventory/inventory.input.js';
import { holdsAt } from '../product-orders/order.access.js';
import * as parse from '../product-returns/return.input.js';
import { money } from './online.input.js';

/**
 * Phase 6 Wave 4 (P6-21; OQ-100, approved 2026-10-09): what the shop paid to have goods come back from a customer after a delivery. When the
 * customer changed their mind they pay the way back themselves and nothing is deducted from the refund; when the goods were wrong or damaged
 * the shop pays and the amount is a COST OF THE SHOP, never deducted from the refund. Staff with `REFUND_PRODUCTS` at the case's branch
 * record the amount here (as often as needed: a cost is a record, not a correction); it appears on the order page for the same people and
 * nowhere else. No money moves and no password is asked: it is a figure, not a payment.
 */
export async function recordReturnCost(
  context: AdminContext,
  caseId: string,
  request: OnlineReturnCostRequest,
): Promise<{ orderId: string }> {
  const body = input.record(request, 'body', ['costVnd', 'note']);
  const cost = money(body['costVnd'], 'costVnd');
  const note = parse.optionalNote(body['note'], 'note', 500);
  const { tx } = context;
  const kase = await tx.productReturnCase.findUnique({
    where: { id: caseId },
    select: {
      id: true,
      code: true,
      branchId: true,
      invoiceId: true,
      invoice: { select: { channel: true } },
    },
  });
  if (!kase || kase.invoice.channel !== 'ONLINE') throw new AuthError('NOT_FOUND');
  if (!holdsAt(context.actor.graph, 'REFUND_PRODUCTS', kase.branchId)) {
    throw new AuthError('FORBIDDEN');
  }
  const order = await tx.productOrder.findFirstOrThrow({
    where: { invoiceId: kase.invoiceId },
    select: { id: true },
  });
  await tx.onlineReturnCost.create({
    data: { caseId, costVnd: cost, note, actorUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'ONLINE_RETURN_COST_RECORDED',
    entityType: 'ProductReturnCase',
    entityId: caseId,
    branchId: kase.branchId,
    classification: 'FINANCIAL',
    after: { caseCode: kase.code, costVnd: cost.toString() },
  });
  return { orderId: order.id };
}

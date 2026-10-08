import { createHash, randomBytes } from 'node:crypto';
import type {
  ProductOrderResponse,
  ProductOrderTicketLinkResponse,
  ProductOrderTicketPublicResponse,
} from '@lucy-spa/contracts';
import { productOrderStatus } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { requireLinkTicket } from './order.access.js';
import { presentProductOrder, productOrderSelect } from './order.core.js';

/**
 * Phase 6 P6-16 (OQ-35, OQ-P6-42, approved by the Owner on 2026-10-07): the digital ticket ("phiếu hẹn nhận hàng") of a pre-order.
 * A member sees it inside their own invoice. A customer without an account gets a SECRET LINK that staff pass on by hand (Zalo, a QR
 * code): a long random token whose SHA-256 is the only thing stored. The token is shown once, here; a new link revokes the old one;
 * a wrong, revoked or unknown token reveals nothing (the same NOT_FOUND). The page it opens carries no phone number, no address, no
 * other order and no staff name.
 *
 * Lock order: the order row, then the ticket rows. The link has no expiry by itself (the Owner gave no validity number; asked).
 */

/** 32 random bytes as base64url: 43 characters of [A-Za-z0-9_-]. */
export const TICKET_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export const ticketHash = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

async function lockOrder(
  context: AdminContext,
  orderId: string,
): Promise<{ id: string; branchId: string }> {
  const { tx } = context;
  const order = await tx.productOrder.findUnique({
    where: { id: orderId },
    select: { id: true, branchId: true },
  });
  if (!order) throw new AuthError('NOT_FOUND');
  requireLinkTicket(context, order.branchId);
  await tx.$queryRaw`SELECT id FROM product_orders WHERE id = ${orderId}::uuid FOR UPDATE`;
  return order;
}

/** Makes a new secret link (the old one stops working) and returns the token once. */
export async function createTicketLink(
  context: AdminContext,
  orderId: string,
): Promise<ProductOrderTicketLinkResponse> {
  const { tx } = context;
  const order = await lockOrder(context, orderId);
  const replaced = await tx.productOrderTicket.updateMany({
    where: { orderId, revokedAt: null },
    data: { revokedAt: context.now, revokedByUserId: context.actor.userId },
  });
  const token = randomBytes(32).toString('base64url');
  const created = await tx.productOrderTicket.create({
    data: { orderId, tokenHash: ticketHash(token), createdByUserId: context.actor.userId },
    select: { createdAt: true },
  });
  // The audit record never holds the token, only that a link was made and whether it replaced one.
  await appendAdminAudit(context, {
    action: 'PRODUCT_ORDER_TICKET_LINK_CREATED',
    entityType: 'ProductOrder',
    entityId: orderId,
    branchId: order.branchId,
    classification: 'STANDARD',
    after: { replacedPrevious: replaced.count > 0 },
  });
  return { token, createdAt: created.createdAt.toISOString() };
}

/** Revokes the active link, if any; returns the order as staff see it. */
export async function revokeTicketLink(
  context: AdminContext,
  orderId: string,
): Promise<ProductOrderResponse> {
  const { tx } = context;
  const order = await lockOrder(context, orderId);
  const revoked = await tx.productOrderTicket.updateMany({
    where: { orderId, revokedAt: null },
    data: { revokedAt: context.now, revokedByUserId: context.actor.userId },
  });
  if (revoked.count > 0) {
    await appendAdminAudit(context, {
      action: 'PRODUCT_ORDER_TICKET_LINK_REVOKED',
      entityType: 'ProductOrder',
      entityId: orderId,
      branchId: order.branchId,
      classification: 'STANDARD',
    });
  }
  const row = await tx.productOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: productOrderSelect,
  });
  return presentProductOrder(row);
}

/** The read-only ticket of a link. Anything but a live token of the right shape is the same NOT_FOUND. */
export async function readPublicTicket(
  tx: Prisma.TransactionClient,
  token: string,
): Promise<ProductOrderTicketPublicResponse> {
  if (typeof token !== 'string' || !TICKET_TOKEN.test(token)) throw new AuthError('NOT_FOUND');
  const ticket = await tx.productOrderTicket.findFirst({
    where: { tokenHash: ticketHash(token), revokedAt: null },
    select: {
      order: {
        select: {
          code: true,
          invoice: {
            select: {
              paidAt: true,
              totalVnd: true,
              branch: { select: { name: true, timezone: true } },
            },
          },
          lines: {
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
            select: {
              status: true,
              expectedFrom: true,
              expectedTo: true,
              quantity: true,
              line: { select: { nameVi: true, nameEn: true, unitPriceVnd: true, grossVnd: true } },
              productLine: { select: { variantLabelVi: true, variantLabelEn: true } },
            },
          },
        },
      },
    },
  });
  if (!ticket) throw new AuthError('NOT_FOUND');
  const { order } = ticket;
  const day = (value: Date | null) => (value ? value.toISOString().slice(0, 10) : null);
  return {
    code: order.code,
    status: productOrderStatus(order.lines),
    branchName: order.invoice.branch.name,
    branchTimezone: order.invoice.branch.timezone,
    paidAt: order.invoice.paidAt ? order.invoice.paidAt.toISOString() : null,
    totalVnd: order.invoice.totalVnd.toString(),
    lines: order.lines.map((line) => ({
      nameVi: line.line.nameVi,
      nameEn: line.line.nameEn,
      variantLabelVi: line.productLine.variantLabelVi,
      variantLabelEn: line.productLine.variantLabelEn,
      quantity: line.quantity,
      unitPriceVnd: (line.line.unitPriceVnd ?? 0n).toString(),
      grossVnd: (line.line.grossVnd ?? 0n).toString(),
      status: line.status,
      expectedFrom: day(line.expectedFrom),
      expectedTo: day(line.expectedTo),
    })),
  };
}

import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide, type AuthorityGraph } from '../authorization/authorization.js';

/**
 * Phase 6 P6-15 (T36, pending the Owner's review of the mapping): who may do what with a counter pre-order. Authorization is a
 * permission at the order's branch, decided inside the command's transaction from the actor's own authority graph, never a role name.
 *
 * - `SELL_PRODUCTS`: sell a pre-order (a pre-order line is a product line) and give the customer the ticket link.
 * - `MANAGE_PRODUCT_ORDERS`: work the order queue (the "cần đặt" list), mark goods ordered, allocate again, hand the goods over, and
 *   also make the ticket link.
 * - `REFUND_PRODUCTS`: cancel an order line and refund it (the refund rules of P6-13: fresh password, the Owner is told).
 * Nothing is granted by default: all three are held by nobody until the Owner grants them.
 */
export type OrderPermission = 'SELL_PRODUCTS' | 'MANAGE_PRODUCT_ORDERS' | 'REFUND_PRODUCTS';

export const holdsAt = (graph: AuthorityGraph, permission: OrderPermission, branchId: string) =>
  decide(graph, permission, { kind: 'BRANCH', branchId });

/** May work the queue of orders (list, mark ordered, hand over, allocate). */
export const canManageOrdersAt = (graph: AuthorityGraph, branchId: string) =>
  holdsAt(graph, 'MANAGE_PRODUCT_ORDERS', branchId);

/** May see an order and give its ticket link: the people who sell, who work the queue, or who refund. */
export const canViewOrderAt = (graph: AuthorityGraph, branchId: string) =>
  holdsAt(graph, 'SELL_PRODUCTS', branchId) ||
  holdsAt(graph, 'MANAGE_PRODUCT_ORDERS', branchId) ||
  holdsAt(graph, 'REFUND_PRODUCTS', branchId);

/** May make and revoke the ticket link of an order. */
export const canLinkTicketAt = (graph: AuthorityGraph, branchId: string) =>
  holdsAt(graph, 'SELL_PRODUCTS', branchId) || holdsAt(graph, 'MANAGE_PRODUCT_ORDERS', branchId);

export function requireManageOrders(context: AdminContext, branchId: string): void {
  if (!canManageOrdersAt(context.actor.graph, branchId)) throw new AuthError('FORBIDDEN');
}

export function requireViewOrder(context: AdminContext, branchId: string): void {
  if (!canViewOrderAt(context.actor.graph, branchId)) throw new AuthError('FORBIDDEN');
}

export function requireLinkTicket(context: AdminContext, branchId: string): void {
  if (!canLinkTicketAt(context.actor.graph, branchId)) throw new AuthError('FORBIDDEN');
}

export function requireRefund(context: AdminContext, branchId: string): void {
  if (!holdsAt(context.actor.graph, 'REFUND_PRODUCTS', branchId)) throw new AuthError('FORBIDDEN');
}

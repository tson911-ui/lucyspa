import type { ProductReturnReasonName } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide, type AuthorityGraph } from '../authorization/authorization.js';

/**
 * Phase 6 P6-12: who may do what with a return case (design 8.1, 9). Authorization is a permission at the invoice's branch, decided
 * inside the command's transaction from the actor's own authority graph, never a role name.
 *
 * - `MANAGE_PRODUCT_RETURNS`: open a case, add notes and photos, cancel, and decide the rule-based reasons.
 * - `REFUND_PRODUCTS` (Owner or senior manager, by grant): also decides the rule-based reasons, and is the one who decides a skin-irritation
 *   case ("Owner/manager decides", OQ-22). Either permission may SEE a case and its evidence photos (design 8.1).
 * - Removing a photo (OQ-79) is the Owner's alone: the virtual Owner account, not a permission.
 * Nothing here is granted by default: both permissions are held by nobody until the Owner grants them.
 */
export type ReturnPermission = 'MANAGE_PRODUCT_RETURNS' | 'REFUND_PRODUCTS';

export const holdsGraphAt = (
  graph: AuthorityGraph,
  permission: ReturnPermission,
  branchId: string,
): boolean => decide(graph, permission, { kind: 'BRANCH', branchId });

export const canManageAt = (graph: AuthorityGraph, branchId: string): boolean =>
  holdsGraphAt(graph, 'MANAGE_PRODUCT_RETURNS', branchId);

export const canViewAt = (graph: AuthorityGraph, branchId: string): boolean =>
  canManageAt(graph, branchId) || holdsGraphAt(graph, 'REFUND_PRODUCTS', branchId);

/** Skin irritation is decided by a holder of REFUND_PRODUCTS; the other reasons by either permission. */
export const canDecideAt = (
  graph: AuthorityGraph,
  branchId: string,
  reason: ProductReturnReasonName,
): boolean =>
  reason === 'SKIN_IRRITATION'
    ? holdsGraphAt(graph, 'REFUND_PRODUCTS', branchId)
    : canViewAt(graph, branchId);

export function requireManage(context: AdminContext, branchId: string): void {
  if (!canManageAt(context.actor.graph, branchId)) throw new AuthError('FORBIDDEN');
}

export function requireView(context: AdminContext, branchId: string): void {
  if (!canViewAt(context.actor.graph, branchId)) throw new AuthError('FORBIDDEN');
}

export function requireDecide(
  context: AdminContext,
  branchId: string,
  reason: ProductReturnReasonName,
): void {
  if (!canDecideAt(context.actor.graph, branchId, reason)) throw new AuthError('FORBIDDEN');
}

/** OQ-79: only the Owner removes evidence. */
export function requireOwner(context: AdminContext): void {
  if (!context.actor.owner) throw new AuthError('FORBIDDEN');
}

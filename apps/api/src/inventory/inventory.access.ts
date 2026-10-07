import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Phase 6 P6-4: who may do what in the inventory. Authorization is a permission at a scope, decided inside the command's
 * transaction from the actor's own authority graph, never a role name. The branch-capable codes are checked at the branch the
 * request names; the global ones (`MANAGE_PRODUCTS`, `VIEW_PRODUCT_COST`) at the global scope.
 */
const GLOBAL = { kind: 'GLOBAL' } as const;

export type InventoryPermission = 'VIEW_INVENTORY' | 'MANAGE_STOCK_RECEIPTS' | 'ADJUST_STOCK';

export interface BranchRef {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export const holdsAt = (
  context: AdminContext,
  permission: InventoryPermission,
  branchId: string,
): boolean => decide(context.actor.graph, permission, { kind: 'BRANCH', branchId });

export const canManageProducts = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'MANAGE_PRODUCTS', GLOBAL);

export const canSeeCost = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'VIEW_PRODUCT_COST', GLOBAL);

export function requireCost(context: AdminContext): void {
  if (!canSeeCost(context)) throw new AuthError('FORBIDDEN');
}

/**
 * The branch of a request: the actor must hold ONE of `permissions` there (otherwise 403 whether or not the branch exists), then the
 * branch must exist and be active (404). Returns the branch with its time zone for branch-local dates.
 */
export async function requireBranch(
  context: AdminContext,
  permissions: readonly InventoryPermission[],
  branchId: string,
): Promise<BranchRef> {
  if (!permissions.some((permission) => holdsAt(context, permission, branchId))) {
    throw new AuthError('FORBIDDEN');
  }
  const branch = await context.tx.branch.findFirst({
    where: { id: branchId, isActive: true },
    select: { id: true, code: true, name: true, timezone: true },
  });
  if (!branch) throw new AuthError('NOT_FOUND');
  return branch;
}

/** Every active branch where the actor holds at least one of the permissions, with the flags. */
export async function workableBranches(context: AdminContext) {
  const branches = await context.tx.branch.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true },
  });
  return branches
    .map((branch) => ({
      ...branch,
      view: holdsAt(context, 'VIEW_INVENTORY', branch.id),
      receipts: holdsAt(context, 'MANAGE_STOCK_RECEIPTS', branch.id),
      adjust: holdsAt(context, 'ADJUST_STOCK', branch.id),
    }))
    .filter((branch) => branch.view || branch.receipts || branch.adjust);
}

/** True when the actor holds the permission at ANY active branch. */
export async function holdsAnywhere(
  context: AdminContext,
  permission: InventoryPermission,
): Promise<boolean> {
  const branches = await context.tx.branch.findMany({
    where: { isActive: true },
    select: { id: true },
  });
  return branches.some((branch) => holdsAt(context, permission, branch.id));
}

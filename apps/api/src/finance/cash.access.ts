import type { CashBranchAccess } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Phase 7 P7-2: who may do what in the cash book (design sections 7 and 9). Authorization is a permission at a branch, decided inside the
 * command's transaction from the actor's own authority graph, never a role name. `VIEW_CASH` reads; `MANAGE_CASH` also changes (and
 * therefore also reads). The shared bank fund is visible and changeable only to a person who holds the permission at EVERY active branch.
 */
export type CashPermission = 'VIEW_CASH' | 'MANAGE_CASH';

export const canManageAt = (context: AdminContext, branchId: string): boolean =>
  decide(context.actor.graph, 'MANAGE_CASH', { kind: 'BRANCH', branchId });

export const canViewAt = (context: AdminContext, branchId: string): boolean =>
  canManageAt(context, branchId) ||
  decide(context.actor.graph, 'VIEW_CASH', { kind: 'BRANCH', branchId });

export function requireManageAt(context: AdminContext, branchId: string): void {
  if (!canManageAt(context, branchId)) throw new AuthError('FORBIDDEN');
}

export function requireViewAt(context: AdminContext, branchId: string): void {
  if (!canViewAt(context, branchId)) throw new AuthError('FORBIDDEN');
}

export interface ActiveBranch {
  id: string;
  code: string;
  name: string;
  timezone: string;
}

export async function activeBranches(context: AdminContext): Promise<ActiveBranch[]> {
  return context.tx.branch.findMany({
    where: { isActive: true },
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: { id: true, code: true, name: true, timezone: true },
  });
}

export function accessOf(
  context: AdminContext,
  branches: readonly ActiveBranch[],
): CashBranchAccess[] {
  return branches.map((branch) => ({
    branch: { id: branch.id, code: branch.code, name: branch.name },
    view: canViewAt(context, branch.id),
    manage: canManageAt(context, branch.id),
    deposit:
      canManageAt(context, branch.id) ||
      decide(context.actor.graph, 'COLLECT_PAYMENTS', { kind: 'BRANCH', branchId: branch.id }),
  }));
}

/** Holds the permission at every active branch (and there is at least one): the rule for shop-wide money (bank, go-live, transfers). */
export function holdsEverywhere(
  context: AdminContext,
  branches: readonly ActiveBranch[],
  permission: 'view' | 'manage',
): boolean {
  return (
    branches.length > 0 &&
    branches.every((branch) =>
      permission === 'manage' ? canManageAt(context, branch.id) : canViewAt(context, branch.id),
    )
  );
}

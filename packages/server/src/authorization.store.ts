import type { Prisma } from '@lucy-spa/database';
import { assertAuthTransaction } from './auth-lock.js';
import type { AuthorityGraph, Grant, Override, Scope } from './authorization.js';

function scopeOf(row: { scopeKind: 'GLOBAL' | 'BRANCH'; branchId: string | null }): Scope | null {
  if (row.scopeKind === 'GLOBAL') return row.branchId === null ? { kind: 'GLOBAL' } : null;
  return row.branchId === null ? null : { kind: 'BRANCH', branchId: row.branchId };
}

/**
 * Load the authoritative authority graph inside the deciding transaction; never
 * authorize from a cached role, session snapshot or client-supplied scope. Returns
 * null for an unknown User. Callers enforce actor status (ACTIVE) separately; a
 * containment target is evaluated from its assignments regardless of status.
 */
export async function loadAuthorityGraph(
  transaction: Prisma.TransactionClient,
  userId: string,
): Promise<AuthorityGraph | null> {
  assertAuthTransaction(transaction);
  const user = await transaction.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      kind: true,
      authzVersion: true,
      employeeProfile: {
        select: {
          branchAssignments: {
            where: { revokedAt: null, branch: { isActive: true } },
            select: { branchId: true },
          },
        },
      },
      roleAssignments: {
        where: { role: { isActive: true } },
        select: {
          scopeKind: true,
          branchId: true,
          role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
        },
      },
      permissionOverrides: {
        select: {
          scopeKind: true,
          branchId: true,
          effect: true,
          permission: { select: { code: true } },
        },
      },
    },
  });
  if (!user) return null;
  // Owner authority is the protected principal kind, never mutable role/override rows.
  const workforce = user.kind === 'EMPLOYEE';
  const roleGrants: Grant[] = [];
  const overrides: Override[] = [];
  if (workforce) {
    for (const assignment of user.roleAssignments) {
      const scope = scopeOf(assignment);
      if (!scope) continue;
      for (const { permission } of assignment.role.permissions) {
        roleGrants.push({ permission: permission.code, scope });
      }
    }
    for (const override of user.permissionOverrides) {
      const scope = scopeOf(override);
      if (!scope) continue;
      overrides.push({ permission: override.permission.code, effect: override.effect, scope });
    }
  }
  return {
    userId: user.id,
    kind: user.kind,
    authzVersion: user.authzVersion,
    activeBranchIds: new Set(
      workforce ? (user.employeeProfile?.branchAssignments.map((row) => row.branchId) ?? []) : [],
    ),
    roleGrants,
    overrides,
  };
}


import type { Prisma } from '@lucy-spa/database';
import { assertAuthTransaction } from './auth-lock.js';
import type { AuthorityGraph, Grant, Override, Scope } from './authorization.js';

export function storedScope(row: {
  scopeKind: string;
  branchId: string | null;
  regionId?: string | null;
  areaId?: string | null;
}): Scope | null {
  if (row.scopeKind === 'GLOBAL') return row.branchId === null ? { kind: 'GLOBAL' } : null;
  if (row.scopeKind === 'REGION')
    return row.regionId ? { kind: 'REGION', regionId: row.regionId } : null;
  if (row.scopeKind === 'AREA') return row.areaId ? { kind: 'AREA', areaId: row.areaId } : null;
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
          organizationAssignments: {
            where: { endedAt: null },
            select: {
              id: true,
              level: true,
              scopeKind: true,
              regionId: true,
              areaId: true,
              branchId: true,
              teamId: true,
              team: { select: { isActive: true } },
            },
          },
          teamMemberships: {
            where: { endedAt: null, team: { isActive: true, branch: { isActive: true } } },
            select: { teamId: true, branchId: true },
          },
          classificationChanges: {
            where: { effectiveDate: { lte: new Date() } },
            orderBy: { effectiveDate: 'desc' },
            take: 1,
            select: { classification: true },
          },
        },
      },
      roleAssignments: {
        where: { role: { isActive: true } },
        select: {
          scopeKind: true,
          regionId: true,
          areaId: true,
          branchId: true,
          role: { select: { permissions: { select: { permission: { select: { code: true } } } } } },
        },
      },
      permissionOverrides: {
        select: {
          scopeKind: true,
          regionId: true,
          areaId: true,
          branchId: true,
          effect: true,
          permission: { select: { code: true } },
        },
      },
    },
  });
  if (!user) return null;
  const [regions, areas, branches] = await Promise.all([
    transaction.region.findMany({ where: { isActive: true }, select: { id: true, name: true } }),
    transaction.area.findMany({
      where: { isActive: true, region: { isActive: true } },
      select: { id: true, regionId: true, name: true },
    }),
    transaction.branch.findMany({
      where: { isActive: true },
      select: {
        id: true,
        areaId: true,
        area: {
          select: { regionId: true, isActive: true, region: { select: { isActive: true } } },
        },
      },
    }),
  ]);
  const organization = {
    regions,
    areas,
    branches: branches.map((branch) => ({
      id: branch.id,
      areaId: branch.area?.isActive && branch.area.region.isActive ? branch.areaId : null,
      regionId: branch.area?.isActive && branch.area.region.isActive ? branch.area.regionId : null,
    })),
  };
  // Owner authority is the protected principal kind, never mutable role/override rows.
  const workforce = user.kind === 'EMPLOYEE';
  const roleGrants: Grant[] = [];
  const overrides: Override[] = [];
  if (workforce) {
    for (const assignment of user.roleAssignments) {
      const scope = storedScope(assignment);
      if (!scope) continue;
      for (const { permission } of assignment.role.permissions) {
        roleGrants.push({ permission: permission.code, scope });
      }
    }
    for (const override of user.permissionOverrides) {
      const scope = storedScope(override);
      if (!scope) continue;
      overrides.push({ permission: override.permission.code, effect: override.effect, scope });
    }
  }
  const activeBranchIds = new Set(
    workforce ? (user.employeeProfile?.branchAssignments.map((row) => row.branchId) ?? []) : [],
  );
  // Ended employment holds no hierarchy position even before its relationships are swept.
  const employmentEnded =
    user.employeeProfile?.classificationChanges[0]?.classification === 'ENDED';
  const appointments =
    workforce && !employmentEnded
      ? (user.employeeProfile?.organizationAssignments ?? []).flatMap((row) => {
          const scope = storedScope(row);
          if (!scope || (row.team && !row.team.isActive)) return [];
          const active =
            scope.kind === 'GLOBAL' ||
            (scope.kind === 'REGION' && regions.some((region) => region.id === scope.regionId)) ||
            (scope.kind === 'AREA' && areas.some((area) => area.id === scope.areaId)) ||
            (scope.kind === 'BRANCH' && activeBranchIds.has(scope.branchId));
          return active ? [{ id: row.id, level: row.level, scope, teamId: row.teamId }] : [];
        })
      : [];
  return {
    userId: user.id,
    kind: user.kind,
    authzVersion: user.authzVersion,
    activeBranchIds,
    organization,
    appointments,
    teamMemberships:
      workforce && !employmentEnded
        ? (user.employeeProfile?.teamMemberships ?? []).filter((membership) =>
            activeBranchIds.has(membership.branchId),
          )
        : [],
    roleGrants,
    overrides,
  };
}

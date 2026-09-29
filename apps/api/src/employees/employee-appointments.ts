import type { EmployeeDirectoryAppointment } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { decide, type AuthorityGraph } from '../authorization/authorization.js';
import { scopeFrom } from '../organization/organization.input.js';

/**
 * Active appointments for the listed employees, filtered by the same rule as
 * GET /organization/appointments: the caller needs VIEW_ORGANIZATION or MANAGE_ORG_ASSIGNMENTS
 * at the appointment's scope (the Owner passes for every scope). Read-only; the employment
 * title is untouched.
 */
export async function visibleAppointments(
  tx: Prisma.TransactionClient,
  graph: AuthorityGraph,
  userIds: readonly string[],
): Promise<Map<string, EmployeeDirectoryAppointment[]>> {
  const result = new Map<string, EmployeeDirectoryAppointment[]>();
  if (userIds.length === 0) return result;
  const rows = await tx.organizationAssignment.findMany({
    where: { employeeUserId: { in: [...userIds] }, endedAt: null },
    orderBy: [{ employeeUserId: 'asc' }, { assignedAt: 'asc' }, { id: 'asc' }],
    select: {
      id: true,
      employeeUserId: true,
      level: true,
      teamId: true,
      team: { select: { name: true, isActive: true } },
      scopeKind: true,
      regionId: true,
      areaId: true,
      branchId: true,
    },
  });
  for (const row of rows) {
    if (row.team && !row.team.isActive) continue;
    const scope = scopeFrom(row);
    if (
      !['VIEW_ORGANIZATION', 'MANAGE_ORG_ASSIGNMENTS'].some((code) => decide(graph, code, scope))
    ) {
      continue;
    }
    const list = result.get(row.employeeUserId) ?? [];
    list.push({
      id: row.id,
      level: row.level,
      scope,
      teamId: row.teamId,
      teamName: row.team?.name ?? null,
    });
    result.set(row.employeeUserId, list);
  }
  return result;
}

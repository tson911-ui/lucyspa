import type { Prisma } from '@lucy-spa/database';
import { invalidateAuthorization } from '../authorization/authorization.store.js';

export interface EndedRelationships {
  membershipIds: string[];
  appointmentIds: string[];
  teamIds: string[];
  branchIds: string[];
}

/**
 * Ends every ACTIVE team membership and organization appointment of the given employees
 * (optionally only within `branchIds`; region/area/system appointments have no branch and are
 * ended only when no branch filter is given). Rows are ended, never deleted or rewritten, so
 * history is preserved. Affected teams get a version bump so stale editors conflict, and
 * authorization is invalidated. The caller appends the audit entry.
 */
export async function endOrganizationRelationships(
  tx: Prisma.TransactionClient,
  employeeUserIds: readonly string[],
  now: Date,
  branchIds?: readonly string[],
): Promise<EndedRelationships> {
  if (employeeUserIds.length === 0)
    return { membershipIds: [], appointmentIds: [], teamIds: [], branchIds: [] };
  const branch = branchIds === undefined ? {} : { branchId: { in: [...branchIds] } };
  const memberships = await tx.teamMembership.findMany({
    where: { employeeUserId: { in: [...employeeUserIds] }, endedAt: null, ...branch },
    select: { id: true, teamId: true, branchId: true },
  });
  const appointments = await tx.organizationAssignment.findMany({
    where: { employeeUserId: { in: [...employeeUserIds] }, endedAt: null, ...branch },
    select: { id: true, teamId: true, branchId: true },
  });
  if (memberships.length === 0 && appointments.length === 0) {
    return { membershipIds: [], appointmentIds: [], teamIds: [], branchIds: [] };
  }
  await tx.teamMembership.updateMany({
    where: { id: { in: memberships.map((row) => row.id) } },
    data: { endedAt: now },
  });
  await tx.organizationAssignment.updateMany({
    where: { id: { in: appointments.map((row) => row.id) } },
    data: { endedAt: now, rowVersion: { increment: 1 } },
  });
  const teamIds = [
    ...new Set([
      ...memberships.map((row) => row.teamId),
      ...appointments.flatMap((row) => (row.teamId ? [row.teamId] : [])),
    ]),
  ];
  await tx.team.updateMany({
    where: { id: { in: teamIds } },
    data: { rowVersion: { increment: 1 } },
  });
  await invalidateAuthorization(tx, [...employeeUserIds], now);
  return {
    membershipIds: memberships.map((row) => row.id),
    appointmentIds: appointments.map((row) => row.id),
    teamIds,
    branchIds: [
      ...new Set([
        ...memberships.map((row) => row.branchId),
        ...appointments.flatMap((row) => (row.branchId ? [row.branchId] : [])),
      ]),
    ],
  };
}

/**
 * Employees holding an active relationship whose CURRENT employment classification (on the
 * business date) is ENDED. Classification is resolved in PostgreSQL, not from a role label.
 */
export async function endedEmploymentWithRelationships(
  tx: Prisma.TransactionClient,
  today: Date,
  branchId?: string,
): Promise<string[]> {
  const rows = await tx.$queryRaw<{ employee_user_id: string }[]>`
    SELECT DISTINCT r.employee_user_id FROM (
      SELECT employee_user_id, branch_id FROM team_memberships WHERE ended_at IS NULL
      UNION ALL
      SELECT employee_user_id, branch_id FROM organization_assignments WHERE ended_at IS NULL
    ) r
    WHERE (${branchId ?? null}::uuid IS NULL OR r.branch_id = ${branchId ?? null}::uuid)
      AND (
        SELECT c.classification::text FROM employment_classification_changes c
        WHERE c.employee_user_id = r.employee_user_id AND c.effective_date <= ${today}::date
        ORDER BY c.effective_date DESC LIMIT 1
      ) = 'ENDED'`;
  return rows.map((row) => row.employee_user_id).sort();
}

import type { Prisma } from '@lucy-spa/database';

/**
 * Integration-test fixture only. Hierarchy is an additional requirement on top of permissions,
 * so an administrative fixture principal needs an appointment to act on other employees:
 * STORE_MANAGER at the branch, or CEO for a GLOBAL grant. Appointments are skipped when the
 * principal is not an employee or has no active membership of the branch.
 */
export async function appointForFixture(
  tx: Prisma.TransactionClient,
  userId: string,
  branchId?: string | null,
): Promise<void> {
  const profile = await tx.employeeProfile.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (!profile) return;
  if (branchId) {
    const member = await tx.employeeBranchAssignment.findFirst({
      where: { employeeUserId: userId, branchId, revokedAt: null, branch: { isActive: true } },
      select: { id: true },
    });
    if (!member) return;
    const existing = await tx.organizationAssignment.findFirst({
      where: { employeeUserId: userId, level: 'STORE_MANAGER', branchId, endedAt: null },
      select: { id: true },
    });
    if (existing) return;
    await tx.organizationAssignment.create({
      data: {
        employeeUserId: userId,
        level: 'STORE_MANAGER',
        scopeKind: 'BRANCH',
        branchId,
        assignedByUserId: userId,
      },
    });
    return;
  }
  const existing = await tx.organizationAssignment.findFirst({
    where: { employeeUserId: userId, level: 'CEO', endedAt: null },
    select: { id: true },
  });
  if (existing) return;
  await tx.organizationAssignment.create({
    data: { employeeUserId: userId, level: 'CEO', scopeKind: 'GLOBAL', assignedByUserId: userId },
  });
}

/** True when a permission set is administrative rather than read-only. */
export function isAdministrative(codes: readonly string[]): boolean {
  return codes.some((code) => !code.startsWith('VIEW_'));
}

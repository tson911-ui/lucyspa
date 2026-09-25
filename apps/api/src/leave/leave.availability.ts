import type { Prisma } from '@lucy-spa/database';

/**
 * The approved-leave question future Booking asks (Phase 3): which of these employees are
 * on APPROVED leave on this calendar date? Leave is employee-level, so the answer holds
 * for every branch the employee works at. `date` is a date-only value (UTC midnight of
 * the calendar day, as parsed by `parseLeaveDate`). Only APPROVED requests count; PENDING,
 * REJECTED and CANCELLED never make an employee unavailable.
 */
export async function employeesOnApprovedLeave(
  tx: Prisma.TransactionClient,
  employeeUserIds: readonly string[],
  date: Date,
): Promise<Set<string>> {
  if (employeeUserIds.length === 0) return new Set();
  const rows = await tx.leaveRequest.findMany({
    where: {
      employeeUserId: { in: [...employeeUserIds] },
      status: 'APPROVED',
      startDate: { lte: date },
      endDate: { gte: date },
    },
    select: { employeeUserId: true },
    distinct: ['employeeUserId'],
  });
  return new Set(rows.map((row) => row.employeeUserId));
}

import { appendOutboxEvent } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { sqlStateOf } from '../booking/customer-command.js';

/**
 * Called only by the existing approval transaction, which already locks the leave employee's
 * user row. Parent NOWAIT locks avoid inversion with arrival/initial assignment; contention
 * rolls back the whole approval so its existing versioned UI can refresh and retry.
 * No copied schedule: update the existing conflict marker and emit minimal line identities.
 */
export async function recordApprovedLeaveConflicts(
  context: AdminContext,
  leave: { id: string; employeeUserId: string; startDate: Date; endDate: Date },
): Promise<number> {
  const { tx, now } = context;
  try {
    // Include CHECKED_IN parents: arrival may have carried a booking line into a Visit.
    await tx.$queryRaw`
      SELECT b.id FROM bookings b WHERE b.status IN ('CONFIRMED', 'CHECKED_IN')
        AND b.service_date BETWEEN ${leave.startDate}::date AND ${leave.endDate}::date
        AND b.service_date >= lucy_branch_local_date(b.branch_id, ${now}::timestamptz)
        AND (EXISTS (SELECT 1 FROM booking_service_lines l WHERE l.booking_id = b.id AND l.employee_user_id = ${leave.employeeUserId}::uuid)
          OR EXISTS (SELECT 1 FROM visits v JOIN visit_service_lines l ON l.visit_id = v.id
            WHERE v.booking_id = b.id AND l.employee_user_id = ${leave.employeeUserId}::uuid AND l.status = 'PLANNED'))
      ORDER BY b.id FOR UPDATE NOWAIT`;
    // This fresh statement sees any arrival that committed before the booking locks above.
    await tx.$queryRaw`
      SELECT v.id FROM visits v WHERE v.status IN ('OPEN', 'IN_SERVICE')
        AND v.service_date BETWEEN ${leave.startDate}::date AND ${leave.endDate}::date
        AND v.service_date >= lucy_branch_local_date(v.branch_id, ${now}::timestamptz)
        AND EXISTS (SELECT 1 FROM visit_service_lines l WHERE l.visit_id = v.id
          AND l.employee_user_id = ${leave.employeeUserId}::uuid AND l.status = 'PLANNED')
      ORDER BY v.id FOR UPDATE NOWAIT`;
    const affected = await tx.$queryRaw<{
      kind: 'BOOKING' | 'VISIT'; id: string; branchId: string; parentId: string; mode: string;
    }[]>`
      SELECT 'BOOKING'::text AS kind, l.id::text, b.branch_id::text AS "branchId", b.id::text AS "parentId", l.assignment_mode::text AS mode
      FROM booking_service_lines l JOIN bookings b ON b.id = l.booking_id
      WHERE l.employee_user_id = ${leave.employeeUserId}::uuid AND b.status = 'CONFIRMED'
        AND b.service_date BETWEEN ${leave.startDate}::date AND ${leave.endDate}::date
        AND b.service_date >= lucy_branch_local_date(b.branch_id, ${now}::timestamptz)
        AND l.assignment_conflict IS DISTINCT FROM 'LEAVE'
        AND NOT EXISTS (SELECT 1 FROM visit_service_lines v WHERE v.booking_service_line_id = l.id)
      UNION ALL
      SELECT 'VISIT', l.id::text, v.branch_id::text, v.id::text, l.assignment_mode::text
      FROM visit_service_lines l JOIN visits v ON v.id = l.visit_id
      WHERE l.employee_user_id = ${leave.employeeUserId}::uuid AND l.status = 'PLANNED' AND v.status IN ('OPEN', 'IN_SERVICE')
        AND v.service_date BETWEEN ${leave.startDate}::date AND ${leave.endDate}::date
        AND v.service_date >= lucy_branch_local_date(v.branch_id, ${now}::timestamptz)
        AND l.assignment_conflict IS DISTINCT FROM 'LEAVE'
        AND NOT EXISTS (SELECT 1 FROM service_executions e WHERE e.visit_service_line_id = l.id)
      ORDER BY kind, id`;
    for (const line of affected) {
      const data = { assignmentConflict: 'LEAVE' as const, rowVersion: { increment: 1 } };
      if (line.kind === 'BOOKING') await tx.bookingServiceLine.update({ where: { id: line.id }, data });
      else await tx.visitServiceLine.update({ where: { id: line.id }, data });
      await appendOutboxEvent(tx, {
        branchId: line.branchId, aggregateType: line.kind === 'BOOKING' ? 'Booking' : 'Visit',
        aggregateId: line.parentId, eventType: 'BOOKING_KTV_CONFLICT', schemaVersion: 1, occurredAt: now,
        payload: { leaveRequestId: leave.id, lineKind: line.kind, lineId: line.id,
          employeeUserId: leave.employeeUserId, assignmentMode: line.mode, context: 'LEAVE' },
      });
    }
    await appendOutboxEvent(tx, {
      aggregateType: 'LeaveRequest', aggregateId: leave.id, eventType: 'EMPLOYEE_LEAVE_APPROVED',
      schemaVersion: 1, occurredAt: now,
      payload: { employeeUserId: leave.employeeUserId, startDate: leave.startDate.toISOString().slice(0, 10),
        endDate: leave.endDate.toISOString().slice(0, 10), affectedLineCount: affected.length },
    });
    return affected.length;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const meta = Reflect.get(Object(error), 'meta');
    const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
    if (['55P03', '40P01', '40001'].includes(state ?? '') || Reflect.get(Object(error), 'code') === 'P2034') throw new AuthError('CONFLICT');
    throw error;
  }
}

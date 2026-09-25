import type {
  AttendanceCheckInRequest,
  AttendanceCorrectionRequest,
  AttendanceListResponse,
  AttendanceQuery,
  AttendanceRecordResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  requireAcross,
  runAdminCommand,
  type AdminActor,
  type AdminContext,
} from '../authorization/admin-command.js';
import { decide, GLOBAL } from '../authorization/authorization.js';
import { requiredReason } from '../catalog/catalog.input.js';
import { isUuid } from '../employees/employee.input.js';

/** Bounded reads: at most 93 business days; defaults to the last 31. */
export const ATTENDANCE_LIMITS = Object.freeze({
  maxRangeDays: 93,
  defaultRangeDays: 31,
  maxRecords: 2_000,
});

const recordSelect = {
  id: true,
  employeeUserId: true,
  branchId: true,
  businessDate: true,
  checkInAt: true,
  checkOutAt: true,
  rowVersion: true,
} satisfies Prisma.AttendanceRecordSelect;

type RecordRow = Prisma.AttendanceRecordGetPayload<{ select: typeof recordSelect }>;

function present(row: RecordRow): AttendanceRecordResponse {
  return {
    id: row.id,
    employeeId: row.employeeUserId,
    branchId: row.branchId,
    businessDate: row.businessDate.toISOString().slice(0, 10),
    checkInAt: row.checkInAt.toISOString(),
    checkOutAt: row.checkOutAt?.toISOString() ?? null,
    version: row.rowVersion,
  };
}

const DATE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;

function parseDate(value: string, field: string): Date {
  const match = DATE.exec(value);
  const date = match ? new Date(`${value}T00:00:00.000Z`) : null;
  if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return date;
}

function parseInstant(value: string, field: string): Date {
  const date = new Date(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value) || Number.isNaN(date.getTime())) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return date;
}

/**
 * Attendance V1 (Phase 2 Step 7): one check-in + one check-out per employee, branch and
 * business date, with no breaks, shifts, lateness or pay effects.
 *
 * - **Business date** is the check-in's calendar date in the **branch** timezone,
 *   computed by PostgreSQL. The Step 2 trigger computes it the same way and enforces it.
 * - **Self check-in** needs an active EmployeeBranchAssignment at an active branch,
 *   rechecked in the transaction.
 * - **Self check-out** closes the caller's own open record for the current business
 *   date. Anything else is a manager correction.
 * - **Reads and corrections** use VIEW_ATTENDANCE / MANAGE_ATTENDANCE for the record's
 *   branch.
 */
@Injectable()
export class AttendanceService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async checkIn(
    sessionToken: string | undefined,
    input: AttendanceCheckInRequest,
    requestId?: string,
  ): Promise<AttendanceRecordResponse> {
    const branchId = this.id(input.branchId, 'branchId');
    return this.frame(sessionToken, requestId, [], async (context) => {
      const { tx, actor, now } = context;
      if (actor.principal.userKind !== 'EMPLOYEE') throw new AuthError('FORBIDDEN');
      // Branch row before attendance rows: a concurrent timezone change or deactivation
      // (Step 3, FOR UPDATE) cannot interleave with this check-in.
      await tx.$queryRaw`SELECT id FROM branches WHERE id = ${branchId}::uuid FOR SHARE`;
      const branch = await tx.branch.findUnique({
        where: { id: branchId },
        select: { isActive: true, timezone: true },
      });
      if (!branch) throw new AuthError('NOT_FOUND');
      if (!branch.isActive) throw new AuthError('CONFLICT', 'branchId');
      // Membership changes take the exclusive graph lock; this frame holds the shared one.
      const membership = await tx.employeeBranchAssignment.findFirst({
        where: { employeeUserId: actor.userId, branchId, revokedAt: null },
        select: { id: true },
      });
      if (!membership) throw new AuthError('FORBIDDEN');
      const businessDate = await this.businessDate(tx, now, branch.timezone);
      const existing = await tx.attendanceRecord.findUnique({
        where: {
          employeeUserId_branchId_businessDate: {
            employeeUserId: actor.userId,
            branchId,
            businessDate,
          },
        },
        select: { id: true },
      });
      if (existing) throw new AuthError('CONFLICT', 'businessDate');
      // The unique key (employee, branch, business date) is the final guard against a
      // concurrent duplicate; the frame maps its violation to 409.
      const row = await tx.attendanceRecord.create({
        data: { employeeUserId: actor.userId, branchId, businessDate, checkInAt: now },
        select: recordSelect,
      });
      await this.audit(context, 'ATTENDANCE_CHECKED_IN', row, {
        after: { businessDate: present(row).businessDate, checkInAt: now.toISOString() },
      });
      return present(row);
    });
  }

  async checkOut(
    sessionToken: string | undefined,
    recordId: string,
    requestId?: string,
  ): Promise<AttendanceRecordResponse> {
    const id = this.id(recordId);
    return this.frame(sessionToken, requestId, [], async (context) => {
      const { tx, actor, now } = context;
      if (actor.principal.userKind !== 'EMPLOYEE') throw new AuthError('FORBIDDEN');
      const row = await this.lockRecord(tx, id);
      // Another employee's record is indistinguishable from an unknown one.
      if (!row || row.employeeUserId !== actor.userId) throw new AuthError('NOT_FOUND');
      if (row.checkOutAt) throw new AuthError('CONFLICT', 'checkOutAt');
      const branch = await tx.branch.findUniqueOrThrow({
        where: { id: row.branchId },
        select: { timezone: true },
      });
      const today = await this.businessDate(tx, now, branch.timezone);
      // A forgotten check-out from an earlier day is a manager correction (Owner decision).
      if (today.getTime() !== row.businessDate.getTime()) {
        throw new AuthError('CONFLICT', 'businessDate');
      }
      if (now <= row.checkInAt) throw new AuthError('CONFLICT', 'checkOutAt');
      const updated = await tx.attendanceRecord.update({
        where: { id },
        data: { checkOutAt: now, rowVersion: { increment: 1 } },
        select: recordSelect,
      });
      await this.audit(context, 'ATTENDANCE_CHECKED_OUT', updated, {
        after: { checkOutAt: now.toISOString() },
      });
      return present(updated);
    });
  }

  /** The caller's own records within a bounded business-date range. */
  async listOwn(
    sessionToken: string | undefined,
    query: AttendanceQuery,
  ): Promise<AttendanceListResponse> {
    const { from, to } = this.range(query);
    const branchId = query.branchId === undefined ? undefined : this.id(query.branchId, 'branchId');
    return this.frame(sessionToken, undefined, [], async ({ tx, actor }) => {
      if (actor.principal.userKind !== 'EMPLOYEE') throw new AuthError('FORBIDDEN');
      return this.list(tx, {
        employeeUserId: actor.userId,
        businessDate: { gte: from, lte: to },
        ...(branchId ? { branchId } : {}),
      });
    });
  }

  /**
   * Branch-scoped reads for VIEW_ATTENDANCE holders. GLOBAL covers every branch, including
   * inactive ones and history. A branch grant covers only the caller's active member
   * branches. The visibility filter is applied before the row limit.
   */
  async listBranch(
    sessionToken: string | undefined,
    query: AttendanceQuery,
  ): Promise<AttendanceListResponse> {
    const { from, to } = this.range(query);
    const branchId = query.branchId === undefined ? undefined : this.id(query.branchId, 'branchId');
    const employeeId =
      query.employeeId === undefined ? undefined : this.id(query.employeeId, 'employeeId');
    return this.frame(sessionToken, undefined, [], async ({ tx, actor }) => {
      const visible = this.visibleBranches(actor, 'VIEW_ATTENDANCE');
      if (visible !== 'ALL' && visible.length === 0) throw new AuthError('FORBIDDEN');
      if (branchId !== undefined && visible !== 'ALL' && !visible.includes(branchId)) {
        throw new AuthError('NOT_FOUND');
      }
      return this.list(tx, {
        businessDate: { gte: from, lte: to },
        ...(branchId ? { branchId } : visible === 'ALL' ? {} : { branchId: { in: visible } }),
        ...(employeeId ? { employeeUserId: employeeId } : {}),
      });
    });
  }

  /**
   * Manager correction (MANAGE_ATTENDANCE for the record's branch). Covers a forgotten or
   * wrong check-out, and a check-in moved within the same business date (the Step 2
   * trigger forbids moving the date). The result must have check-out after check-in and
   * nothing in the future. A reason is required, and non-Owners can't correct their own
   * records.
   */
  async correct(
    sessionToken: string | undefined,
    recordId: string,
    input: AttendanceCorrectionRequest,
    requestId?: string,
  ): Promise<AttendanceRecordResponse> {
    const id = this.id(recordId);
    const checkInAt =
      input.checkInAt === undefined ? undefined : parseInstant(input.checkInAt, 'checkInAt');
    const checkOutAt =
      input.checkOutAt === undefined ? undefined : parseInstant(input.checkOutAt, 'checkOutAt');
    if (checkInAt === undefined && checkOutAt === undefined)
      throw new AuthError('VALIDATION_FAILED');
    const reason = requiredReason(input.reason);
    const owner = async (tx: Prisma.TransactionClient) => {
      const row = await tx.attendanceRecord.findUnique({
        where: { id },
        select: { employeeUserId: true },
      });
      return row ? [row.employeeUserId] : [];
    };
    return this.frame(sessionToken, requestId, owner, async (context) => {
      const { tx, actor, now } = context;
      const row = await this.lockRecord(tx, id);
      if (!row) throw new AuthError('NOT_FOUND');
      requireAcross(actor, 'MANAGE_ATTENDANCE', [row.branchId]);
      if (!actor.owner && actor.userId === row.employeeUserId) throw new AuthError('FORBIDDEN');
      if (row.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      const nextIn = checkInAt ?? row.checkInAt;
      const nextOut = checkOutAt ?? row.checkOutAt;
      if (nextIn > now || (nextOut !== null && nextOut > now)) {
        throw new AuthError('VALIDATION_FAILED', nextIn > now ? 'checkInAt' : 'checkOutAt');
      }
      if (nextOut !== null && nextOut <= nextIn)
        throw new AuthError('VALIDATION_FAILED', 'checkOutAt');
      if (checkInAt !== undefined) {
        const branch = await tx.branch.findUniqueOrThrow({
          where: { id: row.branchId },
          select: { timezone: true },
        });
        const date = await this.businessDate(tx, checkInAt, branch.timezone);
        if (date.getTime() !== row.businessDate.getTime()) {
          throw new AuthError('VALIDATION_FAILED', 'checkInAt');
        }
      }
      if (
        nextIn.getTime() === row.checkInAt.getTime() &&
        nextOut?.getTime() === row.checkOutAt?.getTime()
      ) {
        throw new AuthError('VALIDATION_FAILED');
      }
      const updated = await tx.attendanceRecord.update({
        where: { id },
        data: { checkInAt: nextIn, checkOutAt: nextOut, rowVersion: { increment: 1 } },
        select: recordSelect,
      });
      await this.audit(context, 'ATTENDANCE_CORRECTED', updated, {
        reason,
        before: {
          checkInAt: row.checkInAt.toISOString(),
          checkOutAt: row.checkOutAt?.toISOString() ?? null,
        },
        after: {
          checkInAt: nextIn.toISOString(),
          checkOutAt: nextOut?.toISOString() ?? null,
        },
      });
      return present(updated);
    });
  }

  // -------------------------------------------------------------------- helpers

  private frame<T>(
    sessionToken: string | undefined,
    requestId: string | undefined,
    users: readonly string[] | ((tx: Prisma.TransactionClient) => Promise<readonly string[]>),
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      {
        exclusive: false,
        requestId,
        lockUsers: typeof users === 'function' ? users : () => Promise.resolve(users),
      },
      work,
    );
  }

  private id(value: string, field?: string): string {
    const id = value.toLowerCase();
    if (!isUuid(id)) {
      throw field ? new AuthError('VALIDATION_FAILED', field) : new AuthError('NOT_FOUND');
    }
    return id;
  }

  /** The instant's calendar date in the branch timezone, computed by PostgreSQL. */
  private async businessDate(
    tx: Prisma.TransactionClient,
    instant: Date,
    timezone: string,
  ): Promise<Date> {
    const rows = await tx.$queryRaw<{ day: string }[]>`
      SELECT to_char(${instant}::timestamptz AT TIME ZONE ${timezone}, 'YYYY-MM-DD') AS day`;
    const day = rows[0]?.day;
    if (!day) throw new Error('Business date unavailable.');
    return new Date(`${day}T00:00:00.000Z`);
  }

  private range(query: AttendanceQuery): { from: Date; to: Date } {
    const day = 86_400_000;
    const to =
      query.to === undefined
        ? new Date(new Date().toISOString().slice(0, 10))
        : parseDate(query.to, 'to');
    const from =
      query.from === undefined
        ? new Date(to.getTime() - (ATTENDANCE_LIMITS.defaultRangeDays - 1) * day)
        : parseDate(query.from, 'from');
    if (from > to || (to.getTime() - from.getTime()) / day + 1 > ATTENDANCE_LIMITS.maxRangeDays) {
      throw new AuthError('VALIDATION_FAILED', 'from');
    }
    return { from, to };
  }

  private visibleBranches(actor: AdminActor, permission: string): 'ALL' | string[] {
    if (decide(actor.graph, permission, GLOBAL)) return 'ALL';
    return [...actor.graph.activeBranchIds].filter((branchId) =>
      decide(actor.graph, permission, { kind: 'BRANCH', branchId }),
    );
  }

  private async lockRecord(tx: Prisma.TransactionClient, id: string): Promise<RecordRow | null> {
    await tx.$queryRaw`SELECT id FROM attendance_records WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.attendanceRecord.findUnique({ where: { id }, select: recordSelect });
  }

  private async list(
    tx: Prisma.TransactionClient,
    where: Prisma.AttendanceRecordWhereInput,
  ): Promise<AttendanceListResponse> {
    const rows = await tx.attendanceRecord.findMany({
      where,
      select: recordSelect,
      orderBy: [{ businessDate: 'desc' }, { checkInAt: 'desc' }, { id: 'asc' }],
      take: ATTENDANCE_LIMITS.maxRecords,
    });
    return { records: rows.map(present) };
  }

  private audit(
    context: AdminContext,
    action: string,
    row: RecordRow,
    detail: { reason?: string; before?: Prisma.InputJsonObject; after: Prisma.InputJsonObject },
  ): Promise<void> {
    return appendAdminAudit(context, {
      action,
      entityType: 'AttendanceRecord',
      entityId: row.id,
      subjectUserId: row.employeeUserId,
      branchId: row.branchId,
      reason: detail.reason ?? null,
      ...(detail.before ? { before: detail.before } : {}),
      after: detail.after,
    });
  }
}

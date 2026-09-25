import type {
  LeaveRequestCancelRequest,
  LeaveRequestCreateRequest,
  LeaveRequestDecisionRequest,
  LeaveRequestListResponse,
  LeaveRequestQuery,
  LeaveRequestResponse,
  LeaveStatus,
  LeaveType,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  requireAcross,
  runAdminCommand,
  type AdminActor,
  type AdminContext,
} from '../authorization/admin-command.js';
import { decide, GLOBAL } from '../authorization/authorization.js';
import { isUuid } from '../employees/employee.input.js';

/** Controlled leave types (SQL enum `LeaveType`). None implies paid/unpaid treatment. */
export const LEAVE_TYPES: readonly LeaveType[] = Object.freeze([
  'ANNUAL',
  'SICK',
  'PERSONAL',
  'FAMILY_EVENT',
  'MATERNITY',
  'OTHER',
]);

export const LEAVE_STATUSES: readonly LeaveStatus[] = Object.freeze([
  'PENDING',
  'APPROVED',
  'REJECTED',
  'CANCELLED',
]);

/**
 * Bounds: one request spans at most 366 calendar days; reads cover at most 400 days
 * (default: 93 days back to 366 days ahead) and return at most 500 requests.
 */
export const LEAVE_LIMITS = Object.freeze({
  maxRequestDays: 366,
  maxRangeDays: 400,
  defaultPastDays: 93,
  defaultFutureDays: 366,
  maxRecords: 500,
  reasonMaxCodePoints: 1_000,
});

/** PENDING and APPROVED requests occupy their dates; REJECTED/CANCELLED are history. */
const BLOCKING: LeaveStatus[] = ['PENDING', 'APPROVED'];
const DAY = 86_400_000;

const requestSelect = {
  id: true,
  employeeUserId: true,
  leaveType: true,
  startDate: true,
  endDate: true,
  reason: true,
  status: true,
  requestedAt: true,
  decidedByUserId: true,
  decidedAt: true,
  decisionReason: true,
  cancelledByUserId: true,
  cancelledAt: true,
  cancellationReason: true,
  rowVersion: true,
} satisfies Prisma.LeaveRequestSelect;

type RequestRow = Prisma.LeaveRequestGetPayload<{ select: typeof requestSelect }>;

const day = (date: Date) => date.toISOString().slice(0, 10);

function present(row: RequestRow): LeaveRequestResponse {
  return {
    id: row.id,
    employeeId: row.employeeUserId,
    leaveType: row.leaveType,
    startDate: day(row.startDate),
    endDate: day(row.endDate),
    days: (row.endDate.getTime() - row.startDate.getTime()) / DAY + 1,
    reason: row.reason,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    decidedByUserId: row.decidedByUserId,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    cancelledByUserId: row.cancelledByUserId,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    version: row.rowVersion,
  };
}

/**
 * A calendar date (`YYYY-MM-DD`) as a date-only value. It is parsed as that exact
 * calendar day at UTC midnight, the way PostgreSQL DATE round-trips through Prisma, so
 * no timezone can shift it.
 */
export function parseLeaveDate(value: string, field: string): Date {
  const date = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
    ? new Date(`${value}T00:00:00.000Z`)
    : null;
  if (!date || Number.isNaN(date.getTime()) || day(date) !== value) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return date;
}

function reasonText(value: string): string {
  return text(value, 'reason', LEAVE_LIMITS.reasonMaxCodePoints);
}

/**
 * Leave management (Phase 2 Step 8): employee-level whole-calendar-day requests.
 *
 * - **Lifecycle:** PENDING → APPROVED | REJECTED (APPROVE_LEAVE) | CANCELLED (the
 *   employee, PENDING only). The Step 2 trigger enforces the same transitions and
 *   freezes decided requests; nothing is deleted.
 * - **Overlap:** PENDING and APPROVED requests of one employee never share a date. Every
 *   leave write locks the employee's User row (the shared frame's user lock) before
 *   checking, so concurrent writes for one employee serialize.
 * - **Containment:** APPROVE_LEAVE over every active branch of the employee; a
 *   branchless employee needs GLOBAL authority.
 * - **Policy:** no quota, balance, carry-forward, paid/unpaid or payroll logic. The
 *   1-day-per-month baseline is documented and left to a future Leave Policy.
 */
@Injectable()
export class LeaveService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /** The caller's own request, created PENDING. The employee comes only from the session. */
  async create(
    sessionToken: string | undefined,
    input: LeaveRequestCreateRequest,
    requestId?: string,
  ): Promise<LeaveRequestResponse> {
    if (!LEAVE_TYPES.includes(input.leaveType)) {
      throw new AuthError('VALIDATION_FAILED', 'leaveType');
    }
    const startDate = parseLeaveDate(input.startDate, 'startDate');
    const endDate = parseLeaveDate(input.endDate, 'endDate');
    if (endDate < startDate) throw new AuthError('VALIDATION_FAILED', 'endDate');
    if ((endDate.getTime() - startDate.getTime()) / DAY + 1 > LEAVE_LIMITS.maxRequestDays) {
      throw new AuthError('VALIDATION_FAILED', 'endDate');
    }
    const reason = reasonText(input.reason);
    // The frame has locked the caller's User row FOR UPDATE: the overlap check and the
    // insert can't interleave with another leave write for this employee.
    return this.frame(sessionToken, requestId, [], async (context) => {
      const { tx, actor } = context;
      if (actor.principal.userKind !== 'EMPLOYEE') throw new AuthError('FORBIDDEN');
      await this.requireNoOverlap(tx, actor.userId, startDate, endDate);
      const row = await tx.leaveRequest.create({
        data: {
          employeeUserId: actor.userId,
          leaveType: input.leaveType,
          startDate,
          endDate,
          reason,
        },
        select: requestSelect,
      });
      await this.audit(context, 'LEAVE_REQUESTED', row, {
        after: { ...this.facts(row), status: row.status },
      });
      return present(row);
    });
  }

  /** The employee's own PENDING request only; APPROVED leave is never self-cancelled. */
  async cancel(
    sessionToken: string | undefined,
    requestIdentifier: string,
    input: LeaveRequestCancelRequest,
    requestId?: string,
  ): Promise<LeaveRequestResponse> {
    const id = this.id(requestIdentifier);
    const reason = input.reason === undefined ? null : reasonText(input.reason);
    return this.frame(sessionToken, requestId, this.employeeOf(id), async (context) => {
      const { tx, actor, now } = context;
      if (actor.principal.userKind !== 'EMPLOYEE') throw new AuthError('FORBIDDEN');
      const row = await this.lockRequest(tx, id);
      // Another employee's request is indistinguishable from an unknown one.
      if (!row || row.employeeUserId !== actor.userId) throw new AuthError('NOT_FOUND');
      if (row.status !== 'PENDING') throw new AuthError('CONFLICT', 'status');
      if (row.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledByUserId: actor.userId,
          cancelledAt: now,
          cancellationReason: reason,
          rowVersion: { increment: 1 },
        },
        select: requestSelect,
      });
      await this.audit(context, 'LEAVE_CANCELLED', updated, {
        reason,
        before: { ...this.facts(row), status: row.status },
        after: { ...this.facts(updated), status: updated.status },
      });
      return present(updated);
    });
  }

  async approve(
    sessionToken: string | undefined,
    requestIdentifier: string,
    input: LeaveRequestDecisionRequest,
    requestId?: string,
  ): Promise<LeaveRequestResponse> {
    const reason = input.reason === undefined ? null : reasonText(input.reason);
    return this.decide(sessionToken, requestIdentifier, input, 'APPROVED', reason, requestId);
  }

  /** Rejection always carries a reason for the employee. */
  async reject(
    sessionToken: string | undefined,
    requestIdentifier: string,
    input: LeaveRequestDecisionRequest,
    requestId?: string,
  ): Promise<LeaveRequestResponse> {
    const reason = reasonText(input.reason ?? '');
    return this.decide(sessionToken, requestIdentifier, input, 'REJECTED', reason, requestId);
  }

  /** The caller's own requests overlapping the bounded date range. */
  async listOwn(
    sessionToken: string | undefined,
    query: LeaveRequestQuery,
  ): Promise<LeaveRequestListResponse> {
    const where = this.filter(query);
    return this.frame(sessionToken, undefined, [], async ({ tx, actor }) => {
      if (actor.principal.userKind !== 'EMPLOYEE') throw new AuthError('FORBIDDEN');
      return this.query(tx, { ...where, employeeUserId: actor.userId });
    });
  }

  /**
   * Requests of the employees the caller may decide for: GLOBAL APPROVE_LEAVE covers
   * everyone; a branch grant covers only employees whose active branches all lie within
   * the caller's authorized member branches (branchless employees need GLOBAL).
   */
  async listScoped(
    sessionToken: string | undefined,
    query: LeaveRequestQuery,
  ): Promise<LeaveRequestListResponse> {
    const where = this.filter(query);
    const employeeId =
      query.employeeId === undefined ? undefined : this.id(query.employeeId, 'employeeId');
    return this.frame(sessionToken, undefined, [], async ({ tx, actor }) => {
      if (decide(actor.graph, 'APPROVE_LEAVE', GLOBAL)) {
        return this.query(tx, { ...where, ...(employeeId ? { employeeUserId: employeeId } : {}) });
      }
      const visible = this.visibleBranches(actor);
      if (visible.length === 0) throw new AuthError('FORBIDDEN');
      const contained = await this.containedEmployees(tx, visible);
      if (employeeId !== undefined && !contained.includes(employeeId)) {
        throw new AuthError('NOT_FOUND');
      }
      return this.query(tx, {
        ...where,
        employeeUserId: { in: employeeId ? [employeeId] : contained },
      });
    });
  }

  // -------------------------------------------------------------------- helpers

  private async decide(
    sessionToken: string | undefined,
    requestIdentifier: string,
    input: LeaveRequestDecisionRequest,
    status: 'APPROVED' | 'REJECTED',
    reason: string | null,
    requestId: string | undefined,
  ): Promise<LeaveRequestResponse> {
    const id = this.id(requestIdentifier);
    return this.frame(sessionToken, requestId, this.employeeOf(id), async (context) => {
      const { tx, actor, now } = context;
      const row = await this.lockRequest(tx, id);
      if (!row) throw new AuthError('NOT_FOUND');
      // Authorization before any lifecycle state is revealed.
      const branchIds = await this.activeBranches(tx, row.employeeUserId);
      requireAcross(actor, 'APPROVE_LEAVE', branchIds);
      if (actor.userId === row.employeeUserId) throw new AuthError('FORBIDDEN');
      if (row.status !== 'PENDING') throw new AuthError('CONFLICT', 'status');
      if (row.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      const updated = await tx.leaveRequest.update({
        where: { id },
        data: {
          status,
          decidedByUserId: actor.userId,
          decidedAt: now,
          decisionReason: reason,
          rowVersion: { increment: 1 },
        },
        select: requestSelect,
      });
      await this.audit(
        context,
        status === 'APPROVED' ? 'LEAVE_APPROVED' : 'LEAVE_REJECTED',
        updated,
        {
          reason,
          before: { ...this.facts(row), status: row.status },
          after: { ...this.facts(updated), status: updated.status, employeeBranchIds: branchIds },
        },
      );
      return present(updated);
    });
  }

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

  /** The request's employee (immutable in SQL), locked with the actor before any row. */
  private employeeOf(id: string) {
    return async (tx: Prisma.TransactionClient): Promise<readonly string[]> => {
      const row = await tx.leaveRequest.findUnique({
        where: { id },
        select: { employeeUserId: true },
      });
      return row ? [row.employeeUserId] : [];
    };
  }

  private id(value: string, field?: string): string {
    const id = value.toLowerCase();
    if (!isUuid(id)) {
      throw field ? new AuthError('VALIDATION_FAILED', field) : new AuthError('NOT_FOUND');
    }
    return id;
  }

  private async requireNoOverlap(
    tx: Prisma.TransactionClient,
    employeeUserId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<void> {
    const overlapping = await tx.leaveRequest.findFirst({
      where: {
        employeeUserId,
        status: { in: BLOCKING },
        startDate: { lte: endDate },
        endDate: { gte: startDate },
      },
      select: { id: true },
    });
    if (overlapping) throw new AuthError('CONFLICT', 'startDate');
  }

  private async lockRequest(tx: Prisma.TransactionClient, id: string): Promise<RequestRow | null> {
    await tx.$queryRaw`SELECT id FROM leave_requests WHERE id = ${id}::uuid FOR UPDATE`;
    return tx.leaveRequest.findUnique({ where: { id }, select: requestSelect });
  }

  private async activeBranches(tx: Prisma.TransactionClient, employeeUserId: string) {
    const rows = await tx.employeeBranchAssignment.findMany({
      where: { employeeUserId, revokedAt: null },
      select: { branchId: true },
      orderBy: { branchId: 'asc' },
    });
    return rows.map((row) => row.branchId);
  }

  private visibleBranches(actor: AdminActor): string[] {
    return [...actor.graph.activeBranchIds].filter((branchId) =>
      decide(actor.graph, 'APPROVE_LEAVE', { kind: 'BRANCH', branchId }),
    );
  }

  /** Employees with at least one active branch, all of them inside `visible`. */
  private async containedEmployees(
    tx: Prisma.TransactionClient,
    visible: readonly string[],
  ): Promise<string[]> {
    const candidates = await tx.employeeBranchAssignment.findMany({
      where: { revokedAt: null, branchId: { in: [...visible] } },
      select: { employeeUserId: true },
      distinct: ['employeeUserId'],
    });
    const ids = candidates.map((row) => row.employeeUserId);
    if (ids.length === 0) return [];
    const outside = await tx.employeeBranchAssignment.findMany({
      where: { revokedAt: null, employeeUserId: { in: ids }, branchId: { notIn: [...visible] } },
      select: { employeeUserId: true },
      distinct: ['employeeUserId'],
    });
    const excluded = new Set(outside.map((row) => row.employeeUserId));
    return ids.filter((id) => !excluded.has(id));
  }

  private filter(query: LeaveRequestQuery): Prisma.LeaveRequestWhereInput {
    const today = parseLeaveDate(new Date().toISOString().slice(0, 10), 'to');
    const from =
      query.from === undefined
        ? new Date(today.getTime() - LEAVE_LIMITS.defaultPastDays * DAY)
        : parseLeaveDate(query.from, 'from');
    const to =
      query.to === undefined
        ? new Date(today.getTime() + LEAVE_LIMITS.defaultFutureDays * DAY)
        : parseLeaveDate(query.to, 'to');
    if (from > to || (to.getTime() - from.getTime()) / DAY + 1 > LEAVE_LIMITS.maxRangeDays) {
      throw new AuthError('VALIDATION_FAILED', 'from');
    }
    if (query.status !== undefined && !LEAVE_STATUSES.includes(query.status)) {
      throw new AuthError('VALIDATION_FAILED', 'status');
    }
    return {
      startDate: { lte: to },
      endDate: { gte: from },
      ...(query.status ? { status: query.status } : {}),
    };
  }

  private async query(
    tx: Prisma.TransactionClient,
    where: Prisma.LeaveRequestWhereInput,
  ): Promise<LeaveRequestListResponse> {
    const rows = await tx.leaveRequest.findMany({
      where,
      select: requestSelect,
      orderBy: [{ startDate: 'desc' }, { requestedAt: 'desc' }, { id: 'asc' }],
      take: LEAVE_LIMITS.maxRecords,
    });
    return { requests: rows.map(present) };
  }

  private facts(row: RequestRow): Prisma.InputJsonObject {
    return {
      leaveType: row.leaveType,
      startDate: day(row.startDate),
      endDate: day(row.endDate),
    };
  }

  /** Leave is employee-level: the audit event carries no single branch. */
  private audit(
    context: AdminContext,
    action: string,
    row: RequestRow,
    detail: {
      reason?: string | null;
      before?: Prisma.InputJsonObject;
      after: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    return appendAdminAudit(context, {
      action,
      entityType: 'LeaveRequest',
      entityId: row.id,
      subjectUserId: row.employeeUserId,
      branchId: null,
      reason: detail.reason ?? null,
      ...(detail.before ? { before: detail.before } : {}),
      after: detail.after,
    });
  }
}

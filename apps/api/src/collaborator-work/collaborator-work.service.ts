import type {
  CollaboratorWorkCancelRequest,
  CollaboratorWorkCreateRequest,
  CollaboratorWorkListResponse,
  CollaboratorWorkOccurrence,
  CollaboratorWorkOptionsResponse,
  CollaboratorWorkQuery,
  CollaboratorWorkUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';
import { SessionService } from '../auth/session.service.js';
import {
  runAdminCommand,
  type AdminActor,
  type AdminContext,
} from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { isUuid } from '../employees/employee.input.js';
import { businessToday, classificationOn, day } from '../employees/employment.js';
import {
  branchWindow,
  COLLABORATOR_WORK_LIMITS,
  formatMinute,
  overlaps,
  parseAgreedPay,
  parseTime,
  parseWorkDate,
  type WorkWindow,
} from './collaborator-work.rules.js';

const occurrenceSelect = {
  id: true,
  employeeUserId: true,
  branchId: true,
  workDate: true,
  mode: true,
  startMinute: true,
  endMinute: true,
  agreedPayVnd: true,
  status: true,
  note: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  updatedAt: true,
  rowVersion: true,
  employee: {
    select: { employeeCodeCanonical: true, user: { select: { fullName: true } } },
  },
} satisfies Prisma.CollaboratorWorkOccurrenceSelect;

type OccurrenceRow = Prisma.CollaboratorWorkOccurrenceGetPayload<{
  select: typeof occurrenceSelect;
}>;

type Mode = 'SHIFT' | 'FULL_DAY';

interface Plan {
  branchId: string;
  workDate: Date;
  mode: Mode;
  window: WorkWindow;
}

const at = (branchId: string) => ({ kind: 'BRANCH', branchId }) as const;

function reasonOf(value: string | undefined): string | null {
  return value === undefined
    ? null
    : text(value, 'reason', COLLABORATOR_WORK_LIMITS.reasonMaxCodePoints);
}

function noteOf(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  return value.trim() === ''
    ? null
    : text(value, 'note', COLLABORATOR_WORK_LIMITS.noteMaxCodePoints);
}

function uuid(value: string | undefined, field: string): string {
  if (value === undefined || !isUuid(value.toLowerCase())) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value.toLowerCase();
}

/**
 * "Lịch làm CTV / Collaborator schedule" (follow-up Step 6). One authoritative row per
 * collaborator work occurrence at one branch on one branch-local date:
 *
 * - who: COLLABORATOR on that work date, not INACTIVE, with an active assignment at the
 *   branch; never the Owner, never oneself (non-Owner actors);
 * - when: SHIFT inside the branch hours of that date; FULL_DAY = those hours, snapshotted;
 *   closed days refused; no overlap with the collaborator's other SCHEDULED work (any
 *   branch), serialized by the collaborator's user lock;
 * - pay: entered manually (MANAGE_EMPLOYEE_PAY at the branch), never derived from hours or
 *   attendance; shown only to the collaborator or with pay visibility at the branch;
 * - past dates: allowed for authorized management with a reason; nothing is deleted.
 */
@Injectable()
export class CollaboratorWorkService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  async create(
    sessionToken: string | undefined,
    input: CollaboratorWorkCreateRequest,
    requestId?: string,
  ): Promise<CollaboratorWorkOccurrence> {
    const employeeId = uuid(input.employeeId, 'employeeId');
    const branchId = uuid(input.branchId, 'branchId');
    const workDate = parseWorkDate(input.workDate);
    const pay = parseAgreedPay(input.agreedPayVnd);
    const note = noteOf(input.note) ?? null;
    const reason = reasonOf(input.reason);
    return this.run(
      sessionToken,
      requestId,
      async () => [employeeId],
      async (context) => {
        const { tx, actor } = context;
        this.requireSchedule(actor, branchId);
        if (pay !== undefined && pay !== null) this.requirePay(actor, [branchId]);
        await this.requireCollaborator(context, employeeId);
        const plan = await this.plan(tx, employeeId, {
          branchId,
          workDate,
          mode: input.mode,
          startTime: input.startTime,
          endTime: input.endTime,
        });
        await this.requireReasonIfPast(tx, [plan], reason);
        await this.requireFree(tx, employeeId, plan, null);
        const created = await tx.collaboratorWorkOccurrence.create({
          data: {
            employeeUserId: employeeId,
            branchId: plan.branchId,
            workDate: plan.workDate,
            mode: plan.mode,
            startMinute: plan.window.startMinute,
            endMinute: plan.window.endMinute,
            agreedPayVnd: pay ?? null,
            note,
            createdByUserId: actor.userId,
            updatedByUserId: actor.userId,
          },
          select: occurrenceSelect,
        });
        await this.audit(context, 'COLLABORATOR_WORK_SCHEDULED', created, reason, null);
        return this.present(actor, created);
      },
    );
  }

  async update(
    sessionToken: string | undefined,
    id: string,
    input: CollaboratorWorkUpdateRequest,
    requestId?: string,
  ): Promise<CollaboratorWorkOccurrence> {
    const occurrenceId = uuid(id, 'id');
    const pay = parseAgreedPay(input.agreedPayVnd);
    const note = noteOf(input.note);
    const reason = reasonOf(input.reason);
    const newBranch = input.branchId === undefined ? undefined : uuid(input.branchId, 'branchId');
    const newDate = input.workDate === undefined ? undefined : parseWorkDate(input.workDate);
    return this.run(
      sessionToken,
      requestId,
      (tx) => this.ownerOf(tx, occurrenceId),
      async (context) => {
        const { tx, actor } = context;
        const before = await this.load(tx, occurrenceId);
        if (before.status !== 'SCHEDULED') throw new AuthError('CONFLICT', 'status');
        if (before.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
        const branchId = newBranch ?? before.branchId;
        this.requireSchedule(actor, before.branchId);
        this.requireSchedule(actor, branchId);
        const payChanged = pay !== undefined && pay !== before.agreedPayVnd;
        // Moving a priced occurrence moves its cost: pay authority at both branches.
        if (payChanged || (branchId !== before.branchId && before.agreedPayVnd !== null)) {
          this.requirePay(actor, [before.branchId, branchId]);
        }
        await this.requireCollaborator(context, before.employeeUserId);
        const workDate = newDate ?? before.workDate;
        const mode = input.mode ?? before.mode;
        const keepSnapshot =
          mode === 'FULL_DAY' &&
          before.mode === 'FULL_DAY' &&
          branchId === before.branchId &&
          day(workDate) === day(before.workDate);
        const plan = keepSnapshot
          ? {
              branchId,
              workDate,
              mode,
              window: { startMinute: before.startMinute, endMinute: before.endMinute },
            }
          : await this.plan(tx, before.employeeUserId, {
              branchId,
              workDate,
              mode,
              startTime:
                input.startTime ??
                (mode === 'SHIFT' ? formatMinute(before.startMinute) : undefined),
              endTime:
                input.endTime ?? (mode === 'SHIFT' ? formatMinute(before.endMinute) : undefined),
            });
        if (keepSnapshot) {
          // Re-check who and where even when the agreed window is kept.
          await this.requireEligible(tx, before.employeeUserId, branchId, workDate);
        }
        await this.requireReasonIfPast(
          tx,
          [plan, { branchId: before.branchId, workDate: before.workDate }],
          reason,
        );
        await this.requireFree(tx, before.employeeUserId, plan, before.id);
        const updated = await tx.collaboratorWorkOccurrence.update({
          where: { id: before.id },
          data: {
            branchId: plan.branchId,
            workDate: plan.workDate,
            mode: plan.mode,
            startMinute: plan.window.startMinute,
            endMinute: plan.window.endMinute,
            ...(payChanged ? { agreedPayVnd: pay } : {}),
            ...(note !== undefined ? { note } : {}),
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
          select: occurrenceSelect,
        });
        await this.audit(context, 'COLLABORATOR_WORK_CHANGED', updated, reason, before);
        return this.present(actor, updated);
      },
    );
  }

  async cancel(
    sessionToken: string | undefined,
    id: string,
    input: CollaboratorWorkCancelRequest,
    requestId?: string,
  ): Promise<CollaboratorWorkOccurrence> {
    const occurrenceId = uuid(id, 'id');
    const reason = text(input.reason ?? '', 'reason', COLLABORATOR_WORK_LIMITS.reasonMaxCodePoints);
    return this.run(
      sessionToken,
      requestId,
      (tx) => this.ownerOf(tx, occurrenceId),
      async (context) => {
        const { tx, actor, now } = context;
        const before = await this.load(tx, occurrenceId);
        this.requireSchedule(actor, before.branchId);
        if (!actor.owner && before.employeeUserId === actor.userId) {
          throw new AuthError('FORBIDDEN');
        }
        if (before.status !== 'SCHEDULED') throw new AuthError('CONFLICT', 'status');
        if (before.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
        const cancelled = await tx.collaboratorWorkOccurrence.update({
          where: { id: before.id },
          data: {
            status: 'CANCELLED',
            cancelledByUserId: actor.userId,
            cancelledAt: now,
            cancelReason: reason,
            updatedByUserId: actor.userId,
            rowVersion: { increment: 1 },
          },
          select: occurrenceSelect,
        });
        await this.audit(context, 'COLLABORATOR_WORK_CANCELLED', cancelled, reason, before);
        return this.present(actor, cancelled);
      },
    );
  }

  /** Occurrences at branches the caller may view (VIEW_ or MANAGE_WORK_SCHEDULE there). */
  async list(
    sessionToken: string | undefined,
    query: CollaboratorWorkQuery,
  ): Promise<CollaboratorWorkListResponse> {
    const range = this.range(query);
    const branchId = query.branchId === undefined ? undefined : uuid(query.branchId, 'branchId');
    const employeeId =
      query.employeeId === undefined ? undefined : uuid(query.employeeId, 'employeeId');
    return this.run(sessionToken, undefined, undefined, async ({ tx, actor }) => {
      const rows = await tx.collaboratorWorkOccurrence.findMany({
        where: {
          workDate: { gte: range.from, lte: range.to },
          ...(branchId ? { branchId } : {}),
          ...(employeeId ? { employeeUserId: employeeId } : {}),
          ...(query.status ? { status: query.status } : {}),
        },
        orderBy: [{ workDate: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
        select: occurrenceSelect,
      });
      const visible = rows.filter(
        (row) =>
          decide(actor.graph, 'VIEW_WORK_SCHEDULE', at(row.branchId)) ||
          decide(actor.graph, 'MANAGE_WORK_SCHEDULE', at(row.branchId)),
      );
      return { items: visible.map((row) => this.present(actor, row)) };
    });
  }

  /** The signed-in member's own occurrences, with their own agreed pay (no permission). */
  async mine(
    sessionToken: string | undefined,
    query: Pick<CollaboratorWorkQuery, 'from' | 'to'>,
  ): Promise<CollaboratorWorkListResponse> {
    const range = this.range(query);
    return this.run(sessionToken, undefined, undefined, async ({ tx, actor }) => {
      const rows = await tx.collaboratorWorkOccurrence.findMany({
        where: { employeeUserId: actor.userId, workDate: { gte: range.from, lte: range.to } },
        orderBy: [{ workDate: 'asc' }, { startMinute: 'asc' }, { id: 'asc' }],
        select: occurrenceSelect,
      });
      return { items: rows.map((row) => this.present(actor, row)) };
    });
  }

  /** Scheduling aid: the branch hours of the date and who can be scheduled there. */
  async options(
    sessionToken: string | undefined,
    query: { branchId?: string; workDate?: string },
  ): Promise<CollaboratorWorkOptionsResponse> {
    const branchId = uuid(query.branchId, 'branchId');
    const workDate = parseWorkDate(query.workDate);
    return this.run(sessionToken, undefined, undefined, async ({ tx, actor }) => {
      this.requireSchedule(actor, branchId);
      const window = await branchWindow(tx, branchId, workDate);
      const assigned = await tx.employeeBranchAssignment.findMany({
        where: {
          branchId,
          revokedAt: null,
          employee: { user: { kind: 'EMPLOYEE', status: { not: 'INACTIVE' } } },
        },
        select: {
          employee: {
            select: {
              userId: true,
              employeeCodeCanonical: true,
              user: { select: { fullName: true } },
            },
          },
        },
        orderBy: { employee: { employeeCodeCanonical: 'asc' } },
      });
      const collaborators: CollaboratorWorkOptionsResponse['collaborators'] = [];
      for (const { employee } of assigned) {
        if (!actor.owner && employee.userId === actor.userId) continue;
        const on = await classificationOn(tx, employee.userId, workDate);
        if (on?.classification !== 'COLLABORATOR') continue;
        collaborators.push({
          id: employee.userId,
          employeeCode: employee.employeeCodeCanonical,
          fullName: employee.user.fullName,
        });
      }
      return {
        window: window
          ? { startTime: formatMinute(window.startMinute), endTime: formatMinute(window.endMinute) }
          : null,
        collaborators,
      };
    });
  }

  // ---------------------------------------------------------------- rules

  private requireSchedule(actor: AdminActor, branchId: string): void {
    if (!decide(actor.graph, 'MANAGE_WORK_SCHEDULE', at(branchId))) {
      throw new AuthError('FORBIDDEN');
    }
  }

  private requirePay(actor: AdminActor, branchIds: string[]): void {
    for (const branchId of new Set(branchIds)) {
      if (!decide(actor.graph, 'MANAGE_EMPLOYEE_PAY', at(branchId))) {
        throw new AuthError('FORBIDDEN', 'agreedPayVnd');
      }
    }
  }

  /** The target is an employee (never the Owner), not INACTIVE, and not the actor. */
  private async requireCollaborator(context: AdminContext, employeeId: string): Promise<void> {
    const { tx, actor } = context;
    if (!actor.owner && employeeId === actor.userId) throw new AuthError('FORBIDDEN');
    const user = await tx.user.findUnique({
      where: { id: employeeId },
      select: { kind: true, status: true, employeeProfile: { select: { userId: true } } },
    });
    if (!user || user.kind !== 'EMPLOYEE' || !user.employeeProfile) {
      throw new AuthError('NOT_FOUND');
    }
    if (user.status === 'INACTIVE') throw new AuthError('CONFLICT', 'status');
  }

  /** COLLABORATOR on the work date, and an active assignment at an active branch. */
  private async requireEligible(
    tx: Prisma.TransactionClient,
    employeeId: string,
    branchId: string,
    workDate: Date,
  ): Promise<void> {
    const on = await classificationOn(tx, employeeId, workDate);
    if (on?.classification !== 'COLLABORATOR') throw new AuthError('CONFLICT', 'classification');
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { isActive: true },
    });
    if (!branch?.isActive) throw new AuthError('CONFLICT', 'branch');
    const assignment = await tx.employeeBranchAssignment.findFirst({
      where: { employeeUserId: employeeId, branchId, revokedAt: null },
      select: { id: true },
    });
    if (!assignment) throw new AuthError('CONFLICT', 'branchAssignment');
  }

  /** Who/where checks, then the window: SHIFT inside the hours, FULL_DAY = the hours. */
  private async plan(
    tx: Prisma.TransactionClient,
    employeeId: string,
    input: {
      branchId: string;
      workDate: Date;
      mode: string;
      startTime: string | undefined;
      endTime: string | undefined;
    },
  ): Promise<Plan> {
    if (input.mode !== 'SHIFT' && input.mode !== 'FULL_DAY') {
      throw new AuthError('VALIDATION_FAILED', 'mode');
    }
    await this.requireEligible(tx, employeeId, input.branchId, input.workDate);
    const hours = await branchWindow(tx, input.branchId, input.workDate);
    if (!hours) throw new AuthError('CONFLICT', 'branchClosed');
    if (input.mode === 'FULL_DAY') {
      return {
        branchId: input.branchId,
        workDate: input.workDate,
        mode: 'FULL_DAY',
        window: hours,
      };
    }
    const startMinute = parseTime(input.startTime, 'startTime');
    const endMinute = parseTime(input.endTime, 'endTime');
    if (startMinute >= endMinute) throw new AuthError('VALIDATION_FAILED', 'endTime');
    if (startMinute < hours.startMinute || endMinute > hours.endMinute) {
      throw new AuthError('CONFLICT', 'branchHours');
    }
    return {
      branchId: input.branchId,
      workDate: input.workDate,
      mode: 'SHIFT',
      window: { startMinute, endMinute },
    };
  }

  /** A work date before the branch-local today needs a reason (Owner decision Q8). */
  private async requireReasonIfPast(
    tx: Prisma.TransactionClient,
    dates: { branchId: string; workDate: Date }[],
    reason: string | null,
  ): Promise<void> {
    for (const { branchId, workDate } of dates) {
      if (workDate < (await businessToday(tx, [branchId])) && reason === null) {
        throw new AuthError('VALIDATION_FAILED', 'reason');
      }
    }
  }

  /** No overlap with the collaborator's other SCHEDULED work that date, at any branch. */
  private async requireFree(
    tx: Prisma.TransactionClient,
    employeeId: string,
    plan: Plan,
    exceptId: string | null,
  ): Promise<void> {
    const others = await tx.collaboratorWorkOccurrence.findMany({
      where: {
        employeeUserId: employeeId,
        workDate: plan.workDate,
        status: 'SCHEDULED',
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { mode: true, startMinute: true, endMinute: true },
    });
    for (const other of others) {
      if (plan.mode === 'FULL_DAY' || other.mode === 'FULL_DAY' || overlaps(plan.window, other)) {
        throw new AuthError('CONFLICT', 'overlap');
      }
    }
  }

  // ---------------------------------------------------------------- plumbing

  private range(query: { from?: string; to?: string }): { from: Date; to: Date } {
    const from = parseWorkDate(query.from, 'from');
    const to = parseWorkDate(query.to, 'to');
    const days = (to.getTime() - from.getTime()) / 86_400_000;
    if (days < 0 || days > COLLABORATOR_WORK_LIMITS.maxRangeDays) {
      throw new AuthError('VALIDATION_FAILED', 'to');
    }
    return { from, to };
  }

  private run<T>(
    sessionToken: string | undefined,
    requestId: string | undefined,
    lockUsers: ((tx: Prisma.TransactionClient) => Promise<readonly string[]>) | undefined,
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive: false, requestId, ...(lockUsers ? { lockUsers } : {}) },
      work,
    );
  }

  /** The collaborator to lock (their user row serializes overlap checks). */
  private async ownerOf(tx: Prisma.TransactionClient, id: string): Promise<string[]> {
    const row = await tx.collaboratorWorkOccurrence.findUnique({
      where: { id },
      select: { employeeUserId: true },
    });
    if (!row) throw new AuthError('NOT_FOUND');
    return [row.employeeUserId];
  }

  private async load(tx: Prisma.TransactionClient, id: string): Promise<OccurrenceRow> {
    const row = await tx.collaboratorWorkOccurrence.findUnique({
      where: { id },
      select: occurrenceSelect,
    });
    if (!row) throw new AuthError('NOT_FOUND');
    return row;
  }

  /** Pay only for the collaborator themself or with pay visibility at the branch. */
  private present(actor: AdminActor, row: OccurrenceRow): CollaboratorWorkOccurrence {
    const payVisible =
      row.employeeUserId === actor.userId ||
      decide(actor.graph, 'VIEW_EMPLOYEE_PAY', at(row.branchId)) ||
      decide(actor.graph, 'MANAGE_EMPLOYEE_PAY', at(row.branchId));
    return {
      id: row.id,
      employeeId: row.employeeUserId,
      employeeCode: row.employee.employeeCodeCanonical,
      employeeName: row.employee.user.fullName,
      branchId: row.branchId,
      workDate: day(row.workDate),
      mode: row.mode,
      startTime: formatMinute(row.startMinute),
      endTime: formatMinute(row.endMinute),
      ...(payVisible
        ? { agreedPayVnd: row.agreedPayVnd === null ? null : row.agreedPayVnd.toString() }
        : {}),
      status: row.status,
      note: row.note,
      cancelledAt: row.cancelledAt?.toISOString() ?? null,
      cancelReason: row.cancelReason,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.rowVersion,
    };
  }

  /** Before/after snapshots including pay: EMPLOYEE_PAY-classified audit. */
  private async audit(
    context: AdminContext,
    action: string,
    after: OccurrenceRow,
    reason: string | null,
    before: OccurrenceRow | null,
  ): Promise<void> {
    const snapshot = (row: OccurrenceRow): Prisma.InputJsonObject => ({
      branchId: row.branchId,
      workDate: day(row.workDate),
      mode: row.mode,
      startTime: formatMinute(row.startMinute),
      endTime: formatMinute(row.endMinute),
      agreedPayVnd: row.agreedPayVnd === null ? null : row.agreedPayVnd.toString(),
      status: row.status,
    });
    await context.tx.auditEvent.create({
      data: {
        action,
        actorKind: 'USER',
        actorUserId: context.actor.userId,
        subjectUserId: after.employeeUserId,
        entityType: 'CollaboratorWorkOccurrence',
        entityId: after.id,
        branchId: after.branchId,
        requestId: context.requestId,
        occurredAt: context.now,
        reason,
        ...(before ? { before: snapshot(before) } : {}),
        after: snapshot(after),
        dataClassification: 'EMPLOYEE_PAY',
      },
      select: { id: true },
    });
  }
}

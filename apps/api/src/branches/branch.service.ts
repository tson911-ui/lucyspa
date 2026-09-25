import { randomUUID } from 'node:crypto';
import type {
  BranchCreateRequest,
  BranchHoursUpdateRequest,
  BranchListResponse,
  BranchOperatingDay,
  BranchResponse,
  BranchStatusRequest,
  BranchSummary,
  BranchUpdateRequest,
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
import {
  checkGraphChange,
  decide,
  GLOBAL,
  type AuthorityGraph,
} from '../authorization/authorization.js';
import {
  invalidateAuthorization,
  loadAuthorityGraph,
} from '../authorization/authorization.store.js';
import { isUuid, normalizeReason } from '../employees/employee.input.js';
import {
  DEFAULT_OPERATING_HOURS,
  DEFAULT_TIMEZONE,
  formatLocalTime,
  normalizeBranchCode,
  normalizeBranchName,
  normalizeOperatingDays,
  normalizeOptionalReason,
  normalizeTimezone,
  type OperatingDay,
} from './branch.input.js';

const branchSelect = {
  id: true,
  code: true,
  name: true,
  timezone: true,
  isActive: true,
  rowVersion: true,
} satisfies Prisma.BranchSelect;

const hoursSelect = {
  isoWeekday: true,
  isClosed: true,
  opensAtMinute: true,
  closesAtMinute: true,
} satisfies Prisma.BranchOperatingHoursSelect;

type BranchRow = Prisma.BranchGetPayload<{ select: typeof branchSelect }>;

function summary(branch: BranchRow): BranchSummary {
  return {
    id: branch.id,
    code: branch.code,
    name: branch.name,
    timezone: branch.timezone,
    isActive: branch.isActive,
    version: branch.rowVersion,
  };
}

function presentDay(day: OperatingDay): BranchOperatingDay {
  return {
    isoWeekday: day.isoWeekday as BranchOperatingDay['isoWeekday'],
    isClosed: day.isClosed,
    opensAt: formatLocalTime(day.opensAtMinute),
    closesAt: formatLocalTime(day.closesAtMinute),
  };
}

/** Allowlisted audit snapshot of one day: weekday and wall-clock times only. */
function auditDay(day: OperatingDay): Prisma.InputJsonObject {
  return presentDay(day) as unknown as Prisma.InputJsonObject;
}

/**
 * Branch administration (Phase 2 Step 3). Every command runs in the shared admin frame
 * with transaction-time authorization and same-transaction audit.
 *
 * - Create is GLOBAL `MANAGE_BRANCHES`, with default 09:00–21:00 hours in the same
 *   transaction.
 * - Rename, timezone and hours need `MANAGE_BRANCHES` for that branch.
 * - Activation changes members' effective authority, so it is a security-graph change:
 *   exclusive lock, GLOBAL `MANAGE_BRANCHES`, an escalation check for every member,
 *   then an `authzVersion` bump and session revocation.
 * - Branches are never deleted.
 */
@Injectable()
export class BranchService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /**
   * Branches the caller may see: every branch with GLOBAL `MANAGE_BRANCHES` (Owner
   * included), otherwise the active branches the caller is a member of.
   */
  async list(sessionToken: string | undefined): Promise<BranchListResponse> {
    return this.frame(sessionToken, false, undefined, [], async ({ tx, actor }) => {
      const all = this.managesAll(actor);
      const branches = await tx.branch.findMany({
        where: all ? {} : { id: { in: [...actor.graph.activeBranchIds] } },
        select: branchSelect,
        orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      });
      return { branches: branches.map(summary) };
    });
  }

  async get(sessionToken: string | undefined, branchId: string): Promise<BranchResponse> {
    const id = this.id(branchId);
    return this.frame(sessionToken, false, undefined, [], async ({ tx, actor }) => {
      if (!this.visible(actor, id)) throw new AuthError('NOT_FOUND');
      const branch = await tx.branch.findUnique({ where: { id }, select: branchSelect });
      if (!branch) throw new AuthError('NOT_FOUND');
      return this.present(tx, branch);
    });
  }

  async create(
    sessionToken: string | undefined,
    input: BranchCreateRequest,
    requestId?: string,
  ): Promise<BranchResponse> {
    const code = normalizeBranchCode(input.code);
    const name = normalizeBranchName(input.name);
    const timezone = normalizeTimezone(input.timezone ?? DEFAULT_TIMEZONE);
    const isActive = input.isActive ?? true;
    const reason = normalizeOptionalReason(input.reason);
    return this.frame(sessionToken, false, requestId, [], async (context) => {
      const { tx } = context;
      requireAcross(context.actor, 'MANAGE_BRANCHES', []);
      await this.requireDatabaseTimezone(tx, timezone);
      if (await tx.branch.findUnique({ where: { code }, select: { id: true } })) {
        throw new AuthError('CONFLICT', 'code');
      }
      const id = randomUUID();
      const branch = await tx.branch.create({
        data: { id, code, name, timezone, isActive },
        select: branchSelect,
      });
      await tx.branchOperatingHours.createMany({
        data: [1, 2, 3, 4, 5, 6, 7].map((isoWeekday) => ({
          branchId: id,
          isoWeekday,
          isClosed: false,
          ...DEFAULT_OPERATING_HOURS,
        })),
      });
      await appendAdminAudit(context, {
        action: 'BRANCH_CREATED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        reason,
        after: {
          code,
          name,
          timezone,
          isActive,
          hours: { days: 'MON-SUN', opensAt: '09:00', closesAt: '21:00' },
        },
      });
      return this.present(tx, branch);
    });
  }

  /**
   * Name and timezone for one branch. The code is immutable. The timezone can change
   * only while the branch has no attendance, since business dates depend on it.
   */
  async update(
    sessionToken: string | undefined,
    branchId: string,
    input: BranchUpdateRequest,
    requestId?: string,
  ): Promise<BranchResponse> {
    const id = this.id(branchId);
    const name = input.name === undefined ? undefined : normalizeBranchName(input.name);
    const timezone = input.timezone === undefined ? undefined : normalizeTimezone(input.timezone);
    if (name === undefined && timezone === undefined) throw new AuthError('VALIDATION_FAILED');
    const reason = normalizeOptionalReason(input.reason);
    return this.frame(sessionToken, false, requestId, [], async (context) => {
      const { tx } = context;
      const branch = await this.lockBranch(context, id, input.expectedVersion);
      const changes: { name?: string; timezone?: string } = {};
      if (name !== undefined && name !== branch.name) changes.name = name;
      if (timezone !== undefined && timezone !== branch.timezone) {
        await this.requireDatabaseTimezone(tx, timezone);
        const attendance = await tx.attendanceRecord.count({ where: { branchId: id }, take: 1 });
        if (attendance > 0) throw new AuthError('CONFLICT', 'timezone');
        changes.timezone = timezone;
      }
      if (Object.keys(changes).length === 0) throw new AuthError('VALIDATION_FAILED');
      const updated = await tx.branch.update({
        where: { id },
        data: { ...changes, rowVersion: { increment: 1 } },
        select: branchSelect,
      });
      await appendAdminAudit(context, {
        action: 'BRANCH_UPDATED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        reason,
        before: Object.fromEntries(
          Object.keys(changes).map((key) => [key, branch[key as keyof typeof changes]]),
        ),
        after: changes,
      });
      return this.present(tx, updated);
    });
  }

  /** Activation or deactivation, as a security-graph change (see class comment). */
  async setStatus(
    sessionToken: string | undefined,
    branchId: string,
    input: BranchStatusRequest,
    requestId?: string,
  ): Promise<BranchResponse> {
    const id = this.id(branchId);
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, this.membersOf(id), async (context) => {
      const { tx, actor, now } = context;
      requireAcross(actor, 'MANAGE_BRANCHES', []);
      const branch = await this.lockBranch(context, id, input.expectedVersion, false);
      if (branch.isActive === input.isActive) throw new AuthError('CONFLICT', 'isActive');
      const members = await this.memberIds(tx, id);
      const before = new Map<string, AuthorityGraph>();
      for (const userId of members) {
        const graph = await loadAuthorityGraph(tx, userId);
        if (graph) before.set(userId, graph);
      }
      const updated = await tx.branch.update({
        where: { id },
        data: { isActive: input.isActive, rowVersion: { increment: 1 } },
        select: branchSelect,
      });
      // Reactivation revives dormant branch grants: every gain must be held by the actor.
      for (const [userId, previous] of before) {
        const after = await loadAuthorityGraph(tx, userId);
        if (!after || checkGraphChange(actor.graph, previous, after) !== null) {
          throw new AuthError('FORBIDDEN');
        }
      }
      const sessionCounts = new Map<string, number>();
      for (const userId of members) {
        sessionCounts.set(userId, await tx.session.count({ where: { userId, revokedAt: null } }));
      }
      await invalidateAuthorization(tx, members, now);
      await appendAdminAudit(context, {
        action: 'BRANCH_STATUS_CHANGED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        reason,
        before: { isActive: branch.isActive },
        after: { isActive: input.isActive, affectedMembers: members.length },
      });
      for (const [userId, revokedSessions] of sessionCounts) {
        if (revokedSessions === 0) continue;
        await appendAdminAudit(context, {
          action: 'SESSIONS_REVOKED',
          entityType: 'User',
          entityId: userId,
          subjectUserId: userId,
          branchId: id,
          after: { reason: 'BRANCH_STATUS_CHANGED', revokedSessions },
        });
      }
      return this.present(tx, updated);
    });
  }

  /** Regular weekly hours; the listed weekdays are replaced, the others kept. */
  async setHours(
    sessionToken: string | undefined,
    branchId: string,
    input: BranchHoursUpdateRequest,
    requestId?: string,
  ): Promise<BranchResponse> {
    const id = this.id(branchId);
    const days = normalizeOperatingDays(input.days);
    const reason = normalizeOptionalReason(input.reason);
    return this.frame(sessionToken, false, requestId, [], async (context) => {
      const { tx } = context;
      await this.lockBranch(context, id, input.expectedVersion);
      const existing = new Map(
        (
          await tx.branchOperatingHours.findMany({ where: { branchId: id }, select: hoursSelect })
        ).map((row) => [row.isoWeekday, row as OperatingDay]),
      );
      const changed = days.filter((day) => {
        const current = existing.get(day.isoWeekday);
        return (
          !current ||
          current.isClosed !== day.isClosed ||
          current.opensAtMinute !== day.opensAtMinute ||
          current.closesAtMinute !== day.closesAtMinute
        );
      });
      if (changed.length === 0) throw new AuthError('VALIDATION_FAILED', 'days');
      for (const day of changed) {
        const values = {
          isClosed: day.isClosed,
          opensAtMinute: day.opensAtMinute,
          closesAtMinute: day.closesAtMinute,
        };
        await tx.branchOperatingHours.upsert({
          where: { branchId_isoWeekday: { branchId: id, isoWeekday: day.isoWeekday } },
          create: { branchId: id, isoWeekday: day.isoWeekday, ...values },
          update: { ...values, rowVersion: { increment: 1 } },
          select: { id: true },
        });
      }
      const updated = await tx.branch.update({
        where: { id },
        data: { rowVersion: { increment: 1 } },
        select: branchSelect,
      });
      await appendAdminAudit(context, {
        action: 'BRANCH_HOURS_CHANGED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        reason,
        before: {
          days: changed.map((day) => {
            const current = existing.get(day.isoWeekday);
            return current ? auditDay(current) : { isoWeekday: day.isoWeekday, configured: false };
          }),
        },
        after: { days: changed.map(auditDay) },
      });
      return this.present(tx, updated);
    });
  }

  private frame<T>(
    sessionToken: string | undefined,
    exclusive: boolean,
    requestId: string | undefined,
    users: readonly string[] | ((tx: Prisma.TransactionClient) => Promise<readonly string[]>),
    work: (context: AdminContext) => Promise<T>,
  ): Promise<T> {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      {
        exclusive,
        requestId,
        lockUsers: typeof users === 'function' ? users : () => Promise.resolve(users),
      },
      work,
    );
  }

  private id(value: string): string {
    const id = value.toLowerCase();
    if (!isUuid(id)) throw new AuthError('NOT_FOUND');
    return id;
  }

  private managesAll(actor: AdminActor): boolean {
    return decide(actor.graph, 'MANAGE_BRANCHES', GLOBAL);
  }

  private visible(actor: AdminActor, branchId: string): boolean {
    return this.managesAll(actor) || actor.graph.activeBranchIds.has(branchId);
  }

  /**
   * Locks the branch row after the frame's User locks. Unknown or invisible branches are
   * 404. The action permission is checked for that branch (`perBranch`) or globally.
   */
  private async lockBranch(
    context: AdminContext,
    id: string,
    expectedVersion: number,
    perBranch = true,
  ): Promise<BranchRow> {
    const { tx, actor } = context;
    if (!this.visible(actor, id)) throw new AuthError('NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM branches WHERE id = ${id}::uuid FOR UPDATE`;
    const branch = await tx.branch.findUnique({ where: { id }, select: branchSelect });
    if (!branch) throw new AuthError('NOT_FOUND');
    if (perBranch) requireAcross(actor, 'MANAGE_BRANCHES', [id]);
    if (branch.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
    return branch;
  }

  /** The zone must exist in PostgreSQL, whose zone list the attendance trigger uses. */
  private async requireDatabaseTimezone(tx: Prisma.TransactionClient, zone: string) {
    const rows = await tx.$queryRaw<{ found: boolean }[]>`
      SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = ${zone}) AS found`;
    if (!rows[0]?.found) throw new AuthError('VALIDATION_FAILED', 'timezone');
  }

  private membersOf(branchId: string) {
    return (tx: Prisma.TransactionClient) => this.memberIds(tx, branchId);
  }

  private async memberIds(tx: Prisma.TransactionClient, branchId: string): Promise<string[]> {
    if (!isUuid(branchId)) return [];
    const rows = await tx.employeeBranchAssignment.findMany({
      where: { branchId, revokedAt: null },
      select: { employeeUserId: true },
      distinct: ['employeeUserId'],
    });
    return rows.map((row) => row.employeeUserId).sort();
  }

  private async present(tx: Prisma.TransactionClient, branch: BranchRow): Promise<BranchResponse> {
    const hours = await tx.branchOperatingHours.findMany({
      where: { branchId: branch.id },
      select: hoursSelect,
      orderBy: { isoWeekday: 'asc' },
    });
    return { ...summary(branch), hours: hours.map((row) => presentDay(row as OperatingDay)) };
  }
}

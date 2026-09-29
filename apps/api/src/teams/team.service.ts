import type {
  TeamCreateRequest,
  TeamDeleteRequest,
  TeamEmployeeFilters,
  TeamLeaderRequest,
  TeamMembersRequest,
  TeamSummary,
  TeamUpdateRequest,
  TeamEmployee,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  canAdministerBelow,
  canAppoint,
  canManageTeam,
  canSupervise,
  supervisorWhere,
} from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  runAdminCommand,
  type AdminContext,
} from '../authorization/admin-command.js';
import { checkGraphChange, decide } from '../authorization/authorization.js';
import {
  invalidateAuthorization,
  loadAuthorityGraph,
} from '../authorization/authorization.store.js';
import { normalizeReason } from '../employees/employee.input.js';
import { businessToday, classificationOn } from '../employees/employment.js';
import {
  endedEmploymentWithRelationships,
  endOrganizationRelationships,
} from '../organization/organization.lifecycle.js';
import {
  organizationCode,
  organizationId,
  organizationName,
  pageInput,
} from '../organization/organization.input.js';
import { TEAM_BATCH_SIZE, teamFilters, teamSelection } from './team.selection.js';

type TeamRow = Prisma.TeamGetPayload<Record<string, never>>;

@Injectable()
export class TeamService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  private frame<T>(
    token: string | undefined,
    write: boolean,
    requestId: string | undefined,
    work: (context: AdminContext) => Promise<T>,
    lockUsers?: (tx: Prisma.TransactionClient) => Promise<readonly string[]>,
  ) {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      { exclusive: write, requestId, ...(lockUsers ? { lockUsers } : {}) },
      async (context) => {
        if (write) await this.sweepEndedEmployment(context);
        return work(context);
      },
    );
  }

  /**
   * Ended employment cannot keep team relationships. A future-dated end has no scheduler, so
   * every exclusive team command first ends relationships of employees whose employment is now
   * ended (history retained). Authority already ignores them from the moment employment ends.
   */
  private async sweepEndedEmployment(context: AdminContext) {
    const today = await businessToday(context.tx, []);
    const ids = await endedEmploymentWithRelationships(context.tx, today);
    if (ids.length === 0) return;
    for (const userId of ids) {
      const ended = await endOrganizationRelationships(context.tx, [userId], context.now);
      await appendAdminAudit(context, {
        action: 'ORGANIZATION_RELATIONSHIPS_ENDED',
        entityType: 'EmployeeProfile',
        entityId: userId,
        subjectUserId: userId,
        reason: 'Employment ended',
        after: {
          teamIds: ended.teamIds,
          membershipIds: ended.membershipIds,
          appointmentIds: ended.appointmentIds,
          cause: 'EMPLOYMENT_ENDED',
        },
      });
    }
  }

  private requireTeam(context: AdminContext, team: TeamRow, write: boolean) {
    const scope = { kind: 'BRANCH', branchId: team.branchId } as const;
    if (
      (!decide(context.actor.graph, write ? 'MANAGE_TEAMS' : 'VIEW_TEAMS', scope) &&
        (write || !decide(context.actor.graph, 'MANAGE_TEAMS', scope))) ||
      !canManageTeam(context.actor.graph, team.id, team.branchId)
    )
      throw new AuthError('FORBIDDEN');
  }

  private async team(context: AdminContext, id: string, version?: number) {
    if (version !== undefined)
      await context.tx.$queryRaw`SELECT id FROM teams WHERE id = ${id}::uuid FOR UPDATE`;
    const row = await context.tx.team.findUnique({ where: { id } });
    if (!row || !row.isActive) throw new AuthError('NOT_FOUND');
    if (version !== undefined && row.rowVersion !== version) throw new AuthError('CONFLICT');
    return row;
  }

  private async present(context: AdminContext, team: TeamRow): Promise<TeamSummary> {
    const today = await businessToday(context.tx, [team.branchId]);
    const ended = new Set(await endedEmploymentWithRelationships(context.tx, today, team.branchId));
    const leaderRow = await context.tx.organizationAssignment.findFirst({
      where: { teamId: team.id, level: 'TEAM_LEADER', endedAt: null },
      select: { id: true, employeeUserId: true },
    });
    const leader = leaderRow && !ended.has(leaderRow.employeeUserId) ? leaderRow : null;
    const user = leader
      ? await context.tx.user.findUnique({
          where: { id: leader.employeeUserId },
          select: { fullName: true },
        })
      : null;
    return {
      id: team.id,
      branchId: team.branchId,
      code: team.code,
      name: team.name,
      isActive: team.isActive,
      version: team.rowVersion,
      leader:
        leader && user
          ? { assignmentId: leader.id, userId: leader.employeeUserId, fullName: user.fullName }
          : null,
      memberCount: await context.tx.teamMembership.count({
        where: { teamId: team.id, endedAt: null, employeeUserId: { notIn: [...ended] } },
      }),
      canManage:
        decide(context.actor.graph, 'MANAGE_TEAMS', { kind: 'BRANCH', branchId: team.branchId }) &&
        canManageTeam(context.actor.graph, team.id, team.branchId),
      canAssignLeader:
        decide(context.actor.graph, 'MANAGE_ORG_ASSIGNMENTS', {
          kind: 'BRANCH',
          branchId: team.branchId,
        }) &&
        canAppoint(
          context.actor.graph,
          'TEAM_LEADER',
          { kind: 'BRANCH', branchId: team.branchId },
          team.id,
        ),
    };
  }

  async list(
    token: string | undefined,
    query: { branchId?: string; q?: string; page?: string; limit?: string },
  ) {
    const branchId = query.branchId ? organizationId(query.branchId) : undefined;
    const q = query.q?.normalize('NFC').trim();
    const page = pageInput(query.page, query.limit);
    return this.frame(token, false, undefined, async (context) => {
      const branches = await context.tx.branch.findMany({
        where: { isActive: true, ...(branchId ? { id: branchId } : {}) },
        select: { id: true },
      });
      const allowed = branches
        .filter((row) =>
          ['VIEW_TEAMS', 'MANAGE_TEAMS'].some((p) =>
            decide(context.actor.graph, p, { kind: 'BRANCH', branchId: row.id }),
          ),
        )
        .map((row) => row.id);
      if (allowed.length === 0) throw new AuthError('FORBIDDEN');
      // Team authorization is resolved before the database page, so other teams never
      // leak through page totals. This query reads IDs only; employee pages are bounded.
      const ids = (
        await context.tx.team.findMany({
          where: { branchId: { in: allowed }, isActive: true },
          select: { id: true, branchId: true },
        })
      )
        .filter((row) => canManageTeam(context.actor.graph, row.id, row.branchId))
        .map((row) => row.id);
      const where: Prisma.TeamWhereInput = {
        id: { in: ids },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { code: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const total = await context.tx.team.count({ where });
      const rows = await context.tx.team.findMany({
        where,
        orderBy: [{ branchId: 'asc' }, { code: 'asc' }],
        skip: (page.number - 1) * page.size,
        take: page.size,
      });
      return {
        items: await Promise.all(rows.map((row) => this.present(context, row))),
        page: { ...page, total },
      };
    });
  }

  async get(token: string | undefined, idValue: string) {
    const id = organizationId(idValue);
    return this.frame(token, false, undefined, async (context) => {
      const row = await this.team(context, id);
      this.requireTeam(context, row, false);
      return this.present(context, row);
    });
  }

  async create(token: string | undefined, input: TeamCreateRequest, requestId?: string) {
    const branchId = organizationId(input.branchId);
    const code = organizationCode(input.code);
    const name = organizationName(input.name);
    const reason = normalizeReason(input.reason);
    return this.frame(token, true, requestId, async (context) => {
      const scope = { kind: 'BRANCH', branchId } as const;
      if (
        !decide(context.actor.graph, 'MANAGE_TEAMS', scope) ||
        !canAdministerBelow(context.actor.graph, 'TEAM_LEADER', scope)
      )
        throw new AuthError('FORBIDDEN');
      if (
        !(await context.tx.branch.findFirst({
          where: { id: branchId, isActive: true },
          select: { id: true },
        }))
      )
        throw new AuthError('NOT_FOUND');
      const row = await context.tx.team.create({ data: { branchId, code, name } });
      await appendAdminAudit(context, {
        action: 'TEAM_CREATED',
        entityType: 'Team',
        entityId: row.id,
        branchId,
        reason,
        after: { code, name },
      });
      return this.present(context, row);
    });
  }

  async update(
    token: string | undefined,
    idValue: string,
    input: TeamUpdateRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const name = organizationName(input.name);
    const reason = normalizeReason(input.reason);
    return this.frame(token, true, requestId, async (context) => {
      const previous = await this.team(context, id, input.expectedVersion);
      this.requireTeam(context, previous, true);
      const row = await context.tx.team.update({
        where: { id },
        data: { name, rowVersion: { increment: 1 } },
      });
      await appendAdminAudit(context, {
        action: 'TEAM_UPDATED',
        entityType: 'Team',
        entityId: id,
        branchId: row.branchId,
        reason,
        before: { name: previous.name },
        after: { name },
      });
      return this.present(context, row);
    });
  }

  async remove(
    token: string | undefined,
    idValue: string,
    input: TeamDeleteRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const reason = normalizeReason(input.reason);
    if (input.confirmed !== true) throw new AuthError('VALIDATION_FAILED', 'confirmed');
    return this.frame(
      token,
      true,
      requestId,
      async (context) => {
        const row = await this.team(context, id, input.expectedVersion);
        this.requireTeam(context, row, true);
        // Deletion includes leadership termination and all member relationship changes.
        // It is unavailable to a Team Leader attempting to delete their own authority.
        if (
          !decide(context.actor.graph, 'MANAGE_ORG_ASSIGNMENTS', {
            kind: 'BRANCH',
            branchId: row.branchId,
          }) ||
          !canAppoint(
            context.actor.graph,
            'TEAM_LEADER',
            { kind: 'BRANCH', branchId: row.branchId },
            id,
          )
        )
          throw new AuthError('FORBIDDEN');
        const members = await context.tx.teamMembership.findMany({
          where: { teamId: id, endedAt: null },
          select: { id: true, employeeUserId: true },
        });
        const leaders = await context.tx.organizationAssignment.findMany({
          where: { teamId: id, endedAt: null },
          select: { id: true, employeeUserId: true },
        });
        const affected = [
          ...new Set([...members, ...leaders].map((entry) => entry.employeeUserId)),
        ].sort();
        for (const userId of affected)
          await this.requireEmployee(context, userId, row.branchId, false);
        await context.tx.teamMembership.updateMany({
          where: { teamId: id, endedAt: null },
          data: { endedAt: context.now },
        });
        await context.tx.organizationAssignment.updateMany({
          where: { teamId: id, endedAt: null },
          data: { endedAt: context.now, rowVersion: { increment: 1 } },
        });
        await context.tx.team.update({
          where: { id },
          data: { isActive: false, rowVersion: { increment: 1 } },
        });
        await invalidateAuthorization(context.tx, affected, context.now);
        // One append-only entry per ended relationship preserves auditability without PII.
        for (const membership of members)
          await appendAdminAudit(context, {
            action: 'TEAM_MEMBER_REMOVED',
            entityType: 'TeamMembership',
            entityId: membership.id,
            subjectUserId: membership.employeeUserId,
            branchId: row.branchId,
            reason,
            before: { teamId: id },
            after: { endedAt: context.now.toISOString() },
          });
        for (const leader of leaders)
          await appendAdminAudit(context, {
            action: 'TEAM_LEADER_REMOVED',
            entityType: 'OrganizationAssignment',
            entityId: leader.id,
            subjectUserId: leader.employeeUserId,
            branchId: row.branchId,
            reason,
            before: { teamId: id },
            after: { endedAt: context.now.toISOString() },
          });
        await appendAdminAudit(context, {
          action: 'TEAM_DELETED',
          entityType: 'Team',
          entityId: id,
          branchId: row.branchId,
          reason,
          before: { isActive: true },
          after: {
            isActive: false,
            endedMemberships: members.length,
            endedLeaderships: leaders.length,
          },
        });
        return { deleted: true };
      },
      (tx) => this.relatedUsers(tx, id),
    );
  }

  async setLeader(
    token: string | undefined,
    idValue: string,
    input: TeamLeaderRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const userId = input.userId === null ? null : organizationId(input.userId);
    const reason = normalizeReason(input.reason);
    return this.frame(
      token,
      true,
      requestId,
      async (context) => {
        const row = await this.team(context, id, input.expectedVersion);
        this.requireTeam(context, row, true);
        const scope = { kind: 'BRANCH', branchId: row.branchId } as const;
        if (
          !decide(context.actor.graph, 'MANAGE_ORG_ASSIGNMENTS', scope) ||
          !canAppoint(context.actor.graph, 'TEAM_LEADER', scope, id)
        )
          throw new AuthError('FORBIDDEN');
        const previous = await context.tx.organizationAssignment.findFirst({
          where: { teamId: id, endedAt: null },
        });
        if ((previous?.employeeUserId ?? null) === userId)
          throw new AuthError('CONFLICT', 'userId');
        const affected = [
          ...new Set([...(previous ? [previous.employeeUserId] : []), ...(userId ? [userId] : [])]),
        ].sort();
        const before = new Map<
          string,
          NonNullable<Awaited<ReturnType<typeof loadAuthorityGraph>>>
        >();
        for (const targetId of affected)
          before.set(
            targetId,
            await this.requireEmployee(context, targetId, row.branchId, targetId === userId),
          );
        if (userId) {
          const classification = await classificationOn(
            context.tx,
            userId,
            await businessToday(context.tx, [row.branchId]),
          );
          if (classification?.classification !== 'OFFICIAL_EMPLOYEE')
            throw new AuthError('CONFLICT', 'employee');
        }
        if (previous)
          await context.tx.organizationAssignment.update({
            where: { id: previous.id },
            data: { endedAt: context.now, rowVersion: { increment: 1 } },
          });
        if (userId)
          await context.tx.organizationAssignment.create({
            data: {
              employeeUserId: userId,
              level: 'TEAM_LEADER',
              scopeKind: 'BRANCH',
              branchId: row.branchId,
              teamId: id,
              assignedAt: context.now,
              assignedByUserId: context.actor.userId,
            },
          });
        for (const [targetId, graph] of before) {
          const after = await loadAuthorityGraph(context.tx, targetId);
          if (!after || checkGraphChange(context.actor.graph, graph, after) !== null)
            throw new AuthError('FORBIDDEN');
        }
        const updated = await context.tx.team.update({
          where: { id },
          data: { rowVersion: { increment: 1 } },
        });
        await invalidateAuthorization(context.tx, affected, context.now);
        await appendAdminAudit(context, {
          action: 'TEAM_LEADER_CHANGED',
          entityType: 'Team',
          entityId: id,
          branchId: row.branchId,
          reason,
          before: { userId: previous?.employeeUserId ?? null },
          after: { userId },
        });
        return this.present(context, updated);
      },
      async (tx) => [
        ...new Set([...(await this.relatedUsers(tx, id, true)), ...(userId ? [userId] : [])]),
      ],
    );
  }

  async employees(
    token: string | undefined,
    idValue: string,
    query: TeamEmployeeFilters & { page?: string; limit?: string },
  ) {
    const id = organizationId(idValue);
    const filters = teamFilters(query);
    const page = pageInput(query.page, query.limit);
    return this.frame(token, false, undefined, async (context) => {
      const team = await this.team(context, id);
      this.requireTeam(context, team, false);
      const where = await this.employeeWhere(context, team, filters);
      const total = await context.tx.user.count({ where });
      const rows = await context.tx.user.findMany({
        where,
        select: this.employeeSelect,
        orderBy: { id: 'asc' },
        skip: (page.number - 1) * page.size,
        take: page.size,
      });
      return {
        items: await this.presentEmployees(context.tx, rows, team.branchId),
        page: { ...page, total },
      };
    });
  }

  async members(
    token: string | undefined,
    idValue: string,
    input: TeamMembersRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const targetTeamId = input.targetTeamId ? organizationId(input.targetTeamId) : null;
    if (
      !['ADD', 'REMOVE', 'TRANSFER'].includes(input.action) ||
      (input.action === 'TRANSFER') !== (targetTeamId !== null) ||
      targetTeamId === id
    )
      throw new AuthError('VALIDATION_FAILED', 'action');
    const selection = teamSelection(input.selection);
    const reason = normalizeReason(input.reason);
    let selectedIds: string[] = [];
    let hasMore = false;
    // The graph-exclusive lock is already held while selection resolves. Candidate
    // expansion and user locks precede actor session resolution, exactly as other
    // graph writers do. Authorization is repeated inside the authoritative frame.
    return this.frame(
      token,
      true,
      requestId,
      async (context) => {
        for (const teamId of [id, ...(targetTeamId ? [targetTeamId] : [])].sort())
          await context.tx.$queryRaw`SELECT id FROM teams WHERE id = ${teamId}::uuid FOR UPDATE`;
        const source = await this.team(context, id, input.expectedVersion);
        this.requireTeam(context, source, true);
        const target = targetTeamId ? await this.team(context, targetTeamId) : source;
        this.requireTeam(context, target, true);
        if (target.branchId !== source.branchId)
          throw new AuthError('VALIDATION_FAILED', 'targetTeamId');
        const filters = {
          ...selection.filters,
          membership: input.action === 'ADD' ? ('UNASSIGNED' as const) : ('MEMBERS' as const),
        };
        const where = await this.employeeWhere(context, source, filters);
        const eligible = await context.tx.user.findMany({
          where: { AND: [where, { id: { in: selectedIds } }] },
          select: { id: true },
          orderBy: { id: 'asc' },
        });
        if (eligible.length !== selectedIds.length) throw new AuthError('CONFLICT', 'selection');
        for (const userId of selectedIds) {
          await this.requireEmployee(context, userId, source.branchId, input.action !== 'REMOVE');
          const existing = await context.tx.teamMembership.findFirst({
            where: { employeeUserId: userId, branchId: source.branchId, endedAt: null },
          });
          if (input.action === 'ADD' ? existing !== null : existing?.teamId !== id)
            throw new AuthError('CONFLICT', 'selection');
          if (existing)
            await context.tx.teamMembership.update({
              where: { id: existing.id },
              data: { endedAt: context.now },
            });
          const next =
            input.action === 'REMOVE'
              ? null
              : await context.tx.teamMembership.create({
                  data: {
                    teamId: target.id,
                    branchId: source.branchId,
                    employeeUserId: userId,
                    joinedAt: context.now,
                    assignedByUserId: context.actor.userId,
                  },
                });
          await appendAdminAudit(context, {
            action:
              input.action === 'ADD'
                ? 'TEAM_MEMBER_ADDED'
                : input.action === 'REMOVE'
                  ? 'TEAM_MEMBER_REMOVED'
                  : 'TEAM_MEMBER_TRANSFERRED',
            entityType: 'TeamMembership',
            entityId: next?.id ?? existing!.id,
            subjectUserId: userId,
            branchId: source.branchId,
            reason,
            before: { teamId: existing?.teamId ?? null, membershipId: existing?.id ?? null },
            after: { teamId: next?.teamId ?? null, membershipId: next?.id ?? null },
          });
        }
        let version = source.rowVersion;
        if (selectedIds.length > 0) {
          const updated = await context.tx.team.update({
            where: { id },
            data: { rowVersion: { increment: 1 } },
          });
          version = updated.rowVersion;
          if (target.id !== id)
            await context.tx.team.update({
              where: { id: target.id },
              data: { rowVersion: { increment: 1 } },
            });
          await invalidateAuthorization(context.tx, selectedIds, context.now);
        }
        return {
          processed: selectedIds.length,
          changed: selectedIds.length,
          hasMore,
          nextAfter: hasMore ? selectedIds.at(-1)! : null,
          version,
        };
      },
      async (tx) => {
        if (selection.ids) {
          selectedIds = selection.ids;
          return selectedIds;
        }
        const source = await tx.team.findUnique({ where: { id }, select: { branchId: true } });
        if (!source) return [];
        // This is only a bounded lock hint, never an authorization decision. Full
        // hierarchy/permission validation below rejects any invisible selected row.
        const where = await this.rawSelectionWhere(tx, id, source.branchId, {
          ...selection.filters,
          membership: input.action === 'ADD' ? 'UNASSIGNED' : 'MEMBERS',
        });
        const rows = await tx.user.findMany({
          where: {
            AND: [
              where,
              {
                id: {
                  ...(selection.after ? { gt: selection.after } : {}),
                  notIn: selection.excluded,
                },
              },
            ],
          },
          select: { id: true },
          orderBy: { id: 'asc' },
          take: TEAM_BATCH_SIZE + 1,
        });
        selectedIds = rows.slice(0, TEAM_BATCH_SIZE).map((row) => row.id);
        hasMore = rows.length > TEAM_BATCH_SIZE;
        return selectedIds;
      },
    );
  }

  private readonly employeeSelect = {
    id: true,
    fullName: true,
    status: true,
    employeeProfile: { select: { employeeCodeCanonical: true } },
  } satisfies Prisma.UserSelect;

  private async employeeWhere(
    context: AdminContext,
    team: TeamRow,
    filters: TeamEmployeeFilters,
  ): Promise<Prisma.UserWhereInput> {
    return {
      AND: [
        await this.rawSelectionWhere(context.tx, team.id, team.branchId, filters),
        supervisorWhere(context.actor.graph, [team.branchId]),
      ],
    };
  }

  private async rawSelectionWhere(
    tx: Prisma.TransactionClient,
    teamId: string,
    branchId: string,
    filters: TeamEmployeeFilters,
  ): Promise<Prisma.UserWhereInput> {
    const today = await businessToday(tx, [branchId]);
    // Effective classification is determined in PostgreSQL before paging, rather than
    // filtering a returned page or consulting display-only role grouping.
    const classified = await tx.$queryRaw<{ employee_user_id: string }[]>`
      SELECT current.employee_user_id FROM (
        SELECT DISTINCT ON (c.employee_user_id) c.employee_user_id, c.classification
        FROM employment_classification_changes c
        JOIN employee_branch_assignments b ON b.employee_user_id = c.employee_user_id
          AND b.branch_id = ${branchId}::uuid AND b.revoked_at IS NULL
        WHERE c.effective_date <= ${today}::date
        ORDER BY c.employee_user_id, c.effective_date DESC
      ) current WHERE current.classification::text <> 'ENDED'
        AND (${filters.classification ?? null}::text IS NULL OR current.classification::text = ${filters.classification ?? null}::text)`;
    const membership = filters.membership ?? 'ALL';
    const memberPredicate: Prisma.TeamMembershipWhereInput = {
      branchId,
      endedAt: null,
      ...(membership === 'MEMBERS'
        ? { teamId }
        : membership === 'OTHER_TEAM'
          ? { teamId: { not: teamId } }
          : {}),
    };
    return {
      AND: [
        {
          kind: 'EMPLOYEE',
          id: { in: classified.map((row) => row.employee_user_id) },
          employeeProfile: {
            branchAssignments: { some: { branchId, revokedAt: null, branch: { isActive: true } } },
          },
        },
        ...(filters.status ? [{ status: filters.status }] : []),
        ...(filters.q
          ? [
              {
                OR: [
                  { fullName: { contains: filters.q, mode: 'insensitive' as const } },
                  {
                    employeeProfile: {
                      employeeCodeCanonical: { contains: filters.q, mode: 'insensitive' as const },
                    },
                  },
                ],
              },
            ]
          : []),
        ...(membership === 'ALL'
          ? []
          : [
              {
                employeeProfile: {
                  teamMemberships:
                    membership === 'UNASSIGNED'
                      ? { none: memberPredicate }
                      : { some: memberPredicate },
                },
              },
            ]),
      ],
    };
  }

  private async presentEmployees(
    tx: Prisma.TransactionClient,
    rows: Prisma.UserGetPayload<{ select: TeamService['employeeSelect'] }>[],
    branchId: string,
  ): Promise<TeamEmployee[]> {
    const today = await businessToday(tx, [branchId]);
    return Promise.all(
      rows.map(async (row) => {
        const membership = await tx.teamMembership.findFirst({
          where: { employeeUserId: row.id, branchId, endedAt: null },
          select: { teamId: true, team: { select: { name: true } } },
        });
        return {
          userId: row.id,
          employeeCode: row.employeeProfile!.employeeCodeCanonical,
          fullName: row.fullName,
          status: row.status as TeamEmployee['status'],
          classification: (await classificationOn(tx, row.id, today))?.classification ?? null,
          teamId: membership?.teamId ?? null,
          teamName: membership?.team.name ?? null,
        };
      }),
    );
  }

  private async requireEmployee(
    context: AdminContext,
    userId: string,
    branchId: string,
    requireActive: boolean,
  ) {
    const graph = await loadAuthorityGraph(context.tx, userId);
    if (
      !graph ||
      graph.kind !== 'EMPLOYEE' ||
      !canSupervise(context.actor.graph, graph, [branchId])
    )
      throw new AuthError('FORBIDDEN');
    if (requireActive) {
      const row = await context.tx.user.findUnique({
        where: { id: userId },
        select: { status: true },
      });
      const classification = await classificationOn(
        context.tx,
        userId,
        await businessToday(context.tx, [branchId]),
      );
      if (
        row?.status !== 'ACTIVE' ||
        !graph.activeBranchIds.has(branchId) ||
        !classification ||
        classification.classification === 'ENDED'
      )
        throw new AuthError('CONFLICT', 'employee');
    }
    return graph;
  }

  private async relatedUsers(tx: Prisma.TransactionClient, teamId: string, leadersOnly = false) {
    const leaders = await tx.organizationAssignment.findMany({
      where: { teamId, endedAt: null },
      select: { employeeUserId: true },
    });
    const members = leadersOnly
      ? []
      : await tx.teamMembership.findMany({
          where: { teamId, endedAt: null },
          select: { employeeUserId: true },
        });
    return [...new Set([...leaders, ...members].map((row) => row.employeeUserId))].sort();
  }
}

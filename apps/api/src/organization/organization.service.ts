import type {
  AuthorizationScope,
  OrganizationAppointment,
  OrganizationAppointmentCreateRequest,
  OrganizationAppointmentsResponse,
  OrganizationAppointmentEndRequest,
  OrganizationAreaCreateRequest,
  OrganizationAreaUpdateRequest,
  OrganizationBranchPlacementRequest,
  OrganizationRegionCreateRequest,
  OrganizationRegionUpdateRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { canAdministerBelow, canAppoint, canSupervise } from '@lucy-spa/server';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import {
  appendAdminAudit,
  runAdminCommand,
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
import { normalizeReason } from '../employees/employee.input.js';
import { businessToday, classificationOn } from '../employees/employment.js';
import {
  organizationCode,
  organizationId,
  organizationName,
  organizationScope,
  scopeData,
  scopeFrom,
} from './organization.input.js';

@Injectable()
export class OrganizationService {
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
    users?: readonly string[],
  ) {
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      token,
      {
        exclusive: write,
        requestId,
        // Geography changes can alter inherited grants of any scoped principal. Lock all
        // employees only for these rare organization commands, before the actor session.
        ...(write
          ? {
              lockUsers: async (tx: Prisma.TransactionClient) =>
                users ??
                (
                  await tx.user.findMany({
                    where: { kind: 'EMPLOYEE' },
                    select: { id: true },
                    orderBy: { id: 'asc' },
                  })
                ).map((row) => row.id),
            }
          : {}),
      },
      work,
    );
  }

  private require(context: AdminContext, permission: string, scope: AuthorizationScope) {
    if (!decide(context.actor.graph, permission, scope)) throw new AuthError('FORBIDDEN');
  }

  async snapshot(token: string | undefined) {
    return this.frame(token, false, undefined, async (context) => {
      const { tx, actor } = context;
      const regions = await tx.region.findMany({ orderBy: { code: 'asc' } });
      const areas = await tx.area.findMany({ orderBy: { code: 'asc' } });
      const branches = await tx.branch.findMany({ orderBy: { code: 'asc' } });
      const visible = (scope: AuthorizationScope) =>
        ['VIEW_ORGANIZATION', 'MANAGE_ORGANIZATION', 'MANAGE_ORG_ASSIGNMENTS'].some((p) =>
          decide(actor.graph, p, scope),
        );
      const visibleBranches = branches.filter((row) =>
        visible({ kind: 'BRANCH', branchId: row.id }),
      );
      const visibleAreas = areas.filter(
        (row) =>
          visible({ kind: 'AREA', areaId: row.id }) ||
          visibleBranches.some((branch) => branch.areaId === row.id),
      );
      const visibleRegions = regions.filter(
        (row) =>
          visible({ kind: 'REGION', regionId: row.id }) ||
          visibleAreas.some((area) => area.regionId === row.id),
      );
      if (
        !visible(GLOBAL) &&
        visibleRegions.length + visibleAreas.length + visibleBranches.length === 0
      )
        throw new AuthError('FORBIDDEN');
      return {
        regions: visibleRegions.map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          isActive: row.isActive,
          version: row.rowVersion,
        })),
        areas: visibleAreas.map((row) => ({
          id: row.id,
          regionId: row.regionId,
          code: row.code,
          name: row.name,
          isActive: row.isActive,
          version: row.rowVersion,
        })),
        branches: visibleBranches.map((row) => ({
          id: row.id,
          areaId: row.areaId,
          regionId: areas.find((area) => area.id === row.areaId)?.regionId ?? null,
          code: row.code,
          name: row.name,
          isActive: row.isActive,
          version: row.rowVersion,
        })),
      };
    });
  }

  async createRegion(
    token: string | undefined,
    input: OrganizationRegionCreateRequest,
    requestId?: string,
  ) {
    const code = organizationCode(input.code);
    const name = organizationName(input.name);
    const reason = normalizeReason(input.reason);
    return this.frame(
      token,
      true,
      requestId,
      async (context) => {
        this.require(context, 'MANAGE_ORGANIZATION', GLOBAL);
        if (!canAdministerBelow(context.actor.graph, 'REGIONAL_MANAGER', GLOBAL))
          throw new AuthError('FORBIDDEN');
        const row = await context.tx.region.create({ data: { code, name } });
        await appendAdminAudit(context, {
          action: 'REGION_CREATED',
          entityType: 'Region',
          entityId: row.id,
          reason,
          after: { code, name },
        });
        return { id: row.id, code, name, isActive: row.isActive, version: row.rowVersion };
      },
      [],
    );
  }

  async updateRegion(
    token: string | undefined,
    idValue: string,
    input: OrganizationRegionUpdateRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const reason = normalizeReason(input.reason);
    return this.frame(token, true, requestId, async (context) => {
      const scope = { kind: 'REGION', regionId: id } as const;
      this.require(context, 'MANAGE_ORGANIZATION', scope);
      if (!canAppoint(context.actor.graph, 'REGIONAL_MANAGER', scope))
        throw new AuthError('FORBIDDEN');
      const previous = await context.tx.region.findUnique({ where: { id } });
      if (!previous) throw new AuthError('NOT_FOUND');
      if (previous.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      if (
        input.isActive === false &&
        (await context.tx.area.count({ where: { regionId: id, isActive: true } }))
      )
        throw new AuthError('CONFLICT', 'areas');
      const before = await this.graphs(context.tx);
      const row = await context.tx.region.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : { name: organizationName(input.name) }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          rowVersion: { increment: 1 },
        },
      });
      await this.checkGraphs(context, before);
      await appendAdminAudit(context, {
        action: 'REGION_UPDATED',
        entityType: 'Region',
        entityId: id,
        reason,
        before: { name: previous.name, isActive: previous.isActive },
        after: { name: row.name, isActive: row.isActive },
      });
      return {
        id,
        code: row.code,
        name: row.name,
        isActive: row.isActive,
        version: row.rowVersion,
      };
    });
  }

  async createArea(
    token: string | undefined,
    input: OrganizationAreaCreateRequest,
    requestId?: string,
  ) {
    const regionId = organizationId(input.regionId);
    const code = organizationCode(input.code);
    const name = organizationName(input.name);
    const reason = normalizeReason(input.reason);
    return this.frame(
      token,
      true,
      requestId,
      async (context) => {
        const scope = { kind: 'REGION', regionId } as const;
        this.require(context, 'MANAGE_ORGANIZATION', scope);
        if (!canAdministerBelow(context.actor.graph, 'AREA_MANAGER', scope))
          throw new AuthError('FORBIDDEN');
        await this.activeScope(context.tx, scope);
        const row = await context.tx.area.create({ data: { regionId, code, name } });
        await appendAdminAudit(context, {
          action: 'AREA_CREATED',
          entityType: 'Area',
          entityId: row.id,
          reason,
          after: { regionId, code, name },
        });
        return {
          id: row.id,
          regionId,
          code,
          name,
          isActive: row.isActive,
          version: row.rowVersion,
        };
      },
      [],
    );
  }

  async updateArea(
    token: string | undefined,
    idValue: string,
    input: OrganizationAreaUpdateRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const reason = normalizeReason(input.reason);
    return this.frame(token, true, requestId, async (context) => {
      const previous = await context.tx.area.findUnique({ where: { id } });
      if (!previous) throw new AuthError('NOT_FOUND');
      if (previous.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      const regionId =
        input.regionId === undefined ? previous.regionId : organizationId(input.regionId);
      for (const parentId of new Set([previous.regionId, regionId])) {
        const scope = { kind: 'REGION', regionId: parentId } as const;
        this.require(context, 'MANAGE_ORGANIZATION', scope);
        if (!canAdministerBelow(context.actor.graph, 'AREA_MANAGER', scope))
          throw new AuthError('FORBIDDEN');
      }
      await this.activeScope(context.tx, { kind: 'REGION', regionId });
      if (input.isActive === false && (await context.tx.branch.count({ where: { areaId: id } })))
        throw new AuthError('CONFLICT', 'branches');
      const before = await this.graphs(context.tx);
      const row = await context.tx.area.update({
        where: { id },
        data: {
          regionId,
          ...(input.name === undefined ? {} : { name: organizationName(input.name) }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
          rowVersion: { increment: 1 },
        },
      });
      await this.checkGraphs(context, before);
      await appendAdminAudit(context, {
        action: 'AREA_UPDATED',
        entityType: 'Area',
        entityId: id,
        reason,
        before: { regionId: previous.regionId, name: previous.name, isActive: previous.isActive },
        after: { regionId, name: row.name, isActive: row.isActive },
      });
      return {
        id,
        regionId,
        code: row.code,
        name: row.name,
        isActive: row.isActive,
        version: row.rowVersion,
      };
    });
  }

  async placeBranch(
    token: string | undefined,
    idValue: string,
    input: OrganizationBranchPlacementRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const areaId = input.areaId === null ? null : organizationId(input.areaId);
    const reason = normalizeReason(input.reason);
    return this.frame(token, true, requestId, async (context) => {
      const previous = await context.tx.branch.findUnique({ where: { id } });
      if (!previous) throw new AuthError('NOT_FOUND');
      if (previous.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      for (const parentId of new Set([previous.areaId, areaId])) {
        const scope = parentId ? ({ kind: 'AREA', areaId: parentId } as const) : GLOBAL;
        this.require(context, 'MANAGE_ORGANIZATION', scope);
        if (!canAdministerBelow(context.actor.graph, 'STORE_MANAGER', scope))
          throw new AuthError('FORBIDDEN');
      }
      if (areaId) await this.activeScope(context.tx, { kind: 'AREA', areaId });
      const before = await this.graphs(context.tx);
      const row = await context.tx.branch.update({
        where: { id },
        data: { areaId, rowVersion: { increment: 1 } },
      });
      await this.checkGraphs(context, before);
      await appendAdminAudit(context, {
        action: 'BRANCH_ORGANIZATION_CHANGED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        reason,
        before: { areaId: previous.areaId },
        after: { areaId },
      });
      const area = areaId ? await context.tx.area.findUnique({ where: { id: areaId } }) : null;
      return {
        id,
        code: row.code,
        name: row.name,
        areaId,
        regionId: area?.regionId ?? null,
        isActive: row.isActive,
        version: row.rowVersion,
      };
    });
  }

  async appointments(
    token: string | undefined,
    query: { branchId?: string; userId?: string },
  ): Promise<OrganizationAppointmentsResponse> {
    const branchId = query.branchId ? organizationId(query.branchId) : undefined;
    const userId = query.userId ? organizationId(query.userId) : undefined;
    return this.frame(token, false, undefined, async (context) => {
      const rows = await context.tx.organizationAssignment.findMany({
        where: {
          endedAt: null,
          ...(branchId ? { branchId } : {}),
          ...(userId ? { employeeUserId: userId } : {}),
        },
        orderBy: [{ employeeUserId: 'asc' }, { id: 'asc' }],
      });
      const visible = rows.filter((row) =>
        ['VIEW_ORGANIZATION', 'MANAGE_ORG_ASSIGNMENTS'].some((permission) =>
          decide(context.actor.graph, permission, scopeFrom(row)),
        ),
      );
      if (
        visible.length === 0 &&
        !decide(
          context.actor.graph,
          'VIEW_ORGANIZATION',
          branchId ? { kind: 'BRANCH', branchId } : GLOBAL,
        ) &&
        !decide(
          context.actor.graph,
          'MANAGE_ORG_ASSIGNMENTS',
          branchId ? { kind: 'BRANCH', branchId } : GLOBAL,
        )
      )
        throw new AuthError('FORBIDDEN');
      const users = await context.tx.user.findMany({
        where: { id: { in: visible.map((row) => row.employeeUserId) } },
        select: { id: true, fullName: true },
      });
      return {
        items: visible.map((row) => ({
          id: row.id,
          userId: row.employeeUserId,
          fullName: users.find((user) => user.id === row.employeeUserId)?.fullName ?? '',
          level: row.level,
          scope: scopeFrom(row),
          teamId: row.teamId,
          version: row.rowVersion,
          startedAt: row.assignedAt.toISOString(),
          endedAt: row.endedAt?.toISOString() ?? null,
        })),
      };
    });
  }

  async appoint(
    token: string | undefined,
    input: OrganizationAppointmentCreateRequest,
    requestId?: string,
  ): Promise<OrganizationAppointment> {
    const userId = organizationId(input.userId);
    const scope = organizationScope(input.scope);
    const reason = normalizeReason(input.reason);
    if (input.level === 'TEAM_LEADER') throw new AuthError('VALIDATION_FAILED', 'teamId'); // leadership uses the team versioned command
    const kinds = {
      CEO: 'GLOBAL',
      REGIONAL_MANAGER: 'REGION',
      AREA_MANAGER: 'AREA',
      STORE_MANAGER: 'BRANCH',
      DEPUTY_STORE_MANAGER: 'BRANCH',
    } as const;
    if (kinds[input.level] !== scope.kind) throw new AuthError('VALIDATION_FAILED', 'scope');
    return this.frame(
      token,
      true,
      requestId,
      async (context) => {
        this.require(context, 'MANAGE_ORG_ASSIGNMENTS', scope);
        if (!canAppoint(context.actor.graph, input.level, scope)) throw new AuthError('FORBIDDEN');
        await this.activeScope(context.tx, scope);
        const graph = await loadAuthorityGraph(context.tx, userId);
        if (!graph || graph.kind !== 'EMPLOYEE' || !canSupervise(context.actor.graph, graph))
          throw new AuthError('FORBIDDEN');
        const employee = await context.tx.user.findUnique({
          where: { id: userId },
          select: { status: true },
        });
        const branchIds = [...graph.activeBranchIds];
        const classification = await classificationOn(
          context.tx,
          userId,
          await businessToday(context.tx, branchIds),
        );
        if (employee?.status !== 'ACTIVE' || classification?.classification !== 'OFFICIAL_EMPLOYEE')
          throw new AuthError('CONFLICT', 'employee');
        if (scope.kind === 'BRANCH' && !graph.activeBranchIds.has(scope.branchId))
          throw new AuthError('CONFLICT', 'branchId');
        const row = await context.tx.organizationAssignment.create({
          data: {
            employeeUserId: userId,
            level: input.level,
            ...scopeData(scope),
            assignedAt: context.now,
            assignedByUserId: context.actor.userId,
          },
        });
        const after = await loadAuthorityGraph(context.tx, userId);
        if (!after || checkGraphChange(context.actor.graph, graph, after) !== null)
          throw new AuthError('FORBIDDEN');
        await invalidateAuthorization(context.tx, [userId], context.now);
        await appendAdminAudit(context, {
          action: 'ORGANIZATION_APPOINTED',
          entityType: 'OrganizationAssignment',
          entityId: row.id,
          subjectUserId: userId,
          branchId: row.branchId,
          reason,
          after: { level: row.level, ...scopeData(scope) },
        });
        const user = await context.tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { fullName: true },
        });
        return {
          id: row.id,
          userId,
          fullName: user.fullName,
          level: row.level,
          scope,
          teamId: row.teamId,
          version: row.rowVersion,
          startedAt: row.assignedAt.toISOString(),
          endedAt: null,
        };
      },
      [userId],
    );
  }

  async endAppointment(
    token: string | undefined,
    idValue: string,
    input: OrganizationAppointmentEndRequest,
    requestId?: string,
  ) {
    const id = organizationId(idValue);
    const reason = normalizeReason(input.reason);
    return this.frame(token, true, requestId, async (context) => {
      const row = await context.tx.organizationAssignment.findUnique({ where: { id } });
      if (!row) throw new AuthError('NOT_FOUND');
      if (row.endedAt || row.rowVersion !== input.expectedVersion) throw new AuthError('CONFLICT');
      if (row.teamId) throw new AuthError('CONFLICT', 'teamId');
      const scope = scopeFrom(row);
      this.require(context, 'MANAGE_ORG_ASSIGNMENTS', scope);
      const target = await loadAuthorityGraph(context.tx, row.employeeUserId);
      if (
        !target ||
        !canSupervise(context.actor.graph, target) ||
        !canAppoint(context.actor.graph, row.level, scope, row.teamId)
      )
        throw new AuthError('FORBIDDEN');
      await context.tx.organizationAssignment.update({
        where: { id },
        data: { endedAt: context.now, rowVersion: { increment: 1 } },
      });
      await invalidateAuthorization(context.tx, [row.employeeUserId], context.now);
      await appendAdminAudit(context, {
        action: 'ORGANIZATION_APPOINTMENT_ENDED',
        entityType: 'OrganizationAssignment',
        entityId: id,
        subjectUserId: row.employeeUserId,
        branchId: row.branchId,
        reason,
        before: { level: row.level, ...scopeData(scope) },
        after: { endedAt: context.now.toISOString() },
      });
      return { ended: true };
    });
  }

  private async activeScope(tx: Prisma.TransactionClient, scope: AuthorizationScope) {
    if (scope.kind === 'GLOBAL') return;
    const active =
      scope.kind === 'REGION'
        ? await tx.region.findFirst({
            where: { id: scope.regionId, isActive: true },
            select: { id: true },
          })
        : scope.kind === 'AREA'
          ? await tx.area.findFirst({
              where: { id: scope.areaId, isActive: true, region: { isActive: true } },
              select: { id: true },
            })
          : await tx.branch.findFirst({
              where: { id: scope.branchId, isActive: true },
              select: { id: true },
            });
    if (!active) throw new AuthError('CONFLICT', 'scope');
  }

  private async graphs(tx: Prisma.TransactionClient) {
    const result = new Map<string, AuthorityGraph>();
    for (const row of await tx.user.findMany({
      where: { kind: 'EMPLOYEE' },
      select: { id: true },
      orderBy: { id: 'asc' },
    })) {
      const graph = await loadAuthorityGraph(tx, row.id);
      if (graph) result.set(row.id, graph);
    }
    return result;
  }

  private async checkGraphs(context: AdminContext, before: Map<string, AuthorityGraph>) {
    const changed: string[] = [];
    const serialize = (graph: AuthorityGraph) =>
      JSON.stringify(graph, (_key, value: unknown) =>
        value instanceof Set
          ? [...value].sort()
          : value instanceof Map
            ? [...value.entries()]
            : value,
      );
    for (const [id, graph] of before) {
      const after = await loadAuthorityGraph(context.tx, id);
      if (after && serialize(graph) === serialize(after)) continue;
      if (!after || checkGraphChange(context.actor.graph, graph, after) !== null)
        throw new AuthError('FORBIDDEN');
      changed.push(id);
    }
    await invalidateAuthorization(context.tx, changed, context.now);
  }
}

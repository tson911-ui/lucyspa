import type {
  AuthorizationScope,
  EmployeeAuthorizationResponse,
  PermissionCodeName,
  PermissionOverrideRemoveRequest,
  PermissionOverrideSetRequest,
  RoleAssignRequest,
  RoleCreateRequest,
  RoleListResponse,
  RolePermissionsRequest,
  RoleResponse,
  RoleRevokeRequest,
  RoleUpdateRequest,
} from '@lucy-spa/contracts';
import { PERMISSION_CATALOG, type Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { invalidateChallenges } from '../auth/otp-flow.js';
import { text } from '../auth/registration.js';
import { SessionService } from '../auth/session.service.js';
import { isUuid, normalizeReason } from '../employees/employee.input.js';
import {
  appendAdminAudit,
  requireAcross,
  runAdminCommand,
  type AdminActor,
  type AdminContext,
} from './admin-command.js';
import {
  checkGraphChange,
  decide,
  decideAcross,
  GLOBAL,
  isKnownPermission,
  type AuthorityGraph,
} from './authorization.js';
import { invalidateAuthorization, loadAuthorityGraph } from './authorization.store.js';

const CATALOG = PERMISSION_CATALOG.map((entry) => entry.code) as PermissionCodeName[];
const ROLE_NAME_MAX = 100;

const roleSelect = {
  id: true,
  code: true,
  displayNameVi: true,
  displayNameEn: true,
  isActive: true,
  rowVersion: true,
  permissions: { select: { permission: { select: { code: true } } } },
} satisfies Prisma.RoleSelect;

type RoleRecord = Prisma.RoleGetPayload<{ select: typeof roleSelect }>;

function scopeOf(row: { scopeKind: 'GLOBAL' | 'BRANCH'; branchId: string | null }) {
  return row.scopeKind === 'GLOBAL' || row.branchId === null
    ? ({ kind: 'GLOBAL' } as const)
    : ({ kind: 'BRANCH', branchId: row.branchId } as const);
}

function presentRole(role: RoleRecord): RoleResponse {
  return {
    id: role.id,
    code: role.code,
    displayNameVi: role.displayNameVi,
    displayNameEn: role.displayNameEn,
    isActive: role.isActive,
    permissions: role.permissions.map((row) => row.permission.code as PermissionCodeName).sort(),
    version: role.rowVersion,
  };
}

function normalizeRoleCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code) || code === 'OWNER') {
    throw new AuthError('VALIDATION_FAILED', 'code');
  }
  return code;
}

function normalizePermissions(values: readonly string[]): PermissionCodeName[] {
  const codes = [...new Set(values)];
  // Only the code-owned catalog; unknown codes never gain executable meaning.
  if (codes.length > CATALOG.length || !codes.every(isKnownPermission)) {
    throw new AuthError('VALIDATION_FAILED', 'permissions');
  }
  return (codes as PermissionCodeName[]).sort();
}

function normalizeScope(scope: AuthorizationScope): AuthorizationScope {
  if (scope.kind === 'GLOBAL') return GLOBAL;
  const branchId = scope.branchId.toLowerCase();
  if (!isUuid(branchId)) throw new AuthError('VALIDATION_FAILED', 'scope');
  return { kind: 'BRANCH', branchId };
}

function roleName(value: string, field: string): string {
  return text(value, field, ROLE_NAME_MAX);
}

/**
 * Phase 1 role, assignment and override administration (design section 7). Every
 * security-graph change takes the exclusive graph lock first, locks the actor and every
 * affected User by UUID, applies the change, then compares each affected User's graph
 * before and after with the Step 7 `checkGraphChange` (so removing a DENY, widening a
 * scope or editing a shared bundle all count as grants). Any rejection rolls back the
 * whole transaction. Affected Users get a new authzVersion, revoked sessions and
 * retired setup capabilities in the same transaction.
 */
@Injectable()
export class RoleAdminService {
  constructor(
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /** Roles and the catalog, for actors holding MANAGE_PERMISSIONS in some scope. */
  async listRoles(sessionToken: string | undefined): Promise<RoleListResponse> {
    return this.frame(sessionToken, false, undefined, [], async ({ tx, actor }) => {
      if (!this.administersAnywhere(actor.graph)) throw new AuthError('FORBIDDEN');
      const roles = await tx.role.findMany({ select: roleSelect, orderBy: { code: 'asc' } });
      return { roles: roles.map(presentRole), permissions: [...CATALOG] };
    });
  }

  /** Role definitions are shared, global resources: GLOBAL MANAGE_PERMISSIONS. */
  async createRole(
    sessionToken: string | undefined,
    input: RoleCreateRequest,
    requestId?: string,
  ): Promise<RoleResponse> {
    const code = normalizeRoleCode(input.code);
    const displayNameVi = roleName(input.displayNameVi, 'displayNameVi');
    const displayNameEn = roleName(input.displayNameEn, 'displayNameEn');
    const permissions = normalizePermissions(input.permissions);
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, [], async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_PERMISSIONS', []);
      this.requireBundleHeld(actor, permissions);
      if (await tx.role.findUnique({ where: { code }, select: { id: true } })) {
        throw new AuthError('CONFLICT', 'code');
      }
      const ids = await this.permissionIds(tx, permissions);
      const role = await tx.role.create({
        data: {
          code,
          displayNameVi,
          displayNameEn,
          permissions: { create: ids.map((permissionId) => ({ permissionId })) },
        },
        select: roleSelect,
      });
      await appendAdminAudit(context, {
        action: 'ROLE_CREATED',
        entityType: 'Role',
        entityId: role.id,
        reason,
        after: { code, isActive: true, permissions },
      });
      return presentRole(role);
    });
  }

  /** Names and activation. Activation changes recipients' authority and is checked. */
  async updateRole(
    sessionToken: string | undefined,
    roleId: string,
    input: RoleUpdateRequest,
    requestId?: string,
  ): Promise<RoleResponse> {
    const id = this.id(roleId);
    const patch = {
      ...(input.displayNameVi !== undefined
        ? { displayNameVi: roleName(input.displayNameVi, 'displayNameVi') }
        : {}),
      ...(input.displayNameEn !== undefined
        ? { displayNameEn: roleName(input.displayNameEn, 'displayNameEn') }
        : {}),
      ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
    };
    if (Object.keys(patch).length === 0) throw new AuthError('VALIDATION_FAILED');
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, this.recipientsOf(id), async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_PERMISSIONS', []);
      const role = await this.loadRole(tx, id, input.expectedVersion);
      const recipients = await this.recipientIds(tx, id);
      // Non-Owners cannot modify a shared role assigned to themselves.
      if (!actor.owner && recipients.includes(actor.userId)) throw new AuthError('FORBIDDEN');
      const activation = patch.isActive !== undefined && patch.isActive !== role.isActive;
      if (activation && patch.isActive) {
        this.requireBundleHeld(actor, presentRole(role).permissions);
      }
      const write = () =>
        tx.role
          .update({
            where: { id },
            data: { ...patch, rowVersion: { increment: 1 } },
            select: { id: true },
          })
          .then(() => undefined);
      if (activation) {
        await this.changeGraph(context, recipients, write, id);
      } else {
        await write();
      }
      await appendAdminAudit(context, {
        action: 'ROLE_UPDATED',
        entityType: 'Role',
        entityId: id,
        reason,
        before: {
          displayNameVi: role.displayNameVi,
          displayNameEn: role.displayNameEn,
          isActive: role.isActive,
        },
        after: patch,
      });
      return presentRole(await tx.role.findUniqueOrThrow({ where: { id }, select: roleSelect }));
    });
  }

  /**
   * Replaces a shared role's permission set. The resulting powers of every current
   * recipient are checked; if the actor cannot administer all of them, nothing changes.
   */
  async setRolePermissions(
    sessionToken: string | undefined,
    roleId: string,
    input: RolePermissionsRequest,
    requestId?: string,
  ): Promise<RoleResponse> {
    const id = this.id(roleId);
    const permissions = normalizePermissions(input.permissions);
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, this.recipientsOf(id), async (context) => {
      const { tx, actor } = context;
      requireAcross(actor, 'MANAGE_PERMISSIONS', []);
      const role = await this.loadRole(tx, id, input.expectedVersion);
      const previous = presentRole(role).permissions;
      const added = permissions.filter((code) => !previous.includes(code));
      if (added.length === 0 && previous.length === permissions.length) {
        throw new AuthError('VALIDATION_FAILED', 'permissions');
      }
      this.requireBundleHeld(actor, added);
      const ids = await this.permissionIds(tx, permissions);
      const recipients = await this.recipientIds(tx, id);
      await this.changeGraph(
        context,
        recipients,
        async () => {
          await tx.rolePermission.deleteMany({ where: { roleId: id } });
          if (ids.length > 0) {
            await tx.rolePermission.createMany({
              data: ids.map((permissionId) => ({ roleId: id, permissionId })),
            });
          }
          await tx.role.update({
            where: { id },
            data: { rowVersion: { increment: 1 } },
            select: { id: true },
          });
        },
        id,
      );
      await appendAdminAudit(context, {
        action: 'ROLE_PERMISSIONS_CHANGED',
        entityType: 'Role',
        entityId: id,
        reason,
        before: { permissions: previous },
        after: { permissions, affectedUsers: recipients.length },
      });
      return presentRole(await tx.role.findUniqueOrThrow({ where: { id }, select: roleSelect }));
    });
  }

  /** The employee's own role assignments and overrides, for administrators of it. */
  async employeeAuthorization(
    sessionToken: string | undefined,
    employeeId: string,
  ): Promise<EmployeeAuthorizationResponse> {
    const id = this.id(employeeId);
    return this.frame(sessionToken, false, undefined, [id], async ({ tx, actor }) => {
      const branches = await this.employeeBranches(tx, id);
      // Reads of another employee's grants require MANAGE_PERMISSIONS over all of it.
      if (!decideAcross(actor.graph, 'MANAGE_PERMISSIONS', branches)) {
        throw new AuthError('NOT_FOUND');
      }
      return this.presentAuthorization(tx, id);
    });
  }

  /** Grants a role at GLOBAL or one branch; the resulting powers must be held by the actor. */
  async assignRole(
    sessionToken: string | undefined,
    employeeId: string,
    input: RoleAssignRequest,
    requestId?: string,
  ): Promise<EmployeeAuthorizationResponse> {
    const id = this.id(employeeId);
    const roleId = this.id(input.roleId, 'roleId');
    const scope = normalizeScope(input.scope);
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, [id], async (context) => {
      const { tx } = context;
      await this.requireTarget(context, id, scope, input.expectedVersion);
      const role = await tx.role.findUnique({ where: { id: roleId }, select: roleSelect });
      if (!role) throw new AuthError('VALIDATION_FAILED', 'roleId');
      await this.requireBranch(tx, scope);
      const duplicate = await tx.userRoleAssignment.findFirst({
        where: {
          userId: id,
          roleId,
          scopeKind: scope.kind,
          branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
        },
        select: { id: true },
      });
      if (duplicate) throw new AuthError('CONFLICT');
      let assignmentId = '';
      await this.changeGraph(context, [id], async () => {
        assignmentId = (
          await tx.userRoleAssignment.create({
            data: {
              userId: id,
              roleId,
              scopeKind: scope.kind,
              branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
            },
            select: { id: true },
          })
        ).id;
      });
      await appendAdminAudit(context, {
        action: 'ROLE_ASSIGNED',
        entityType: 'User',
        entityId: id,
        subjectUserId: id,
        branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
        reason,
        after: { assignmentId, roleId, roleCode: role.code, scope },
      });
      return this.presentAuthorization(tx, id);
    });
  }

  async revokeRole(
    sessionToken: string | undefined,
    employeeId: string,
    input: RoleRevokeRequest,
    requestId?: string,
  ): Promise<EmployeeAuthorizationResponse> {
    const id = this.id(employeeId);
    const assignmentId = this.id(input.assignmentId, 'assignmentId');
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, [id], async (context) => {
      const { tx } = context;
      const assignment = await tx.userRoleAssignment.findFirst({
        where: { id: assignmentId, userId: id },
        select: {
          id: true,
          roleId: true,
          scopeKind: true,
          branchId: true,
          role: { select: { code: true } },
        },
      });
      await this.requireTarget(
        context,
        id,
        assignment ? scopeOf(assignment) : null,
        input.expectedVersion,
      );
      if (!assignment) throw new AuthError('NOT_FOUND');
      const scope = scopeOf(assignment);
      await this.changeGraph(context, [id], async () => {
        await tx.userRoleAssignment.delete({ where: { id: assignmentId }, select: { id: true } });
      });
      await appendAdminAudit(context, {
        action: 'ROLE_REVOKED',
        entityType: 'User',
        entityId: id,
        subjectUserId: id,
        branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
        reason,
        before: { assignmentId, roleId: assignment.roleId, roleCode: assignment.role.code, scope },
      });
      return this.presentAuthorization(tx, id);
    });
  }

  /** Creates or changes the ALLOW/DENY override at one scope. */
  async setOverride(
    sessionToken: string | undefined,
    employeeId: string,
    input: PermissionOverrideSetRequest,
    requestId?: string,
  ): Promise<EmployeeAuthorizationResponse> {
    const id = this.id(employeeId);
    const [permission] = normalizePermissions([input.permission]);
    if (!permission) throw new AuthError('VALIDATION_FAILED', 'permission');
    const scope = normalizeScope(input.scope);
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, [id], async (context) => {
      const { tx } = context;
      await this.requireTarget(context, id, scope, input.expectedVersion);
      await this.requireBranch(tx, scope);
      const [permissionId] = await this.permissionIds(tx, [permission]);
      if (!permissionId) throw new AuthError('VALIDATION_FAILED', 'permission');
      const existing = await tx.userPermissionOverride.findFirst({
        where: {
          userId: id,
          permissionId,
          scopeKind: scope.kind,
          branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
        },
        select: { id: true, effect: true },
      });
      if (existing?.effect === input.effect) throw new AuthError('CONFLICT');
      await this.changeGraph(context, [id], async () => {
        if (existing) {
          await tx.userPermissionOverride.update({
            where: { id: existing.id },
            data: { effect: input.effect, rowVersion: { increment: 1 } },
            select: { id: true },
          });
        } else {
          await tx.userPermissionOverride.create({
            data: {
              userId: id,
              permissionId,
              effect: input.effect,
              scopeKind: scope.kind,
              branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
            },
            select: { id: true },
          });
        }
      });
      await appendAdminAudit(context, {
        action: 'PERMISSION_OVERRIDE_CHANGED',
        entityType: 'User',
        entityId: id,
        subjectUserId: id,
        branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
        reason,
        before: { permission, scope, effect: existing?.effect ?? null },
        after: { permission, scope, effect: input.effect },
      });
      return this.presentAuthorization(tx, id);
    });
  }

  /** Removal restores inheritance; removing a DENY is a grant and is checked as one. */
  async removeOverride(
    sessionToken: string | undefined,
    employeeId: string,
    input: PermissionOverrideRemoveRequest,
    requestId?: string,
  ): Promise<EmployeeAuthorizationResponse> {
    const id = this.id(employeeId);
    const overrideId = this.id(input.overrideId, 'overrideId');
    const reason = normalizeReason(input.reason);
    return this.frame(sessionToken, true, requestId, [id], async (context) => {
      const { tx } = context;
      const override = await tx.userPermissionOverride.findFirst({
        where: { id: overrideId, userId: id },
        select: {
          id: true,
          effect: true,
          scopeKind: true,
          branchId: true,
          permission: { select: { code: true } },
        },
      });
      await this.requireTarget(
        context,
        id,
        override ? scopeOf(override) : null,
        input.expectedVersion,
      );
      if (!override) throw new AuthError('NOT_FOUND');
      const scope = scopeOf(override);
      await this.changeGraph(context, [id], async () => {
        await tx.userPermissionOverride.delete({ where: { id: overrideId }, select: { id: true } });
      });
      await appendAdminAudit(context, {
        action: 'PERMISSION_OVERRIDE_CHANGED',
        entityType: 'User',
        entityId: id,
        subjectUserId: id,
        branchId: scope.kind === 'BRANCH' ? scope.branchId : null,
        reason,
        before: { permission: override.permission.code, scope, effect: override.effect },
        after: { permission: override.permission.code, scope, effect: null },
      });
      return this.presentAuthorization(tx, id);
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

  private id(value: string, field?: string): string {
    const id = value.toLowerCase();
    if (!isUuid(id))
      throw field ? new AuthError('VALIDATION_FAILED', field) : new AuthError('NOT_FOUND');
    return id;
  }

  /** MANAGE_PERMISSIONS in any scope (Owner, GLOBAL, or an active member branch). */
  private administersAnywhere(graph: AuthorityGraph): boolean {
    return (
      decide(graph, 'MANAGE_PERMISSIONS', GLOBAL) ||
      [...graph.activeBranchIds].some((branchId) =>
        decide(graph, 'MANAGE_PERMISSIONS', { kind: 'BRANCH', branchId }),
      )
    );
  }

  /**
   * A non-Owner may place in a shared bundle only permissions it holds with unrestricted
   * GLOBAL authority: a bundle can be assigned anywhere, including where it is denied.
   */
  private requireBundleHeld(actor: AdminActor, permissions: readonly string[]): void {
    if (actor.owner) return;
    for (const permission of permissions) {
      if (!decide(actor.graph, permission, GLOBAL, { unrestricted: true })) {
        throw new AuthError('FORBIDDEN');
      }
    }
  }

  /** Every recipient of a role (any scope), for locking before the actor's session. */
  private recipientsOf(roleId: string) {
    return (tx: Prisma.TransactionClient) => this.recipientIds(tx, roleId);
  }

  private async recipientIds(tx: Prisma.TransactionClient, roleId: string): Promise<string[]> {
    const rows = await tx.userRoleAssignment.findMany({
      where: { roleId },
      select: { userId: true },
      distinct: ['userId'],
    });
    return rows.map((row) => row.userId).sort();
  }

  private async loadRole(
    tx: Prisma.TransactionClient,
    id: string,
    expectedVersion: number,
  ): Promise<RoleRecord> {
    const role = await tx.role.findUnique({ where: { id }, select: roleSelect });
    if (!role) throw new AuthError('NOT_FOUND');
    if (role.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
    return role;
  }

  private async permissionIds(
    tx: Prisma.TransactionClient,
    codes: readonly PermissionCodeName[],
  ): Promise<string[]> {
    if (codes.length === 0) return [];
    const rows = await tx.permission.findMany({
      where: { code: { in: [...codes] } },
      select: { id: true },
    });
    // The operator catalog sync has not inserted every code yet.
    if (rows.length !== codes.length) throw new AuthError('VALIDATION_FAILED', 'permissions');
    return rows.map((row) => row.id);
  }

  private async employeeBranches(tx: Prisma.TransactionClient, userId: string): Promise<string[]> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: {
        kind: true,
        employeeProfile: {
          select: { branchAssignments: { where: { revokedAt: null }, select: { branchId: true } } },
        },
      },
    });
    // Owner and customers are never grant targets.
    if (!user || user.kind !== 'EMPLOYEE' || !user.employeeProfile) {
      throw new AuthError('NOT_FOUND');
    }
    return user.employeeProfile.branchAssignments.map((row) => row.branchId);
  }

  /**
   * Target is an employee the actor administers: MANAGE_PERMISSIONS at the changed scope
   * and at every branch of the target; the expected version is its authzVersion.
   */
  private async requireTarget(
    context: AdminContext,
    userId: string,
    scope: AuthorizationScope | null,
    expectedVersion: number,
  ): Promise<void> {
    const branches = await this.employeeBranches(context.tx, userId);
    // A null scope (unknown assignment/override) checks only the target's own scope.
    if (scope?.kind === 'GLOBAL') requireAcross(context.actor, 'MANAGE_PERMISSIONS', []);
    requireAcross(context.actor, 'MANAGE_PERMISSIONS', [
      ...branches,
      ...(scope?.kind === 'BRANCH' ? [scope.branchId] : []),
    ]);
    const { authzVersion } = await context.tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { authzVersion: true },
    });
    if (authzVersion !== expectedVersion) throw new AuthError('CONFLICT');
  }

  private async requireBranch(
    tx: Prisma.TransactionClient,
    scope: AuthorizationScope,
  ): Promise<void> {
    if (scope.kind === 'GLOBAL') return;
    const branch = await tx.branch.findUnique({
      where: { id: scope.branchId },
      select: { isActive: true },
    });
    if (!branch?.isActive) throw new AuthError('VALIDATION_FAILED', 'scope');
  }

  /**
   * Applies a graph mutation for the affected Users (already locked by the frame) and
   * enforces the Step 7 rules on each: the actor must administer the recipient at every
   * scope it holds this role, and every gained capability must be held by the actor.
   * Then increments authzVersion, revokes sessions and retires setup capabilities.
   */
  private async changeGraph(
    context: AdminContext,
    userIds: readonly string[],
    mutate: () => Promise<void>,
    sharedRoleId?: string,
  ): Promise<void> {
    const { tx, actor, now } = context;
    const before = new Map<string, AuthorityGraph>();
    for (const userId of userIds) {
      const graph = await loadAuthorityGraph(tx, userId);
      if (!graph) throw new AuthError('NOT_FOUND');
      before.set(userId, graph);
      if (sharedRoleId) {
        // A global delegation cannot bypass a branch DENY over any affected recipient.
        const scopes = await tx.userRoleAssignment.findMany({
          where: { userId, roleId: sharedRoleId },
          select: { scopeKind: true, branchId: true },
        });
        const branches = await this.employeeBranches(tx, userId);
        requireAcross(actor, 'MANAGE_PERMISSIONS', [
          ...branches,
          ...scopes.flatMap((row) => (row.branchId ? [row.branchId] : [])),
        ]);
      }
    }
    await mutate();
    for (const userId of userIds) {
      const after = await loadAuthorityGraph(tx, userId);
      if (!after || checkGraphChange(actor.graph, before.get(userId)!, after) !== null) {
        throw new AuthError('FORBIDDEN');
      }
    }
    if (userIds.length === 0) return;
    const setups = await tx.authChallenge.findMany({
      where: {
        userId: { in: [...userIds] },
        purpose: 'EMPLOYEE_SETUP',
        consumedAt: null,
        invalidatedAt: null,
      },
      select: { id: true },
    });
    await invalidateChallenges(
      tx,
      setups.map((row) => row.id),
      now,
    );
    const counts = new Map<string, number>();
    for (const userId of userIds) {
      counts.set(userId, await tx.session.count({ where: { userId, revokedAt: null } }));
    }
    await invalidateAuthorization(tx, userIds, now);
    for (const [userId, revokedSessions] of counts) {
      if (revokedSessions === 0) continue;
      await appendAdminAudit(context, {
        action: 'SESSIONS_REVOKED',
        entityType: 'User',
        entityId: userId,
        subjectUserId: userId,
        after: { reason: 'AUTHORIZATION_CHANGED', revokedSessions },
      });
    }
  }

  private async presentAuthorization(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<EmployeeAuthorizationResponse> {
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        authzVersion: true,
        roleAssignments: {
          select: {
            id: true,
            roleId: true,
            scopeKind: true,
            branchId: true,
            role: { select: { code: true } },
          },
          orderBy: { id: 'asc' },
        },
        permissionOverrides: {
          select: {
            id: true,
            effect: true,
            scopeKind: true,
            branchId: true,
            permission: { select: { code: true } },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
    return {
      userId,
      version: user.authzVersion,
      roleAssignments: user.roleAssignments.map((row) => ({
        id: row.id,
        roleId: row.roleId,
        roleCode: row.role.code,
        scope: scopeOf(row),
      })),
      overrides: user.permissionOverrides.map((row) => ({
        id: row.id,
        permission: row.permission.code as PermissionCodeName,
        effect: row.effect,
        scope: scopeOf(row),
      })),
    };
  }
}

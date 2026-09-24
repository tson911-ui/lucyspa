import { randomUUID } from 'node:crypto';
import type {
  EmployeeBaseSalaryRequest,
  EmployeeCreateRequest,
  EmployeeProfileUpdateRequest,
  EmployeeResponse,
  EmployeeScopeChangeRequest,
  EmployeeSetupIssueRequest,
  EmployeeSetupIssueResponse,
  EmployeeStatusChangeRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { invalidatePendingDeliveries } from '../auth/auth-delivery.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest, generateCapability, identityDigest } from '../auth/crypto.js';
import { flowTokenDigest, OTP_POLICY } from '../auth/otp-flow.js';
import { hasFreshReauthentication, type SessionPrincipal } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import {
  authorizationSummary,
  checkContainment,
  checkGraphChange,
  decideAcross,
  type AuthorityGraph,
} from '../authorization/authorization.js';
import {
  invalidateAuthorization,
  loadAuthorityGraph,
} from '../authorization/authorization.store.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import {
  isUuid,
  normalizeBranchIds,
  normalizeEmployee,
  normalizeProfilePatch,
  normalizeReason,
  parseBaseSalary,
} from './employee.input.js';

/** Design section 2: a setup capability is high-entropy and lives 24 hours. */
export const EMPLOYEE_SETUP_POLICY = Object.freeze({ lifetimeSeconds: 86_400 } as const);
export const SETUP_PURPOSE = 'EMPLOYEE_SETUP';

/** Flows bound to a credential that an inactivation or setup reissue retires. */
const CREDENTIAL_FLOWS = ['RESET_PASSWORD', 'EMPLOYEE_SETUP', 'VERIFY_RECOVERY_EMAIL'] as const;

const employeeSelect = {
  id: true,
  kind: true,
  status: true,
  fullName: true,
  preferredLocale: true,
  emailDelivery: true,
  emailVerifiedAt: true,
  phoneCanonical: true,
  passwordHash: true,
  credentialVersion: true,
  authzVersion: true,
  rowVersion: true,
  employeeProfile: {
    select: {
      employeeCodeCanonical: true,
      dateOfBirth: true,
      address: true,
      baseSalaryVnd: true,
      // Every unrevoked membership, including inactive branches: stricter authorization.
      branchAssignments: {
        where: { revokedAt: null },
        select: { branchId: true },
        orderBy: { branchId: 'asc' },
      },
    },
  },
} satisfies Prisma.UserSelect;

type EmployeeRecord = Prisma.UserGetPayload<{ select: typeof employeeSelect }> & {
  employeeProfile: NonNullable<
    Prisma.UserGetPayload<{ select: typeof employeeSelect }>['employeeProfile']
  >;
};

interface Actor {
  readonly principal: SessionPrincipal;
  readonly graph: AuthorityGraph;
  readonly userId: string;
  readonly owner: boolean;
}

interface CommandContext {
  readonly tx: Prisma.TransactionClient;
  readonly now: Date;
  readonly actor: Actor;
  readonly requestId: string | null;
}

interface TargetContext extends CommandContext {
  readonly target: EmployeeRecord;
  readonly branchIds: string[];
}

function branchesOf(target: EmployeeRecord): string[] {
  return target.employeeProfile.branchAssignments.map((row) => row.branchId);
}

/** A single-branch event names its branch; global or multi-branch events use null. */
function auditBranch(branchIds: readonly string[]): string | null {
  return branchIds.length === 1 ? (branchIds[0] ?? null) : null;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function uniqueViolation(error: unknown): boolean {
  return Reflect.get(Object(error), 'code') === 'P2002';
}

/**
 * Phase 1 employee administration (design sections 2, 7, 8 and 10). Every command runs
 * with transaction-time authorization from the Step 7 engine, targets EMPLOYEE Users
 * only (Owner and customers are reported as not found and never modified) and appends
 * its audit in the same transaction.
 */
@Injectable()
export class EmployeeService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation'
    >,
    @Inject(AuthThrottleService) private readonly throttle: Pick<AuthThrottleService, 'now'>,
  ) {}

  /** Creates only PENDING_SETUP with explicit branch membership; no credential, no grant. */
  async create(
    sessionToken: string | undefined,
    input: EmployeeCreateRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const candidate = normalizeEmployee(input);
    // Membership is part of the security graph: exclusive lock.
    return this.command(sessionToken, null, true, requestId, async (context) => {
      const { tx, now, actor } = context;
      this.require(actor, 'CREATE_EMPLOYEES', candidate.branchIds);
      if (candidate.baseSalaryVnd !== null) {
        this.require(actor, 'MANAGE_EMPLOYEE_PAY', candidate.branchIds);
      }
      await this.requireActiveBranches(tx, candidate.branchIds);
      await this.requireUnique(tx, candidate);
      const id = randomUUID();
      await tx.user.create({
        data: {
          id,
          kind: 'EMPLOYEE',
          status: 'PENDING_SETUP',
          fullName: candidate.fullName,
          preferredLocale: candidate.locale,
          emailCanonical: candidate.emailCanonical,
          emailDelivery: candidate.emailDelivery,
          // An administrator entering an address is not verification (Step 9 proves it).
          emailVerifiedAt: null,
          phoneCanonical: candidate.phoneCanonical,
          normalizationVersion: candidate.normalizationVersion,
          passwordHash: null,
          employeeProfile: {
            create: {
              employeeCodeCanonical: candidate.employeeCodeCanonical,
              dateOfBirth: candidate.dateOfBirth,
              address: candidate.address,
              baseSalaryVnd: candidate.baseSalaryVnd,
            },
          },
        },
        select: { id: true },
      });
      if (candidate.branchIds.length > 0) {
        await tx.employeeBranchAssignment.createMany({
          data: candidate.branchIds.map((branchId) => ({
            employeeUserId: id,
            branchId,
            grantedAt: now,
            grantedByUserId: actor.userId,
          })),
        });
      }
      await this.audit(context, id, candidate.branchIds, 'EMPLOYEE_CREATED', {
        after: {
          status: 'PENDING_SETUP',
          employeeId: candidate.employeeCodeCanonical,
          branchIds: candidate.branchIds,
          recoveryEmailSupplied: candidate.emailCanonical !== null,
        },
      });
      if (candidate.baseSalaryVnd !== null) {
        await this.audit(context, id, candidate.branchIds, 'BASE_SALARY_CHANGED', {
          before: { baseSalaryVnd: null },
          after: { baseSalaryVnd: candidate.baseSalaryVnd.toString() },
          classification: 'EMPLOYEE_PAY',
        });
      }
      return this.present(actor, await this.load(tx, id));
    });
  }

  /** Object-level read: inaccessible and non-employee IDs are a consistent 404. */
  async get(sessionToken: string | undefined, targetId: string): Promise<EmployeeResponse> {
    return this.command(
      sessionToken,
      targetId,
      false,
      undefined,
      ({ actor, target, branchIds }) => {
        if (!decideAcross(actor.graph, 'VIEW_EMPLOYEES', branchIds)) {
          throw new AuthError('NOT_FOUND');
        }
        return Promise.resolve(this.present(actor, target));
      },
    );
  }

  /** Non-security profile fields only; contact identifiers and pay are excluded. */
  async updateProfile(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeProfileUpdateRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const patch = normalizeProfilePatch(input);
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, actor, target, branchIds } = context;
      this.require(actor, 'UPDATE_EMPLOYEES', branchIds);
      this.expectVersion(target, input.expectedVersion);
      await tx.user.update({
        where: { id: target.id },
        data: {
          ...(patch.fullName !== undefined ? { fullName: patch.fullName } : {}),
          ...(patch.locale !== undefined ? { preferredLocale: patch.locale } : {}),
          rowVersion: { increment: 1 },
          employeeProfile: {
            update: {
              ...(patch.dateOfBirth !== undefined ? { dateOfBirth: patch.dateOfBirth } : {}),
              ...(patch.address !== undefined ? { address: patch.address } : {}),
            },
          },
        },
        select: { id: true },
      });
      // Field names only; profile values are not copied into permanent history.
      await this.audit(context, target.id, branchIds, 'PROFILE_UPDATED', {
        after: { fields: Object.keys(patch).sort() },
      });
      return this.present(actor, await this.load(tx, target.id));
    });
  }

  /**
   * INACTIVE revokes sessions and outstanding setup/reset/recovery flows. Reactivation
   * restores previously assigned powers, so it requires credential-control containment,
   * and returns to ACTIVE only when a credential remains (otherwise PENDING_SETUP).
   */
  async changeStatus(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeStatusChangeRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const reason = normalizeReason(input.reason);
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, now, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      this.require(actor, 'MANAGE_EMPLOYEE_STATUS', branchIds);
      this.expectVersion(target, input.expectedVersion);
      if (input.status === 'INACTIVE') {
        if (target.status === 'INACTIVE') throw new AuthError('CONFLICT');
        await tx.user.update({
          where: { id: target.id },
          data: { status: 'INACTIVE', rowVersion: { increment: 1 } },
          select: { id: true },
        });
        await this.retireFlows(tx, target.id, CREDENTIAL_FLOWS, now);
        const revoked = await invalidateAuthorization(tx, [target.id], now);
        await this.audit(context, target.id, branchIds, 'STATUS_CHANGED', {
          reason,
          before: { status: target.status },
          after: { status: 'INACTIVE' },
        });
        await this.revokedAudit(context, target.id, branchIds, revoked, 'EMPLOYEE_INACTIVATED');
      } else {
        if (target.status !== 'INACTIVE') throw new AuthError('CONFLICT');
        await this.requireContainment(tx, actor, target.id);
        const status = target.passwordHash === null ? 'PENDING_SETUP' : 'ACTIVE';
        await tx.user.update({
          where: { id: target.id },
          data: { status, rowVersion: { increment: 1 } },
          select: { id: true },
        });
        await this.audit(context, target.id, branchIds, 'STATUS_CHANGED', {
          reason,
          before: { status: 'INACTIVE' },
          after: { status },
        });
      }
      return this.present(actor, await this.load(tx, target.id));
    });
  }

  /**
   * Replaces the employee's authorization branch membership. MANAGE_EMPLOYEE_SCOPE is
   * required at every old and new branch, activating a dormant grant additionally needs
   * MANAGE_PERMISSIONS, and the resulting rights cannot exceed the actor's own.
   */
  async changeScope(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeScopeChangeRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const next = normalizeBranchIds(input.branchIds);
    const reason = normalizeReason(input.reason);
    return this.command(sessionToken, targetId, true, requestId, async (context) => {
      const { tx, now, actor, target, branchIds: previous } = context;
      this.forbidSelf(actor, target);
      const added = next.filter((id) => !previous.includes(id));
      const removed = previous.filter((id) => !next.includes(id));
      this.require(actor, 'MANAGE_EMPLOYEE_SCOPE', [...previous, ...next]);
      this.expectVersion(target, input.expectedVersion);
      if (added.length === 0 && removed.length === 0) {
        throw new AuthError('VALIDATION_FAILED', 'branchIds');
      }
      await this.requireActiveBranches(tx, added);
      const before = await loadAuthorityGraph(tx, target.id);
      if (!before) throw new AuthError('NOT_FOUND');
      const after: AuthorityGraph = {
        ...before,
        activeBranchIds: new Set([
          ...[...before.activeBranchIds].filter((id) => !removed.includes(id)),
          ...added,
        ]),
      };
      if (checkGraphChange(actor.graph, before, after) !== null) {
        throw new AuthError('FORBIDDEN');
      }
      if (this.activatesGrants(before, after)) {
        this.require(actor, 'MANAGE_PERMISSIONS', added);
      }
      if (removed.length > 0) {
        await tx.employeeBranchAssignment.updateMany({
          where: { employeeUserId: target.id, branchId: { in: removed }, revokedAt: null },
          data: { revokedAt: now },
        });
      }
      if (added.length > 0) {
        await tx.employeeBranchAssignment.createMany({
          data: added.map((branchId) => ({
            employeeUserId: target.id,
            branchId,
            grantedAt: now,
            grantedByUserId: actor.userId,
          })),
        });
      }
      await tx.user.update({
        where: { id: target.id },
        data: { rowVersion: { increment: 1 } },
        select: { id: true },
      });
      // A setup capability must never become a route into the changed authority.
      await this.retireFlows(tx, target.id, [SETUP_PURPOSE], now);
      const revoked = await invalidateAuthorization(tx, [target.id], now);
      // Multi-branch change: a global event, authorized by whoever can see all of it.
      await this.audit(context, target.id, [], 'BRANCH_SCOPE_CHANGED', {
        reason,
        before: { branchIds: previous },
        after: { branchIds: next },
      });
      await this.revokedAudit(context, target.id, [], revoked, 'BRANCH_SCOPE_CHANGED');
      return this.present(actor, await this.load(tx, target.id));
    });
  }

  /** Supplied base salary only (null = unknown). Restricted EMPLOYEE_PAY audit. */
  async setBaseSalary(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeBaseSalaryRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const salary = parseBaseSalary(input.baseSalaryVnd);
    const reason = normalizeReason(input.reason);
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      this.require(actor, 'MANAGE_EMPLOYEE_PAY', branchIds);
      this.expectVersion(target, input.expectedVersion);
      await tx.user.update({
        where: { id: target.id },
        data: {
          rowVersion: { increment: 1 },
          employeeProfile: { update: { baseSalaryVnd: salary } },
        },
        select: { id: true },
      });
      await this.audit(context, target.id, branchIds, 'BASE_SALARY_CHANGED', {
        reason,
        before: { baseSalaryVnd: target.employeeProfile.baseSalaryVnd?.toString() ?? null },
        after: { baseSalaryVnd: salary?.toString() ?? null },
        classification: 'EMPLOYEE_PAY',
      });
      return this.present(actor, await this.load(tx, target.id));
    });
  }

  /**
   * Issues (PENDING_SETUP) or reissues (ACTIVE) the 24-hour setup capability. Requires
   * fresh password proof, MANAGE_EMPLOYEE_ACCESS at every branch and containment. A
   * reissue clears the password, increments the credential version, moves the account
   * to PENDING_SETUP and revokes its sessions. Prior setup/reset/recovery flows end.
   */
  async issueSetup(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeSetupIssueRequest,
    requestId?: string,
  ): Promise<EmployeeSetupIssueResponse> {
    const reason = normalizeReason(input.reason);
    const setupToken = generateCapability();
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, now, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      if (!hasFreshReauthentication(actor.principal, now, this.environment.auth.freshAuthSeconds)) {
        throw new AuthError('REAUTHENTICATION_REQUIRED');
      }
      this.require(actor, 'MANAGE_EMPLOYEE_ACCESS', branchIds);
      this.expectVersion(target, input.expectedVersion);
      if (target.status === 'INACTIVE') throw new AuthError('CONFLICT');
      await this.requireContainment(tx, actor, target.id);
      const reissue = target.status === 'ACTIVE';
      const credentialVersion = reissue ? target.credentialVersion + 1 : target.credentialVersion;
      await tx.user.update({
        where: { id: target.id },
        data: {
          rowVersion: { increment: 1 },
          ...(reissue ? { status: 'PENDING_SETUP', passwordHash: null, credentialVersion } : {}),
        },
        select: { id: true },
      });
      await this.retireFlows(tx, target.id, CREDENTIAL_FLOWS, now);
      const revoked = reissue
        ? (
            await tx.session.updateMany({
              where: { userId: target.id, revokedAt: null },
              data: { revokedAt: now },
            })
          ).count
        : 0;
      const identity = this.setupIdentity(target.id);
      const challengeId = randomUUID();
      const expiresAt = new Date(now.getTime() + EMPLOYEE_SETUP_POLICY.lifetimeSeconds * 1_000);
      await tx.authChallenge.create({
        data: {
          id: challengeId,
          purpose: SETUP_PURPOSE,
          flowTokenHash: new Uint8Array(flowTokenDigest(setupToken)),
          identityKey: new Uint8Array(identity.digest),
          identityKeyVersion: identity.version,
          userId: target.id,
          generation: 1,
          credentialVersion,
          authzVersion: target.authzVersion,
          maxAttempts: OTP_POLICY.maxAttempts,
          createdAt: now,
          flowExpiresAt: expiresAt,
        },
        select: { id: true },
      });
      await this.audit(context, target.id, branchIds, 'ACCESS_SETUP_ISSUED', {
        reason,
        before: { status: target.status, credentialVersion: target.credentialVersion },
        after: {
          status: 'PENDING_SETUP',
          credentialVersion,
          challengeId,
          reissue,
        },
      });
      await this.revokedAudit(context, target.id, branchIds, revoked, 'ACCESS_SETUP_REISSUED');
      return { setupToken, expiresAt: expiresAt.toISOString() };
    });
  }

  /**
   * Shared command frame. Lock order: graph (shared, or exclusive for membership
   * changes), Users sorted by UUID (actor and target), the actor's session, then
   * challenge rows. Authorization always uses graphs loaded under those locks.
   */
  private async command<T>(
    sessionToken: string | undefined,
    targetId: null,
    exclusive: boolean,
    requestId: string | undefined,
    work: (context: CommandContext) => Promise<T>,
  ): Promise<T>;
  private async command<T>(
    sessionToken: string | undefined,
    targetId: string,
    exclusive: boolean,
    requestId: string | undefined,
    work: (context: TargetContext) => Promise<T>,
  ): Promise<T>;
  private async command<T>(
    sessionToken: string | undefined,
    targetId: string | null,
    exclusive: boolean,
    requestId: string | undefined,
    work: (context: TargetContext) => Promise<T>,
  ): Promise<T> {
    const digest = sessionToken === undefined ? null : capabilityDigest(sessionToken);
    if (sessionToken === undefined || digest === null) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    const target = targetId?.toLowerCase() ?? null;
    if (target !== null && !isUuid(target)) throw new AuthError('NOT_FOUND');
    const run = exclusive
      ? this.sessions.withExclusiveTransaction.bind(this.sessions)
      : this.sessions.withTransaction.bind(this.sessions);
    try {
      return await run(async (tx) => {
        const hint = await tx.session.findUnique({
          where: { tokenHash: new Uint8Array(digest) },
          select: { userId: true },
        });
        if (!hint?.userId) throw new AuthError('AUTHENTICATION_REQUIRED');
        const users = [...new Set([hint.userId, ...(target ? [target] : [])])].sort();
        for (const id of users) {
          await tx.$queryRaw`SELECT id FROM users WHERE id = ${id}::uuid FOR UPDATE`;
        }
        const principal = await this.sessions.resolveForMutation(sessionToken, tx);
        if (
          principal?.kind !== 'AUTHENTICATED' ||
          principal.userId === null ||
          principal.userId !== hint.userId
        ) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        // Customers never reach employee administration.
        if (principal.userKind !== 'OWNER' && principal.userKind !== 'EMPLOYEE') {
          throw new AuthError('FORBIDDEN');
        }
        const graph = await loadAuthorityGraph(tx, principal.userId);
        if (!graph) throw new AuthError('AUTHENTICATION_REQUIRED');
        const actor: Actor = {
          principal,
          graph,
          userId: principal.userId,
          owner: graph.kind === 'OWNER',
        };
        const now = await this.throttle.now(tx);
        const base = { tx, now, actor, requestId: requestId ?? null };
        if (target === null) return work(base as TargetContext);
        const record = await tx.user.findUnique({ where: { id: target }, select: employeeSelect });
        // Owner and customers are never employee-administration targets.
        if (!record || record.kind !== 'EMPLOYEE' || !record.employeeProfile) {
          throw new AuthError('NOT_FOUND');
        }
        const employee = record as EmployeeRecord;
        return work({ ...base, target: employee, branchIds: branchesOf(employee) });
      });
    } catch (error) {
      if (error instanceof AuthError) throw error;
      // A concurrent insert won the unique identifier; reveal no conflicting account.
      if (uniqueViolation(error)) throw new AuthError('CONFLICT');
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }

  /** Every affected branch must pass; no branch requires GLOBAL authority. */
  private require(actor: Actor, permission: string, branchIds: readonly string[]): void {
    if (!decideAcross(actor.graph, permission, branchIds)) throw new AuthError('FORBIDDEN');
  }

  /** Non-Owners cannot change their own status, scope, pay or credentials. */
  private forbidSelf(actor: Actor, target: EmployeeRecord): void {
    if (!actor.owner && actor.userId === target.id) throw new AuthError('FORBIDDEN');
  }

  private expectVersion(target: EmployeeRecord, expectedVersion: number): void {
    if (target.rowVersion !== expectedVersion) throw new AuthError('CONFLICT');
  }

  /** Target evaluated as if ACTIVE: its status never reduces the comparison to zero. */
  private async requireContainment(
    tx: Prisma.TransactionClient,
    actor: Actor,
    targetId: string,
  ): Promise<void> {
    const target = await loadAuthorityGraph(tx, targetId);
    if (!target || checkContainment(actor.graph, target) !== null) {
      throw new AuthError('FORBIDDEN');
    }
  }

  /** Scope expansion that makes a dormant branch grant effective counts as a grant. */
  private activatesGrants(before: AuthorityGraph, after: AuthorityGraph): boolean {
    const key = (grant: { permission: string; scope: { kind: string; branchId?: string } }) =>
      `${grant.permission}|${grant.scope.branchId ?? '*'}`;
    const summaryBefore = authorizationSummary(before);
    const summaryAfter = authorizationSummary(after);
    if (!('grants' in summaryBefore) || !('grants' in summaryAfter)) return true;
    const held = new Set(summaryBefore.grants.map(key));
    return summaryAfter.grants.some((grant) => !held.has(key(grant)));
  }

  private async requireActiveBranches(
    tx: Prisma.TransactionClient,
    branchIds: readonly string[],
  ): Promise<void> {
    if (branchIds.length === 0) return;
    const found = await tx.branch.count({ where: { id: { in: [...branchIds] }, isActive: true } });
    if (found !== branchIds.length) throw new AuthError('VALIDATION_FAILED', 'branchIds');
  }

  /** Reports only the submitted field that collides, never the conflicting account. */
  private async requireUnique(
    tx: Prisma.TransactionClient,
    candidate: ReturnType<typeof normalizeEmployee>,
  ): Promise<void> {
    if (
      await tx.employeeProfile.findUnique({
        where: { employeeCodeCanonical: candidate.employeeCodeCanonical },
        select: { userId: true },
      })
    ) {
      throw new AuthError('CONFLICT', 'employeeId');
    }
    if (
      await tx.user.findUnique({
        where: { phoneCanonical: candidate.phoneCanonical },
        select: { id: true },
      })
    ) {
      throw new AuthError('CONFLICT', 'phone');
    }
    if (
      candidate.emailCanonical !== null &&
      (await tx.user.findUnique({
        where: { emailCanonical: candidate.emailCanonical },
        select: { id: true },
      }))
    ) {
      throw new AuthError('CONFLICT', 'email');
    }
  }

  private async retireFlows(
    tx: Prisma.TransactionClient,
    userId: string,
    purposes: readonly (typeof CREDENTIAL_FLOWS)[number][],
    now: Date,
  ): Promise<void> {
    const actionable = await tx.authChallenge.findMany({
      where: { userId, purpose: { in: [...purposes] }, consumedAt: null, invalidatedAt: null },
      select: { id: true },
    });
    if (actionable.length === 0) return;
    const ids = actionable.map((row) => row.id);
    await tx.authChallenge.updateMany({ where: { id: { in: ids } }, data: { invalidatedAt: now } });
    await invalidatePendingDeliveries(tx, ids);
  }

  private setupIdentity(userId: string): { version: number; digest: Buffer } {
    const version = this.environment.auth.throttleActiveVersion;
    const key = this.environment.auth.throttleKeys.get(version);
    if (!key) throw new Error('Identity key unavailable.');
    return { version, digest: identityDigest(SETUP_PURPOSE, userId, key) };
  }

  private async audit(
    context: CommandContext,
    subjectUserId: string,
    branchIds: readonly string[],
    action: string,
    detail: {
      reason?: string;
      before?: Prisma.InputJsonObject;
      after?: Prisma.InputJsonObject;
      classification?: 'STANDARD' | 'EMPLOYEE_PAY';
    },
  ): Promise<void> {
    await context.tx.auditEvent.create({
      data: {
        action,
        actorKind: 'USER',
        actorUserId: context.actor.userId,
        subjectUserId,
        entityType: 'User',
        entityId: subjectUserId,
        branchId: auditBranch(branchIds),
        requestId: context.requestId,
        occurredAt: context.now,
        reason: detail.reason ?? null,
        ...(detail.before ? { before: detail.before } : {}),
        ...(detail.after ? { after: detail.after } : {}),
        dataClassification: detail.classification ?? 'STANDARD',
      },
      select: { id: true },
    });
  }

  private async revokedAudit(
    context: CommandContext,
    subjectUserId: string,
    branchIds: readonly string[],
    revokedSessions: number,
    reason: string,
  ): Promise<void> {
    if (revokedSessions === 0) return;
    await this.audit(context, subjectUserId, branchIds, 'SESSIONS_REVOKED', {
      after: { reason, revokedSessions },
    });
  }

  private async load(tx: Prisma.TransactionClient, id: string): Promise<EmployeeRecord> {
    return (await tx.user.findUniqueOrThrow({
      where: { id },
      select: employeeSelect,
    })) as EmployeeRecord;
  }

  /** Pay appears only when VIEW_EMPLOYEE_PAY passes for the full target. */
  private present(actor: Actor, target: EmployeeRecord): EmployeeResponse {
    const branchIds = branchesOf(target);
    const response: EmployeeResponse = {
      id: target.id,
      employeeId: target.employeeProfile.employeeCodeCanonical,
      fullName: target.fullName,
      dateOfBirth: dateOnly(target.employeeProfile.dateOfBirth),
      address: target.employeeProfile.address,
      phone: target.phoneCanonical ?? '',
      email: target.emailDelivery,
      emailVerified: target.emailVerifiedAt !== null,
      locale: target.preferredLocale,
      status: target.status,
      branchIds,
      version: target.rowVersion,
    };
    if (decideAcross(actor.graph, 'VIEW_EMPLOYEE_PAY', branchIds)) {
      response.baseSalaryVnd = target.employeeProfile.baseSalaryVnd?.toString() ?? null;
    }
    return response;
  }
}

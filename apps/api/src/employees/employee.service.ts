import { randomUUID } from 'node:crypto';
import type {
  EmployeeCredentialsRequest,
  EmploymentEndAccess,
  EmploymentEndRequest,
  EmploymentEndResponse,
  EmploymentClassificationChangeRequest,
  EmploymentResponse,
  EmployeeBaseSalaryRequest,
  EmployeeBranchAssignmentsResponse,
  EmployeeBranchAssignRequest,
  EmployeeBranchRevokeRequest,
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
import { text } from '../auth/registration.js';
import { generateCapability, identityDigest } from '../auth/crypto.js';
import { flowTokenDigest, OTP_POLICY } from '../auth/otp-flow.js';
import {
  PasswordPolicyError,
  PasswordService,
  validatePasswordForSetting,
} from '../auth/password.service.js';
import { hasFreshReauthentication } from '../auth/session.policy.js';
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
import {
  requireAcross,
  runAdminCommand,
  type AdminActor,
  type AdminContext,
} from '../authorization/admin-command.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import {
  isUuid,
  normalizeBranchIds,
  normalizeEmployee,
  normalizeProfilePatch,
  EMPLOYMENT_REASON_MAX_CODE_POINTS,
  normalizeReason,
  parseBaseSalary,
} from './employee.input.js';
import {
  businessToday,
  classificationHistory,
  classificationOn,
  classificationSelect,
  day,
  parseEmploymentDate,
  payrollEligible,
  presentClassification,
  transitionAllowed,
} from './employment.js';
import { holdsManagerRole, workforceTitle } from './workforce-title.js';

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

type Actor = AdminActor;
type CommandContext = AdminContext;

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
    @Inject(PasswordService) private readonly passwords: Pick<PasswordService, 'hashForSetting'>,
  ) {}

  /**
   * Creates an employee with explicit branch membership and no grant. Without
   * `initialPassword` the account is PENDING_SETUP. With it (Owner/manager-provisioned
   * workforce access) the account is created ACTIVE in the same transaction; that needs
   * MANAGE_EMPLOYEE_ACCESS at every branch and a fresh reauthentication of the creator.
   */
  async create(
    sessionToken: string | undefined,
    input: EmployeeCreateRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const candidate = normalizeEmployee(input);
    const passwordHash =
      input.initialPassword === undefined
        ? null
        : await this.preparePassword(sessionToken, input.initialPassword, 'initialPassword');
    // Membership is part of the security graph: exclusive lock.
    return this.command(sessionToken, null, true, requestId, async (context) => {
      const { tx, now, actor } = context;
      this.require(actor, 'CREATE_EMPLOYEES', candidate.branchIds);
      if (passwordHash !== null) {
        // Provisioning sign-in is an access decision, exactly as for later credential changes.
        this.requireFresh(actor, now);
        this.require(actor, 'MANAGE_EMPLOYEE_ACCESS', candidate.branchIds);
      }
      if (candidate.baseSalaryVnd !== null) {
        this.require(actor, 'MANAGE_EMPLOYEE_PAY', candidate.branchIds);
      }
      // Base salary is for official employment only (Owner decision Q16).
      if (candidate.baseSalaryVnd !== null && candidate.classification !== 'OFFICIAL_EMPLOYEE') {
        throw new AuthError('VALIDATION_FAILED', 'baseSalaryVnd');
      }
      // Official employment creates payroll eligibility: the pay authority is required too.
      // TRAINEE and COLLABORATOR need only CREATE_EMPLOYEES (collaborator pay is per
      // scheduled occurrence and authorized there, Owner decision Q2).
      if (candidate.classification === 'OFFICIAL_EMPLOYEE') {
        this.require(actor, 'MANAGE_EMPLOYEE_PAY', candidate.branchIds);
      }
      await this.requireActiveBranches(tx, candidate.branchIds);
      // A start date in the past (recording existing staff) must say why.
      const today = await businessToday(tx, candidate.branchIds);
      if (candidate.employmentStartDate < today && candidate.employmentReason === null) {
        throw new AuthError('VALIDATION_FAILED', 'employmentReason');
      }
      await this.requireUnique(tx, candidate);
      const id = randomUUID();
      await tx.user.create({
        data: {
          id,
          kind: 'EMPLOYEE',
          status: passwordHash === null ? 'PENDING_SETUP' : 'ACTIVE',
          fullName: candidate.fullName,
          preferredLocale: candidate.locale,
          emailCanonical: candidate.emailCanonical,
          emailDelivery: candidate.emailDelivery,
          // An administrator entering an address is not verification (Step 9 proves it).
          emailVerifiedAt: null,
          phoneCanonical: candidate.phoneCanonical,
          normalizationVersion: candidate.normalizationVersion,
          passwordHash,
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
      // Initial classification in the same transaction: no employee without history.
      await tx.employmentClassificationChange.create({
        data: {
          employeeUserId: id,
          classification: candidate.classification,
          effectiveDate: candidate.employmentStartDate,
          reason: candidate.employmentReason,
          recordedByUserId: actor.userId,
          recordedAt: now,
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
          status: passwordHash === null ? 'PENDING_SETUP' : 'ACTIVE',
          employeeId: candidate.employeeCodeCanonical,
          branchIds: candidate.branchIds,
          recoveryEmailSupplied: candidate.emailCanonical !== null,
        },
      });
      if (passwordHash !== null) {
        // Never any password material: only the fact, the method and the version.
        await this.audit(context, id, candidate.branchIds, 'ACCESS_PASSWORD_SET', {
          after: { status: 'ACTIVE', credentialVersion: 1, method: 'INITIAL_PROVISIONING' },
        });
      }
      await this.audit(context, id, candidate.branchIds, 'EMPLOYMENT_CLASSIFICATION_RECORDED', {
        ...(candidate.employmentReason ? { reason: candidate.employmentReason } : {}),
        after: {
          classification: candidate.classification,
          effectiveDate: day(candidate.employmentStartDate),
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

  /**
   * Employment classification history (oldest first), the classification in effect today and,
   * with `date`, on that business date. Visible to the employee themself and to VIEW_EMPLOYEES
   * over every branch of the employee; otherwise 404.
   */
  async employment(
    sessionToken: string | undefined,
    targetId: string,
    query: { date?: string },
  ): Promise<EmploymentResponse> {
    const date = query.date === undefined ? null : parseEmploymentDate(query.date, 'date');
    return this.command(
      sessionToken,
      targetId,
      false,
      undefined,
      async ({ tx, actor, target, branchIds }) => {
        if (actor.userId !== target.id && !decideAcross(actor.graph, 'VIEW_EMPLOYEES', branchIds)) {
          throw new AuthError('NOT_FOUND');
        }
        return this.presentEmployment(tx, target, branchIds, date);
      },
    );
  }

  /**
   * Records a classification change: TRAINEE → OFFICIAL_EMPLOYEE (promotion), TRAINEE → ENDED
   * or OFFICIAL_EMPLOYEE → ENDED. It changes payroll eligibility, so it needs
   * MANAGE_EMPLOYEE_PAY at every branch of the employee and is never self-service for
   * non-Owners. The effective date must be later than the latest change (history is never
   * rewritten); a date before today's business date (backdating) is Owner-only. A reason is
   * always required. No other state (account, roles, branches, skills) changes.
   */
  async changeClassification(
    sessionToken: string | undefined,
    targetId: string,
    input: EmploymentClassificationChangeRequest,
    requestId?: string,
  ): Promise<EmploymentResponse> {
    if (
      input.classification !== 'COLLABORATOR' &&
      input.classification !== 'OFFICIAL_EMPLOYEE' &&
      input.classification !== 'ENDED'
    ) {
      throw new AuthError('VALIDATION_FAILED', 'classification');
    }
    const effectiveDate = parseEmploymentDate(input.effectiveDate, 'effectiveDate');
    const reason = text(input.reason, 'reason', EMPLOYMENT_REASON_MAX_CODE_POINTS);
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      this.expectVersion(target, input.expectedVersion);
      await this.appendClassification(context, input.classification, effectiveDate, reason);
      return this.presentEmployment(tx, await this.load(tx, target.id), branchIds, null);
    });
  }

  /**
   * Sets or replaces the employee's workforce password (Owner/manager-managed; no employee
   * OTP). Rules as for setup issuance: never oneself unless Owner, fresh reauthentication,
   * MANAGE_EMPLOYEE_ACCESS at every branch, containment (no takeover of a more powerful
   * colleague). Refused for INACTIVE accounts and for ENDED employment (no rehire through
   * access management). The account becomes ACTIVE, the credential version increments,
   * open setup/reset/recovery flows end and every session of the employee is revoked.
   */
  async setCredentials(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeCredentialsRequest,
    requestId?: string,
  ): Promise<EmployeeResponse> {
    const reason = normalizeReason(input.reason);
    const passwordHash = await this.preparePassword(sessionToken, input.newPassword, 'newPassword');
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, now, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      this.requireFresh(actor, now);
      this.require(actor, 'MANAGE_EMPLOYEE_ACCESS', branchIds);
      this.expectVersion(target, input.expectedVersion);
      if (target.status === 'INACTIVE') throw new AuthError('CONFLICT', 'status');
      await this.requireNotEnded(tx, target.id, branchIds);
      await this.requireContainment(tx, actor, target.id);
      const credentialVersion = target.credentialVersion + 1;
      const changed = await tx.user.updateMany({
        where: { id: target.id, credentialVersion: target.credentialVersion },
        data: {
          status: 'ACTIVE',
          passwordHash,
          credentialVersion,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new AuthError('CONFLICT');
      await this.retireFlows(tx, target.id, CREDENTIAL_FLOWS, now);
      const revoked = (
        await tx.session.updateMany({
          where: { userId: target.id, revokedAt: null },
          data: { revokedAt: now },
        })
      ).count;
      await this.audit(context, target.id, branchIds, 'ACCESS_PASSWORD_SET', {
        reason,
        before: { status: target.status, credentialVersion: target.credentialVersion },
        after: {
          status: 'ACTIVE',
          credentialVersion,
          method: 'MANAGER_SET',
          replacedExisting: target.passwordHash !== null,
        },
      });
      await this.revokedAudit(context, target.id, branchIds, revoked, 'ACCESS_PASSWORD_SET');
      return this.present(actor, await this.load(tx, target.id));
    });
  }

  /**
   * "Kết thúc làm việc": appends ENDED (Step 1 rules: MANAGE_EMPLOYEE_PAY, later than the
   * latest change, backdating Owner-only) and, when `disableAccess` is set and the end date
   * is today or earlier, makes the account INACTIVE in the same transaction
   * (MANAGE_EMPLOYEE_STATUS; sessions revoked, credential flows retired). A future end date
   * never disables access now and nothing disables it later automatically (no scheduler);
   * the response says so. Nothing is deleted.
   */
  async endEmployment(
    sessionToken: string | undefined,
    targetId: string,
    input: EmploymentEndRequest,
    requestId?: string,
  ): Promise<EmploymentEndResponse> {
    const effectiveDate = parseEmploymentDate(input.effectiveDate, 'effectiveDate');
    const reason = text(input.reason, 'reason', EMPLOYMENT_REASON_MAX_CODE_POINTS);
    if (typeof input.disableAccess !== 'boolean') {
      throw new AuthError('VALIDATION_FAILED', 'disableAccess');
    }
    return this.command(sessionToken, targetId, false, requestId, async (context) => {
      const { tx, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      this.expectVersion(target, input.expectedVersion);
      const today = await businessToday(tx, branchIds);
      const disableNow = input.disableAccess && effectiveDate <= today;
      if (disableNow && target.status !== 'INACTIVE') {
        this.require(actor, 'MANAGE_EMPLOYEE_STATUS', branchIds);
      }
      await this.appendClassification(context, 'ENDED', effectiveDate, reason);
      let access: EmploymentEndAccess = 'UNCHANGED';
      if (input.disableAccess && !disableNow) access = 'UNCHANGED_FUTURE_DATE';
      else if (disableNow && target.status === 'INACTIVE') access = 'ALREADY_INACTIVE';
      else if (disableNow) {
        await this.inactivate(context, target, reason);
        access = 'DISABLED';
      }
      await this.audit(context, target.id, branchIds, 'EMPLOYMENT_ENDED', {
        reason,
        after: {
          effectiveDate: day(effectiveDate),
          disableAccessRequested: input.disableAccess,
          access,
        },
      });
      const employee = await this.load(tx, target.id);
      return {
        employee: this.present(actor, employee),
        employment: await this.presentEmployment(tx, employee, branchIds, null),
        access,
      };
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
      const { tx, actor, target, branchIds } = context;
      this.forbidSelf(actor, target);
      this.require(actor, 'MANAGE_EMPLOYEE_STATUS', branchIds);
      this.expectVersion(target, input.expectedVersion);
      if (input.status === 'INACTIVE') {
        if (target.status === 'INACTIVE') throw new AuthError('CONFLICT');
        await this.inactivate(context, target, reason);
      } else {
        if (target.status !== 'INACTIVE') throw new AuthError('CONFLICT');
        // Reactivation after ENDED employment would be a rehire, which is not supported.
        await this.requireNotEnded(tx, target.id, branchIds);
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
      await this.applyScope(context, next, input.expectedVersion, reason);
      return this.present(context.actor, await this.load(context.tx, context.target.id));
    });
  }

  /**
   * The employee's branch assignments (Phase 2 Step 6): active rows and revoked history.
   * Same visibility as the employee record: VIEW_EMPLOYEES over every branch of the
   * employee, or the employee themself; otherwise 404.
   */
  async branchAssignments(
    sessionToken: string | undefined,
    targetId: string,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    return this.command(
      sessionToken,
      targetId,
      false,
      undefined,
      ({ tx, actor, target, branchIds }) => {
        if (actor.userId !== target.id && !decideAcross(actor.graph, 'VIEW_EMPLOYEES', branchIds)) {
          throw new AuthError('NOT_FOUND');
        }
        return this.presentAssignments(tx, target);
      },
    );
  }

  /**
   * Adds one operational branch (Phase 2 Step 6). It is the same security-graph change as
   * `changeScope`, with the resulting set = current + branch.
   */
  async assignBranch(
    sessionToken: string | undefined,
    targetId: string,
    input: EmployeeBranchAssignRequest,
    requestId?: string,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    const [branchId] = normalizeBranchIds([input.branchId]);
    const reason = normalizeReason(input.reason);
    return this.command(sessionToken, targetId, true, requestId, async (context) => {
      const { actor, target, branchIds: previous } = context;
      if (!branchId) throw new AuthError('VALIDATION_FAILED', 'branchId');
      // Authorize before revealing membership state.
      this.forbidSelf(actor, target);
      this.require(actor, 'MANAGE_EMPLOYEE_SCOPE', [...previous, branchId]);
      if (previous.length === 0) this.require(actor, 'MANAGE_EMPLOYEE_SCOPE', []);
      if (previous.includes(branchId)) throw new AuthError('CONFLICT', 'branchId');
      await this.applyScope(
        context,
        [...previous, branchId].sort(),
        input.expectedVersion,
        reason,
        {
          operation: 'ASSIGN',
          branchId,
        },
      );
      return this.presentAssignments(context.tx, target);
    });
  }

  /**
   * Revokes one active branch and keeps it as history. Removing the final branch is
   * allowed (design section 7: an employee without any active branch requires GLOBAL
   * authority afterwards).
   */
  async revokeBranch(
    sessionToken: string | undefined,
    targetId: string,
    branchId: string,
    input: EmployeeBranchRevokeRequest,
    requestId?: string,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    const branch = branchId.toLowerCase();
    if (!isUuid(branch)) throw new AuthError('NOT_FOUND');
    const reason = normalizeReason(input.reason);
    return this.command(sessionToken, targetId, true, requestId, async (context) => {
      const { actor, target, branchIds: previous } = context;
      // Authorize before revealing membership state.
      this.forbidSelf(actor, target);
      this.require(actor, 'MANAGE_EMPLOYEE_SCOPE', previous);
      if (!previous.includes(branch)) throw new AuthError('NOT_FOUND');
      await this.applyScope(
        context,
        previous.filter((id) => id !== branch),
        input.expectedVersion,
        reason,
        { operation: 'REVOKE', branchId: branch },
      );
      return this.presentAssignments(context.tx, target);
    });
  }

  /**
   * The one branch-scope graph change (Phase 1 Step 10, reused by Phase 2 Step 6).
   * - MANAGE_EMPLOYEE_SCOPE at every old and new branch; non-Owners never change
   *   themselves.
   * - `checkGraphChange` refuses any gained capability the actor lacks, and activating a
   *   dormant branch grant also needs MANAGE_PERMISSIONS.
   * - History-preserving revocation.
   * - authzVersion bump, session revocation, retired setup capabilities and audit.
   * The caller holds the exclusive graph lock and the User locks.
   */
  private async applyScope(
    context: TargetContext,
    next: string[],
    expectedVersion: number,
    reason: string,
    change?: { operation: 'ASSIGN' | 'REVOKE'; branchId: string },
  ): Promise<void> {
    const { tx, now, actor, target, branchIds: previous } = context;
    this.forbidSelf(actor, target);
    const added = next.filter((id) => !previous.includes(id));
    const removed = previous.filter((id) => !next.includes(id));
    this.require(actor, 'MANAGE_EMPLOYEE_SCOPE', [...previous, ...next]);
    // Design section 7: an employee without any active branch requires GLOBAL authority,
    // so a branch-scoped actor can never claim a branchless employee into their branch.
    if (previous.length === 0) this.require(actor, 'MANAGE_EMPLOYEE_SCOPE', []);
    this.expectVersion(target, expectedVersion);
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
      after: {
        branchIds: next,
        ...(change ? { operation: change.operation, branchId: change.branchId } : {}),
      },
    });
    await this.revokedAudit(context, target.id, [], revoked, 'BRANCH_SCOPE_CHANGED');
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
      // Base salary is for official employment only (Owner decision Q16). The latest
      // recorded classification decides, so a scheduled promotion can be prepared; clearing
      // a salary is always allowed.
      if (salary !== null) {
        const latest = await tx.employmentClassificationChange.findFirst({
          where: { employeeUserId: target.id },
          orderBy: { effectiveDate: 'desc' },
          select: { classification: true },
        });
        if (latest?.classification !== 'OFFICIAL_EMPLOYEE') {
          throw new AuthError('CONFLICT', 'classification');
        }
      }
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
      this.requireFresh(actor, now);
      this.require(actor, 'MANAGE_EMPLOYEE_ACCESS', branchIds);
      this.expectVersion(target, input.expectedVersion);
      if (target.status === 'INACTIVE') throw new AuthError('CONFLICT');
      await this.requireNotEnded(tx, target.id, branchIds);
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
    const target = targetId?.toLowerCase() ?? null;
    if (target !== null && !isUuid(target)) throw new AuthError('NOT_FOUND');
    return runAdminCommand(
      { sessions: this.sessions, throttle: this.throttle },
      sessionToken,
      { exclusive, requestId, lockUsers: () => Promise.resolve(target ? [target] : []) },
      async (base) => {
        if (target === null) return work(base as TargetContext);
        const record = await base.tx.user.findUnique({
          where: { id: target },
          select: employeeSelect,
        });
        // Owner and customers are never employee-administration targets.
        if (!record || record.kind !== 'EMPLOYEE' || !record.employeeProfile) {
          throw new AuthError('NOT_FOUND');
        }
        const employee = record as EmployeeRecord;
        return work({ ...base, target: employee, branchIds: branchesOf(employee) });
      },
    );
  }

  /** Every affected branch must pass; no branch requires GLOBAL authority. */
  private require(actor: Actor, permission: string, branchIds: readonly string[]): void {
    requireAcross(actor, permission, branchIds);
  }

  /**
   * Appends one classification change under the Step 1 rules (see `changeClassification`).
   * The caller has already checked self-targeting and the expected version.
   */
  private async appendClassification(
    context: TargetContext,
    classification: 'COLLABORATOR' | 'OFFICIAL_EMPLOYEE' | 'ENDED',
    effectiveDate: Date,
    reason: string,
  ): Promise<void> {
    const { tx, actor, target, branchIds, now } = context;
    this.require(actor, 'MANAGE_EMPLOYEE_PAY', branchIds);
    const latest = await tx.employmentClassificationChange.findFirst({
      where: { employeeUserId: target.id },
      orderBy: { effectiveDate: 'desc' },
      select: classificationSelect,
    });
    if (!latest || !transitionAllowed(latest.classification, classification)) {
      throw new AuthError('CONFLICT', 'classification');
    }
    if (effectiveDate <= latest.effectiveDate) {
      throw new AuthError('VALIDATION_FAILED', 'effectiveDate');
    }
    // Manager invariant (Owner decision Q3): an official employee holding an active
    // manager-group role never leaves official employment while holding it. The role must
    // be removed first; it is never removed silently.
    if (latest.classification === 'OFFICIAL_EMPLOYEE' && (await holdsManagerRole(tx, target.id))) {
      throw new AuthError('CONFLICT', 'managerRole');
    }
    const today = await businessToday(tx, branchIds);
    const backdated = effectiveDate < today;
    if (backdated && !actor.owner) throw new AuthError('FORBIDDEN');
    await tx.employmentClassificationChange.create({
      data: {
        employeeUserId: target.id,
        classification,
        effectiveDate,
        reason,
        recordedByUserId: actor.userId,
        recordedAt: now,
      },
      select: { id: true },
    });
    await tx.user.update({
      where: { id: target.id },
      data: { rowVersion: { increment: 1 } },
      select: { id: true },
    });
    await this.audit(context, target.id, branchIds, 'EMPLOYMENT_CLASSIFICATION_CHANGED', {
      reason,
      before: { classification: latest.classification, effectiveDate: day(latest.effectiveDate) },
      after: { classification, effectiveDate: day(effectiveDate), backdated },
    });
  }

  /** ACTIVE/PENDING_SETUP to INACTIVE: flows retired, authorization invalidated, audited. */
  private async inactivate(
    context: TargetContext,
    target: EmployeeRecord,
    reason: string,
  ): Promise<void> {
    const { tx, now, branchIds } = context;
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
  }

  /**
   * Ended employment is final (no rehire): access cannot be re-enabled or re-provisioned
   * once ENDED is in effect on today's business date. History is never rewritten.
   */
  private async requireNotEnded(
    tx: Prisma.TransactionClient,
    employeeUserId: string,
    branchIds: readonly string[],
  ): Promise<void> {
    const today = await businessToday(tx, branchIds);
    const current = await classificationOn(tx, employeeUserId, today);
    if (current?.classification === 'ENDED') throw new AuthError('CONFLICT', 'employment');
  }

  private requireFresh(actor: Actor, now: Date): void {
    if (!hasFreshReauthentication(actor.principal, now, this.environment.auth.freshAuthSeconds)) {
      throw new AuthError('REAUTHENTICATION_REQUIRED');
    }
  }

  /**
   * Existing workforce password policy and Argon2id hashing, before any transaction (the
   * expensive work never holds locks). Only callers with a session reach the hashing work.
   */
  private async preparePassword(
    sessionToken: string | undefined,
    value: string,
    field: 'initialPassword' | 'newPassword',
  ): Promise<string> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    try {
      validatePasswordForSetting(value);
    } catch (error) {
      if (error instanceof PasswordPolicyError) throw new AuthError('VALIDATION_FAILED', field);
      throw error;
    }
    try {
      return await this.passwords.hashForSetting(value);
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
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

  private async presentAssignments(
    tx: Prisma.TransactionClient,
    target: EmployeeRecord,
  ): Promise<EmployeeBranchAssignmentsResponse> {
    const rows = await tx.employeeBranchAssignment.findMany({
      where: { employeeUserId: target.id },
      select: { id: true, branchId: true, grantedAt: true, grantedByUserId: true, revokedAt: true },
      orderBy: [{ grantedAt: 'asc' }, { id: 'asc' }],
    });
    const { rowVersion } = await tx.user.findUniqueOrThrow({
      where: { id: target.id },
      select: { rowVersion: true },
    });
    const entries = rows.map((row) => ({
      id: row.id,
      branchId: row.branchId,
      grantedAt: row.grantedAt.toISOString(),
      grantedByUserId: row.grantedByUserId,
      revokedAt: row.revokedAt?.toISOString() ?? null,
    }));
    return {
      employeeId: target.id,
      version: rowVersion,
      active: entries.filter((entry) => entry.revokedAt === null),
      history: entries.filter((entry) => entry.revokedAt !== null),
    };
  }

  /** Pay appears only when VIEW_EMPLOYEE_PAY passes for the full target. */
  private async presentEmployment(
    tx: Prisma.TransactionClient,
    target: EmployeeRecord,
    branchIds: readonly string[],
    date: Date | null,
  ): Promise<EmploymentResponse> {
    const today = await businessToday(tx, branchIds);
    const history = await classificationHistory(tx, target.id);
    const current = await classificationOn(tx, target.id, today);
    const onDate = date === null ? null : await classificationOn(tx, target.id, date);
    const currentClassification = current?.classification ?? null;
    const manager =
      currentClassification === 'OFFICIAL_EMPLOYEE' && (await holdsManagerRole(tx, target.id));
    return {
      employeeId: target.id,
      version: target.rowVersion,
      today: day(today),
      current: current ? presentClassification(current) : null,
      onDate:
        date === null
          ? null
          : { date: day(date), entry: onDate ? presentClassification(onDate) : null },
      payrollEligibleToday: payrollEligible(currentClassification),
      title: workforceTitle({ owner: false, current: currentClassification, manager }),
      history: history.map(presentClassification),
    };
  }

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

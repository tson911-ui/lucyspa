import type { CurrentAccountResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { authorizationSummary } from '../authorization/authorization.js';
import { loadAuthorityGraph } from '../authorization/authorization.store.js';
import { PrismaService } from '../platform/prisma.service.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { generateCapability } from './crypto.js';
import { normalizeEmail, normalizeEmployeeCode } from './identity.js';
import { titleOfEmployee } from '../employees/workforce-title.js';
import { invalidateChallenges } from './otp-flow.js';
import {
  normalizePassword,
  PasswordPolicyError,
  PasswordService,
  validatePasswordForSetting,
} from './password.service.js';
import { RateLimitedError } from './registration.service.js';
import { SessionService, type CredentialEvidence } from './session.service.js';

/** Design section 6 login failure budgets (fixed 15-minute UTC windows). */
export const LOGIN_POLICY = Object.freeze({
  identifierFailureLimit: 10,
  ipFailureLimit: 100,
  windowSeconds: 900,
} as const);

export type LoginRealm = 'CUSTOMER' | 'WORKFORCE';
export type LoginIdentifierType = 'EMAIL' | 'EMPLOYEE_ID';

export interface LoginPrincipal {
  readonly realm: LoginRealm;
  readonly identifierType: LoginIdentifierType;
}

const CUSTOMER_EMAIL: LoginPrincipal = { realm: 'CUSTOMER', identifierType: 'EMAIL' };

/** Failure budgets are per realm/identifier type, so realms never share or leak budgets. */
const IDENTIFIER_FAILURE_OPS: Readonly<Record<string, string | undefined>> = {
  CUSTOMER_EMAIL: 'LOGIN_FAILURE_CUSTOMER_EMAIL',
  WORKFORCE_EMAIL: 'LOGIN_FAILURE_WORKFORCE_EMAIL',
  WORKFORCE_EMPLOYEE_ID: 'LOGIN_FAILURE_WORKFORCE_EMPLOYEE_ID',
};
const IP_FAILURE_OP = 'LOGIN_FAILURE_IP';
// Reauthentication is keyed by the authenticated User rather than a typed identifier.
const REAUTH_FAILURE_OP = 'REAUTH_FAILURE_USER';

export interface LoginResult {
  readonly token: string;
  readonly account: CurrentAccountResponse;
}

const userSelect = {
  id: true,
  kind: true,
  status: true,
  fullName: true,
  preferredLocale: true,
  emailVerifiedAt: true,
  passwordHash: true,
  credentialVersion: true,
  authzVersion: true,
} as const satisfies Prisma.UserSelect;

export type LoginUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/**
 * Realm separation: a credential match in one realm grants no access in the other.
 * CUSTOMER: active, email-verified customers. WORKFORCE by email: the Owner, or an active
 * employee whose email is verified. WORKFORCE by employee ID: active employees.
 */
function eligible(user: LoginUser | null, principal: LoginPrincipal): user is LoginUser {
  if (user === null || user.status !== 'ACTIVE' || user.passwordHash === null) return false;
  if (principal.realm === 'CUSTOMER') {
    return user.kind === 'CUSTOMER' && user.emailVerifiedAt !== null;
  }
  if (principal.identifierType === 'EMPLOYEE_ID') return user.kind === 'EMPLOYEE';
  return user.kind === 'OWNER' || (user.kind === 'EMPLOYEE' && user.emailVerifiedAt !== null);
}

@Injectable()
export class LoginService implements OnModuleInit {
  private dummyHash: Promise<string> | undefined;

  constructor(
    @Inject(PrismaService) private readonly prisma: Pick<PrismaService, 'client'>,
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      | 'withTransaction'
      | 'rotateAuthenticated'
      | 'resolve'
      | 'resolveForMutation'
      | 'continueAfterCredentialChange'
    >,
    @Inject(PasswordService)
    private readonly passwords: Pick<
      PasswordService,
      'hashForSetting' | 'verify' | 'verifyAndRehash'
    >,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
  ) {}

  /** Prepare the dummy verifier at startup so the first unknown-account login does no extra work. */
  async onModuleInit(): Promise<void> {
    await this.dummy();
  }

  /**
   * Exactly one real or dummy Argon2 verification. Unknown, malformed, wrong-password,
   * wrong-realm and ineligible accounts share one 401.
   */
  async login(
    identifier: string,
    password: string,
    sessionToken: string,
    peer: string,
    requestId?: string,
    principal: LoginPrincipal = CUSTOMER_EMAIL,
  ): Promise<LoginResult> {
    const key = this.identifierKey(identifier, principal);
    // CUSTOMER accounts sign in only by email; EMPLOYEE_ID exists only in WORKFORCE.
    const operation = IDENTIFIER_FAILURE_OPS[`${principal.realm}_${principal.identifierType}`];
    if (operation === undefined) throw new AuthError('VALIDATION_FAILED', 'identifierType');
    const user = await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        // Applies equally to known and unknown identifiers; no password work when limited.
        if (
          (await this.throttle.windowCount(
            tx,
            IP_FAILURE_OP,
            peer,
            LOGIN_POLICY.windowSeconds,
            now,
          )) >= LOGIN_POLICY.ipFailureLimit ||
          (key !== null &&
            (await this.throttle.windowCount(
              tx,
              operation,
              key,
              LOGIN_POLICY.windowSeconds,
              now,
            )) >= LOGIN_POLICY.identifierFailureLimit)
        ) {
          throw new RateLimitedError(LOGIN_POLICY.windowSeconds);
        }
        if (key === null) return null;
        if (principal.identifierType === 'EMPLOYEE_ID') {
          const profile = await tx.employeeProfile.findUnique({
            where: { employeeCodeCanonical: key },
            select: { user: { select: userSelect } },
          });
          return profile?.user ?? null;
        }
        return tx.user.findUnique({ where: { emailCanonical: key }, select: userSelect });
      }),
    );

    const evidenceHash = await this.verifyPassword(user, password);
    // Eligibility is evaluated only after the verification work, never as an early shortcut.
    if (evidenceHash === null || !eligible(user, principal)) {
      await this.recordFailure([
        [IP_FAILURE_OP, peer, LOGIN_POLICY.ipFailureLimit],
        ...(key === null ? [] : [[operation, key, LOGIN_POLICY.identifierFailureLimit] as const]),
      ]);
      throw new AuthError('AUTHENTICATION_FAILED');
    }
    const token = await this.rotate(sessionToken, user, evidenceHash, false, requestId);
    return { token, account: await this.account(user.id) };
  }

  /** GET /auth/me: the authenticated caller's own account; 401 otherwise. */
  async currentAccount(sessionToken: string | undefined): Promise<CurrentAccountResponse> {
    const principal = await this.guard(() => this.sessions.resolve(sessionToken));
    if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    return this.account(principal.userId);
  }

  /**
   * Fresh password proof for sensitive actions. Success rotates the session (new token,
   * previous revoked, no overlap) and never extends its absolute lifetime.
   */
  async reauthenticate(
    sessionToken: string | undefined,
    password: string,
    peer: string,
    requestId?: string,
  ): Promise<string> {
    const principal = await this.guard(() => this.sessions.resolve(sessionToken));
    if (
      sessionToken === undefined ||
      principal?.kind !== 'AUTHENTICATED' ||
      principal.userId === null
    ) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    const userId = principal.userId;
    const user = await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (
          (await this.throttle.windowCount(
            tx,
            IP_FAILURE_OP,
            peer,
            LOGIN_POLICY.windowSeconds,
            now,
          )) >= LOGIN_POLICY.ipFailureLimit ||
          (await this.throttle.windowCount(
            tx,
            REAUTH_FAILURE_OP,
            userId,
            LOGIN_POLICY.windowSeconds,
            now,
          )) >= LOGIN_POLICY.identifierFailureLimit
        ) {
          throw new RateLimitedError(LOGIN_POLICY.windowSeconds);
        }
        return tx.user.findUnique({ where: { id: userId }, select: userSelect });
      }),
    );
    const evidenceHash = await this.verifyPassword(user, password);
    if (evidenceHash === null || user === null) {
      await this.recordFailure([
        [IP_FAILURE_OP, peer, LOGIN_POLICY.ipFailureLimit],
        [REAUTH_FAILURE_OP, userId, LOGIN_POLICY.identifierFailureLimit],
      ]);
      throw new AuthError('AUTHENTICATION_FAILED');
    }
    try {
      return await this.rotate(sessionToken, user, evidenceHash, true, requestId);
    } catch (error) {
      if (error instanceof AuthError && error.code === 'AUTHENTICATION_FAILED') {
        // The session itself became invalid; the caller must sign in again.
        throw new AuthError('AUTHENTICATION_REQUIRED');
      }
      throw error;
    }
  }

  /**
   * "Prove your current password while signed in", shared by self-service password change
   * (Step 4) and verified email change (Step 5). The session must be an authenticated Owner
   * or employee (customers: FORBIDDEN). The reauthentication failure budgets apply (per IP
   * and per User); a wrong password debits them and is one generic AUTHENTICATION_FAILED.
   * Returns the verified credential evidence; callers re-check it under their own locks.
   */
  async proveCurrentPassword(
    sessionToken: string | undefined,
    currentPassword: string,
    peer: string,
  ): Promise<{ userId: string; user: LoginUser; evidenceHash: string }> {
    const principal = await this.guard(() => this.sessions.resolve(sessionToken));
    if (
      sessionToken === undefined ||
      principal?.kind !== 'AUTHENTICATED' ||
      principal.userId === null
    ) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    if (principal.userKind !== 'OWNER' && principal.userKind !== 'EMPLOYEE') {
      throw new AuthError('FORBIDDEN');
    }
    const userId = principal.userId;
    const user = await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (
          (await this.throttle.windowCount(
            tx,
            IP_FAILURE_OP,
            peer,
            LOGIN_POLICY.windowSeconds,
            now,
          )) >= LOGIN_POLICY.ipFailureLimit ||
          (await this.throttle.windowCount(
            tx,
            REAUTH_FAILURE_OP,
            userId,
            LOGIN_POLICY.windowSeconds,
            now,
          )) >= LOGIN_POLICY.identifierFailureLimit
        ) {
          throw new RateLimitedError(LOGIN_POLICY.windowSeconds);
        }
        return tx.user.findUnique({ where: { id: userId }, select: userSelect });
      }),
    );
    const evidenceHash = await this.verifyPassword(user, currentPassword);
    if (evidenceHash === null || user === null) {
      await this.recordFailure([
        [IP_FAILURE_OP, peer, LOGIN_POLICY.ipFailureLimit],
        [REAUTH_FAILURE_OP, userId, LOGIN_POLICY.identifierFailureLimit],
      ]);
      throw new AuthError('AUTHENTICATION_FAILED');
    }
    return { userId, user, evidenceHash };
  }

  /**
   * Self-service password change for the signed-in Owner or employee (follow-up Step 4).
   *
   * - Identity: the session only; customers are refused.
   * - Abuse: the same failure budgets as reauthentication (per IP and per User); a wrong
   *   current password debits them and returns one generic 401 AUTHENTICATION_FAILED.
   * - Proof: the current password is verified with the existing verifier (never the session
   *   alone). The new one passes the existing setting policy (length, blocklist) and must
   *   differ from the current one; that check runs only after the proof, so it is no oracle.
   * - Effect (one transaction): Argon2id hash replaced and credentialVersion bumped (as a
   *   reset does), outstanding reset/setup/recovery-email flows retired, EVERY session of the
   *   user revoked, then one replacement session issued for this device. Returns its token.
   * - Audit: PASSWORD_CHANGED (method SELF_SERVICE) and SESSIONS_REVOKED; never a password
   *   or hash.
   */
  async changePassword(
    sessionToken: string | undefined,
    currentPassword: string,
    newPassword: string,
    peer: string,
    requestId?: string,
  ): Promise<string> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    const { userId, user, evidenceHash } = await this.proveCurrentPassword(
      sessionToken,
      currentPassword,
      peer,
    );
    let replacement: string;
    try {
      replacement = validatePasswordForSetting(newPassword);
    } catch (error) {
      if (error instanceof PasswordPolicyError)
        throw new AuthError('VALIDATION_FAILED', 'newPassword');
      throw error;
    }
    // The verified current password normalizes exactly as the replacement does.
    if (normalizePassword(currentPassword) === replacement) {
      throw new AuthError('VALIDATION_FAILED', 'newPasswordUnchanged');
    }
    let passwordHash: string;
    try {
      passwordHash = await this.passwords.hashForSetting(replacement);
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    return this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        // Locks the User, then the current session (documented lock order).
        const current = await this.sessions.resolveForMutation(sessionToken, tx);
        if (current?.kind !== 'AUTHENTICATED' || current.userId !== userId) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        const now = await this.throttle.now(tx);
        const credentialVersion = user.credentialVersion + 1;
        // Guarded on the verified credential: a concurrent reset or change fails closed.
        const changed = await tx.user.updateMany({
          where: {
            id: userId,
            status: 'ACTIVE',
            passwordHash: evidenceHash,
            credentialVersion: user.credentialVersion,
          },
          data: { passwordHash, credentialVersion },
        });
        if (changed.count !== 1) throw new AuthError('AUTHENTICATION_REQUIRED');
        const outstanding = await tx.authChallenge.findMany({
          where: {
            userId,
            purpose: { in: ['RESET_PASSWORD', 'EMPLOYEE_SETUP', 'VERIFY_RECOVERY_EMAIL'] },
            consumedAt: null,
            invalidatedAt: null,
          },
          select: { id: true },
        });
        await invalidateChallenges(
          tx,
          outstanding.map((row) => row.id),
          now,
        );
        // Every session, this one included; this device continues on a new one below.
        const revoked = await tx.session.updateMany({
          where: { userId, revokedAt: null },
          data: { revokedAt: now },
        });
        const issued = await this.sessions.continueAfterCredentialChange(
          tx,
          current,
          requestId,
          'PASSWORD_CHANGED',
        );
        const others = Math.max(revoked.count - 1, 0);
        const audit = {
          actorKind: 'USER',
          actorUserId: userId,
          subjectUserId: userId,
          entityType: 'User',
          entityId: userId,
          requestId: requestId ?? null,
          occurredAt: now,
          dataClassification: 'STANDARD',
        } as const;
        await tx.auditEvent.createMany({
          data: [
            {
              ...audit,
              action: 'PASSWORD_CHANGED',
              before: { credentialVersion: user.credentialVersion },
              after: { credentialVersion, method: 'SELF_SERVICE' },
            },
            ...(others > 0
              ? [
                  {
                    ...audit,
                    action: 'SESSIONS_REVOKED',
                    after: { reason: 'PASSWORD_CHANGED', revokedSessions: others },
                  },
                ]
              : []),
          ],
        });
        return issued.token;
      }),
    );
  }

  /** Revokes every session of the authenticated User, including the current one. */
  async logoutAll(sessionToken: string | undefined, requestId?: string): Promise<void> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        // Locks the User, then the current session (documented lock order).
        const principal = await this.sessions.resolveForMutation(sessionToken, tx);
        if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        const now = await this.throttle.now(tx);
        const revoked = await tx.session.updateMany({
          where: { userId: principal.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.auditEvent.create({
          data: {
            action: 'SESSIONS_REVOKED',
            actorKind: 'USER',
            actorUserId: principal.userId,
            subjectUserId: principal.userId,
            entityType: 'User',
            entityId: principal.userId,
            requestId: requestId ?? null,
            occurredAt: now,
            dataClassification: 'STANDARD',
            after: { reason: 'LOGOUT_ALL', revokedSessions: revoked.count },
          },
          select: { id: true },
        });
      }),
    );
  }

  private identifierKey(identifier: string, principal: LoginPrincipal): string | null {
    try {
      return principal.identifierType === 'EMPLOYEE_ID'
        ? normalizeEmployeeCode(identifier).employeeCodeCanonical
        : normalizeEmail(identifier).emailCanonical;
    } catch {
      // Malformed identifiers fail like unknown accounts, after the same dummy work.
      return null;
    }
  }

  /**
   * One real or dummy verification. Returns the credential evidence hash, which after a
   * guarded rehash is the new stored hash (never the pre-rehash hash), or null.
   */
  private async verifyPassword(user: LoginUser | null, password: string): Promise<string | null> {
    try {
      if (user?.passwordHash == null) {
        await this.passwords.verify(password, await this.dummy());
        return null;
      }
      const snapshot = {
        userId: user.id,
        passwordHash: user.passwordHash,
        credentialVersion: user.credentialVersion,
      };
      const result = await this.passwords.verifyAndRehash(password, snapshot, this.prisma.client);
      if (!result.verified) return null;
      if (result.rehash !== 'updated') return snapshot.passwordHash;
      const current = await this.prisma.client.user.findUnique({
        where: { id: snapshot.userId },
        select: { passwordHash: true, credentialVersion: true },
      });
      return current?.credentialVersion === snapshot.credentialVersion
        ? current.passwordHash
        : null;
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }

  private async rotate(
    sessionToken: string,
    user: LoginUser,
    passwordHash: string,
    reauthenticated: boolean,
    requestId?: string,
  ): Promise<string> {
    const evidence: CredentialEvidence = {
      userId: user.id,
      passwordHash,
      credentialVersion: user.credentialVersion,
      authzVersion: user.authzVersion,
    };
    try {
      const { token } = await this.sessions.rotateAuthenticated(sessionToken, evidence, {
        reauthenticated,
        ...(requestId ? { requestId } : {}),
      });
      return token;
    } catch (error) {
      // A concurrent reset, version change or revoked session fails closed.
      if (error instanceof AuthError) throw new AuthError('AUTHENTICATION_FAILED');
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }

  /** CurrentAccount from authoritative data; authorization comes from the Step 7 engine. */
  private account(userId: string): Promise<CurrentAccountResponse> {
    return this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const user = await tx.user.findUnique({
          where: { id: userId },
          select: {
            id: true,
            kind: true,
            fullName: true,
            preferredLocale: true,
            emailDelivery: true,
            emailVerifiedAt: true,
            employeeProfile: {
              select: {
                branchAssignments: { where: { revokedAt: null }, select: { branchId: true } },
              },
            },
          },
        });
        const graph = await loadAuthorityGraph(tx, userId);
        if (!user || !graph) throw new AuthError('AUTHENTICATION_REQUIRED');
        // Workforce only: the authoritative display title (Owner, or derived for employees).
        const title =
          user.kind === 'OWNER'
            ? ('OWNER' as const)
            : user.kind === 'EMPLOYEE'
              ? await titleOfEmployee(
                  tx,
                  user.id,
                  user.employeeProfile?.branchAssignments.map((row) => row.branchId) ?? [],
                )
              : null;
        return {
          id: user.id,
          kind: user.kind,
          displayName: user.fullName,
          locale: user.preferredLocale,
          authorization: authorizationSummary(graph),
          // Workforce only: the recovery email status shown to the account itself.
          ...(user.kind === 'CUSTOMER'
            ? {}
            : {
                recoveryEmail: user.emailDelivery
                  ? { address: user.emailDelivery, verified: user.emailVerifiedAt !== null }
                  : null,
                ...(title ? { workforceTitle: title } : {}),
              }),
        };
      }),
    );
  }

  /** Failure debits commit in their own transaction; the 401 never rolls them back. */
  private async recordFailure(
    debits: ReadonlyArray<readonly [operation: string, identifier: string, limit: number]>,
  ): Promise<void> {
    await this.guard(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        for (const [operation, identifier, limit] of debits) {
          await this.throttle.debitWindow(
            tx,
            operation,
            identifier,
            limit,
            LOGIN_POLICY.windowSeconds,
            now,
          );
        }
      }),
    );
  }

  private dummy(): Promise<string> {
    // A random, never-stored password hashed with the current parameters.
    this.dummyHash ??= this.passwords.hashForSetting(generateCapability());
    return this.dummyHash;
  }

  private async guard<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof AuthError) throw error;
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
  }
}

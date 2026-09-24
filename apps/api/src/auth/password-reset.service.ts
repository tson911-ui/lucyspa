import type { AcceptedFlowResponse, PasswordResetRealm } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { invalidatePendingDeliveries } from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, generateCapability, verifyOtpDigest } from './crypto.js';
import { IdentityValidationError, normalizeEmail } from './identity.js';
import {
  accepted,
  debitIpIssue,
  debitIpVerify,
  emailIssuanceAllowed,
  guardAuth,
  identityFailuresExhausted,
  invalidateChallenges,
  issueUserChallenge,
  lockIdentity,
  OTP_POLICY,
  RateLimitedError,
  recordIdentityFailure,
  requireDeliveryKey,
  requireOtpKey,
  rotateUserChallenge,
  supersedeActionable,
  userOtpBinding,
} from './otp-flow.js';
import {
  PasswordPolicyError,
  PasswordService,
  validatePasswordForSetting,
} from './password.service.js';
import { SessionService } from './session.service.js';

/** Design section 6: reset flows live 15 minutes; codes 5 minutes within that. */
export const RESET_POLICY = Object.freeze({ flowLifetimeSeconds: 900 } as const);

const PURPOSE = 'RESET_PASSWORD';

const challengeSelect = {
  id: true,
  purpose: true,
  userId: true,
  generation: true,
  verifierDigest: true,
  keyVersion: true,
  credentialVersion: true,
  deliveryEmailSnapshot: true,
  failedAttempts: true,
  maxAttempts: true,
  flowExpiresAt: true,
  codeExpiresAt: true,
  consumedAt: true,
  invalidatedAt: true,
} satisfies Prisma.AuthChallengeSelect;

const userSelect = {
  id: true,
  kind: true,
  status: true,
  emailCanonical: true,
  emailDelivery: true,
  emailVerifiedAt: true,
  passwordHash: true,
  credentialVersion: true,
  authzVersion: true,
  preferredLocale: true,
} satisfies Prisma.UserSelect;

type LockedChallenge = Prisma.AuthChallengeGetPayload<{ select: typeof challengeSelect }>;
type LockedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
type CompleteOutcome = 'RESET' | 'FAILED' | 'RATE_LIMITED';

type RecoverableUser = LockedUser & { emailCanonical: string; emailDelivery: string };

/**
 * An ACTIVE User with a password and a verified email. Pending-setup and inactive
 * employees are never activated or reactivated through reset.
 */
function eligible(user: LockedUser | null): user is RecoverableUser {
  return (
    user !== null &&
    user.status === 'ACTIVE' &&
    user.emailVerifiedAt !== null &&
    user.passwordHash !== null &&
    user.emailCanonical !== null &&
    user.emailDelivery !== null
  );
}

/** A credential in one realm grants nothing in the other; principal kind is immutable. */
function inRealm(user: LockedUser, realm: PasswordResetRealm): boolean {
  return realm === 'CUSTOMER'
    ? user.kind === 'CUSTOMER'
    : user.kind === 'OWNER' || user.kind === 'EMPLOYEE';
}

@Injectable()
export class PasswordResetService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService) private readonly sessions: Pick<SessionService, 'withTransaction'>,
    @Inject(PasswordService) private readonly passwords: Pick<PasswordService, 'hashForSetting'>,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
  ) {}

  /**
   * Always the same accepted shape. Unknown, ineligible and suppressed identities get an
   * unstored random flow token and no email; eligible ones get a code at the stored
   * verified delivery address, never the submitted spelling. The Owner and employees
   * recover in the WORKFORCE realm once their recovery email is verified.
   */
  async request(
    email: string,
    locale: 'vi' | 'en',
    peer: string,
    realm: PasswordResetRealm = 'CUSTOMER',
  ): Promise<AcceptedFlowResponse> {
    const otp = requireOtpKey(this.environment.auth);
    requireDeliveryKey(this.environment.auth);
    let emailCanonical: string;
    try {
      emailCanonical = normalizeEmail(email).emailCanonical;
    } catch (error) {
      if (error instanceof IdentityValidationError)
        throw new AuthError('VALIDATION_FAILED', 'email');
      throw error;
    }
    const flowToken = generateCapability();
    await guardAuth(async () => {
      const limited = await this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpIssue(tx, this.throttle, this.environment.auth, peer, now))) return true;
        const identities = await lockIdentity(tx, this.environment.auth, PURPOSE, emailCanonical);
        // Budgets apply equally to known and unknown identities.
        if (!(await emailIssuanceAllowed(tx, this.throttle, emailCanonical, now))) return false;
        const user = await tx.user.findUnique({ where: { emailCanonical }, select: userSelect });
        if (!eligible(user) || !inRealm(user, realm)) return false;
        await supersedeActionable(tx, PURPOSE, identities.all, now);
        await issueUserChallenge(tx, this.environment.auth, otp, {
          purpose: PURPOSE,
          flowToken,
          identity: identities.active,
          user,
          now,
          flowLifetimeSeconds: RESET_POLICY.flowLifetimeSeconds,
          locale,
        });
        return false;
      });
      if (limited) throw new RateLimitedError(OTP_POLICY.ipIssueWindowSeconds);
    });
    return accepted(flowToken);
  }

  /**
   * One operation: flow capability, OTP and new password. On success the password and
   * credential version change, every session and other reset/setup flow is revoked and
   * the audit is appended atomically. No session is created; normal login is required.
   */
  async complete(
    flowToken: string,
    otp: string,
    newPassword: string,
    peer: string,
    requestId?: string,
  ): Promise<void> {
    try {
      validatePasswordForSetting(newPassword);
    } catch (error) {
      if (error instanceof PasswordPolicyError) {
        throw new AuthError('VALIDATION_FAILED', 'newPassword');
      }
      throw error;
    }
    // Hash before any lookup so real and unknown flows perform the same work.
    let passwordHash: string;
    try {
      passwordHash = await this.passwords.hashForSetting(newPassword);
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    const digest = capabilityDigest(flowToken);
    const outcome = await guardAuth(() =>
      this.sessions.withTransaction(async (tx): Promise<CompleteOutcome> => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpVerify(tx, this.throttle, peer, now))) return 'RATE_LIMITED';
        const locked = await this.lock(tx, digest);
        if (!locked) return 'FAILED';
        const { challenge, user } = locked;
        if (challenge.consumedAt || challenge.invalidatedAt) return 'FAILED';
        if (!this.live(challenge, user, now)) {
          await this.invalidate(tx, challenge.id, now);
          return 'FAILED';
        }
        if (await identityFailuresExhausted(tx, this.throttle, user.emailCanonical, now)) {
          return 'FAILED';
        }
        const key =
          challenge.keyVersion === null
            ? undefined
            : this.environment.auth.otpKeys?.get(challenge.keyVersion);
        if (!key || !challenge.verifierDigest || challenge.credentialVersion === null) {
          // A missing retained key invalidates the flow; verification is never bypassed.
          await this.invalidate(tx, challenge.id, now);
          return 'FAILED';
        }
        const verified =
          challenge.codeExpiresAt !== null &&
          now < challenge.codeExpiresAt &&
          verifyOtpDigest(
            challenge.verifierDigest,
            userOtpBinding(
              PURPOSE,
              challenge.id,
              challenge.generation,
              user,
              challenge.credentialVersion,
            ),
            otp,
            key,
          );
        if (!verified) {
          // Committed with the error response: a thrown exception must not roll back debits.
          const failedAttempts = challenge.failedAttempts + 1;
          const exhausted = failedAttempts >= challenge.maxAttempts;
          await tx.authChallenge.update({
            where: { id: challenge.id },
            data: { failedAttempts, ...(exhausted ? { invalidatedAt: now } : {}) },
            select: { id: true },
          });
          if (exhausted) await invalidatePendingDeliveries(tx, [challenge.id]);
          await recordIdentityFailure(tx, this.throttle, user.emailCanonical, now);
          return 'FAILED';
        }

        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: now },
          select: { id: true },
        });
        const credentialVersion = user.credentialVersion + 1;
        const changed = await tx.user.updateMany({
          where: { id: user.id, credentialVersion: user.credentialVersion },
          data: { passwordHash, credentialVersion },
        });
        if (changed.count !== 1) throw new Error('Credential changed concurrently.');
        const revoked = await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        const others = await tx.authChallenge.findMany({
          where: {
            userId: user.id,
            // A pending recovery-email proof is bound to the replaced credential too.
            purpose: { in: ['RESET_PASSWORD', 'EMPLOYEE_SETUP', 'VERIFY_RECOVERY_EMAIL'] },
            consumedAt: null,
            invalidatedAt: null,
          },
          select: { id: true },
        });
        if (others.length > 0) {
          await tx.authChallenge.updateMany({
            where: { id: { in: others.map((row) => row.id) } },
            data: { invalidatedAt: now },
          });
        }
        await invalidatePendingDeliveries(tx, [challenge.id, ...others.map((row) => row.id)]);
        const audit = {
          actorKind: 'SYSTEM',
          subjectUserId: user.id,
          entityType: 'User',
          entityId: user.id,
          requestId: requestId ?? null,
          occurredAt: now,
          dataClassification: 'STANDARD',
        } as const;
        await tx.auditEvent.createMany({
          data: [
            {
              ...audit,
              action: 'PASSWORD_RESET_COMPLETED',
              before: { credentialVersion: user.credentialVersion },
              after: { credentialVersion, method: 'EMAIL_OTP', challengeId: challenge.id },
            },
            ...(revoked.count > 0
              ? [
                  {
                    ...audit,
                    action: 'SESSIONS_REVOKED',
                    after: { reason: 'PASSWORD_RESET', revokedSessions: revoked.count },
                  },
                ]
              : []),
          ],
        });
        return 'RESET';
      }),
    );
    if (outcome === 'RATE_LIMITED') throw new RateLimitedError(OTP_POLICY.verifyWindowSeconds);
    if (outcome === 'FAILED') throw new AuthError('VERIFICATION_FAILED');
  }

  /**
   * Resend for a reset flow, inside the shared resend transaction (IP budget already
   * debited). Rotates the code only for a live, still-eligible flow; otherwise silent.
   */
  async rotateLocked(tx: Prisma.TransactionClient, digest: Buffer, now: Date): Promise<void> {
    const otp = requireOtpKey(this.environment.auth);
    const locked = await this.lock(tx, digest);
    if (!locked) return;
    const { challenge, user } = locked;
    if (challenge.consumedAt || challenge.invalidatedAt) return;
    if (!this.live(challenge, user, now) || challenge.credentialVersion === null) {
      await this.invalidate(tx, challenge.id, now);
      return;
    }
    if (!(await emailIssuanceAllowed(tx, this.throttle, user.emailCanonical, now))) return;
    await rotateUserChallenge(tx, this.environment.auth, otp, {
      purpose: PURPOSE,
      challenge: { ...challenge, credentialVersion: challenge.credentialVersion },
      user,
      now,
      locale: user.preferredLocale,
    });
  }

  /** Lock order: identity, challenge row, then the User row; reread the locked state. */
  private async lock(
    tx: Prisma.TransactionClient,
    digest: Buffer | null,
  ): Promise<{ challenge: LockedChallenge; user: RecoverableUser } | null> {
    if (digest === null) return null;
    const located = await tx.authChallenge.findUnique({
      where: { flowTokenHash: new Uint8Array(digest) },
      select: { id: true, purpose: true, userId: true, user: { select: { emailCanonical: true } } },
    });
    if (
      !located ||
      located.purpose !== PURPOSE ||
      !located.userId ||
      !located.user?.emailCanonical
    ) {
      return null;
    }
    await lockIdentity(tx, this.environment.auth, PURPOSE, located.user.emailCanonical);
    await tx.$queryRaw`SELECT id FROM auth_challenges WHERE id = ${located.id}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${located.userId}::uuid FOR UPDATE`;
    const challenge = await tx.authChallenge.findUnique({
      where: { id: located.id },
      select: challengeSelect,
    });
    const user = await tx.user.findUnique({ where: { id: located.userId }, select: userSelect });
    if (!challenge || !eligible(user)) {
      if (challenge && !challenge.consumedAt && !challenge.invalidatedAt) {
        const now = await this.throttle.now(tx);
        await this.invalidate(tx, challenge.id, now);
      }
      return null;
    }
    return { challenge, user };
  }

  /** Flow deadline plus the bound identity, delivery target and credential version. */
  private live(
    challenge: LockedChallenge,
    user: LockedUser & { emailDelivery: string },
    now: Date,
  ): boolean {
    return (
      now < challenge.flowExpiresAt &&
      challenge.failedAttempts < challenge.maxAttempts &&
      challenge.deliveryEmailSnapshot === user.emailDelivery &&
      challenge.credentialVersion === user.credentialVersion
    );
  }

  private invalidate(tx: Prisma.TransactionClient, challengeId: string, now: Date) {
    return invalidateChallenges(tx, [challengeId], now);
  }
}

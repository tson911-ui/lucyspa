import type { AcceptedFlowResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { invalidatePendingDeliveries } from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, generateCapability, verifyOtpDigest } from './crypto.js';
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
  userOtpBinding,
} from './otp-flow.js';
import { hasFreshReauthentication, type SessionPrincipal } from './session.policy.js';
import { SessionService } from './session.service.js';

/** Design section 6: recovery-email flows live 15 minutes; codes 5 minutes within that. */
export const RECOVERY_EMAIL_POLICY = Object.freeze({ flowLifetimeSeconds: 900 } as const);

const PURPOSE = 'VERIFY_RECOVERY_EMAIL';

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
type PendingUser = LockedUser & { emailCanonical: string; emailDelivery: string };
type Refusal = 'UNAUTHENTICATED' | 'NOT_WORKFORCE' | 'RATE_LIMITED';
type RequestOutcome = Refusal | 'STALE_PROOF' | 'ACCEPTED';
type VerifyOutcome = Refusal | 'FAILED' | 'VERIFIED';

/** An active Owner/employee credential whose stored email has not been proven yet. */
function pending(user: LockedUser | null): user is PendingUser {
  return (
    user !== null &&
    (user.kind === 'OWNER' || user.kind === 'EMPLOYEE') &&
    user.status === 'ACTIVE' &&
    user.passwordHash !== null &&
    user.emailCanonical !== null &&
    user.emailDelivery !== null &&
    user.emailVerifiedAt === null
  );
}

function workforce(principal: SessionPrincipal): boolean {
  return principal.userKind === 'OWNER' || principal.userKind === 'EMPLOYEE';
}

/**
 * Proves control of the recovery email already stored for the authenticated Owner or
 * employee. It never accepts or changes an address and only sets `emailVerifiedAt`;
 * password, credential/authorization versions, status and sessions are untouched.
 */
@Injectable()
export class RecoveryEmailService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService)
    private readonly sessions: Pick<SessionService, 'withTransaction' | 'resolveForMutation'>,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
  ) {}

  /**
   * Requires a session reauthenticated within the fresh-proof window. Always the same
   * accepted shape: without a pending stored email, or when email budgets suppress
   * issuance, the token is an unstored random value and nothing is sent.
   */
  async request(sessionToken: string | undefined, peer: string): Promise<AcceptedFlowResponse> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    const otp = requireOtpKey(this.environment.auth);
    requireDeliveryKey(this.environment.auth);
    const flowToken = generateCapability();
    const outcome = await guardAuth(() =>
      this.sessions.withTransaction(async (tx): Promise<RequestOutcome> => {
        const now = await this.throttle.now(tx);
        // Lock order: IP bucket, User, session, identity, challenge (as the shared resend).
        if (!(await debitIpIssue(tx, this.throttle, this.environment.auth, peer, now))) {
          return 'RATE_LIMITED';
        }
        const principal = await this.sessions.resolveForMutation(sessionToken, tx);
        if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
          return 'UNAUTHENTICATED';
        }
        if (!workforce(principal)) return 'NOT_WORKFORCE';
        if (!hasFreshReauthentication(principal, now, this.environment.auth.freshAuthSeconds)) {
          return 'STALE_PROOF';
        }
        const user = await tx.user.findUnique({
          where: { id: principal.userId },
          select: userSelect,
        });
        if (!pending(user)) return 'ACCEPTED';
        const identities = await lockIdentity(
          tx,
          this.environment.auth,
          PURPOSE,
          user.emailCanonical,
        );
        if (!(await emailIssuanceAllowed(tx, this.throttle, user.emailCanonical, now))) {
          return 'ACCEPTED';
        }
        await this.supersede(tx, user.id, now);
        await issueUserChallenge(tx, this.environment.auth, otp, {
          purpose: PURPOSE,
          flowToken,
          identity: identities.active,
          user,
          now,
          flowLifetimeSeconds: RECOVERY_EMAIL_POLICY.flowLifetimeSeconds,
          locale: user.preferredLocale,
        });
        return 'ACCEPTED';
      }),
    );
    if (outcome === 'STALE_PROOF') throw new AuthError('REAUTHENTICATION_REQUIRED');
    refuse(outcome, OTP_POLICY.ipIssueWindowSeconds);
    return accepted(flowToken);
  }

  /**
   * The same authenticated User submits the flow capability and OTP. Wrong codes debit
   * the flow and identity budgets in a transaction that commits before the 400.
   */
  async verify(
    sessionToken: string | undefined,
    flowToken: string,
    otp: string,
    peer: string,
    requestId?: string,
  ): Promise<void> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    const digest = capabilityDigest(flowToken);
    const outcome = await guardAuth(() =>
      this.sessions.withTransaction(async (tx): Promise<VerifyOutcome> => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpVerify(tx, this.throttle, peer, now))) return 'RATE_LIMITED';
        const principal = await this.sessions.resolveForMutation(sessionToken, tx);
        if (principal?.kind !== 'AUTHENTICATED' || principal.userId === null) {
          return 'UNAUTHENTICATED';
        }
        if (!workforce(principal)) return 'NOT_WORKFORCE';
        const locked = await this.lock(tx, digest, principal.userId, now);
        if (!locked) return 'FAILED';
        const { challenge, user } = locked;
        if (!this.live(challenge, user, now)) {
          await invalidateChallenges(tx, [challenge.id], now);
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
          await invalidateChallenges(tx, [challenge.id], now);
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
        await invalidatePendingDeliveries(tx, [challenge.id]);
        // Only the proof timestamp changes, guarded by the exact address and credential.
        const changed = await tx.user.updateMany({
          where: {
            id: user.id,
            emailVerifiedAt: null,
            emailCanonical: user.emailCanonical,
            emailDelivery: challenge.deliveryEmailSnapshot,
            credentialVersion: challenge.credentialVersion,
          },
          data: { emailVerifiedAt: now },
        });
        if (changed.count !== 1) throw new Error('Recovery email changed concurrently.');
        await tx.auditEvent.create({
          data: {
            action: 'RECOVERY_EMAIL_VERIFIED',
            actorKind: 'USER',
            actorUserId: user.id,
            subjectUserId: user.id,
            entityType: 'User',
            entityId: user.id,
            requestId: requestId ?? null,
            occurredAt: now,
            dataClassification: 'STANDARD',
            before: { emailVerified: false },
            after: { emailVerified: true, method: 'EMAIL_OTP', challengeId: challenge.id },
          },
          select: { id: true },
        });
        return 'VERIFIED';
      }),
    );
    if (outcome === 'FAILED') throw new AuthError('VERIFICATION_FAILED');
    refuse(outcome, OTP_POLICY.verifyWindowSeconds);
  }

  /**
   * Resend for a recovery-email flow, inside the shared resend transaction (IP budget
   * already debited). Rotates only a live flow whose stored email is still unproven.
   */
  async rotateLocked(tx: Prisma.TransactionClient, digest: Buffer, now: Date): Promise<void> {
    const otp = requireOtpKey(this.environment.auth);
    const located = await tx.authChallenge.findUnique({
      where: { flowTokenHash: new Uint8Array(digest) },
      select: { userId: true },
    });
    if (!located?.userId) return;
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${located.userId}::uuid FOR UPDATE`;
    const locked = await this.lock(tx, digest, located.userId, now);
    if (!locked) return;
    const { challenge, user } = locked;
    if (!this.live(challenge, user, now) || challenge.credentialVersion === null) {
      await invalidateChallenges(tx, [challenge.id], now);
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

  /**
   * The caller already holds the User lock. Then identity, then the challenge row; the
   * locked state is reread. Another User's flow is reported as unknown and left intact.
   * Returns only an actionable flow; a flow whose User no longer qualifies is retired.
   */
  private async lock(
    tx: Prisma.TransactionClient,
    digest: Buffer | null,
    userId: string,
    now: Date,
  ): Promise<{ challenge: LockedChallenge; user: PendingUser } | null> {
    if (digest === null) return null;
    const located = await tx.authChallenge.findUnique({
      where: { flowTokenHash: new Uint8Array(digest) },
      select: { id: true, purpose: true, userId: true, user: { select: { emailCanonical: true } } },
    });
    if (
      !located ||
      located.purpose !== PURPOSE ||
      located.userId !== userId ||
      !located.user?.emailCanonical
    ) {
      return null;
    }
    await lockIdentity(tx, this.environment.auth, PURPOSE, located.user.emailCanonical);
    await tx.$queryRaw`SELECT id FROM auth_challenges WHERE id = ${located.id}::uuid FOR UPDATE`;
    const challenge = await tx.authChallenge.findUnique({
      where: { id: located.id },
      select: challengeSelect,
    });
    const user = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!challenge || challenge.consumedAt || challenge.invalidatedAt) return null;
    if (!pending(user)) {
      await invalidateChallenges(tx, [challenge.id], now);
      return null;
    }
    return { challenge, user };
  }

  /** Flow deadline plus the bound address and credential version. */
  private live(challenge: LockedChallenge, user: PendingUser, now: Date): boolean {
    return (
      now < challenge.flowExpiresAt &&
      challenge.failedAttempts < challenge.maxAttempts &&
      challenge.deliveryEmailSnapshot === user.emailDelivery &&
      challenge.credentialVersion === user.credentialVersion
    );
  }

  /**
   * At most one actionable proof per User. Identity keys cover the current address;
   * the User scope also retires flows keyed under retired throttle-key versions.
   */
  private async supersede(tx: Prisma.TransactionClient, userId: string, now: Date) {
    const actionable = await tx.authChallenge.findMany({
      where: { purpose: PURPOSE, userId, consumedAt: null, invalidatedAt: null },
      select: { id: true },
    });
    await invalidateChallenges(
      tx,
      actionable.map((row) => row.id),
      now,
    );
  }
}

function refuse(outcome: Refusal | 'ACCEPTED' | 'VERIFIED', retryAfterSeconds: number): void {
  if (outcome === 'RATE_LIMITED') throw new RateLimitedError(retryAfterSeconds);
  if (outcome === 'UNAUTHENTICATED') throw new AuthError('AUTHENTICATION_REQUIRED');
  if (outcome === 'NOT_WORKFORCE') throw new AuthError('REQUEST_NOT_ALLOWED');
}

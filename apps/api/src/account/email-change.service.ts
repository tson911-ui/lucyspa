import type { AcceptedFlowResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { invalidatePendingDeliveries } from '../auth/auth-delivery.js';
import { capabilityDigest, generateCapability, verifyOtpDigest } from '../auth/crypto.js';
import { IdentityValidationError, normalizeEmail } from '../auth/identity.js';
import { LoginService } from '../auth/login.service.js';
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
} from '../auth/otp-flow.js';
import type { SessionPrincipal } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';

/** Same lifetimes as the recovery-email proof: a 15-minute flow, 5-minute codes within it. */
export const EMAIL_CHANGE_POLICY = Object.freeze({ flowLifetimeSeconds: 900 } as const);

const PURPOSE = 'CHANGE_EMAIL';

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

type LockedUser = Prisma.UserGetPayload<{ select: typeof userSelect }>;
type LockedChallenge = Prisma.AuthChallengeGetPayload<{ select: typeof challengeSelect }>;

/** The proposed address of a CHANGE_EMAIL flow (stored only in the challenge snapshot). */
interface Proposed {
  emailCanonical: string;
  emailDelivery: string;
}

function workforce(principal: SessionPrincipal | null): principal is SessionPrincipal & {
  userId: string;
} {
  return (
    principal?.kind === 'AUTHENTICATED' &&
    principal.userId !== null &&
    (principal.userKind === 'OWNER' || principal.userKind === 'EMPLOYEE')
  );
}

function proposedOf(snapshot: string | null): Proposed | null {
  if (snapshot === null) return null;
  try {
    return normalizeEmail(snapshot);
  } catch {
    return null;
  }
}

/**
 * "Đổi email / Change email" (follow-up Step 5): a verified, self-service change of the
 * signed-in Owner's or employee's one authoritative email (`users.email_*`).
 *
 * The current email stays authoritative until the NEW address proves control: the proposed
 * address lives only in the CHANGE_EMAIL challenge (`delivery_email_snapshot`), the code is
 * sent only to it and is bound to it (OTP binding includes its canonical form, the user and
 * the credential version). There is no second email field and nothing to synchronize.
 */
@Injectable()
export class EmailChangeService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService)
    private readonly sessions: Pick<
      SessionService,
      'withTransaction' | 'resolveForMutation' | 'continueAfterCredentialChange'
    >,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
    @Inject(LoginService) private readonly logins: Pick<LoginService, 'proveCurrentPassword'>,
  ) {}

  /**
   * Current password (the shared Step 4 proof and budgets) plus the new address. Refuses an
   * invalid, unchanged, taken or reserved address; then issues a CHANGE_EMAIL flow (older ones
   * superseded) and queues the code to the NEW address only. The account email is untouched.
   */
  async request(
    sessionToken: string | undefined,
    currentPassword: string,
    newEmail: string,
    peer: string,
    requestId?: string,
  ): Promise<AcceptedFlowResponse> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    let proposed: Proposed;
    try {
      proposed = normalizeEmail(newEmail);
    } catch (error) {
      if (error instanceof IdentityValidationError) {
        throw new AuthError('VALIDATION_FAILED', 'newEmail');
      }
      throw error;
    }
    const otp = requireOtpKey(this.environment.auth);
    requireDeliveryKey(this.environment.auth);
    // Wrong passwords debit the reauthentication budgets and send nothing.
    const proof = await this.logins.proveCurrentPassword(sessionToken, currentPassword, peer);
    const flowToken = generateCapability();
    await guardAuth(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpIssue(tx, this.throttle, this.environment.auth, peer, now))) {
          throw new RateLimitedError(OTP_POLICY.ipIssueWindowSeconds);
        }
        const principal = await this.sessions.resolveForMutation(sessionToken, tx);
        if (!workforce(principal) || principal.userId !== proof.userId) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        const user = await this.user(tx, principal.userId);
        // The proof must still describe the stored credential.
        if (
          user.passwordHash !== proof.evidenceHash ||
          user.credentialVersion !== proof.user.credentialVersion
        ) {
          throw new AuthError('AUTHENTICATION_REQUIRED');
        }
        if (proposed.emailCanonical === user.emailCanonical) {
          throw new AuthError('VALIDATION_FAILED', 'newEmailUnchanged');
        }
        const identities = await lockIdentity(
          tx,
          this.environment.auth,
          PURPOSE,
          proposed.emailCanonical,
        );
        // Taken by any account, or reserved by another account's pending change.
        const owner = await tx.user.findUnique({
          where: { emailCanonical: proposed.emailCanonical },
          select: { id: true },
        });
        const reserved = await tx.authChallenge.findFirst({
          where: {
            purpose: PURPOSE,
            identityKey: { in: identities.all.map((key) => new Uint8Array(key)) },
            userId: { not: user.id },
            consumedAt: null,
            invalidatedAt: null,
            flowExpiresAt: { gt: now },
          },
          select: { id: true },
        });
        if (owner || reserved) throw new AuthError('CONFLICT', 'email');
        if (!(await emailIssuanceAllowed(tx, this.throttle, proposed.emailCanonical, now))) {
          throw new RateLimitedError(OTP_POLICY.resendCooldownSeconds);
        }
        await this.supersede(tx, user.id, identities.all, now);
        await issueUserChallenge(tx, this.environment.auth, otp, {
          purpose: PURPOSE,
          flowToken,
          identity: identities.active,
          user: {
            id: user.id,
            emailCanonical: proposed.emailCanonical,
            emailDelivery: proposed.emailDelivery,
            credentialVersion: user.credentialVersion,
            authzVersion: user.authzVersion,
          },
          now,
          flowLifetimeSeconds: EMAIL_CHANGE_POLICY.flowLifetimeSeconds,
          locale: user.preferredLocale,
        });
        await this.audit(tx, user.id, 'EMAIL_CHANGE_REQUESTED', now, requestId, {
          after: { method: 'SELF_SERVICE', emailVerified: false },
        });
      }),
    );
    return accepted(flowToken);
  }

  /** A new code for this user's own live flow (cooldown and email budgets apply). */
  async resend(sessionToken: string | undefined, flowToken: string, peer: string): Promise<void> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    const otp = requireOtpKey(this.environment.auth);
    requireDeliveryKey(this.environment.auth);
    const digest = capabilityDigest(flowToken);
    await guardAuth(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpIssue(tx, this.throttle, this.environment.auth, peer, now))) {
          throw new RateLimitedError(OTP_POLICY.ipIssueWindowSeconds);
        }
        const principal = await this.sessions.resolveForMutation(sessionToken, tx);
        if (!workforce(principal)) throw new AuthError('AUTHENTICATION_REQUIRED');
        const locked = await this.lock(tx, digest, principal.userId, now);
        if (!locked) throw new AuthError('VERIFICATION_FAILED');
        const { challenge, user, proposed } = locked;
        if (!(await emailIssuanceAllowed(tx, this.throttle, proposed.emailCanonical, now))) {
          throw new RateLimitedError(OTP_POLICY.resendCooldownSeconds);
        }
        await rotateUserChallenge(tx, this.environment.auth, otp, {
          purpose: PURPOSE,
          challenge: { ...challenge, credentialVersion: user.credentialVersion },
          user: { id: user.id, ...proposed },
          now,
          locale: user.preferredLocale,
        });
      }),
    );
  }

  /**
   * The same signed-in user submits the flow capability and the code sent to the new
   * address. Wrong codes debit the flow and identity budgets (committed before the 400).
   * On success, atomically: the new address becomes THE email and is verified, the flow is
   * consumed, reset/recovery/other change flows bound to the old address are retired, every
   * session is revoked and one replacement session is issued for this device (its token is
   * returned). The old address stops being a recovery or Owner sign-in address.
   */
  async verify(
    sessionToken: string | undefined,
    flowToken: string,
    code: string,
    peer: string,
    requestId?: string,
  ): Promise<string> {
    if (sessionToken === undefined) throw new AuthError('AUTHENTICATION_REQUIRED');
    const digest = capabilityDigest(flowToken);
    const outcome = await guardAuth(() =>
      this.sessions.withTransaction(
        async (tx): Promise<{ kind: 'FAILED' | 'TAKEN' } | { kind: 'CHANGED'; token: string }> => {
          const now = await this.throttle.now(tx);
          if (!(await debitIpVerify(tx, this.throttle, peer, now))) {
            throw new RateLimitedError(OTP_POLICY.verifyWindowSeconds);
          }
          const principal = await this.sessions.resolveForMutation(sessionToken, tx);
          if (!workforce(principal)) throw new AuthError('AUTHENTICATION_REQUIRED');
          const locked = await this.lock(tx, digest, principal.userId, now);
          if (!locked) return { kind: 'FAILED' };
          const { challenge, user, proposed } = locked;
          if (await identityFailuresExhausted(tx, this.throttle, proposed.emailCanonical, now)) {
            return { kind: 'FAILED' };
          }
          const key =
            challenge.keyVersion === null
              ? undefined
              : this.environment.auth.otpKeys?.get(challenge.keyVersion);
          if (!key || !challenge.verifierDigest || challenge.credentialVersion === null) {
            // A missing retained key invalidates the flow; verification is never bypassed.
            await invalidateChallenges(tx, [challenge.id], now);
            return { kind: 'FAILED' };
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
                { id: user.id, emailCanonical: proposed.emailCanonical },
                challenge.credentialVersion,
              ),
              code,
              key,
            );
          if (!verified) {
            const failedAttempts = challenge.failedAttempts + 1;
            const exhausted = failedAttempts >= challenge.maxAttempts;
            await tx.authChallenge.update({
              where: { id: challenge.id },
              data: { failedAttempts, ...(exhausted ? { invalidatedAt: now } : {}) },
              select: { id: true },
            });
            if (exhausted) await invalidatePendingDeliveries(tx, [challenge.id]);
            await recordIdentityFailure(tx, this.throttle, proposed.emailCanonical, now);
            return { kind: 'FAILED' };
          }
          // Still available? (Taken since the request: the flow ends, nothing changes.)
          const holder = await tx.user.findUnique({
            where: { emailCanonical: proposed.emailCanonical },
            select: { id: true },
          });
          if (holder) {
            await invalidateChallenges(tx, [challenge.id], now);
            return { kind: 'TAKEN' };
          }
          await tx.authChallenge.update({
            where: { id: challenge.id },
            data: { consumedAt: now },
            select: { id: true },
          });
          await invalidatePendingDeliveries(tx, [challenge.id]);
          const changed = await tx.user.updateMany({
            where: {
              id: user.id,
              status: 'ACTIVE',
              credentialVersion: challenge.credentialVersion,
              emailCanonical: user.emailCanonical,
            },
            data: {
              emailCanonical: proposed.emailCanonical,
              emailDelivery: proposed.emailDelivery,
              emailVerifiedAt: now,
              rowVersion: { increment: 1 },
            },
          });
          if (changed.count !== 1) throw new AuthError('AUTHENTICATION_REQUIRED');
          // Flows bound to the old address (reset, recovery proof) or another change are void.
          const obsolete = await tx.authChallenge.findMany({
            where: {
              userId: user.id,
              purpose: { in: ['RESET_PASSWORD', 'VERIFY_RECOVERY_EMAIL', PURPOSE] },
              consumedAt: null,
              invalidatedAt: null,
            },
            select: { id: true },
          });
          await invalidateChallenges(
            tx,
            obsolete.map((row) => row.id),
            now,
          );
          // Every session, this one included; this device continues on a new one.
          const revoked = await tx.session.updateMany({
            where: { userId: user.id, revokedAt: null },
            data: { revokedAt: now },
          });
          const issued = await this.sessions.continueAfterCredentialChange(
            tx,
            principal,
            requestId,
            'EMAIL_CHANGED',
          );
          await this.audit(tx, user.id, 'EMAIL_CHANGED', now, requestId, {
            before: {
              emailPresent: user.emailCanonical !== null,
              emailVerified: user.emailVerifiedAt !== null,
            },
            after: {
              method: 'SELF_SERVICE_EMAIL_OTP',
              emailVerified: true,
              challengeId: challenge.id,
            },
          });
          const others = Math.max(revoked.count - 1, 0);
          if (others > 0) {
            await this.audit(tx, user.id, 'SESSIONS_REVOKED', now, requestId, {
              after: { reason: 'EMAIL_CHANGED', revokedSessions: others },
            });
          }
          return { kind: 'CHANGED', token: issued.token };
        },
      ),
    );
    if (outcome.kind === 'CHANGED') return outcome.token;
    if (outcome.kind === 'TAKEN') throw new AuthError('CONFLICT', 'email');
    throw new AuthError('VERIFICATION_FAILED');
  }

  private async user(tx: Prisma.TransactionClient, userId: string): Promise<LockedUser> {
    const user = await tx.user.findUnique({ where: { id: userId }, select: userSelect });
    if (!user || user.status !== 'ACTIVE' || (user.kind !== 'OWNER' && user.kind !== 'EMPLOYEE')) {
      throw new AuthError('AUTHENTICATION_REQUIRED');
    }
    return user;
  }

  /**
   * The caller holds the User lock (from `resolveForMutation`). Then identity, then the
   * challenge row; the locked state is reread. Another user's flow is reported as unknown
   * and left intact. Returns only a live flow; a dead one is retired.
   */
  private async lock(
    tx: Prisma.TransactionClient,
    digest: Buffer | null,
    userId: string,
    now: Date,
  ): Promise<{ challenge: LockedChallenge; user: LockedUser; proposed: Proposed } | null> {
    if (digest === null) return null;
    const located = await tx.authChallenge.findUnique({
      where: { flowTokenHash: new Uint8Array(digest) },
      select: { id: true, purpose: true, userId: true, deliveryEmailSnapshot: true },
    });
    const proposed = proposedOf(located?.deliveryEmailSnapshot ?? null);
    if (!located || located.purpose !== PURPOSE || located.userId !== userId || !proposed) {
      return null;
    }
    await lockIdentity(tx, this.environment.auth, PURPOSE, proposed.emailCanonical);
    await tx.$queryRaw`SELECT id FROM auth_challenges WHERE id = ${located.id}::uuid FOR UPDATE`;
    const challenge = await tx.authChallenge.findUnique({
      where: { id: located.id },
      select: challengeSelect,
    });
    if (!challenge || challenge.consumedAt || challenge.invalidatedAt) return null;
    const user = await this.user(tx, userId);
    if (
      now >= challenge.flowExpiresAt ||
      challenge.failedAttempts >= challenge.maxAttempts ||
      challenge.credentialVersion !== user.credentialVersion ||
      proposed.emailCanonical === user.emailCanonical
    ) {
      await invalidateChallenges(tx, [challenge.id], now);
      return null;
    }
    return { challenge, user, proposed };
  }

  /** At most one actionable change per user, and per proposed address for this user. */
  private async supersede(
    tx: Prisma.TransactionClient,
    userId: string,
    identityKeys: Buffer[],
    now: Date,
  ): Promise<void> {
    const actionable = await tx.authChallenge.findMany({
      where: {
        purpose: PURPOSE,
        consumedAt: null,
        invalidatedAt: null,
        OR: [
          { userId },
          // Expired flows of others still hold the partial unique index for this address.
          { identityKey: { in: identityKeys.map((key) => new Uint8Array(key)) } },
        ],
      },
      select: { id: true },
    });
    await invalidateChallenges(
      tx,
      actionable.map((row) => row.id),
      now,
    );
  }

  private async audit(
    tx: Prisma.TransactionClient,
    userId: string,
    action: string,
    now: Date,
    requestId: string | undefined,
    detail: { before?: Prisma.InputJsonObject; after?: Prisma.InputJsonObject },
  ): Promise<void> {
    // No email address, code, password or hash is recorded.
    await tx.auditEvent.create({
      data: {
        action,
        actorKind: 'USER',
        actorUserId: userId,
        subjectUserId: userId,
        entityType: 'User',
        entityId: userId,
        requestId: requestId ?? null,
        occurredAt: now,
        dataClassification: 'STANDARD',
        ...(detail.before ? { before: detail.before } : {}),
        ...(detail.after ? { after: detail.after } : {}),
      },
      select: { id: true },
    });
  }
}

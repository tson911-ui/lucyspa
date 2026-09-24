import { randomUUID } from 'node:crypto';
import type { AcceptedFlowResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { enqueueAuthEmail, invalidatePendingDeliveries } from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import {
  capabilityDigest,
  generateCapability,
  generateOtp,
  otpDigest,
  verifyOtpDigest,
} from './crypto.js';
import {
  accepted,
  codeExpiry,
  debitIpIssue,
  debitIpVerify,
  emailIssuanceAllowed,
  flowTokenDigest,
  guardAuth,
  identityFailuresExhausted,
  lockIdentity,
  OTP_POLICY,
  RateLimitedError,
  recordIdentityFailure,
  requireDeliveryKey,
  requireOtpKey,
} from './otp-flow.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { RecoveryEmailService } from './recovery-email.service.js';
import { normalizeRegistration, type RegistrationInput } from './registration.js';
import { SessionService } from './session.service.js';

/** Design section 6 defaults; shared OTP rules live in otp-flow.ts. */
export const ACTIVATION_POLICY = Object.freeze({
  ...OTP_POLICY,
  intentLifetimeSeconds: 1_800,
} as const);

// Existing imports of these names from this module remain valid.
export { accepted, RateLimitedError };

const PURPOSE = 'ACTIVATE_CUSTOMER';

type VerifyOutcome = 'ACTIVATED' | 'FAILED' | 'RATE_LIMITED' | 'UNIQUE_CONFLICT';

const challengeSelect = {
  id: true,
  purpose: true,
  generation: true,
  verifierDigest: true,
  keyVersion: true,
  failedAttempts: true,
  maxAttempts: true,
  flowExpiresAt: true,
  codeExpiresAt: true,
  consumedAt: true,
  invalidatedAt: true,
  registrationIntent: true,
} satisfies Prisma.AuthChallengeSelect;

type LockedChallenge = Prisma.AuthChallengeGetPayload<{ select: typeof challengeSelect }>;

@Injectable()
export class RegistrationService {
  constructor(
    @Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment,
    @Inject(SessionService) private readonly sessions: Pick<SessionService, 'withTransaction'>,
    @Inject(PasswordService) private readonly passwords: Pick<PasswordService, 'hashForSetting'>,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
    // The shared resend endpoint forwards reset flows; absent in activation-only tests.
    @Optional()
    @Inject(PasswordResetService)
    private readonly resets?: Pick<PasswordResetService, 'rotateLocked'>,
    // Also forwards workforce recovery-email flows; optional for the same reason.
    @Optional()
    @Inject(RecoveryEmailService)
    private readonly recoveryEmails?: Pick<RecoveryEmailService, 'rotateLocked'>,
  ) {}

  /**
   * Always returns the same accepted shape. Duplicate, throttled and ineligible
   * identities get an unstored random flow token and no email.
   */
  async register(input: RegistrationInput, peer: string): Promise<AcceptedFlowResponse> {
    const otp = requireOtpKey(this.environment.auth);
    requireDeliveryKey(this.environment.auth);
    const candidate = normalizeRegistration(input);
    await guardAuth(async () => {
      const admitted = await this.sessions.withTransaction(async (tx) =>
        debitIpIssue(tx, this.throttle, this.environment.auth, peer, await this.throttle.now(tx)),
      );
      if (!admitted) throw new RateLimitedError(OTP_POLICY.ipIssueWindowSeconds);
    });
    // Hash before any identity lookup so every accepted path performs the same work.
    let passwordHash: string;
    try {
      passwordHash = await this.passwords.hashForSetting(candidate.password);
    } catch {
      // Includes the bounded Argon2 work queue being full; the policy was already checked.
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    const flowToken = generateCapability();
    await guardAuth(() =>
      this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        const identities = await lockIdentity(
          tx,
          this.environment.auth,
          PURPOSE,
          candidate.emailCanonical,
        );
        if (!(await emailIssuanceAllowed(tx, this.throttle, candidate.emailCanonical, now))) {
          return;
        }
        const existing = await tx.user.findFirst({
          where: {
            OR: [
              { emailCanonical: candidate.emailCanonical },
              { phoneCanonical: candidate.phoneCanonical },
            ],
          },
          select: { id: true },
        });
        // Never alter an existing User or send activation for it.
        if (existing) return;
        await this.invalidateActionable(tx, identities.all, now);
        const intentId = randomUUID();
        const challengeId = randomUUID();
        const expiresAt = new Date(now.getTime() + ACTIVATION_POLICY.intentLifetimeSeconds * 1_000);
        const codeExpiresAt = codeExpiry(now, expiresAt);
        const code = generateOtp();
        await tx.registrationIntent.create({
          data: {
            id: intentId,
            emailCanonical: candidate.emailCanonical,
            emailDelivery: candidate.emailDelivery,
            phoneCanonical: candidate.phoneCanonical,
            normalizationVersion: candidate.normalizationVersion,
            passwordHash,
            fullName: candidate.fullName,
            dateOfBirth: candidate.dateOfBirth,
            address: candidate.address,
            preferredLocale: candidate.locale,
            createdAt: now,
            expiresAt,
          },
          select: { id: true },
        });
        await tx.authChallenge.create({
          data: {
            id: challengeId,
            purpose: PURPOSE,
            flowTokenHash: new Uint8Array(flowTokenDigest(flowToken)),
            identityKey: new Uint8Array(identities.active.digest),
            identityKeyVersion: identities.active.version,
            registrationIntentId: intentId,
            generation: 1,
            verifierDigest: new Uint8Array(
              otpDigest(
                this.binding(challengeId, 1, intentId, candidate.emailCanonical),
                code,
                otp.key,
              ),
            ),
            keyVersion: otp.version,
            deliveryEmailSnapshot: candidate.emailDelivery,
            maxAttempts: ACTIVATION_POLICY.maxAttempts,
            createdAt: now,
            flowExpiresAt: expiresAt,
            codeGeneratedAt: now,
            codeExpiresAt,
          },
          select: { id: true },
        });
        await enqueueAuthEmail(tx, this.environment.auth, {
          challengeId,
          generation: 1,
          now,
          codeExpiresAt,
          to: candidate.emailDelivery,
          code,
          locale: candidate.locale,
        });
      }),
    );
    return accepted(flowToken);
  }

  /** Activates the bound candidate only; never creates a session. */
  async verify(flowToken: string, otp: string, peer: string, requestId?: string): Promise<void> {
    const digest = capabilityDigest(flowToken);
    let outcome: VerifyOutcome;
    try {
      outcome = await this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpVerify(tx, this.throttle, peer, now))) return 'RATE_LIMITED';
        const challenge = await this.lockChallenge(tx, digest);
        const intent = challenge?.registrationIntent;
        if (!challenge || !intent || challenge.consumedAt || challenge.invalidatedAt) {
          return 'FAILED';
        }
        if (
          now >= challenge.flowExpiresAt ||
          now >= intent.expiresAt ||
          intent.completedAt ||
          intent.invalidatedAt
        ) {
          await this.invalidateFlow(tx, challenge, now);
          return 'FAILED';
        }
        if (await identityFailuresExhausted(tx, this.throttle, intent.emailCanonical, now)) {
          return 'FAILED';
        }
        const key =
          challenge.keyVersion === null
            ? undefined
            : this.environment.auth.otpKeys?.get(challenge.keyVersion);
        if (!key || !challenge.verifierDigest) {
          // A missing retained key invalidates the flow; verification is never bypassed.
          await this.invalidateFlow(tx, challenge, now);
          return 'FAILED';
        }
        const verified =
          challenge.codeExpiresAt !== null &&
          now < challenge.codeExpiresAt &&
          verifyOtpDigest(
            challenge.verifierDigest,
            this.binding(challenge.id, challenge.generation, intent.id, intent.emailCanonical),
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
          if (exhausted) await this.invalidateFlow(tx, challenge, now, false);
          await recordIdentityFailure(tx, this.throttle, intent.emailCanonical, now);
          return 'FAILED';
        }
        const conflict = await tx.user.findFirst({
          where: {
            OR: [
              { emailCanonical: intent.emailCanonical },
              { phoneCanonical: intent.phoneCanonical },
            ],
          },
          select: { id: true },
        });
        if (conflict) {
          // Never attach this verified email or phone to the existing User.
          await this.invalidateFlow(tx, challenge, now);
          return 'FAILED';
        }
        const userId = randomUUID();
        await tx.user.create({
          data: {
            id: userId,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: intent.fullName,
            preferredLocale: intent.preferredLocale,
            emailCanonical: intent.emailCanonical,
            emailDelivery: intent.emailDelivery,
            emailVerifiedAt: now,
            phoneCanonical: intent.phoneCanonical,
            normalizationVersion: intent.normalizationVersion,
            passwordHash: intent.passwordHash,
            createdAt: now,
            customerProfile: {
              create: { dateOfBirth: intent.dateOfBirth, address: intent.address },
            },
          },
          select: { id: true },
        });
        await tx.registrationIntent.update({
          where: { id: intent.id },
          data: { completedAt: now, completedUserId: userId },
          select: { id: true },
        });
        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: now },
          select: { id: true },
        });
        await invalidatePendingDeliveries(tx, [challenge.id]);
        const identities = await lockIdentity(
          tx,
          this.environment.auth,
          PURPOSE,
          intent.emailCanonical,
        );
        await this.invalidateActionable(tx, identities.all, now);
        const audit = {
          actorKind: 'SYSTEM',
          subjectUserId: userId,
          entityType: 'User',
          entityId: userId,
          requestId: requestId ?? null,
          occurredAt: now,
          dataClassification: 'STANDARD',
        } as const;
        await tx.auditEvent.createMany({
          data: [
            { ...audit, action: 'USER_CREATED', after: { kind: 'CUSTOMER', status: 'ACTIVE' } },
            {
              ...audit,
              action: 'CUSTOMER_EMAIL_VERIFIED',
              after: { method: 'EMAIL_OTP', registrationIntentId: intent.id },
            },
          ],
        });
        return 'ACTIVATED';
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        outcome = 'UNIQUE_CONFLICT';
      } else if (error instanceof AuthError) {
        throw error;
      } else {
        throw new AuthError('SERVICE_UNAVAILABLE');
      }
    }
    if (outcome === 'UNIQUE_CONFLICT') {
      // The rolled-back activation lost a uniqueness race; retire the unusable flow.
      await guardAuth(() =>
        this.sessions.withTransaction(async (tx) => {
          const now = await this.throttle.now(tx);
          const challenge = await this.lockChallenge(tx, digest);
          if (challenge && !challenge.consumedAt && !challenge.invalidatedAt) {
            await this.invalidateFlow(tx, challenge, now);
          }
        }),
      );
      throw new AuthError('VERIFICATION_FAILED');
    }
    if (outcome === 'RATE_LIMITED') throw new RateLimitedError(OTP_POLICY.verifyWindowSeconds);
    if (outcome === 'FAILED') throw new AuthError('VERIFICATION_FAILED');
  }

  /** Rotates the code of a live flow; the response never reveals whether it did. */
  async resend(flowToken: string, peer: string): Promise<void> {
    const otp = requireOtpKey(this.environment.auth);
    requireDeliveryKey(this.environment.auth);
    const digest = capabilityDigest(flowToken);
    await guardAuth(async () => {
      const limited = await this.sessions.withTransaction(async (tx) => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpIssue(tx, this.throttle, this.environment.auth, peer, now))) {
          return true;
        }
        if (digest !== null && (this.resets || this.recoveryEmails)) {
          const located = await tx.authChallenge.findUnique({
            where: { flowTokenHash: new Uint8Array(digest) },
            select: { purpose: true },
          });
          if (located?.purpose === 'RESET_PASSWORD' && this.resets) {
            await this.resets.rotateLocked(tx, digest, now);
            return false;
          }
          if (located?.purpose === 'VERIFY_RECOVERY_EMAIL' && this.recoveryEmails) {
            await this.recoveryEmails.rotateLocked(tx, digest, now);
            return false;
          }
        }
        const challenge = await this.lockChallenge(tx, digest);
        const intent = challenge?.registrationIntent;
        if (!challenge || !intent || challenge.consumedAt || challenge.invalidatedAt) return false;
        if (
          now >= challenge.flowExpiresAt ||
          now >= intent.expiresAt ||
          intent.completedAt ||
          intent.invalidatedAt
        ) {
          await this.invalidateFlow(tx, challenge, now);
          return false;
        }
        if (!(await emailIssuanceAllowed(tx, this.throttle, intent.emailCanonical, now))) {
          return false;
        }
        const generation = challenge.generation + 1;
        const code = generateOtp();
        const codeExpiresAt = codeExpiry(now, challenge.flowExpiresAt);
        await invalidatePendingDeliveries(tx, [challenge.id]);
        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: {
            generation,
            verifierDigest: new Uint8Array(
              otpDigest(
                this.binding(challenge.id, generation, intent.id, intent.emailCanonical),
                code,
                otp.key,
              ),
            ),
            keyVersion: otp.version,
            codeGeneratedAt: now,
            codeExpiresAt,
          },
          select: { id: true },
        });
        await enqueueAuthEmail(tx, this.environment.auth, {
          challengeId: challenge.id,
          generation,
          now,
          codeExpiresAt,
          to: intent.emailDelivery,
          code,
          locale: intent.preferredLocale,
        });
        return false;
      });
      if (limited) throw new RateLimitedError(OTP_POLICY.ipIssueWindowSeconds);
    });
  }

  private async lockChallenge(
    tx: Prisma.TransactionClient,
    digest: Buffer | null,
  ): Promise<LockedChallenge | null> {
    if (digest === null) return null;
    const located = await tx.authChallenge.findUnique({
      where: { flowTokenHash: new Uint8Array(digest) },
      select: { id: true, purpose: true, registrationIntent: { select: { emailCanonical: true } } },
    });
    if (!located || located.purpose !== PURPOSE || !located.registrationIntent) return null;
    // Lock order: identity, then the challenge row; then reread the locked state.
    await lockIdentity(
      tx,
      this.environment.auth,
      PURPOSE,
      located.registrationIntent.emailCanonical,
    );
    await tx.$queryRaw`SELECT id FROM auth_challenges WHERE id = ${located.id}::uuid FOR UPDATE`;
    return tx.authChallenge.findUnique({ where: { id: located.id }, select: challengeSelect });
  }

  /** Supersedes any actionable activation for this identity before a new one is inserted. */
  private async invalidateActionable(
    tx: Prisma.TransactionClient,
    identityKeys: Buffer[],
    now: Date,
  ): Promise<void> {
    const actionable = await tx.authChallenge.findMany({
      where: {
        purpose: PURPOSE,
        identityKey: { in: identityKeys.map((key) => new Uint8Array(key)) },
        consumedAt: null,
        invalidatedAt: null,
      },
      select: { id: true, registrationIntentId: true },
    });
    if (actionable.length === 0) return;
    const ids = actionable.map((row) => row.id);
    await tx.authChallenge.updateMany({ where: { id: { in: ids } }, data: { invalidatedAt: now } });
    await tx.registrationIntent.updateMany({
      where: {
        id: { in: actionable.flatMap((row) => row.registrationIntentId ?? []) },
        completedAt: null,
        invalidatedAt: null,
      },
      data: { invalidatedAt: now },
    });
    await invalidatePendingDeliveries(tx, ids);
  }

  private async invalidateFlow(
    tx: Prisma.TransactionClient,
    challenge: LockedChallenge,
    now: Date,
    invalidateChallenge = true,
  ): Promise<void> {
    if (invalidateChallenge) {
      await tx.authChallenge.update({
        where: { id: challenge.id },
        data: { invalidatedAt: now },
        select: { id: true },
      });
    }
    const intent = challenge.registrationIntent;
    if (intent && !intent.completedAt && !intent.invalidatedAt) {
      await tx.registrationIntent.update({
        where: { id: intent.id },
        data: { invalidatedAt: now },
        select: { id: true },
      });
    }
    await invalidatePendingDeliveries(tx, [challenge.id]);
  }

  private binding(challengeId: string, generation: number, intentId: string, email: string) {
    return {
      purpose: PURPOSE,
      challengeId,
      generation,
      subjectId: intentId,
      emailCanonical: email,
      credentialVersion: null,
    } as const;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (Reflect.get(error, 'code') === 'P2002' ||
      /\b23505\b/.test(String(Reflect.get(error, 'message'))))
  );
}

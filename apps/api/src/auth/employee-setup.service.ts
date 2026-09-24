import { Inject, Injectable } from '@nestjs/common';
import { invalidatePendingDeliveries } from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest } from './crypto.js';
import { debitIpVerify, guardAuth, OTP_POLICY, RateLimitedError } from './otp-flow.js';
import {
  PasswordPolicyError,
  PasswordService,
  validatePasswordForSetting,
} from './password.service.js';
import { SessionService } from './session.service.js';

type CompleteOutcome = 'COMPLETED' | 'FAILED' | 'RATE_LIMITED';

/**
 * Redeems an EMPLOYEE_SETUP capability (design sections 2 and 7). The employee chooses
 * the password; completion rechecks PENDING_SETUP and both captured versions, then
 * atomically consumes the capability, establishes the password, increments the
 * credential version, revokes sibling flows and sessions and appends audit. It never
 * creates a session and never activates an INACTIVE, Owner or customer account.
 */
@Injectable()
export class EmployeeSetupService {
  constructor(
    @Inject(SessionService) private readonly sessions: Pick<SessionService, 'withTransaction'>,
    @Inject(PasswordService) private readonly passwords: Pick<PasswordService, 'hashForSetting'>,
    @Inject(AuthThrottleService) private readonly throttle: AuthThrottleService,
  ) {}

  async complete(
    setupToken: string,
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
    // Hash before any lookup so real and unknown capabilities perform the same work.
    let passwordHash: string;
    try {
      passwordHash = await this.passwords.hashForSetting(newPassword);
    } catch {
      throw new AuthError('SERVICE_UNAVAILABLE');
    }
    const digest = capabilityDigest(setupToken);
    const outcome = await guardAuth(() =>
      this.sessions.withTransaction(async (tx): Promise<CompleteOutcome> => {
        const now = await this.throttle.now(tx);
        if (!(await debitIpVerify(tx, this.throttle, peer, now))) return 'RATE_LIMITED';
        if (digest === null) return 'FAILED';
        const located = await tx.authChallenge.findUnique({
          where: { flowTokenHash: new Uint8Array(digest) },
          select: { id: true, purpose: true, userId: true },
        });
        if (!located || located.purpose !== 'EMPLOYEE_SETUP' || !located.userId) return 'FAILED';
        // Lock order: User, then challenge rows (as issuance and recovery-email flows).
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${located.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM auth_challenges WHERE id = ${located.id}::uuid FOR UPDATE`;
        const challenge = await tx.authChallenge.findUniqueOrThrow({
          where: { id: located.id },
          select: {
            id: true,
            credentialVersion: true,
            authzVersion: true,
            flowExpiresAt: true,
            consumedAt: true,
            invalidatedAt: true,
          },
        });
        if (challenge.consumedAt || challenge.invalidatedAt) return 'FAILED';
        const user = await tx.user.findUniqueOrThrow({
          where: { id: located.userId },
          select: {
            id: true,
            kind: true,
            status: true,
            passwordHash: true,
            credentialVersion: true,
            authzVersion: true,
          },
        });
        if (
          now >= challenge.flowExpiresAt ||
          user.kind !== 'EMPLOYEE' ||
          user.status !== 'PENDING_SETUP' ||
          user.passwordHash !== null ||
          challenge.credentialVersion !== user.credentialVersion ||
          challenge.authzVersion !== user.authzVersion
        ) {
          // Promotion, scope change, inactivation or expiry retires the capability.
          await tx.authChallenge.update({
            where: { id: challenge.id },
            data: { invalidatedAt: now },
            select: { id: true },
          });
          return 'FAILED';
        }

        await tx.authChallenge.update({
          where: { id: challenge.id },
          data: { consumedAt: now },
          select: { id: true },
        });
        const credentialVersion = user.credentialVersion + 1;
        const changed = await tx.user.updateMany({
          where: {
            id: user.id,
            status: 'PENDING_SETUP',
            credentialVersion: user.credentialVersion,
            authzVersion: user.authzVersion,
          },
          data: {
            status: 'ACTIVE',
            passwordHash,
            credentialVersion,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new Error('Credential changed concurrently.');
        const revoked = await tx.session.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: now },
        });
        const siblings = await tx.authChallenge.findMany({
          where: {
            userId: user.id,
            purpose: { in: ['RESET_PASSWORD', 'EMPLOYEE_SETUP', 'VERIFY_RECOVERY_EMAIL'] },
            consumedAt: null,
            invalidatedAt: null,
          },
          select: { id: true },
        });
        if (siblings.length > 0) {
          await tx.authChallenge.updateMany({
            where: { id: { in: siblings.map((row) => row.id) } },
            data: { invalidatedAt: now },
          });
        }
        await invalidatePendingDeliveries(
          tx,
          siblings.map((row) => row.id),
        );
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
              action: 'ACCESS_SETUP_COMPLETED',
              before: { status: 'PENDING_SETUP', credentialVersion: user.credentialVersion },
              after: {
                status: 'ACTIVE',
                credentialVersion,
                method: 'SETUP_CAPABILITY',
                challengeId: challenge.id,
              },
            },
            ...(revoked.count > 0
              ? [
                  {
                    ...audit,
                    action: 'SESSIONS_REVOKED',
                    after: { reason: 'ACCESS_SETUP_COMPLETED', revokedSessions: revoked.count },
                  },
                ]
              : []),
          ],
        });
        return 'COMPLETED';
      }),
    );
    if (outcome === 'RATE_LIMITED') throw new RateLimitedError(OTP_POLICY.verifyWindowSeconds);
    if (outcome === 'FAILED') throw new AuthError('VERIFICATION_FAILED');
  }
}

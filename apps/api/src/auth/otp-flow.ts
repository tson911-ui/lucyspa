import type { AcceptedFlowResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import type { AuthEnvironment } from '@lucy-spa/server';
import type { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, identityDigest } from './crypto.js';

/**
 * Shared email-OTP flow rules (design section 6). Budgets are keyed by canonical email
 * or IP only, so they apply across flows and purposes and survive new flow creation.
 */
export const OTP_POLICY = Object.freeze({
  codeLifetimeSeconds: 300,
  maxAttempts: 5,
  resendCooldownSeconds: 60,
  emailHourlyLimit: 5,
  emailDailyLimit: 10,
  ipIssueWindowSeconds: 3_600,
  ipVerifyLimit: 100,
  verifyWindowSeconds: 900,
  identityFailureLimit: 10,
} as const);

export const OTP_OPS = {
  ipIssue: 'OTP_ISSUE_IP',
  ipVerify: 'OTP_VERIFY_IP',
  emailCooldown: 'OTP_ISSUE_EMAIL_COOLDOWN',
  emailHour: 'OTP_ISSUE_EMAIL_HOUR',
  emailDay: 'OTP_ISSUE_EMAIL_DAY',
  identityFailure: 'OTP_VERIFY_FAILURE_IDENTITY',
} as const;

export type EmailOtpPurpose = 'ACTIVATE_CUSTOMER' | 'RESET_PASSWORD';

export class RateLimitedError extends AuthError {
  constructor(readonly retryAfterSeconds: number) {
    super('RATE_LIMITED');
  }
}

/** Constant receipt for real and dummy flows; not a delivery promise. */
export function accepted(flowToken: string): AcceptedFlowResponse {
  return {
    status: 'accepted',
    flowToken,
    codeLifetimeSeconds: OTP_POLICY.codeLifetimeSeconds,
    resendAfterSeconds: OTP_POLICY.resendCooldownSeconds,
  };
}

/** Fail closed before any write when the independent OTP key is not configured. */
export function requireOtpKey(auth: AuthEnvironment): { version: number; key: Buffer } {
  const { otpActiveVersion, otpKeys } = auth;
  const key = otpActiveVersion === undefined ? undefined : otpKeys?.get(otpActiveVersion);
  if (otpActiveVersion === undefined || !key) throw new AuthError('SERVICE_UNAVAILABLE');
  return { version: otpActiveVersion, key };
}

export function requireDeliveryKey(auth: AuthEnvironment): void {
  const { deliveryActiveVersion, deliveryKeys } = auth;
  if (deliveryActiveVersion === undefined || !deliveryKeys?.has(deliveryActiveVersion)) {
    throw new AuthError('SERVICE_UNAVAILABLE');
  }
}

export function flowTokenDigest(flowToken: string): Buffer {
  const digest = capabilityDigest(flowToken);
  if (digest === null) throw new Error('Capability generation failed.');
  return digest;
}

export function codeExpiry(now: Date, flowExpiresAt: Date): Date {
  return new Date(
    Math.min(now.getTime() + OTP_POLICY.codeLifetimeSeconds * 1_000, flowExpiresAt.getTime()),
  );
}

/** Serializes issuance/verification per canonical email and purpose across retained key versions. */
export async function lockIdentity(
  tx: Prisma.TransactionClient,
  auth: AuthEnvironment,
  purpose: EmailOtpPurpose,
  emailCanonical: string,
): Promise<{ active: { version: number; digest: Buffer }; all: Buffer[] }> {
  const versions = [...auth.throttleKeys].sort(([a], [b]) => a - b);
  const all: Buffer[] = [];
  let active: { version: number; digest: Buffer } | undefined;
  for (const [version, key] of versions) {
    const digest = identityDigest(purpose, emailCanonical, key);
    all.push(digest);
    if (version === auth.throttleActiveVersion) active = { version, digest };
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(${digest.readBigInt64BE(0)}::bigint)::text`;
  }
  if (!active) throw new Error('Identity key unavailable.');
  return { active, all };
}

/** Cooldown plus hourly/daily email budgets; false means silently suppress issuance. */
export async function emailIssuanceAllowed(
  tx: Prisma.TransactionClient,
  throttle: AuthThrottleService,
  emailCanonical: string,
  now: Date,
): Promise<boolean> {
  return (
    (await throttle.claimCooldown(
      tx,
      OTP_OPS.emailCooldown,
      emailCanonical,
      OTP_POLICY.resendCooldownSeconds,
      now,
    )) &&
    (await throttle.debitWindow(
      tx,
      OTP_OPS.emailHour,
      emailCanonical,
      OTP_POLICY.emailHourlyLimit,
      3_600,
      now,
    )) &&
    (await throttle.debitWindow(
      tx,
      OTP_OPS.emailDay,
      emailCanonical,
      OTP_POLICY.emailDailyLimit,
      86_400,
      now,
    ))
  );
}

/** Public per-IP budgets; false means respond 429. */
export function debitIpIssue(
  tx: Prisma.TransactionClient,
  throttle: AuthThrottleService,
  auth: AuthEnvironment,
  peer: string,
  now: Date,
): Promise<boolean> {
  return throttle.debitWindow(
    tx,
    OTP_OPS.ipIssue,
    peer,
    auth.otpIpIssueLimit,
    OTP_POLICY.ipIssueWindowSeconds,
    now,
  );
}

export function debitIpVerify(
  tx: Prisma.TransactionClient,
  throttle: AuthThrottleService,
  peer: string,
  now: Date,
): Promise<boolean> {
  return throttle.debitWindow(
    tx,
    OTP_OPS.ipVerify,
    peer,
    OTP_POLICY.ipVerifyLimit,
    OTP_POLICY.verifyWindowSeconds,
    now,
  );
}

export async function identityFailuresExhausted(
  tx: Prisma.TransactionClient,
  throttle: AuthThrottleService,
  emailCanonical: string,
  now: Date,
): Promise<boolean> {
  const failures = await throttle.windowCount(
    tx,
    OTP_OPS.identityFailure,
    emailCanonical,
    OTP_POLICY.verifyWindowSeconds,
    now,
  );
  return failures >= OTP_POLICY.identityFailureLimit;
}

export async function recordIdentityFailure(
  tx: Prisma.TransactionClient,
  throttle: AuthThrottleService,
  emailCanonical: string,
  now: Date,
): Promise<void> {
  await throttle.debitWindow(
    tx,
    OTP_OPS.identityFailure,
    emailCanonical,
    OTP_POLICY.identityFailureLimit,
    OTP_POLICY.verifyWindowSeconds,
    now,
  );
}

/** Only allowlisted errors reach the transport; everything else is a sanitized 503. */
export async function guardAuth<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError('SERVICE_UNAVAILABLE');
  }
}

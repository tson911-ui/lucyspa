import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { assertAuthTransaction } from './auth-store.js';
import { throttleDigest } from './crypto.js';

const COOLDOWN_EPOCH = new Date(0);

/**
 * Authoritative PostgreSQL budgets for OTP issuance and verification. Every retained
 * throttle key version is debited in stable order so key rotation cannot reset a
 * live budget. Callers decide whether a refusal is public (IP) or silent (identity).
 */
@Injectable()
export class AuthThrottleService {
  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {}

  async now(transaction: Prisma.TransactionClient): Promise<Date> {
    const rows = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = rows[0]?.now;
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new Error('Database clock unavailable.');
    }
    return now;
  }

  /** Fixed UTC window counter; false when any retained version is already at the limit. */
  async debitWindow(
    transaction: Prisma.TransactionClient,
    operation: string,
    identifier: string,
    limit: number,
    windowSeconds: number,
    now: Date,
  ): Promise<boolean> {
    assertAuthTransaction(transaction);
    const { start, expires } = this.window(now, windowSeconds);
    let admitted = true;
    for (const [version, digest] of this.digests(operation, identifier)) {
      const rows = await transaction.$queryRaw<{ id: string }[]>`
        INSERT INTO auth_throttle_buckets
          (id, operation_bucket, pseudonymous_key, key_version, window_started_at,
           window_seconds, count, expires_at)
        VALUES (gen_random_uuid(), ${operation}, ${digest}, ${version}, ${start},
                ${windowSeconds}, 1, ${expires})
        ON CONFLICT (operation_bucket, pseudonymous_key, key_version, window_started_at, window_seconds)
        DO UPDATE SET count = auth_throttle_buckets.count + 1
        WHERE auth_throttle_buckets.count < ${limit}
        RETURNING id`;
      if (rows.length !== 1) admitted = false;
    }
    return admitted;
  }

  /** Highest current-window count across retained versions, without debiting. */
  async windowCount(
    transaction: Prisma.TransactionClient,
    operation: string,
    identifier: string,
    windowSeconds: number,
    now: Date,
  ): Promise<number> {
    assertAuthTransaction(transaction);
    const { start } = this.window(now, windowSeconds);
    let highest = 0;
    for (const [version, digest] of this.digests(operation, identifier)) {
      const rows = await transaction.$queryRaw<{ count: number }[]>`
        SELECT count FROM auth_throttle_buckets
        WHERE operation_bucket = ${operation} AND pseudonymous_key = ${digest}
          AND key_version = ${version} AND window_started_at = ${start}
          AND window_seconds = ${windowSeconds}`;
      highest = Math.max(highest, rows[0]?.count ?? 0);
    }
    return highest;
  }

  /** Separate zero-second bucket: a window rollover can never reset this cooldown. */
  async claimCooldown(
    transaction: Prisma.TransactionClient,
    operation: string,
    identifier: string,
    seconds: number,
    now: Date,
  ): Promise<boolean> {
    assertAuthTransaction(transaction);
    const next = new Date(now.getTime() + seconds * 1_000);
    let admitted = true;
    for (const [version, digest] of this.digests(operation, identifier)) {
      const rows = await transaction.$queryRaw<{ id: string }[]>`
        INSERT INTO auth_throttle_buckets
          (id, operation_bucket, pseudonymous_key, key_version, window_started_at,
           window_seconds, count, next_allowed_at, expires_at)
        VALUES (gen_random_uuid(), ${operation}, ${digest}, ${version}, ${COOLDOWN_EPOCH},
                0, 0, ${next}, ${next})
        ON CONFLICT (operation_bucket, pseudonymous_key, key_version, window_started_at, window_seconds)
        DO UPDATE SET next_allowed_at = EXCLUDED.next_allowed_at,
          expires_at = GREATEST(auth_throttle_buckets.expires_at, EXCLUDED.expires_at)
        WHERE auth_throttle_buckets.next_allowed_at <= ${now}
        RETURNING id`;
      if (rows.length !== 1) admitted = false;
    }
    return admitted;
  }

  private window(now: Date, windowSeconds: number): { start: Date; expires: Date } {
    const windowMs = windowSeconds * 1_000;
    const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    return { start, expires: new Date(start.getTime() + windowMs) };
  }

  private digests(operation: string, identifier: string): Array<[number, Buffer]> {
    return [...this.environment.auth.throttleKeys]
      .sort(([a], [b]) => a - b)
      .map(([version, key]) => [version, throttleDigest(operation, identifier, key)]);
  }
}

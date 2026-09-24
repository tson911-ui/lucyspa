import type { Prisma } from '@lucy-spa/database';
import { Inject, Injectable } from '@nestjs/common';
import { API_ENVIRONMENT, type ApiEnvironment } from '../platform/tokens.js';
import { assertAuthTransaction } from './auth-store.js';
import { AuthError } from './auth.error.js';
import { throttleDigest } from './crypto.js';

/** Authoritative, bounded fixed-window admission for anonymous context creation. */
@Injectable()
export class ContextThrottleService {
  constructor(@Inject(API_ENVIRONMENT) private readonly environment: ApiEnvironment) {}

  async consume(transaction: Prisma.TransactionClient, peer: string): Promise<void> {
    assertAuthTransaction(transaction);
    const config = this.environment.auth;
    const clock = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = clock[0]?.now;
    if (!now) throw new AuthError('SERVICE_UNAVAILABLE');
    const windowMs = config.contextWindowSeconds * 1_000;
    const start = new Date(Math.floor(now.getTime() / windowMs) * windowMs);
    const expires = new Date(start.getTime() + windowMs);
    // Debit retained versions in stable order. Rotation cannot reset a live budget.
    for (const [version, key] of [...config.throttleKeys].sort(([a], [b]) => a - b)) {
      const digest = throttleDigest('ANONYMOUS_CONTEXT_IP', peer, key);
      const admitted = await transaction.$queryRaw<{ id: string }[]>`
        INSERT INTO auth_throttle_buckets
          (id, operation_bucket, pseudonymous_key, key_version, window_started_at,
           window_seconds, count, expires_at)
        VALUES (gen_random_uuid(), 'ANONYMOUS_CONTEXT_IP', ${digest}, ${version}, ${start},
                ${config.contextWindowSeconds}, 1, ${expires})
        ON CONFLICT (operation_bucket, pseudonymous_key, key_version, window_started_at, window_seconds)
        DO UPDATE SET count = auth_throttle_buckets.count + 1
        WHERE auth_throttle_buckets.count < ${config.contextLimit}
        RETURNING id`;
      if (admitted.length !== 1) throw new AuthError('RATE_LIMITED');
    }
  }
}

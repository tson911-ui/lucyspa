import type { AuthTransactionRunner } from './auth-lock.js';
import { ERASED_DELIVERY } from './auth-delivery.js';

export interface CleanupLimits {
  /** Rows per batch; each batch is its own short transaction. */
  readonly batchSize: number;
  /** Batches per table per run, so one run is bounded even with a large backlog. */
  readonly maxBatches: number;
}

export interface CleanupSummary {
  readonly expiredDeliveries: number;
  readonly deletedChallenges: number;
  readonly deletedDeliveries: number;
  readonly deletedIntents: number;
  readonly deletedAnonymousSessions: number;
}

/**
 * Bounded cleanup of transient authentication data (design section 6): expired
 * delivery ciphertext, terminal or expired challenges with their deliveries, terminal
 * or expired registration intents, and expired anonymous sessions. Running it at
 * least every few hours meets the design's "within 24 hours" deadline for terminal
 * intents/challenges.
 *
 * Never touched: Users, profiles, memberships, roles, audit events, outbox history,
 * throttle buckets and authenticated sessions. Rows are picked with FOR UPDATE SKIP
 * LOCKED, so a row a live request or delivery is holding waits for a later run.
 * Idempotent: rerunning finds nothing more to do.
 */
export class AuthCleanup {
  constructor(private readonly transactions: AuthTransactionRunner) {}

  async run(limits: CleanupLimits): Promise<CleanupSummary> {
    const batchSize = Math.max(1, Math.floor(limits.batchSize));
    const maxBatches = Math.max(1, Math.floor(limits.maxBatches));
    const repeat = async (batch: () => Promise<number>): Promise<number> => {
      let total = 0;
      for (let index = 0; index < maxBatches; index += 1) {
        const count = await batch();
        total += count;
        if (count < batchSize) break;
      }
      return total;
    };
    const expiredDeliveries = await repeat(() => this.expireDeliveries(batchSize));
    let deletedDeliveries = 0;
    const deletedChallenges = await repeat(async () => {
      const result = await this.deleteChallenges(batchSize);
      deletedDeliveries += result.deliveries;
      return result.challenges;
    });
    const deletedIntents = await repeat(() => this.deleteIntents(batchSize));
    const deletedAnonymousSessions = await repeat(() => this.deleteAnonymousSessions(batchSize));
    return {
      expiredDeliveries,
      deletedChallenges,
      deletedDeliveries,
      deletedIntents,
      deletedAnonymousSessions,
    };
  }

  /** PENDING deliveries past their deadline: mark EXPIRED and erase ciphertext. */
  private expireDeliveries(batchSize: number): Promise<number> {
    return this.transactions.withTransaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM auth_deliveries
        WHERE state = 'PENDING' AND expires_at <= clock_timestamp()
          AND (lease_until IS NULL OR lease_until <= clock_timestamp())
        ORDER BY expires_at, id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const result = await tx.authDelivery.updateMany({
        where: { id: { in: rows.map((row) => row.id) }, state: 'PENDING' },
        data: { state: 'EXPIRED', ...ERASED_DELIVERY },
      });
      return result.count;
    });
  }

  /**
   * Consumed, invalidated or flow-expired challenges, excluding any whose delivery is
   * currently leased to a sender. Their delivery rows go first (restrictive FK).
   */
  private deleteChallenges(batchSize: number): Promise<{ challenges: number; deliveries: number }> {
    return this.transactions.withTransaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT c.id::text AS id FROM auth_challenges c
        WHERE (c.consumed_at IS NOT NULL OR c.invalidated_at IS NOT NULL
               OR c.flow_expires_at <= clock_timestamp())
          AND NOT EXISTS (
            SELECT 1 FROM auth_deliveries d
            WHERE d.challenge_id = c.id AND d.state = 'PENDING'
              AND d.lease_until IS NOT NULL AND d.lease_until > clock_timestamp())
        ORDER BY c.flow_expires_at, c.id
        LIMIT ${batchSize}
        FOR UPDATE OF c SKIP LOCKED`;
      if (rows.length === 0) return { challenges: 0, deliveries: 0 };
      const ids = rows.map((row) => row.id);
      const deliveries = await tx.authDelivery.deleteMany({ where: { challengeId: { in: ids } } });
      const challenges = await tx.authChallenge.deleteMany({ where: { id: { in: ids } } });
      return { challenges: challenges.count, deliveries: deliveries.count };
    });
  }

  /** Completed, invalidated or expired intents that no challenge still references. */
  private deleteIntents(batchSize: number): Promise<number> {
    return this.transactions.withTransaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT i.id::text AS id FROM registration_intents i
        WHERE (i.completed_at IS NOT NULL OR i.invalidated_at IS NOT NULL
               OR i.expires_at <= clock_timestamp())
          AND NOT EXISTS (SELECT 1 FROM auth_challenges c WHERE c.registration_intent_id = i.id)
        ORDER BY i.expires_at, i.id
        LIMIT ${batchSize}
        FOR UPDATE OF i SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const result = await tx.registrationIntent.deleteMany({
        where: { id: { in: rows.map((row) => row.id) } },
      });
      return result.count;
    });
  }

  /** Anonymous (pre-authentication) sessions past their absolute expiry only. */
  private deleteAnonymousSessions(batchSize: number): Promise<number> {
    return this.transactions.withTransaction(async (tx) => {
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT id::text AS id FROM sessions
        WHERE kind = 'ANONYMOUS' AND absolute_expires_at <= clock_timestamp()
        ORDER BY absolute_expires_at, id
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED`;
      if (rows.length === 0) return 0;
      const result = await tx.session.deleteMany({
        where: { id: { in: rows.map((row) => row.id) }, kind: 'ANONYMOUS', userId: null },
      });
      return result.count;
    });
  }
}

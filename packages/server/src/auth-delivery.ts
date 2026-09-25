import { randomBytes } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import {
  AuthEmailSendError,
  parseAuthEmailEnvelope,
  renderAuthEmail,
  type AuthEmailMessage,
  type AuthEmailTransport,
} from './auth-email.js';
import type { AuthTransactionRunner } from './auth-lock.js';
import { openDeliveryPayload } from './delivery-crypto.js';

export const AUTH_EMAIL_EVENT_TYPE = 'auth.email_delivery.requested';
export const AUTH_EMAIL_EVENT_VERSION = 1;

/** Existing Phase 1 retry semantics: bounded attempts, exponential backoff, code expiry. */
export const DELIVERY_POLICY = Object.freeze({
  maxAttempts: 5,
  leaseMs: 30_000,
  retryBaseMs: 15_000,
} as const);

export type DeliveryOutcome =
  'DELIVERED' | 'RETRY_SCHEDULED' | 'FAILED' | 'INVALIDATED' | 'EXPIRED' | 'SKIPPED';

/** Rows erased whenever a delivery leaves PENDING: ciphertext, key version and lease. */
export const ERASED_DELIVERY = {
  encryptedPayload: null,
  nonce: null,
  tag: null,
  keyVersion: null,
  leaseToken: null,
  leaseUntil: null,
} as const;

export interface DeliveryKeys {
  readonly deliveryKeys?: ReadonlyMap<number, Uint8Array> | undefined;
}

async function databaseNow(transaction: Prisma.TransactionClient): Promise<Date> {
  const rows = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new Error('Database clock unavailable.');
  return now;
}

/**
 * Sends one delivery by ID. Claim and completion are short transactions; the provider
 * call happens outside any transaction under a lease, so concurrent workers skip a
 * leased row. Retries resend the same code with the same idempotency key and never
 * generate a new OTP. Plaintext exists only in memory between claim and send.
 */
export class AuthDeliveryProcessor {
  constructor(
    private readonly transactions: AuthTransactionRunner,
    private readonly keys: DeliveryKeys,
    private readonly transport: AuthEmailTransport,
  ) {}

  async deliver(deliveryId: string): Promise<DeliveryOutcome> {
    const claimed = await this.transactions.withTransaction((tx) => this.claim(tx, deliveryId));
    if (typeof claimed === 'string') return claimed;
    let providerMessageId: string | null = null;
    let failure: { safeCode: string; permanent: boolean } | null = null;
    try {
      const result = await this.transport.send(
        { ...claimed.message, ...renderAuthEmail(claimed.message) },
        deliveryId,
      );
      providerMessageId =
        typeof result.providerMessageId === 'string'
          ? result.providerMessageId.slice(0, 256)
          : null;
    } catch (error) {
      // Provider errors may echo recipients or content; keep only a safe classification.
      failure =
        error instanceof AuthEmailSendError
          ? { safeCode: error.safeCode, permanent: error.permanent }
          : { safeCode: 'PROVIDER_UNAVAILABLE', permanent: false };
    }
    return this.transactions.withTransaction((tx) =>
      this.complete(tx, deliveryId, claimed.leaseToken, failure, providerMessageId),
    );
  }

  private async claim(
    transaction: Prisma.TransactionClient,
    deliveryId: string,
  ): Promise<DeliveryOutcome | { message: AuthEmailMessage; leaseToken: Buffer }> {
    await transaction.$queryRaw`SELECT id FROM auth_deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE`;
    const delivery = await transaction.authDelivery.findUnique({
      where: { id: deliveryId },
      include: {
        challenge: {
          select: {
            generation: true,
            consumedAt: true,
            invalidatedAt: true,
            codeExpiresAt: true,
          },
        },
      },
    });
    const now = await databaseNow(transaction);
    if (
      !delivery ||
      delivery.state !== 'PENDING' ||
      delivery.nextAttemptAt > now ||
      (delivery.leaseUntil !== null && delivery.leaseUntil > now)
    ) {
      return 'SKIPPED';
    }
    const { challenge } = delivery;
    if (
      challenge.consumedAt !== null ||
      challenge.invalidatedAt !== null ||
      challenge.generation !== delivery.generation
    ) {
      await this.finish(transaction, deliveryId, { state: 'INVALIDATED' });
      return 'INVALIDATED';
    }
    if (
      now >= delivery.expiresAt ||
      challenge.codeExpiresAt === null ||
      now >= challenge.codeExpiresAt
    ) {
      await this.finish(transaction, deliveryId, { state: 'EXPIRED' });
      return 'EXPIRED';
    }
    const key =
      delivery.keyVersion === null ? undefined : this.keys.deliveryKeys?.get(delivery.keyVersion);
    const plaintext =
      key && delivery.encryptedPayload && delivery.nonce && delivery.tag
        ? openDeliveryPayload(
            {
              ciphertext: Buffer.from(delivery.encryptedPayload),
              nonce: Buffer.from(delivery.nonce),
              tag: Buffer.from(delivery.tag),
            },
            { deliveryId, challengeId: delivery.challengeId, generation: delivery.generation },
            key,
          )
        : null;
    const envelope = plaintext === null ? null : parseAuthEmailEnvelope(plaintext);
    if (envelope === null) {
      await this.finish(transaction, deliveryId, {
        state: 'FAILED',
        safeErrorCode: 'PAYLOAD_UNAVAILABLE',
      });
      return 'FAILED';
    }
    const leaseToken = randomBytes(32);
    await transaction.authDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: { increment: 1 },
        leaseToken: new Uint8Array(leaseToken),
        leaseUntil: new Date(
          Math.min(now.getTime() + DELIVERY_POLICY.leaseMs, delivery.expiresAt.getTime()),
        ),
      },
      select: { id: true },
    });
    return {
      leaseToken,
      message: {
        deliveryId,
        purpose: envelope.purpose,
        to: envelope.to,
        code: envelope.code,
        locale: envelope.locale,
        expiresAt: delivery.expiresAt,
      },
    };
  }

  private async complete(
    transaction: Prisma.TransactionClient,
    deliveryId: string,
    leaseToken: Buffer,
    failure: { safeCode: string; permanent: boolean } | null,
    providerMessageId: string | null,
  ): Promise<DeliveryOutcome> {
    await transaction.$queryRaw`SELECT id FROM auth_deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE`;
    const delivery = await transaction.authDelivery.findUnique({
      where: { id: deliveryId },
      select: { state: true, leaseToken: true, attempts: true, expiresAt: true },
    });
    // Invalidated/expired/cleaned meanwhile: a late email is harmless because
    // verification rechecks the challenge state and generation.
    if (
      !delivery ||
      delivery.state !== 'PENDING' ||
      !delivery.leaseToken ||
      !leaseToken.equals(Buffer.from(delivery.leaseToken))
    ) {
      return 'SKIPPED';
    }
    const now = await databaseNow(transaction);
    if (failure === null) {
      await this.finish(transaction, deliveryId, {
        state: 'DELIVERED',
        deliveredAt: now,
        providerMessageId,
      });
      return 'DELIVERED';
    }
    const retryAt = new Date(
      now.getTime() + DELIVERY_POLICY.retryBaseMs * 2 ** (delivery.attempts - 1),
    );
    if (
      failure.permanent ||
      delivery.attempts >= DELIVERY_POLICY.maxAttempts ||
      retryAt >= delivery.expiresAt
    ) {
      await this.finish(transaction, deliveryId, {
        state: 'FAILED',
        safeErrorCode: failure.permanent ? failure.safeCode : 'RETRIES_EXHAUSTED',
      });
      return 'FAILED';
    }
    await transaction.authDelivery.update({
      where: { id: deliveryId },
      // Existing contract: a retrying delivery records no error code until it is final.
      data: { leaseToken: null, leaseUntil: null, nextAttemptAt: retryAt },
      select: { id: true },
    });
    return 'RETRY_SCHEDULED';
  }

  private async finish(
    transaction: Prisma.TransactionClient,
    deliveryId: string,
    data: Prisma.AuthDeliveryUpdateInput,
  ): Promise<void> {
    await transaction.authDelivery.update({
      where: { id: deliveryId },
      data: { ...data, ...ERASED_DELIVERY },
      select: { id: true },
    });
  }
}

export interface DispatchSummary {
  readonly examined: number;
  readonly outcomes: Readonly<Record<DeliveryOutcome, number>>;
}

/**
 * Polls due PENDING deliveries through the existing claim index (state, nextAttemptAt,
 * leaseUntil) and delivers each with its own claim/complete transactions. Any number of
 * workers may run this: the row lock plus lease make a second claim a no-op (SKIPPED).
 * When a delivery leaves PENDING its outbox event is marked published. Only delivery
 * IDs and outcome counts are ever returned or logged.
 */
export class AuthEmailDispatcher {
  constructor(
    private readonly client: {
      $queryRaw: Prisma.TransactionClient['$queryRaw'];
      outboxEvent: Pick<Prisma.TransactionClient['outboxEvent'], 'updateMany'>;
    },
    private readonly processor: Pick<AuthDeliveryProcessor, 'deliver'>,
  ) {}

  async dispatchDue(limit: number): Promise<DispatchSummary> {
    const due = await this.client.$queryRaw<{ id: string }[]>`
      SELECT id::text AS id FROM auth_deliveries
      WHERE state = 'PENDING'
        AND next_attempt_at <= clock_timestamp()
        AND (lease_until IS NULL OR lease_until <= clock_timestamp())
      ORDER BY next_attempt_at, id
      LIMIT ${limit}`;
    const outcomes: Record<DeliveryOutcome, number> = {
      DELIVERED: 0,
      RETRY_SCHEDULED: 0,
      FAILED: 0,
      INVALIDATED: 0,
      EXPIRED: 0,
      SKIPPED: 0,
    };
    for (const { id } of due) {
      const outcome = await this.processor.deliver(id);
      outcomes[outcome] += 1;
      if (outcome !== 'RETRY_SCHEDULED' && outcome !== 'SKIPPED') {
        await this.client.outboxEvent.updateMany({
          where: {
            aggregateType: 'AuthDelivery',
            aggregateId: id,
            eventType: AUTH_EMAIL_EVENT_TYPE,
            publishedAt: null,
          },
          data: { publishedAt: new Date() },
        });
      }
    }
    return { examined: due.length, outcomes };
  }
}

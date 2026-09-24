import { randomBytes, randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import type { AuthEnvironment } from '@lucy-spa/server';
import { openDeliveryPayload, sealDeliveryPayload } from './crypto.js';

export const AUTH_EMAIL_EVENT_TYPE = 'auth.email_delivery.requested';
export const AUTH_EMAIL_EVENT_VERSION = 1;
const MAX_DELIVERY_ATTEMPTS = 5;
const LEASE_MS = 30_000;
const RETRY_BASE_MS = 15_000;

export type AuthEmailPurpose = 'ACTIVATE_CUSTOMER';

/** Only the recipient and code needed for sending; decrypted by the delivery processor. */
interface AuthEmailEnvelope {
  v: 1;
  purpose: AuthEmailPurpose;
  to: string;
  code: string;
  locale: 'vi' | 'en';
}

export interface AuthEmailMessage {
  readonly deliveryId: string;
  readonly purpose: AuthEmailPurpose;
  readonly to: string;
  readonly code: string;
  readonly locale: 'vi' | 'en';
  readonly expiresAt: Date;
}

/**
 * Provider port. Adapters must pass `idempotencyKey` to the provider where supported,
 * never log the message, and throw on rejection. No provider or credential is bundled.
 */
export interface AuthEmailTransport {
  send(
    message: AuthEmailMessage & { subject: string; text: string },
    idempotencyKey: string,
  ): Promise<{ providerMessageId?: string }>;
}

export function renderAuthEmail(message: AuthEmailMessage): { subject: string; text: string } {
  const minutes = 5;
  return message.locale === 'vi'
    ? {
        subject: 'Mã xác minh Lucy Spa',
        text: `Mã xác minh tài khoản Lucy Spa của bạn là ${message.code}. Mã có hiệu lực trong ${minutes} phút. Nếu bạn không yêu cầu, hãy bỏ qua email này. Lucy Spa không bao giờ hỏi mã này qua điện thoại.`,
      }
    : {
        subject: 'Your Lucy Spa verification code',
        text: `Your Lucy Spa account verification code is ${message.code}. It expires in ${minutes} minutes. If you did not request it, ignore this email. Lucy Spa never asks for this code by phone.`,
      };
}

function keyRing(auth: AuthEnvironment): { version: number; key: Buffer } {
  const version = auth.deliveryActiveVersion;
  const key = version === undefined ? undefined : auth.deliveryKeys?.get(version);
  if (version === undefined || !key) throw new Error('Delivery encryption unavailable.');
  return { version, key };
}

/**
 * Durable email intent in the issuing transaction: encrypted AuthDelivery plus an
 * outbox event carrying only the delivery ID and event version.
 */
export async function enqueueAuthEmail(
  transaction: Prisma.TransactionClient,
  auth: AuthEnvironment,
  input: {
    challengeId: string;
    generation: number;
    now: Date;
    codeExpiresAt: Date;
    to: string;
    code: string;
    locale: 'vi' | 'en';
  },
): Promise<string> {
  const { version, key } = keyRing(auth);
  const deliveryId = randomUUID();
  const envelope: AuthEmailEnvelope = {
    v: 1,
    purpose: 'ACTIVATE_CUSTOMER',
    to: input.to,
    code: input.code,
    locale: input.locale,
  };
  const sealed = sealDeliveryPayload(
    JSON.stringify(envelope),
    { deliveryId, challengeId: input.challengeId, generation: input.generation },
    key,
  );
  await transaction.authDelivery.create({
    data: {
      id: deliveryId,
      challengeId: input.challengeId,
      generation: input.generation,
      state: 'PENDING',
      encryptedPayload: new Uint8Array(sealed.ciphertext),
      nonce: new Uint8Array(sealed.nonce),
      tag: new Uint8Array(sealed.tag),
      keyVersion: version,
      createdAt: input.now,
      expiresAt: input.codeExpiresAt,
      nextAttemptAt: input.now,
    },
    select: { id: true },
  });
  await transaction.outboxEvent.create({
    data: {
      aggregateType: 'AuthDelivery',
      aggregateId: deliveryId,
      eventType: AUTH_EMAIL_EVENT_TYPE,
      schemaVersion: AUTH_EMAIL_EVENT_VERSION,
      payload: { deliveryId, eventVersion: AUTH_EMAIL_EVENT_VERSION },
      occurredAt: input.now,
    },
    select: { id: true },
  });
  return deliveryId;
}

const erased = {
  encryptedPayload: null,
  nonce: null,
  tag: null,
  keyVersion: null,
  leaseToken: null,
  leaseUntil: null,
} as const;

/** Superseded, consumed or invalidated flows erase their undelivered ciphertext. */
export async function invalidatePendingDeliveries(
  transaction: Prisma.TransactionClient,
  challengeIds: readonly string[],
): Promise<void> {
  if (challengeIds.length === 0) return;
  await transaction.authDelivery.updateMany({
    where: { challengeId: { in: [...challengeIds] }, state: 'PENDING' },
    data: { state: 'INVALIDATED', ...erased },
  });
}

export type DeliveryOutcome =
  'DELIVERED' | 'RETRY_SCHEDULED' | 'FAILED' | 'INVALIDATED' | 'EXPIRED' | 'SKIPPED';

interface TransactionRunner {
  withTransaction<T>(work: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T>;
}

/**
 * Sends one delivery by ID (the outbox/queue payload). The provider call happens
 * outside the database transaction under a lease; retries resend the same code with
 * the same idempotency key and never generate a new OTP. Not scheduled until an
 * email provider and dispatcher are configured in a later step.
 */
export class AuthDeliveryProcessor {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly auth: AuthEnvironment,
    private readonly transport: AuthEmailTransport,
  ) {}

  async deliver(deliveryId: string): Promise<DeliveryOutcome> {
    const claimed = await this.transactions.withTransaction((tx) => this.claim(tx, deliveryId));
    if (typeof claimed === 'string') return claimed;
    let providerMessageId: string | null = null;
    let sent = false;
    try {
      const result = await this.transport.send(
        { ...claimed.message, ...renderAuthEmail(claimed.message) },
        deliveryId,
      );
      providerMessageId =
        typeof result.providerMessageId === 'string'
          ? result.providerMessageId.slice(0, 256)
          : null;
      sent = true;
    } catch {
      // Provider errors may echo recipients or content; record only a safe code.
    }
    return this.transactions.withTransaction((tx) =>
      this.complete(tx, deliveryId, claimed.leaseToken, sent, providerMessageId),
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
    const now = await this.now(transaction);
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
      delivery.keyVersion === null ? undefined : this.auth.deliveryKeys?.get(delivery.keyVersion);
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
    const envelope = plaintext === null ? null : parseEnvelope(plaintext);
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
        leaseUntil: new Date(Math.min(now.getTime() + LEASE_MS, delivery.expiresAt.getTime())),
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
    sent: boolean,
    providerMessageId: string | null,
  ): Promise<DeliveryOutcome> {
    await transaction.$queryRaw`SELECT id FROM auth_deliveries WHERE id = ${deliveryId}::uuid FOR UPDATE`;
    const delivery = await transaction.authDelivery.findUnique({
      where: { id: deliveryId },
      select: { state: true, leaseToken: true, attempts: true, expiresAt: true },
    });
    // Invalidated/expired meanwhile: a late email is harmless because verification
    // rechecks the challenge state and generation.
    if (
      !delivery ||
      delivery.state !== 'PENDING' ||
      !delivery.leaseToken ||
      !leaseToken.equals(Buffer.from(delivery.leaseToken))
    ) {
      return 'SKIPPED';
    }
    const now = await this.now(transaction);
    if (sent) {
      await this.finish(transaction, deliveryId, {
        state: 'DELIVERED',
        deliveredAt: now,
        providerMessageId,
      });
      return 'DELIVERED';
    }
    const retryAt = new Date(now.getTime() + RETRY_BASE_MS * 2 ** (delivery.attempts - 1));
    if (delivery.attempts >= MAX_DELIVERY_ATTEMPTS || retryAt >= delivery.expiresAt) {
      await this.finish(transaction, deliveryId, {
        state: 'FAILED',
        safeErrorCode: 'PROVIDER_REJECTED',
      });
      return 'FAILED';
    }
    await transaction.authDelivery.update({
      where: { id: deliveryId },
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
      data: { ...data, ...erased },
      select: { id: true },
    });
  }

  private async now(transaction: Prisma.TransactionClient): Promise<Date> {
    const rows = await transaction.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
    const now = rows[0]?.now;
    if (!(now instanceof Date)) throw new Error('Database clock unavailable.');
    return now;
  }
}

function parseEnvelope(plaintext: string): AuthEmailEnvelope | null {
  try {
    const value = JSON.parse(plaintext) as Partial<AuthEmailEnvelope>;
    return value.v === 1 &&
      value.purpose === 'ACTIVATE_CUSTOMER' &&
      typeof value.to === 'string' &&
      typeof value.code === 'string' &&
      /^[0-9]{6}$/.test(value.code) &&
      (value.locale === 'vi' || value.locale === 'en')
      ? (value as AuthEmailEnvelope)
      : null;
  } catch {
    return null;
  }
}

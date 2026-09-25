import { randomUUID } from 'node:crypto';
import type { Prisma } from '@lucy-spa/database';
import {
  AUTH_EMAIL_EVENT_TYPE,
  AUTH_EMAIL_EVENT_VERSION,
  ERASED_DELIVERY,
  sealDeliveryPayload,
  type AuthEmailEnvelope,
  type AuthEmailPurpose,
  type AuthEnvironment,
} from '@lucy-spa/server';

// The processor, templates and transport port live in @lucy-spa/server so the worker
// can dispatch; these re-exports keep existing API imports stable.
export {
  AUTH_EMAIL_EVENT_TYPE,
  AUTH_EMAIL_EVENT_VERSION,
  AuthDeliveryProcessor,
  renderAuthEmail,
  type AuthEmailMessage,
  type AuthEmailPurpose,
  type AuthEmailTransport,
  type DeliveryOutcome,
} from '@lucy-spa/server';

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
    purpose?: AuthEmailPurpose;
  },
): Promise<string> {
  const { version, key } = keyRing(auth);
  const deliveryId = randomUUID();
  const envelope: AuthEmailEnvelope = {
    v: 1,
    purpose: input.purpose ?? 'ACTIVATE_CUSTOMER',
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

/** Superseded, consumed or invalidated flows erase their undelivered ciphertext. */
export async function invalidatePendingDeliveries(
  transaction: Prisma.TransactionClient,
  challengeIds: readonly string[],
): Promise<void> {
  if (challengeIds.length === 0) return;
  await transaction.authDelivery.updateMany({
    where: { challengeId: { in: [...challengeIds] }, state: 'PENDING' },
    data: { state: 'INVALIDATED', ...ERASED_DELIVERY },
  });
}

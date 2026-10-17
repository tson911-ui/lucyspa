import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import {
  accountDeletionEmailBinding,
  openDeliveryPayload,
  parseAccountDeletionEmailEnvelope,
  parseApiEnvironment,
} from '@lucy-spa/server';
import {
  comboSessionsLeft,
  DELETED_ACCOUNT_NAME,
  eraseCustomerAccount,
  unfinishedOrderKind,
} from './account-deletion.core.js';

test('an order stops the deletion while it is not finished (reading pending Owner confirmation)', () => {
  const online = (queueState: string | null, invoiceStatus = 'PAID') =>
    unfinishedOrderKind({ channel: 'ONLINE', invoiceStatus, queueState, lineStatuses: [] });
  assert.equal(online('UNPAID', 'PENDING_PAYMENT'), 'ONLINE_UNPAID');
  assert.equal(online('UNPAID', 'CANCELLED'), null, 'an unpaid order that was cancelled is over');
  for (const state of ['TO_SHIP', 'WAITING_GOODS', 'SHIPPED', 'DELIVERY_FAILED']) {
    assert.equal(online(state), 'ONLINE_IN_PROGRESS', state);
  }
  assert.equal(online('DONE'), null);
  assert.equal(online('CANCELLED'), null);
  const counter = (lineStatuses: string[]) =>
    unfinishedOrderKind({
      channel: 'COUNTER',
      invoiceStatus: 'PAID',
      queueState: null,
      lineStatuses,
    });
  for (const status of ['AWAITING_PAYMENT', 'PAID', 'ORDERED', 'ARRIVED']) {
    assert.equal(counter(['COMPLETED', status]), 'COUNTER_PREORDER', status);
  }
  assert.equal(counter(['HANDED_OVER', 'COMPLETED', 'CANCELLED']), null);
});

test('prepaid sessions count only while the combo can still be used (Owner answer 3)', () => {
  const now = new Date('2026-10-16T03:00:00Z');
  const base = { usable: true, freeSessions: 3, expiresAt: null, now };
  assert.equal(comboSessionsLeft(base), 3);
  assert.equal(comboSessionsLeft({ ...base, expiresAt: new Date('2026-12-31T00:00:00Z') }), 3);
  assert.equal(comboSessionsLeft({ ...base, expiresAt: now }), 0, 'expired');
  assert.equal(comboSessionsLeft({ ...base, usable: false }), 0, 'paused by a reversed sale');
  assert.equal(comboSessionsLeft({ ...base, freeSessions: 0 }), 0, 'used up');
});

test('the erasure writes the account before the sealed email, keeps the address out of plaintext and reports counts only', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  const environment = parseApiEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'http://localhost:3000',
    AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
    AUTH_CSRF_KEYS: ring(),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: ring(),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
    AUTH_DELIVERY_KEYS: ring(),
    AUTH_DELIVERY_ACTIVE_VERSION: '1',
  });
  const userId = randomUUID();
  const now = new Date('2026-10-16T03:00:00.000Z');
  const log: { op: string; args: Record<string, unknown> }[] = [];
  const step =
    (op: string, result: unknown = { count: 0 }) =>
    (args: Record<string, unknown>) => {
      log.push({ op, args });
      return Promise.resolve(result);
    };
  const tx = {
    productOrder: {
      findMany: step('productOrder.findMany', [{ id: 'order-unpaid' }]),
      updateMany: step('productOrder.updateMany', { count: 1 }),
    },
    user: { update: step('user.update', { id: userId }) },
    customerProfile: { updateMany: step('customerProfile.updateMany', { count: 1 }) },
    onlineOrderDetail: { updateMany: step('onlineOrderDetail.updateMany', { count: 1 }) },
    session: { updateMany: step('session.updateMany', { count: 2 }) },
    authChallenge: {
      findMany: step('authChallenge.findMany', [{ id: 'flow-1' }]),
      updateMany: step('authChallenge.updateMany', { count: 1 }),
    },
    authDelivery: { updateMany: step('authDelivery.updateMany', { count: 1 }) },
    customerAddress: { deleteMany: step('customerAddress.deleteMany', { count: 1 }) },
    onlineCart: { deleteMany: step('onlineCart.deleteMany', { count: 1 }) },
    notification: { updateMany: step('notification.updateMany', { count: 3 }) },
    accountDeletionEmail: { create: step('accountDeletionEmail.create', { id: 'x' }) },
    outboxEvent: { create: step('outboxEvent.create', { id: 'y' }) },
  } as unknown as Prisma.TransactionClient;

  const summary = await eraseCustomerAccount(tx, {
    user: { id: userId, emailDelivery: 'Lan@Example.com', preferredLocale: 'vi' },
    bookingsToCancel: [],
    now,
    auth: environment.auth,
  });
  assert.deepEqual(summary, {
    bookingsCancelled: 0,
    ordersErased: 1,
    addressesDeleted: 1,
    sessionsRevoked: 2,
    notificationsArchived: 3,
    emailQueued: true,
  });
  const order = log.map((entry) => entry.op);
  const at = (op: string) => order.indexOf(op);
  // The database accepts the order and profile erasure only for a deleted account, and the sealed row only after it.
  assert.ok(at('user.update') < at('customerProfile.updateMany'));
  assert.ok(at('user.update') < at('onlineOrderDetail.updateMany'));
  assert.ok(at('user.update') < at('productOrder.updateMany'));
  assert.ok(at('user.update') < at('accountDeletionEmail.create'));

  const erased = log.find((entry) => entry.op === 'user.update')!.args['data'] as Record<
    string,
    unknown
  >;
  assert.equal(erased['fullName'], DELETED_ACCOUNT_NAME);
  for (const field of [
    'emailCanonical',
    'emailDelivery',
    'emailVerifiedAt',
    'phoneCanonical',
    'passwordHash',
  ]) {
    assert.equal(erased[field], null, field);
  }
  assert.equal(erased['status'], 'INACTIVE');
  assert.equal(erased['deletedAt'], now);
  assert.deepEqual(erased['credentialVersion'], { increment: 1 });

  // Only never-paid, cancelled online orders of this account lose the recipient (Owner answer 3).
  const picked = log.find((entry) => entry.op === 'productOrder.findMany')!.args['where'];
  assert.deepEqual(picked, {
    customerUserId: userId,
    channel: 'ONLINE',
    contactPhone: { not: null },
    invoice: { paidSeq: 0, status: 'CANCELLED' },
  });

  // The sealed row opens with its own binding to exactly the envelope; the outbox event carries the row id only.
  const created = log.find((entry) => entry.op === 'accountDeletionEmail.create')!.args['data'] as {
    id: string;
    encryptedPayload: Uint8Array;
    nonce: Uint8Array;
    tag: Uint8Array;
    keyVersion: number;
    userId: string;
  };
  assert.equal(created.userId, userId);
  const plaintext = openDeliveryPayload(
    {
      ciphertext: Buffer.from(created.encryptedPayload),
      nonce: Buffer.from(created.nonce),
      tag: Buffer.from(created.tag),
    },
    accountDeletionEmailBinding(created.id),
    environment.auth.deliveryKeys!.get(created.keyVersion)!,
  );
  assert.deepEqual(parseAccountDeletionEmailEnvelope(plaintext!), {
    v: 1,
    kind: 'ACCOUNT_DELETED',
    to: 'Lan@Example.com',
    locale: 'vi',
    deletedAt: now.toISOString(),
  });
  const outbox = log.find((entry) => entry.op === 'outboxEvent.create')!.args['data'];
  assert.doesNotMatch(JSON.stringify(outbox), /@|Lan/i);
  assert.match(JSON.stringify(outbox), new RegExp(created.id));
});

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import {
  AuthEmailSendError,
  accountDeletionEmailBinding,
  parseAccountDeletionEmailEnvelope,
  sealDeliveryPayload,
  type AccountDeletionEmailEnvelope,
  type AuthTransactionRunner,
} from '@lucy-spa/server';
import {
  AccountDeletionEmailProcessor,
  dispatchAccountDeletionEmails,
  renderAccountDeletedEmail,
} from './account-deletion-email.js';

// 2026-10-16 18:30 UTC is already 17/10/2026 in Vietnam: the date is the spa's local day.
const DELETED_AT = new Date('2026-10-16T18:30:00.000Z');

test('the confirmation email states the fact and the Vietnam date, in Vietnamese and English, with no link or personal data', () => {
  const vi = renderAccountDeletedEmail('vi', DELETED_AT);
  assert.equal(vi.subject, 'Lucy Spa – Tài khoản của bạn đã được xóa');
  assert.match(vi.text, /đã được xóa vào ngày 17\/10\/2026\./);
  assert.match(vi.text, /Hóa đơn và thanh toán trước đây/);
  assert.match(vi.html, /<html lang="vi">/);
  const en = renderAccountDeletedEmail('en', DELETED_AT);
  assert.equal(en.subject, 'Lucy Spa – Your account was deleted');
  assert.match(en.text, /deleted on 17\/10\/2026\./);
  assert.match(en.html, /<html lang="en">/);
  for (const message of [vi, en]) {
    assert.doesNotMatch(
      message.html,
      /<a\s|href=|<img|<script|https?:/i,
      'no link, image or script',
    );
    assert.doesNotMatch(message.text, /https?:|@/, 'no link and no address in the body');
    assert.doesNotMatch(`${message.text}${message.html}`, /khám/i);
  }
});

test('the sealed envelope is strict: only the deletion kind, an address, a language and a date', () => {
  const good: AccountDeletionEmailEnvelope = {
    v: 1,
    kind: 'ACCOUNT_DELETED',
    to: 'lan@example.com',
    locale: 'vi',
    deletedAt: DELETED_AT.toISOString(),
  };
  assert.deepEqual(parseAccountDeletionEmailEnvelope(JSON.stringify(good)), good);
  for (const bad of [
    { ...good, v: 2 },
    { ...good, kind: 'RESET_PASSWORD' },
    { ...good, to: 'no-address' },
    { ...good, locale: 'fr' },
    { ...good, deletedAt: 'yesterday' },
  ]) {
    assert.equal(parseAccountDeletionEmailEnvelope(JSON.stringify(bad)), null);
  }
  assert.equal(parseAccountDeletionEmailEnvelope('{not json'), null);
});

interface Row {
  id: string;
  state: string;
  encryptedPayload: Uint8Array | null;
  nonce: Uint8Array | null;
  tag: Uint8Array | null;
  keyVersion: number | null;
  expiresAt: Date;
  attempts: number;
  nextAttemptAt: Date;
  leaseToken: Uint8Array | null;
  leaseUntil: Date | null;
  deliveredAt: Date | null;
  providerMessageId: string | null;
  safeErrorCode: string | null;
}

/** An in-memory stand-in for the two short transactions of the processor. */
function fakeStore(row: Row) {
  const tx = {
    $queryRaw: (strings: TemplateStringsArray) =>
      Promise.resolve(strings.join('').includes('clock_timestamp') ? [{ now: new Date() }] : []),
    accountDeletionEmail: {
      findUnique: () => Promise.resolve({ ...row }),
      update: ({ data }: { data: Record<string, unknown> }) => {
        for (const [key, value] of Object.entries(data)) {
          const current = (row as unknown as Record<string, unknown>)[key];
          (row as unknown as Record<string, unknown>)[key] =
            value !== null && typeof value === 'object' && 'increment' in value
              ? (current as number) + (value as { increment: number }).increment
              : value;
        }
        return Promise.resolve({ id: row.id });
      },
    },
  } as unknown as Prisma.TransactionClient;
  const runner: AuthTransactionRunner = {
    withTransaction: <T>(work: (client: Prisma.TransactionClient) => Promise<T>) => work(tx),
  } as AuthTransactionRunner;
  return runner;
}

function sealedRow(key: Buffer, to = 'lan@example.com', bindingId?: string): Row {
  const id = randomUUID();
  const sealed = sealDeliveryPayload(
    JSON.stringify({
      v: 1,
      kind: 'ACCOUNT_DELETED',
      to,
      locale: 'en',
      deletedAt: DELETED_AT.toISOString(),
    }),
    accountDeletionEmailBinding(bindingId ?? id),
    key,
  );
  return {
    id,
    state: 'PENDING',
    encryptedPayload: new Uint8Array(sealed.ciphertext),
    nonce: new Uint8Array(sealed.nonce),
    tag: new Uint8Array(sealed.tag),
    keyVersion: 1,
    expiresAt: new Date(Date.now() + 86_400_000),
    attempts: 0,
    nextAttemptAt: new Date(Date.now() - 1_000),
    leaseToken: null,
    leaseUntil: null,
    deliveredAt: null,
    providerMessageId: null,
    safeErrorCode: null,
  };
}

const erased = (row: Row) =>
  row.encryptedPayload === null &&
  row.nonce === null &&
  row.tag === null &&
  row.keyVersion === null &&
  row.leaseToken === null &&
  row.leaseUntil === null;

test('a sealed row is opened, sent once to its address and erased when delivered', async () => {
  const key = randomBytes(32);
  const row = sealedRow(key);
  const sent: { to: string; subject: string; text: string; html: string; key: string }[] = [];
  const processor = new AccountDeletionEmailProcessor(
    fakeStore(row),
    { deliveryKeys: new Map([[1, key]]) },
    {
      send: (message, idempotencyKey) => {
        sent.push({ ...message, key: idempotencyKey });
        return Promise.resolve({ providerMessageId: 'provider-1' });
      },
    },
  );
  assert.equal(await processor.deliver(row.id), 'DELIVERED');
  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.to, 'lan@example.com');
  assert.equal(sent[0]?.subject, 'Lucy Spa – Your account was deleted');
  assert.equal(sent[0]?.key, row.id, 'the row id is the idempotency key');
  assert.equal(row.state, 'DELIVERED');
  assert.ok(erased(row), 'no ciphertext is kept once the row leaves PENDING');
  assert.equal(row.attempts, 1);
  // Delivered: a second run finds nothing to send.
  assert.equal(await processor.deliver(row.id), 'SKIPPED');
  assert.equal(sent.length, 1);
});

test('a payload sealed for another row, or with an unknown key, fails closed and is erased', async () => {
  const key = randomBytes(32);
  for (const [row, keys] of [
    [sealedRow(key, 'lan@example.com', randomUUID()), new Map([[1, key]])],
    [sealedRow(key), new Map([[1, randomBytes(32)]])],
  ] as const) {
    let sends = 0;
    const processor = new AccountDeletionEmailProcessor(
      fakeStore(row),
      { deliveryKeys: keys },
      {
        send: () => {
          sends += 1;
          return Promise.resolve({});
        },
      },
    );
    assert.equal(await processor.deliver(row.id), 'FAILED');
    assert.equal(sends, 0);
    assert.equal(row.safeErrorCode, 'PAYLOAD_UNAVAILABLE');
    assert.ok(erased(row));
  }
});

test('a passing provider failure is retried later; a permanent one ends the row with a safe code only', async () => {
  const key = randomBytes(32);
  const transient = sealedRow(key);
  const retrying = new AccountDeletionEmailProcessor(
    fakeStore(transient),
    { deliveryKeys: new Map([[1, key]]) },
    { send: () => Promise.reject(new Error('socket closed for lan@example.com')) },
  );
  assert.equal(await retrying.deliver(transient.id), 'RETRY_SCHEDULED');
  assert.equal(transient.state, 'PENDING');
  assert.ok(transient.encryptedPayload !== null, 'kept sealed for the next attempt');
  assert.equal(transient.leaseToken, null);
  assert.ok(transient.nextAttemptAt.getTime() > Date.now());

  const permanent = sealedRow(key);
  const refused = new AccountDeletionEmailProcessor(
    fakeStore(permanent),
    { deliveryKeys: new Map([[1, key]]) },
    { send: () => Promise.reject(new AuthEmailSendError('RECIPIENT_REJECTED', true)) },
  );
  assert.equal(await refused.deliver(permanent.id), 'FAILED');
  assert.equal(permanent.safeErrorCode, 'RECIPIENT_REJECTED');
  assert.ok(erased(permanent));
});

test('the dispatcher sends due rows and marks the outbox event of a finished row published', async () => {
  const marked: unknown[] = [];
  const summary = await dispatchAccountDeletionEmails(
    {
      $queryRaw: (() => Promise.resolve([{ id: 'a' }, { id: 'b' }])) as never,
      outboxEvent: {
        updateMany: ((args: unknown) => {
          marked.push(args);
          return Promise.resolve({ count: 1 });
        }) as never,
      },
    },
    { deliver: (id: string) => Promise.resolve(id === 'a' ? 'DELIVERED' : 'RETRY_SCHEDULED') },
    25,
  );
  assert.equal(summary.examined, 2);
  assert.equal(summary.outcomes.DELIVERED, 1);
  assert.equal(summary.outcomes.RETRY_SCHEDULED, 1);
  assert.equal(marked.length, 1, 'only the finished row');
  assert.match(
    JSON.stringify(marked[0]),
    /"aggregateType":"AccountDeletionEmail","aggregateId":"a"/,
  );
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { listOwnNotifications, NotificationService, parseNotificationCursor, readOwnNotification } from './notification.service.js';

test('inbox is bounded and projects only own safe fields, with timestamp/UUID pagination', async () => {
  const userId = randomUUID(); const id = randomUUID(); const now = new Date('2030-01-02T10:00:00.000Z');
  let query: unknown;
  const row = { id, type: 'START_OVERDUE', entityType: 'Visit', entityId: randomUUID(), contextCode: 'VS-9',
    actionAt: now, createdAt: now, readAt: null, recipientUserId: userId, sourceEventId: randomUUID(),
    branch: { id: randomUUID(), name: 'Branch', timezone: 'UTC' } };
  const tx = { notification: {
    findMany: async (input: unknown) => { query = input; return [row]; },
    count: async (input: unknown) => { assert.deepEqual(input, { where: { recipientUserId: userId, readAt: null } }); return 1; },
  } } as unknown as Prisma.TransactionClient;
  const page = await listOwnNotifications(tx, userId, `${now.toISOString()}~${id}`);
  assert.equal(page.unreadCount, 1); assert.equal(page.nextCursor, null);
  assert.equal(Reflect.get(Object(query), 'take'), 31);
  assert.equal(Reflect.get(Object(Reflect.get(Object(query), 'where')), 'recipientUserId'), userId);
  assert.ok(!('recipientUserId' in page.items[0]!)); assert.ok(!('sourceEventId' in page.items[0]!));
  assert.ok(!('payload' in page.items[0]!));
  assert.throws(() => parseNotificationCursor('bad'), (error) => error instanceof AuthError && error.code === 'VALIDATION_FAILED');
});
test('read is own-only, idempotent and uses database time; foreign and missing IDs are indistinguishable', async () => {
  const userId = randomUUID(); const id = randomUUID(); const now = new Date();
  const tx = { $queryRaw: async () => [{ now }], notification: {
    updateMany: async (input: unknown) => {
      assert.deepEqual(input, { where: { id, recipientUserId: userId, readAt: null }, data: { readAt: now } }); return { count: 0 };
    }, findFirst: async (input: unknown) => {
      assert.deepEqual(Reflect.get(Object(input), 'where'), { id, recipientUserId: userId }); return null;
    },
  } } as unknown as Prisma.TransactionClient;
  await assert.rejects(readOwnNotification(tx, userId, id), (error) => error instanceof AuthError && error.code === 'NOT_FOUND');
});
test('missing or expired authentication never reaches inbox storage', async () => {
  let calls = 0;
  const service = new NotificationService({
    withTransaction: async (work) => { calls++; return work({} as Prisma.TransactionClient); },
    resolveForMutation: async () => null,
  });
  await assert.rejects(service.list(undefined), (error) => error instanceof AuthError && error.code === 'AUTHENTICATION_REQUIRED');
  assert.equal(calls, 0);
  await assert.rejects(service.list('expired'), (error) => error instanceof AuthError && error.code === 'AUTHENTICATION_REQUIRED');
  assert.equal(calls, 1);
});

test('mark-read returns authoritative state and an idempotent repeat preserves the first timestamp', async () => {
  const userId = randomUUID(); const id = randomUUID();
  const first = new Date('2030-01-02T10:00:00.000Z');
  let readAt: Date | null = null; let currentTime = first;
  const tx = { $queryRaw: async () => [{ now: currentTime }], notification: {
    updateMany: async () => { if (readAt === null) readAt = currentTime; return { count: 1 }; },
    findFirst: async () => ({ id, type: 'PRE_END', entityType: 'Visit', entityId: randomUUID(), contextCode: 'VS-9',
      actionAt: first, createdAt: first, readAt, branch: { id: randomUUID(), name: 'Branch', timezone: 'UTC' } }),
  } } as unknown as Prisma.TransactionClient;
  assert.equal((await readOwnNotification(tx, userId, id)).readAt, first.toISOString());
  currentTime = new Date(first.getTime() + 60_000);
  assert.equal((await readOwnNotification(tx, userId, id)).readAt, first.toISOString());
});

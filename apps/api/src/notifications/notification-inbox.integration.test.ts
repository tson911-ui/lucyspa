import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import {
  archiveOwnNotification,
  countOwnUnread,
  listOwnNotifications,
  readAllOwnNotifications,
  readOwnNotification,
} from './notification.service.js';

// Explicit opt-in: ordinary unit tests do not connect to PostgreSQL. All fixtures roll back.
test(
  'inbox: ownership isolation, filters, counts, read, read-all and archive against PostgreSQL',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toLowerCase();
    const rollback = new Error('Intentional inbox rollback');
    try {
      await database.$connect();
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const user = async (label: string) =>
              (
                await tx.user.create({
                  data: {
                    kind: 'CUSTOMER',
                    status: 'ACTIVE',
                    fullName: `Inbox ${label}`,
                    preferredLocale: 'vi',
                    emailCanonical: `inbox-${label}-${run}@example.com`,
                    emailDelivery: `inbox-${label}-${run}@example.com`,
                    emailVerifiedAt: new Date(),
                    normalizationVersion: 1,
                    passwordHash: '$argon2id$fixture',
                    phoneCanonical: `+84918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                    customerProfile: {
                      create: { dateOfBirth: new Date('1990-01-01'), address: 'x' },
                    },
                  },
                })
              ).id;
            const a = await user('a');
            const b = await user('b');
            const branch = await tx.branch.create({
              data: { code: `IB-${run}`, name: 'Inbox branch' },
            });
            let step = 0;
            const notify = async (
              recipient: string,
              type: string,
              extra: {
                entity?: 'Booking' | 'Visit' | 'LeaveRequest';
                branch?: boolean;
                read?: boolean;
                archived?: boolean;
                params?: object;
              } = {},
            ) => {
              const event = await tx.outboxEvent.create({
                data: {
                  aggregateType: 'Booking',
                  aggregateId: randomUUID(),
                  eventType: 'BOOKING_CREATED',
                  payload: {},
                },
              });
              const leave = type.startsWith('LEAVE_');
              step += 1;
              return tx.notification.create({
                data: {
                  recipientUserId: recipient,
                  sourceEventId: event.id,
                  branchId: leave ? null : branch.id,
                  type,
                  entityType: extra.entity ?? (leave ? 'LeaveRequest' : 'Booking'),
                  entityId: randomUUID(),
                  contextCode: `C-${step}`,
                  actionAt: new Date(Date.UTC(2030, 0, 1, 0, step)),
                  createdAt: new Date(Date.UTC(2030, 0, 1, 0, step)),
                  ...(extra.read ? { readAt: new Date() } : {}),
                  ...(extra.archived ? { archivedAt: new Date() } : {}),
                  ...(extra.params ? { params: extra.params } : {}),
                },
              });
            };
            const requested = {
              subjectUserId: b,
              startDate: '2030-03-10',
              endDate: '2030-03-12',
              leaveType: 'ANNUAL',
            };
            const decided = {
              decision: 'APPROVED',
              startDate: '2030-03-10',
              endDate: '2030-03-12',
              leaveType: 'ANNUAL',
            };
            const n1 = await notify(a, 'BOOKING_CREATED');
            const n2 = await notify(a, 'START_OVERDUE', { entity: 'Visit', read: true });
            const n3 = await notify(a, 'LEAVE_REQUESTED', { params: requested });
            const n4 = await notify(a, 'LEAVE_DECIDED', { params: decided });
            const foreignLeave = await notify(b, 'LEAVE_DECIDED', { params: decided });
            const foreignBooking = await notify(b, 'BOOKING_CREATED');
            const ids = (page: { items: { id: string }[] }) =>
              page.items.map((row) => row.id).sort();
            const expected = (...rows: { id: string }[]) => rows.map((row) => row.id).sort();

            // Ownership: only A's rows, never B's; counts split by registry category.
            let page = await listOwnNotifications(tx, a);
            assert.deepEqual(ids(page), expected(n1, n2, n3, n4));
            assert.equal(page.unreadCount, 3);
            assert.deepEqual(page.unreadByCategory, { OPERATIONS: 1, HR: 2, FINANCE: 0 });
            assert.equal(page.items.find((row) => row.id === n1.id)!.params, null);
            assert.deepEqual(page.items.find((row) => row.id === n3.id)!.params, requested);
            assert.equal(page.items.find((row) => row.id === n3.id)!.branch, null);
            assert.equal(page.items.find((row) => row.id === n3.id)!.source.type, 'LeaveRequest');

            // Filters: category, unread and their combination (Phase 3 types stay OPERATIONS).
            assert.deepEqual(
              ids(await listOwnNotifications(tx, a, undefined, { category: 'HR' })),
              expected(n3, n4),
            );
            assert.deepEqual(
              ids(await listOwnNotifications(tx, a, undefined, { category: 'OPERATIONS' })),
              expected(n1, n2),
            );
            assert.deepEqual(
              ids(await listOwnNotifications(tx, a, undefined, { unread: true })),
              expected(n1, n3, n4),
            );
            assert.deepEqual(
              ids(
                await listOwnNotifications(tx, a, undefined, {
                  category: 'OPERATIONS',
                  unread: true,
                }),
              ),
              expected(n1),
            );

            // A tampered params object is never exposed (only registry-valid structure is).
            const tampered = await notify(a, 'LEAVE_DECIDED', {
              params: { decision: 'APPROVED', note: 'private' },
            });
            const shown = (
              await listOwnNotifications(tx, a, undefined, { category: 'HR' })
            ).items.find((row) => row.id === tampered.id)!;
            assert.equal(shown.params, null);
            await tx.notification.delete({ where: { id: tampered.id } });

            // Foreign ids are indistinguishable from missing ones, and nothing of B changes.
            for (const operation of [
              () => readOwnNotification(tx, a, foreignLeave.id),
              () => archiveOwnNotification(tx, a, foreignLeave.id),
              () => readOwnNotification(tx, a, randomUUID()),
              () => archiveOwnNotification(tx, a, 'not-a-uuid'),
            ]) {
              await assert.rejects(
                operation(),
                (error: unknown) => error instanceof AuthError && error.code === 'NOT_FOUND',
              );
            }
            const untouched = await tx.notification.findMany({ where: { recipientUserId: b } });
            assert.ok(untouched.every((row) => row.readAt === null && row.archivedAt === null));

            // Mark one read: idempotent, first timestamp kept, counts follow.
            const first = await readOwnNotification(tx, a, n1.id);
            assert.ok(first.readAt);
            assert.equal((await readOwnNotification(tx, a, n1.id)).readAt, first.readAt);
            assert.deepEqual((await countOwnUnread(tx, a)).unreadByCategory, {
              OPERATIONS: 0,
              HR: 2,
              FINANCE: 0,
            });
            await tx.notification.update({ where: { id: n1.id }, data: { readAt: null } }); // restore for the next checks

            // Archive: soft, idempotent, hidden by default, listed only on request, never counted.
            const archivedItem = await archiveOwnNotification(tx, a, n1.id);
            assert.ok(archivedItem.archivedAt);
            assert.equal(
              (await archiveOwnNotification(tx, a, n1.id)).archivedAt,
              archivedItem.archivedAt,
            );
            assert.equal(
              await tx.notification.count({ where: { id: n1.id } }),
              1,
              'archive never deletes',
            );
            assert.deepEqual(ids(await listOwnNotifications(tx, a)), expected(n2, n3, n4));
            assert.deepEqual(
              ids(await listOwnNotifications(tx, a, undefined, { archived: true })),
              expected(n1),
            );
            page = await listOwnNotifications(tx, a);
            assert.equal(page.unreadCount, 2, 'an unread archived item is not counted');
            assert.deepEqual(page.unreadByCategory, { OPERATIONS: 0, HR: 2, FINANCE: 0 });
            // An archived item can still be read (own item) without leaving the archive.
            assert.ok((await readOwnNotification(tx, a, n1.id)).archivedAt);
            await tx.notification.update({ where: { id: n1.id }, data: { readAt: null } });

            // Mark all matching read: own, non-archived, optionally one category; idempotent.
            const hr = await readAllOwnNotifications(tx, a, 'HR');
            assert.equal(hr.updated, 2);
            assert.deepEqual(hr.unreadByCategory, { OPERATIONS: 0, HR: 0, FINANCE: 0 });
            assert.equal((await readAllOwnNotifications(tx, a, 'HR')).updated, 0);
            const other = await notify(a, 'PRE_END', { entity: 'Visit' });
            const all = await readAllOwnNotifications(tx, a);
            assert.equal(all.updated, 1);
            assert.equal(all.unreadCount, 0);
            assert.ok(
              (await tx.notification.findUniqueOrThrow({ where: { id: other.id } })).readAt,
            );
            assert.equal(
              (await tx.notification.findUniqueOrThrow({ where: { id: n1.id } })).readAt,
              null,
              'read-all skips archived items',
            );
            const stillUnread = await tx.notification.findMany({
              where: { recipientUserId: b, readAt: null },
            });
            assert.equal(stillUnread.length, 2, "A's read-all never touches B's inbox");
            void foreignBooking;

            // Pagination keeps its filters.
            for (let index = 0; index < 32; index += 1) await notify(b, 'BOOKING_CREATED');
            const firstPage = await listOwnNotifications(tx, b, undefined, {
              category: 'OPERATIONS',
              unread: true,
            });
            assert.equal(firstPage.items.length, 30);
            assert.ok(firstPage.nextCursor);
            const secondPage = await listOwnNotifications(tx, b, firstPage.nextCursor!, {
              category: 'OPERATIONS',
              unread: true,
            });
            assert.equal(secondPage.items.length, 3, '33 unread operations items in total');
            assert.equal(secondPage.nextCursor, null);

            throw rollback;
          },
          { timeout: 120_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

// Notification Center Step 1: additive and Phase 3 compatible (all fixtures roll back).
test('notification foundation keeps Phase 3 rows valid and admits Leave notifications', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional notification foundation rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8).toLowerCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              assert.match(`${String((error as Error).message)}`, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const user = await tx.user.create({
            data: {
              kind: 'CUSTOMER',
              status: 'ACTIVE',
              fullName: 'Notification fixture',
              preferredLocale: 'vi',
              emailCanonical: `nf-${run}@example.com`,
              emailDelivery: `nf-${run}@example.com`,
              emailVerifiedAt: new Date(),
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84919${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              customerProfile: {
                create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
              },
            },
          });
          const branch = await tx.branch.create({ data: { code: `NF-${run}`, name: 'NF' } });
          const event = async () =>
            (
              await tx.outboxEvent.create({
                data: {
                  aggregateType: 'Booking',
                  aggregateId: randomUUID(),
                  eventType: 'BOOKING_CREATED',
                  payload: {},
                },
              })
            ).id;
          const base = (sourceEventId: string) => ({
            recipientUserId: user.id,
            sourceEventId,
            entityId: randomUUID(),
            contextCode: 'CODE',
            actionAt: new Date(),
          });

          // Phase 3 shape (a branch, a Booking or Visit, no params) is unchanged and valid.
          const phase3 = await tx.notification.create({
            data: {
              ...base(await event()),
              branchId: branch.id,
              type: 'BOOKING_CREATED',
              entityType: 'Booking',
            },
          });
          assert.equal(phase3.params, null);
          assert.equal(phase3.archivedAt, null);
          assert.equal(phase3.readAt, null);
          await tx.notification.create({
            data: {
              ...base(await event()),
              branchId: branch.id,
              type: 'END_OVERDUE',
              entityType: 'Visit',
            },
          });
          // The Phase 3 idempotency key is unchanged.
          const sameEvent = await event();
          await tx.notification.create({
            data: { ...base(sameEvent), branchId: branch.id, type: 'PRE_END', entityType: 'Visit' },
          });
          await rejects(
            () =>
              tx.notification.create({
                data: {
                  ...base(sameEvent),
                  branchId: branch.id,
                  type: 'PRE_END',
                  entityType: 'Visit',
                },
              }),
            /notifications_event_recipient_key|Unique/,
          );

          // Leave notifications: no branch, structured params.
          const leave = await tx.notification.create({
            data: {
              ...base(await event()),
              branchId: null,
              type: 'LEAVE_REQUESTED',
              entityType: 'LeaveRequest',
              params: {
                subjectUserId: user.id,
                startDate: '2026-10-05',
                endDate: '2026-10-07',
                leaveType: 'ANNUAL',
              },
            },
          });
          assert.equal(leave.branchId, null);
          assert.deepEqual(leave.params, {
            subjectUserId: user.id,
            startDate: '2026-10-05',
            endDate: '2026-10-07',
            leaveType: 'ANNUAL',
          });

          // Integrity: families cannot be mixed, Phase 3 keeps its branch, params stay an object.
          await rejects(
            () =>
              tx.notification.create({
                data: {
                  ...base(sameEvent),
                  type: 'BOOKING_CREATED',
                  entityType: 'Booking',
                  branchId: null,
                },
              }),
            /notifications_branch_scope/,
          );
          await rejects(
            async () =>
              tx.notification.create({
                data: {
                  ...base(await event()),
                  branchId: branch.id,
                  type: 'LEAVE_DECIDED',
                  entityType: 'Booking',
                },
              }),
            /notifications_type_entity/,
          );
          await rejects(
            async () =>
              tx.notification.create({
                data: {
                  ...base(await event()),
                  branchId: branch.id,
                  type: 'BOOKING_CREATED',
                  entityType: 'LeaveRequest',
                },
              }),
            /notifications_type_entity/,
          );
          await rejects(
            async () =>
              tx.notification.create({
                data: {
                  ...base(await event()),
                  branchId: branch.id,
                  type: 'NOT_A_TYPE',
                  entityType: 'Booking',
                },
              }),
            /notifications_type_check/,
          );
          await rejects(
            async () =>
              tx.$executeRaw`UPDATE notifications SET params = '[]'::jsonb WHERE id = ${leave.id}::uuid`,
            /notifications_params_object/,
          );

          // Archive state is independent of read state (both nullable timestamps).
          const archived = await tx.notification.update({
            where: { id: phase3.id },
            data: { archivedAt: new Date() },
          });
          assert.ok(archived.archivedAt);
          assert.equal(archived.readAt, null);

          throw rollback;
        },
        { timeout: 60_000 },
      ),
      (error: unknown) => error === rollback,
    );
    assert.equal(await database.branch.count({ where: { code: `NF-${run}` } }), 0);
  } finally {
    await database.$disconnect();
  }
});

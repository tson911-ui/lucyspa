import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment, processLeaveEvent, takeSharedAuthGraphLock } from '@lucy-spa/server';
import { takeExclusiveAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { LeaveService } from './leave.service.js';

// Explicit opt-in: ordinary unit tests do not connect to PostgreSQL. All fixtures roll back.
test(
  'leave notifications: real Leave service -> outbox -> consumer -> in-app inbox',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_CSRF_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const rollback = new Error('Intentional leave notification rollback');
    try {
      await database.$connect();
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            const isolated = async <T>(work: () => Promise<T>): Promise<T> => {
              const name = `command_${++savepoints}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work();
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(async () => {
                  await takeExclusiveAuthGraphLock(tx);
                  return work(tx);
                }),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const leave = new LeaveService(runner, new AuthThrottleService(environment));
            await takeSharedAuthGraphLock(tx);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            const existingOwner = await tx.user.findFirst({
              where: { kind: 'OWNER' },
              select: { id: true },
            });
            const ownerId = existingOwner?.id ?? randomUUID();
            if (!existingOwner) {
              await tx.user.create({
                data: {
                  id: ownerId,
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Leave owner',
                  preferredLocale: 'vi',
                  emailCanonical: `leave-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `leave-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              });
            }
            const employee = async (branches: string[]) => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind: 'EMPLOYEE',
                  status: 'ACTIVE',
                  fullName: `Leave ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `leave-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `leave-${sequence}-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  phoneCanonical: `+84913${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `LVN-${sequence}-${run}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
              });
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              for (const branchId of branches) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: ownerId },
                });
              }
              return id;
            };
            const manager = async (
              level: 'DEPUTY_STORE_MANAGER' | 'STORE_MANAGER',
              branchId: string,
            ) => {
              const id = await employee([branchId]);
              const role = await tx.role.create({
                data: {
                  code: `LVN_${run}_${++sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: ['APPROVE_LEAVE', 'VIEW_ATTENDANCE'].map((code) => ({
                      permissionId: permissions.get(code)!,
                    })),
                  },
                },
              });
              await tx.userRoleAssignment.create({
                data: { userId: id, roleId: role.id, scopeKind: 'BRANCH', branchId },
              });
              await tx.organizationAssignment.create({
                data: {
                  employeeUserId: id,
                  level,
                  scopeKind: 'BRANCH',
                  branchId,
                  assignedByUserId: ownerId,
                },
              });
              return id;
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: user.passwordHash!,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const eventsOf = (leaveId: string) =>
              tx.outboxEvent.findMany({
                where: { aggregateType: 'LeaveRequest', aggregateId: leaveId },
                orderBy: { occurredAt: 'asc' },
              });
            const inboxOf = (eventId: string) =>
              tx.notification.findMany({
                where: { sourceEventId: eventId },
                orderBy: { recipientUserId: 'asc' },
              });
            const ids = (...values: string[]) => [...values].sort();

            const b1 = (await tx.branch.create({ data: { code: `LVB1-${run}`, name: 'B1' } })).id;
            const b2 = (await tx.branch.create({ data: { code: `LVB2-${run}`, name: 'B2' } })).id;
            const deputyA = await manager('DEPUTY_STORE_MANAGER', b1);
            const deputyB = await manager('DEPUTY_STORE_MANAGER', b1);
            const store = await manager('STORE_MANAGER', b1);
            const staff = await employee([b1]);
            const staffSession = await login(staff);
            const storeSession = await login(store);
            const days = (from: string, to: string) => ({
              leaveType: 'ANNUAL' as const,
              startDate: from,
              endDate: to,
              reason: 'Private family reason 123',
            });

            // 1. Creating a request writes exactly one minimal LEAVE_REQUESTED event, same transaction.
            const first = await leave.create(staffSession, days('2030-03-10', '2030-03-12'));
            const [requested, ...rest] = await eventsOf(first.id);
            assert.equal(rest.length, 0);
            assert.equal(requested!.eventType, 'LEAVE_REQUESTED');
            assert.equal(requested!.schemaVersion, 1);
            assert.equal(requested!.branchId, null);
            assert.equal(requested!.publishedAt, null);
            assert.deepEqual(requested!.payload, { employeeUserId: staff });
            assert.ok(
              !JSON.stringify(requested!.payload).includes('Private'),
              'no free-form reason',
            );

            // 2. Consumer: the lowest eligible level (both Deputies), nobody above, not the requester.
            assert.equal(await processLeaveEvent(tx, requested!.id), 'PUBLISHED');
            const notified = await inboxOf(requested!.id);
            assert.deepEqual(
              notified.map((row) => row.recipientUserId),
              ids(deputyA, deputyB),
            );
            for (const row of notified) {
              assert.equal(row.type, 'LEAVE_REQUESTED');
              assert.equal(row.entityType, 'LeaveRequest');
              assert.equal(row.entityId, first.id);
              assert.equal(row.branchId, null);
              assert.equal(row.readAt, null);
              assert.deepEqual(row.params, {
                subjectUserId: staff,
                startDate: '2030-03-10',
                endDate: '2030-03-12',
                leaveType: 'ANNUAL',
              });
              assert.ok(
                !JSON.stringify(row).includes('Private'),
                'reason never reaches an inbox row',
              );
            }
            assert.ok(
              ![store, staff, ownerId].some((id) => notified.some((n) => n.recipientUserId === id)),
            );
            assert.ok(
              (await tx.outboxEvent.findUniqueOrThrow({ where: { id: requested!.id } }))
                .publishedAt,
            );

            // 3. Retry / idempotency: consumed events are not claimed again, and even a forced
            //    re-run adds nothing and never resets read state.
            assert.equal(await processLeaveEvent(tx, requested!.id), 'NOT_CLAIMED');
            await tx.notification.updateMany({
              where: { sourceEventId: requested!.id, recipientUserId: deputyA },
              data: { readAt: new Date() },
            });
            await tx.outboxEvent.update({
              where: { id: requested!.id },
              data: { publishedAt: null },
            });
            assert.equal(await processLeaveEvent(tx, requested!.id), 'PUBLISHED');
            const again = await inboxOf(requested!.id);
            assert.equal(again.length, 2, 'no duplicate notification');
            assert.ok(
              again.find((row) => row.recipientUserId === deputyA)!.readAt,
              'read state kept',
            );

            // 4. A Deputy's own request escalates past the peer to the Store Manager.
            const deputySession = await login(deputyA);
            const peerLeave = await leave.create(deputySession, days('2030-04-01', '2030-04-01'));
            const [peerEvent] = await eventsOf(peerLeave.id);
            assert.equal(await processLeaveEvent(tx, peerEvent!.id), 'PUBLISHED');
            assert.deepEqual(
              (await inboxOf(peerEvent!.id)).map((row) => row.recipientUserId),
              [store],
              'requester excluded; peers do not supervise; escalates one level',
            );

            // 5. Nobody eligible: the Owner is only the fallback.
            const lonely = await employee([b2]);
            const lonelyLeave = await leave.create(
              await login(lonely),
              days('2030-05-01', '2030-05-02'),
            );
            const [lonelyEvent] = await eventsOf(lonelyLeave.id);
            assert.equal(await processLeaveEvent(tx, lonelyEvent!.id), 'PUBLISHED');
            assert.deepEqual(
              (await inboxOf(lonelyEvent!.id)).map((row) => row.recipientUserId),
              [ownerId],
            );

            // 6. Approve: LEAVE_DECIDED carries only the decision; only the employee is notified.
            const approved = await leave.approve(storeSession, first.id, {
              expectedVersion: first.version,
            });
            assert.equal(approved.status, 'APPROVED');
            const decidedEvents = (await eventsOf(first.id)).filter(
              (e) => e.eventType === 'LEAVE_DECIDED',
            );
            assert.equal(decidedEvents.length, 1);
            assert.deepEqual(decidedEvents[0]!.payload, {
              employeeUserId: staff,
              decision: 'APPROVED',
            });
            assert.equal(await processLeaveEvent(tx, decidedEvents[0]!.id), 'PUBLISHED');
            const decided = await inboxOf(decidedEvents[0]!.id);
            assert.deepEqual(
              decided.map((row) => row.recipientUserId),
              [staff],
            );
            assert.equal(decided[0]!.type, 'LEAVE_DECIDED');
            assert.deepEqual(decided[0]!.params, {
              decision: 'APPROVED',
              startDate: '2030-03-10',
              endDate: '2030-03-12',
              leaveType: 'ANNUAL',
            });

            // 7. Reject: the manager's reason never enters the event or the inbox.
            const second = await leave.create(staffSession, days('2030-06-03', '2030-06-04'));
            const rejected = await leave.reject(storeSession, second.id, {
              expectedVersion: second.version,
              reason: 'Confidential manager note 999',
            });
            assert.equal(rejected.status, 'REJECTED');
            const rejectedEvent = (await eventsOf(second.id)).find(
              (e) => e.eventType === 'LEAVE_DECIDED',
            )!;
            assert.deepEqual(rejectedEvent.payload, {
              employeeUserId: staff,
              decision: 'REJECTED',
            });
            // The request event is processed AFTER the decision: nothing left to handle.
            const staleRequest = (await eventsOf(second.id)).find(
              (e) => e.eventType === 'LEAVE_REQUESTED',
            )!;
            assert.equal(await processLeaveEvent(tx, staleRequest.id), 'SKIPPED');
            assert.equal((await inboxOf(staleRequest.id)).length, 0);
            assert.equal(await processLeaveEvent(tx, rejectedEvent.id), 'PUBLISHED');
            const rejectedInbox = await inboxOf(rejectedEvent.id);
            assert.deepEqual(
              rejectedInbox.map((row) => row.recipientUserId),
              [staff],
            );
            assert.equal((rejectedInbox[0]!.params as { decision: string }).decision, 'REJECTED');
            assert.ok(!JSON.stringify(rejectedInbox).includes('Confidential'));

            // 8. Failed commands leave no half-written state or event.
            const before = await tx.outboxEvent.count({ where: { aggregateType: 'LeaveRequest' } });
            await fails(leave.create(staffSession, days('2030-03-11', '2030-03-11')), 'CONFLICT'); // overlap
            await fails(
              leave.approve(storeSession, peerLeave.id, { expectedVersion: peerLeave.version + 5 }),
              'CONFLICT',
            );
            assert.equal(
              await tx.outboxEvent.count({ where: { aggregateType: 'LeaveRequest' } }),
              before,
            );

            // 9. A failing consumer leaves nothing behind and the event stays pending.
            const third = await leave.create(staffSession, days('2030-07-01', '2030-07-01'));
            const [thirdEvent] = await eventsOf(third.id);
            await tx.$executeRawUnsafe('SAVEPOINT consumer_failure');
            await assert.rejects(
              processLeaveEvent(tx, thirdEvent!.id, {
                resolve: () => Promise.reject(new Error('routing unavailable')),
              }),
              /routing unavailable/,
            );
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT consumer_failure');
            assert.equal(
              (await tx.outboxEvent.findUniqueOrThrow({ where: { id: thirdEvent!.id } }))
                .publishedAt,
              null,
            );
            assert.equal((await inboxOf(thirdEvent!.id)).length, 0);
            assert.equal(
              await processLeaveEvent(tx, thirdEvent!.id),
              'PUBLISHED',
              'retry succeeds',
            );
            assert.deepEqual(
              (await inboxOf(thirdEvent!.id)).map((row) => row.recipientUserId),
              ids(deputyA, deputyB),
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

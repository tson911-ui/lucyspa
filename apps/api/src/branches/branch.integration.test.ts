import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { takeExclusiveAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { BranchService } from './branch.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'branch administration and business hours with actual constraints; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
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
    const userIds: string[] = [];
    const rollback = new Error('Intentional branch administration integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const branchCount = await database.branch.count();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            // Each command gets its own savepoint, so a rejected command rolls back exactly
            // as its own transaction would in production.
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
            let exclusiveCommands = 0;
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(async () => {
                  exclusiveCommands += 1;
                  await takeExclusiveAuthGraphLock(tx);
                  return work(tx);
                }),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const branches = new BranchService(runner, new AuthThrottleService(environment));
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER',
              member: string[] = [],
            ) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `branch-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `branch-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84916${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `BR-${sequence}-${run}`,
                            dateOfBirth: new Date('1992-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1992-01-01'), address: 'Fixture' },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              for (const branchId of member) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: id },
                });
              }
              return id;
            };
            const grant = async (userId: string, codes: PermissionCode[], branchId?: string) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `BR_${run}_${sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                  },
                },
                select: { id: true },
              });
              await tx.userRoleAssignment.create({
                data: {
                  userId,
                  roleId: role.id,
                  scopeKind: branchId ? 'BRANCH' : 'GLOBAL',
                  branchId: branchId ?? null,
                },
              });
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: hash,
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
            const auditOf = (branchId: string, action: string) =>
              tx.auditEvent.findMany({
                where: { entityId: branchId, action },
                orderBy: { occurredAt: 'asc' },
              });

            const owner = existingOwner?.id ?? (await principal('OWNER'));
            // A pre-existing Owner's password is unknown: use a GLOBAL administrator instead.
            const admin = existingOwner ? await principal('EMPLOYEE') : owner;
            if (existingOwner) {
              await grant(admin, ['MANAGE_BRANCHES', 'VIEW_EMPLOYEES', 'MANAGE_PERMISSIONS']);
            }
            const adminSession = await login(admin);
            const customer = await principal('CUSTOMER');

            let A = '';
            let B = '';
            await context.test(
              'creation: GLOBAL only, default hours, validated, audited',
              async () => {
                const created = await branches.create(adminSession, {
                  code: ` q1-${run} `,
                  name: '  Lucy Spa Quận 1  ',
                  reason: 'Opening',
                });
                A = created.id;
                assert.equal(created.code, `Q1-${run}`);
                assert.equal(created.name, 'Lucy Spa Quận 1');
                assert.equal(created.timezone, 'Asia/Ho_Chi_Minh');
                assert.equal(created.isActive, true);
                assert.equal(created.version, 1);
                assert.deepEqual(
                  created.hours,
                  [1, 2, 3, 4, 5, 6, 7].map((isoWeekday) => ({
                    isoWeekday,
                    isClosed: false,
                    opensAt: '09:00',
                    closesAt: '21:00',
                  })),
                );
                const stored = await tx.branchOperatingHours.findMany({ where: { branchId: A } });
                assert.equal(stored.length, 7);
                assert.ok(
                  stored.every((row) => row.opensAtMinute === 540 && row.closesAtMinute === 1260),
                );
                const [event] = await auditOf(A, 'BRANCH_CREATED');
                assert.equal(event?.branchId, A);
                assert.equal(event?.actorUserId, admin);
                assert.equal(event?.reason, 'Opening');
                B = (
                  await branches.create(adminSession, {
                    code: `Q3-${run}`,
                    name: 'Lucy Spa Quận 3',
                    timezone: 'Asia/Bangkok',
                  })
                ).id;

                await fails(
                  branches.create(adminSession, { code: `q1-${run}`, name: 'Dup' }),
                  'CONFLICT',
                );
                await fails(
                  branches.create(adminSession, { code: '1-BAD', name: 'X' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  branches.create(adminSession, { code: 'OK', name: '   ' }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  branches.create(adminSession, {
                    code: `TZ-${run}`,
                    name: 'X',
                    timezone: 'Mars/Base',
                  }),
                  'VALIDATION_FAILED',
                );
                // Branch-scoped MANAGE_BRANCHES never creates branches.
                const local = await principal('EMPLOYEE', [A]);
                await grant(local, ['MANAGE_BRANCHES'], A);
                await fails(
                  branches.create(await login(local), { code: `L-${run}`, name: 'X' }),
                  'FORBIDDEN',
                );
                await fails(
                  branches.create(await login(customer), { code: `C-${run}`, name: 'X' }),
                  'FORBIDDEN',
                );
                await fails(
                  branches.create(undefined, { code: `U-${run}`, name: 'X' }),
                  'AUTHENTICATION_REQUIRED',
                );
              },
            );

            await context.test('branch and default hours are created atomically', async () => {
              // Force the seventh default day to fail: no branch row may remain. NOT VALID
              // checks only new rows, leaving existing branches' hours untouched.
              await tx.$executeRawUnsafe('SAVEPOINT force_hours_failure');
              try {
                await tx.$executeRawUnsafe(
                  'ALTER TABLE branch_operating_hours ADD CONSTRAINT test_no_sunday CHECK (iso_weekday <> 7) NOT VALID',
                );
                await assert.rejects(
                  branches.create(adminSession, { code: `ATOM-${run}`, name: 'Atomic' }),
                );
                assert.equal(await tx.branch.count({ where: { code: `ATOM-${run}` } }), 0);
                assert.equal(
                  await tx.branchOperatingHours.count({
                    where: { branch: { code: `ATOM-${run}` } },
                  }),
                  0,
                );
              } finally {
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT force_hours_failure');
              }
            });

            await context.test('reads are scoped to the caller', async () => {
              const manager = await principal('EMPLOYEE', [A]);
              await grant(manager, ['MANAGE_BRANCHES'], A);
              const staff = await principal('EMPLOYEE', [A]);
              const managerView = await branches.list(await login(manager));
              assert.deepEqual(
                managerView.branches.map((branch) => branch.id),
                [A],
              );
              assert.deepEqual(
                (await branches.list(await login(staff))).branches.map((b) => b.id),
                [A],
              );
              await fails(branches.get(await login(manager), B), 'NOT_FOUND');
              await fails(branches.get(await login(manager), randomUUID()), 'NOT_FOUND');
              assert.equal((await branches.get(await login(staff), A)).hours.length, 7);
              const all = (await branches.list(adminSession)).branches.map((branch) => branch.id);
              assert.ok(all.includes(A) && all.includes(B));
              await fails(branches.list(await login(customer)), 'FORBIDDEN');
            });

            await context.test(
              'rename and timezone: versioned, audited, attendance-guarded',
              async () => {
                const manager = await principal('EMPLOYEE', [A]);
                await grant(manager, ['MANAGE_BRANCHES'], A);
                const session = await login(manager);
                const current = await branches.get(session, A);
                const renamed = await branches.update(session, A, {
                  expectedVersion: current.version,
                  name: 'Lucy Spa Bến Thành',
                });
                assert.equal(renamed.name, 'Lucy Spa Bến Thành');
                assert.equal(renamed.version, current.version + 1);
                await fails(
                  branches.update(session, A, { expectedVersion: current.version, name: 'Stale' }),
                  'CONFLICT',
                );
                await fails(
                  branches.update(session, B, { expectedVersion: 1, name: 'Other' }),
                  'NOT_FOUND',
                );
                await fails(
                  branches.update(session, A, {
                    expectedVersion: renamed.version,
                    name: 'Lucy Spa Bến Thành',
                  }),
                  'VALIDATION_FAILED',
                );
                const [event] = await auditOf(A, 'BRANCH_UPDATED');
                assert.deepEqual(event?.before, { name: 'Lucy Spa Quận 1' });
                assert.deepEqual(event?.after, { name: 'Lucy Spa Bến Thành' });

                // Timezone changes are allowed before any attendance exists.
                const moved = await branches.update(session, A, {
                  expectedVersion: renamed.version,
                  timezone: 'Asia/Bangkok',
                  reason: 'Configured wrongly',
                });
                assert.equal(moved.timezone, 'Asia/Bangkok');
                await fails(
                  branches.update(session, A, {
                    expectedVersion: moved.version,
                    timezone: 'Nowhere/City',
                  }),
                  'VALIDATION_FAILED',
                );
                // Once attendance exists, the timezone is fixed.
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: manager,
                    branchId: A,
                    businessDate: new Date('2026-09-25T00:00:00Z'),
                    checkInAt: new Date('2026-09-25T03:00:00Z'),
                  },
                });
                await fails(
                  branches.update(session, A, {
                    expectedVersion: moved.version,
                    timezone: 'Asia/Ho_Chi_Minh',
                  }),
                  'CONFLICT',
                );
                assert.equal(
                  (await tx.branch.findUniqueOrThrow({ where: { id: A } })).timezone,
                  'Asia/Bangkok',
                );
                // Renaming stays possible.
                await branches.update(session, A, {
                  expectedVersion: moved.version,
                  name: 'Lucy Spa Q1',
                });
              },
            );

            await context.test(
              'business hours: open, closed, validated, versioned, audited',
              async () => {
                const manager = await principal('EMPLOYEE', [A]);
                await grant(manager, ['MANAGE_BRANCHES'], A);
                const session = await login(manager);
                const current = await branches.get(session, A);
                const updated = await branches.setHours(session, A, {
                  expectedVersion: current.version,
                  days: [
                    { isoWeekday: 7, isClosed: true, opensAt: null, closesAt: null },
                    { isoWeekday: 1, isClosed: false, opensAt: '10:00', closesAt: '24:00' },
                  ],
                  reason: 'New schedule',
                });
                assert.equal(updated.version, current.version + 1);
                assert.deepEqual(updated.hours[0], {
                  isoWeekday: 1,
                  isClosed: false,
                  opensAt: '10:00',
                  closesAt: '24:00',
                });
                assert.deepEqual(updated.hours[6], {
                  isoWeekday: 7,
                  isClosed: true,
                  opensAt: null,
                  closesAt: null,
                });
                assert.deepEqual(updated.hours[2], {
                  isoWeekday: 3,
                  isClosed: false,
                  opensAt: '09:00',
                  closesAt: '21:00',
                });
                const [event] = await auditOf(A, 'BRANCH_HOURS_CHANGED');
                assert.equal(event?.reason, 'New schedule');
                assert.deepEqual(event?.before, {
                  days: [
                    { isoWeekday: 1, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
                    { isoWeekday: 7, isClosed: false, opensAt: '09:00', closesAt: '21:00' },
                  ],
                });
                const bad = async (day: Record<string, unknown>) =>
                  fails(
                    branches.setHours(session, A, {
                      expectedVersion: updated.version,
                      days: [day as never],
                    }),
                    'VALIDATION_FAILED',
                  );
                await bad({ isoWeekday: 2, isClosed: false, opensAt: '21:00', closesAt: '09:00' });
                await bad({ isoWeekday: 2, isClosed: false, opensAt: '09:00', closesAt: '09:00' });
                await bad({ isoWeekday: 2, isClosed: false, opensAt: '09:00', closesAt: null });
                await bad({ isoWeekday: 2, isClosed: true, opensAt: '09:00', closesAt: '21:00' });
                await bad({ isoWeekday: 2, isClosed: false, opensAt: '24:00', closesAt: '24:00' });
                await bad({ isoWeekday: 8, isClosed: true, opensAt: null, closesAt: null });
                await bad({ isoWeekday: 3, isClosed: false, opensAt: '09:00', closesAt: '21:00' }); // no change
                await fails(
                  branches.setHours(session, A, {
                    expectedVersion: current.version,
                    days: [{ isoWeekday: 2, isClosed: true, opensAt: null, closesAt: null }],
                  }),
                  'CONFLICT',
                );
                await fails(
                  branches.setHours(session, B, {
                    expectedVersion: 1,
                    days: [{ isoWeekday: 2, isClosed: true, opensAt: null, closesAt: null }],
                  }),
                  'NOT_FOUND',
                );
                // A branch created before Phase 2 (no hours rows) can be configured.
                const legacy = await tx.branch.create({
                  data: { code: `LEGACY-${run}`, name: 'Legacy' },
                  select: { id: true },
                });
                const configured = await branches.setHours(adminSession, legacy.id, {
                  expectedVersion: 1,
                  days: [{ isoWeekday: 1, isClosed: false, opensAt: '09:00', closesAt: '21:00' }],
                });
                assert.equal(configured.hours.length, 1);

                // Production regression: a new branch (version 1) already has the default
                // 09:00–21:00 week, so the UI's unchanged seven-open-days payload is a no-op.
                // The API contract rejects no-op updates as VALIDATION_FAILED "days".
                const fresh = await branches.create(adminSession, {
                  code: `HOURS-${run}`,
                  name: 'Unchanged hours',
                });
                assert.equal(fresh.version, 1);
                await assert.rejects(
                  branches.setHours(adminSession, fresh.id, {
                    expectedVersion: 1,
                    days: [1, 2, 3, 4, 5, 6, 7].map((isoWeekday) => ({
                      isoWeekday: isoWeekday as 1 | 2 | 3 | 4 | 5 | 6 | 7,
                      isClosed: false,
                      opensAt: '09:00',
                      closesAt: '21:00',
                    })),
                  }),
                  (error: unknown) =>
                    error instanceof AuthError &&
                    error.code === 'VALIDATION_FAILED' &&
                    error.field === 'days',
                );
                assert.equal((await branches.get(adminSession, fresh.id)).version, 1);
              },
            );

            await context.test(
              'activation is a graph change: GLOBAL, containment, invalidation',
              async () => {
                const member = await principal('EMPLOYEE', [B]);
                await grant(member, ['VIEW_EMPLOYEES'], B);
                const memberSession = await login(member);
                const localManager = await principal('EMPLOYEE', [B]);
                await grant(localManager, ['MANAGE_BRANCHES'], B);
                const current = await branches.get(adminSession, B);
                await fails(
                  branches.setStatus(await login(localManager), B, {
                    expectedVersion: current.version,
                    isActive: false,
                    reason: 'Closing',
                  }),
                  'FORBIDDEN',
                );
                const before = exclusiveCommands;
                const off = await branches.setStatus(adminSession, B, {
                  expectedVersion: current.version,
                  isActive: false,
                  reason: 'Renovation',
                });
                assert.equal(off.isActive, false);
                assert.ok(exclusiveCommands > before, 'exclusive graph lock');
                assert.equal(await sessions.resolve(memberSession, tx), null, 'member signed out');
                assert.equal(
                  (await tx.user.findUniqueOrThrow({ where: { id: member } })).authzVersion,
                  2,
                );
                const [status] = await auditOf(B, 'BRANCH_STATUS_CHANGED');
                assert.equal(status?.reason, 'Renovation');
                assert.deepEqual(status?.after, { isActive: false, affectedMembers: 2 });
                await fails(
                  branches.setStatus(adminSession, B, {
                    expectedVersion: off.version,
                    isActive: false,
                    reason: 'x',
                  }),
                  'CONFLICT',
                );
                // A non-Owner GLOBAL manager cannot revive authority it does not hold.
                const globalManager = await principal('EMPLOYEE');
                await grant(globalManager, ['MANAGE_BRANCHES']);
                await fails(
                  branches.setStatus(await login(globalManager), B, {
                    expectedVersion: off.version,
                    isActive: true,
                    reason: 'Reopen',
                  }),
                  'FORBIDDEN',
                );
                assert.equal(
                  (await tx.branch.findUniqueOrThrow({ where: { id: B } })).isActive,
                  false,
                );
                const on = await branches.setStatus(adminSession, B, {
                  expectedVersion: off.version,
                  isActive: true,
                  reason: 'Reopen',
                });
                assert.equal(on.isActive, true);
                // Never deleted.
                assert.equal(await tx.branch.count({ where: { id: B } }), 1);
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.branch.count(), branchCount, 'no branch remains');
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
    } finally {
      await database.$disconnect();
    }
  },
);

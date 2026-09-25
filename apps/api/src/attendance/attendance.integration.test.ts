import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { setTimeout as sleep } from 'node:timers/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { AttendanceService } from './attendance.service.js';

// The calendar date of `instant` in `timeZone` (independent of the server timezone).
function localDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(instant);
}

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'attendance V1 with actual constraints and branch timezones; all fixtures roll back',
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
    const rollback = new Error('Intentional attendance integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const attendanceCount = await database.attendanceRecord.count();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            // Each command in its own savepoint: a rejected command rolls back exactly as its
            // own transaction would in production.
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
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const attendance = new AttendanceService(runner, new AuthThrottleService(environment));
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            // Two far-apart zones: their calendar dates always differ, so a stored business
            // date proves which timezone was used.
            const branch = async (label: string, timezone: string) =>
              (
                await tx.branch.create({
                  data: { code: `AT-${label}-${run}`, name: `Branch ${label}`, timezone },
                  select: { id: true },
                })
              ).id;
            const EAST = await branch('E', 'Pacific/Kiritimati'); // UTC+14
            const WEST = await branch('W', 'Pacific/Pago_Pago'); // UTC-11
            const OTHER = await branch('O', 'Asia/Ho_Chi_Minh');
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
                  emailCanonical: `att-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `att-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84913${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `ATE-${sequence}-${run}`,
                            dateOfBirth: new Date('1994-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1994-01-01'), address: 'Fixture' },
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
            const grantRole = async (
              userId: string,
              codes: PermissionCode[],
              branchId?: string,
            ) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `AT_${run}_${sequence}`,
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
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });

            const worker = await principal('EMPLOYEE', [EAST, WEST]);
            const workerSession = await login(worker);
            const colleague = await principal('EMPLOYEE', [EAST]);
            const colleagueSession = await login(colleague);
            const viewerEast = await principal('EMPLOYEE', [EAST]);
            await grantRole(viewerEast, ['VIEW_ATTENDANCE'], EAST);
            const viewerEastSession = await login(viewerEast);
            const managerEast = await principal('EMPLOYEE', [EAST]);
            await grantRole(managerEast, ['MANAGE_ATTENDANCE'], EAST);
            const managerEastSession = await login(managerEast);
            const managerOther = await principal('EMPLOYEE', [OTHER]);
            await grantRole(managerOther, ['MANAGE_ATTENDANCE', 'VIEW_ATTENDANCE'], OTHER);
            const managerOtherSession = await login(managerOther);
            const globalViewer = await principal('EMPLOYEE');
            await grantRole(globalViewer, ['VIEW_ATTENDANCE']);
            const globalViewerSession = await login(globalViewer);
            const customerSession = await login(await principal('CUSTOMER'));

            let eastRecord = '';
            await context.test(
              'check-in: branch-local business date, membership, duplicates',
              async () => {
                const east = await attendance.checkIn(workerSession, { branchId: EAST });
                const west = await attendance.checkIn(workerSession, { branchId: WEST });
                eastRecord = east.id;
                const at = new Date(east.checkInAt);
                assert.equal(east.businessDate, localDate(at, 'Pacific/Kiritimati'));
                assert.equal(
                  west.businessDate,
                  localDate(new Date(west.checkInAt), 'Pacific/Pago_Pago'),
                );
                assert.notEqual(
                  east.businessDate,
                  west.businessDate,
                  'branch timezone, not server',
                );
                assert.equal(east.checkOutAt, null);
                assert.equal(east.version, 1);
                const [event] = await audit(east.id, 'ATTENDANCE_CHECKED_IN');
                assert.equal(event?.branchId, EAST);
                assert.equal(event?.subjectUserId, worker);
                // One record per employee + branch + business date.
                await fails(attendance.checkIn(workerSession, { branchId: EAST }), 'CONFLICT');
                await tx.$executeRawUnsafe('SAVEPOINT duplicate_attendance');
                await assert.rejects(
                  tx.attendanceRecord.create({
                    data: {
                      employeeUserId: worker,
                      branchId: EAST,
                      businessDate: new Date(`${east.businessDate}T00:00:00Z`),
                      checkInAt: at,
                    },
                  }),
                );
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_attendance');
                // No active assignment at OTHER; unknown branch; customer and anonymous callers.
                await fails(attendance.checkIn(workerSession, { branchId: OTHER }), 'FORBIDDEN');
                await fails(
                  attendance.checkIn(workerSession, { branchId: randomUUID() }),
                  'NOT_FOUND',
                );
                await fails(attendance.checkIn(customerSession, { branchId: EAST }), 'FORBIDDEN');
                await fails(
                  attendance.checkIn(undefined, { branchId: EAST }),
                  'AUTHENTICATION_REQUIRED',
                );
              },
            );

            await context.test('check-out: own open record for today only', async () => {
              await fails(attendance.checkOut(colleagueSession, eastRecord), 'NOT_FOUND');
              await fails(attendance.checkOut(workerSession, randomUUID()), 'NOT_FOUND');
              await sleep(5);
              const closed = await attendance.checkOut(workerSession, eastRecord);
              assert.equal(closed.id, eastRecord, 'same record updated');
              assert.ok(closed.checkOutAt && closed.checkOutAt > closed.checkInAt);
              assert.equal(closed.version, 2);
              assert.equal((await audit(eastRecord, 'ATTENDANCE_CHECKED_OUT')).length, 1);
              await fails(attendance.checkOut(workerSession, eastRecord), 'CONFLICT');
              assert.equal(
                await tx.attendanceRecord.count({ where: { employeeUserId: worker } }),
                2,
              );
            });

            let forgotten = '';
            await context.test(
              'forgotten check-out: manager correction with reason and audit',
              async () => {
                // Yesterday's open record in the Ho Chi Minh branch (UTC+7).
                const checkIn = new Date(Date.now() - 30 * 3_600_000);
                const created = await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: colleague,
                    branchId: OTHER,
                    businessDate: new Date(`${localDate(checkIn, 'Asia/Ho_Chi_Minh')}T00:00:00Z`),
                    checkInAt: checkIn,
                  },
                  select: { id: true },
                });
                forgotten = created.id;
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: colleague, branchId: OTHER, grantedByUserId: colleague },
                });
                const colleagueAgain = await login(colleague);
                // Self check-out of an earlier day is refused; correction is the path.
                await fails(attendance.checkOut(colleagueAgain, forgotten), 'CONFLICT');
                const out = new Date(checkIn.getTime() + 8 * 3_600_000).toISOString();
                await fails(
                  attendance.correct(managerEastSession, forgotten, {
                    expectedVersion: 1,
                    checkOutAt: out,
                    reason: 'Forgot',
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  attendance.correct(managerOtherSession, forgotten, {
                    expectedVersion: 1,
                    checkOutAt: out,
                    reason: '   ',
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  attendance.correct(managerOtherSession, forgotten, {
                    expectedVersion: 1,
                    checkOutAt: new Date(checkIn.getTime() - 60_000).toISOString(),
                    reason: 'Wrong',
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  attendance.correct(managerOtherSession, forgotten, {
                    expectedVersion: 1,
                    checkOutAt: new Date(Date.now() + 3_600_000).toISOString(),
                    reason: 'Future',
                  }),
                  'VALIDATION_FAILED',
                );
                // Moving the check-in to another business date is refused.
                await fails(
                  attendance.correct(managerOtherSession, forgotten, {
                    expectedVersion: 1,
                    checkInAt: new Date(checkIn.getTime() - 26 * 3_600_000).toISOString(),
                    reason: 'Other day',
                  }),
                  'VALIDATION_FAILED',
                );
                const corrected = await attendance.correct(managerOtherSession, forgotten, {
                  expectedVersion: 1,
                  checkOutAt: out,
                  reason: 'Forgot to check out',
                });
                assert.equal(corrected.checkOutAt, out);
                assert.equal(corrected.version, 2);
                const [event] = await audit(forgotten, 'ATTENDANCE_CORRECTED');
                assert.equal(event?.reason, 'Forgot to check out');
                assert.equal(event?.actorUserId, managerOther);
                assert.equal(event?.branchId, OTHER);
                assert.deepEqual(event?.before, {
                  checkInAt: checkIn.toISOString(),
                  checkOutAt: null,
                });
                assert.deepEqual(event?.after, {
                  checkInAt: checkIn.toISOString(),
                  checkOutAt: out,
                });
                // A stale version (for example racing another change) is refused.
                await fails(
                  attendance.correct(managerOtherSession, forgotten, {
                    expectedVersion: 1,
                    checkOutAt: new Date(checkIn.getTime() + 9 * 3_600_000).toISOString(),
                    reason: 'Late',
                  }),
                  'CONFLICT',
                );
                // Non-Owners never correct their own record.
                const own = await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: managerOther,
                    branchId: OTHER,
                    businessDate: new Date(`${localDate(checkIn, 'Asia/Ho_Chi_Minh')}T00:00:00Z`),
                    checkInAt: checkIn,
                  },
                  select: { id: true },
                });
                await fails(
                  attendance.correct(managerOtherSession, own.id, {
                    expectedVersion: 1,
                    checkOutAt: out,
                    reason: 'Self',
                  }),
                  'FORBIDDEN',
                );
              },
            );

            await context.test('reads: own, branch-scoped, global and refused', async () => {
              const own = await attendance.listOwn(workerSession, {});
              assert.equal(own.records.length, 2);
              assert.ok(own.records.every((record) => record.employeeId === worker));
              const east = await attendance.listBranch(viewerEastSession, {});
              assert.ok(east.records.length >= 1);
              assert.ok(east.records.every((record) => record.branchId === EAST));
              await fails(
                attendance.listBranch(viewerEastSession, { branchId: OTHER }),
                'NOT_FOUND',
              );
              await fails(attendance.listBranch(workerSession, {}), 'FORBIDDEN');
              await fails(attendance.listBranch(customerSession, {}), 'FORBIDDEN');
              await fails(attendance.listOwn(customerSession, {}), 'FORBIDDEN');
              await fails(
                attendance.listOwn(workerSession, { from: '2026-01-01', to: '2026-12-31' }),
                'VALIDATION_FAILED',
              );
              const global = await attendance.listBranch(globalViewerSession, {
                employeeId: colleague,
              });
              assert.ok(global.records.some((record) => record.id === forgotten));
            });

            await context.test('history survives revocation and deactivation', async () => {
              await tx.employeeBranchAssignment.updateMany({
                where: { employeeUserId: worker, branchId: EAST, revokedAt: null },
                data: { revokedAt: new Date() },
              });
              await tx.branch.update({ where: { id: WEST }, data: { isActive: false } });
              const kept = await attendance.listBranch(globalViewerSession, { employeeId: worker });
              assert.equal(kept.records.length, 2, 'records kept after revocation/deactivation');
              assert.ok(kept.records.some((record) => record.branchId === EAST));
              assert.ok(kept.records.some((record) => record.branchId === WEST));
              await fails(attendance.checkIn(workerSession, { branchId: EAST }), 'FORBIDDEN');
              await fails(attendance.checkIn(workerSession, { branchId: WEST }), 'CONFLICT');
            });

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.attendanceRecord.count(), attendanceCount);
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

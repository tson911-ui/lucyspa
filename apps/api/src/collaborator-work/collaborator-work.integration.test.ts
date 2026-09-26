import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { CollaboratorWorkCreateRequest } from '@lucy-spa/contracts';
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
import { EmployeeService } from '../employees/employee.service.js';
import { businessToday, day } from '../employees/employment.js';
import { LeaveService } from '../leave/leave.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { collaboratorWorkCovering, isoWeekday } from './collaborator-work.rules.js';
import { CollaboratorWorkService } from './collaborator-work.service.js';

const PASSWORD = 'a calm lotus evening 2026';
const shift = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Collaborator work schedule and agreed pay (follow-up Step 6); all fixtures roll back',
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
    const passwords = new PasswordService();
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const userIds: string[] = [];
    const rollback = new Error('Intentional collaborator work integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const hash = await passwords.hashForSetting(PASSWORD);
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
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const work = new CollaboratorWorkService(runner, throttle);
            const employees = new EmployeeService(environment, runner, throttle, passwords);
            const leave = new LeaveService(runner, throttle);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            // Branches open 09:00–21:00 every day except Sunday (closed).
            const branch = async (label: string) => {
              const id = (
                await tx.branch.create({
                  data: { code: `IT-CW-${label}-${run}`, name: `Branch ${label}` },
                  select: { id: true },
                })
              ).id;
              for (let weekday = 1; weekday <= 7; weekday += 1) {
                await tx.branchOperatingHours.create({
                  data:
                    weekday === 7
                      ? { branchId: id, isoWeekday: weekday, isClosed: true }
                      : {
                          branchId: id,
                          isoWeekday: weekday,
                          opensAtMinute: 540,
                          closesAtMinute: 1260,
                        },
                });
              }
              return id;
            };
            const A = await branch('A');
            const B = await branch('B');
            const today = day(await businessToday(tx, [A]));
            // The next date (after today) with the given ISO weekday.
            const next = (weekday: number, after = today) => {
              for (let offset = 1; offset <= 14; offset += 1) {
                const candidate = shift(after, offset);
                if (isoWeekday(new Date(`${candidate}T00:00:00.000Z`)) === weekday)
                  return candidate;
              }
              throw new Error('unreachable');
            };
            const phone = () => `+84915${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            const principal = async (
              kind: 'EMPLOYEE' | 'OWNER',
              branches: string[] = [],
              classification: string | null = null,
              since = shift(today, -30),
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
                  emailCanonical: `cw-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `cw-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `CW-${sequence}-${run}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture address',
                          },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              for (const branchId of branches) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: id },
                });
              }
              if (classification) {
                await tx.$executeRaw`
                  INSERT INTO employment_classification_changes
                    (employee_user_id, classification, effective_date, reason)
                  VALUES (${id}::uuid, ${classification}::"EmploymentClassification",
                    ${since}::date, 'fixture')`;
              }
              return id;
            };
            const grant = async (userId: string, codes: PermissionCode[], branches: string[]) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `IT_CW_${run}_${sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                  },
                },
                select: { id: true },
              });
              for (const branchId of branches) {
                await tx.userRoleAssignment.create({
                  data: { userId, roleId: role.id, scopeKind: 'BRANCH', branchId },
                });
              }
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
            const fails = (promise: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                promise,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );

            // Actors.
            const scheduler = await principal('EMPLOYEE', [A, B], 'OFFICIAL_EMPLOYEE');
            await grant(scheduler, ['MANAGE_WORK_SCHEDULE', 'VIEW_WORK_SCHEDULE'], [A, B]);
            const payManager = await principal('EMPLOYEE', [A, B], 'OFFICIAL_EMPLOYEE');
            await grant(
              payManager,
              [
                'MANAGE_WORK_SCHEDULE',
                'MANAGE_EMPLOYEE_PAY',
                'VIEW_EMPLOYEE_PAY',
                'MANAGE_EMPLOYEE_STATUS',
                'VIEW_EMPLOYEES',
              ],
              [A, B],
            );
            const viewer = await principal('EMPLOYEE', [A], 'OFFICIAL_EMPLOYEE');
            await grant(viewer, ['VIEW_WORK_SCHEDULE'], [A]);
            const ctv = await principal('EMPLOYEE', [A, B], 'COLLABORATOR');
            const ctv2 = await principal('EMPLOYEE', [A], 'COLLABORATOR');
            const official = await principal('EMPLOYEE', [A], 'OFFICIAL_EMPLOYEE');
            const trainee = await principal('EMPLOYEE', [A], 'TRAINEE');
            const schedulerSession = await login(scheduler);
            const paySession = await login(payManager);
            const viewerSession = await login(viewer);
            const ctvSession = await login(ctv);
            const ctv2Session = await login(ctv2);
            const monday = next(1);
            const tuesday = next(2);
            const sunday = next(7);
            const input = (
              extra: Partial<CollaboratorWorkCreateRequest>,
            ): CollaboratorWorkCreateRequest => ({
              employeeId: ctv,
              branchId: A,
              workDate: monday,
              mode: 'SHIFT',
              startTime: '13:00',
              endTime: '18:00',
              ...extra,
            });
            const rowOf = (id: string) =>
              tx.collaboratorWorkOccurrence.findUniqueOrThrow({ where: { id } });

            let shiftId = '';
            let fullDayId = '';

            await context.test(
              '1, 12, 15. a SHIFT with the agreed pay stored exactly',
              async () => {
                const created = await work.create(paySession, input({ agreedPayVnd: '80000' }));
                shiftId = created.id;
                assert.deepEqual(
                  [
                    created.mode,
                    created.startTime,
                    created.endTime,
                    created.agreedPayVnd,
                    created.status,
                  ],
                  ['SHIFT', '13:00', '18:00', '80000', 'SCHEDULED'],
                );
                assert.equal((await rowOf(shiftId)).agreedPayVnd, 80_000n, 'never hours × rate');
              },
            );

            await context.test(
              '2–4, 6. FULL_DAY snapshots the branch hours; closed days refused',
              async () => {
                const full = await work.create(
                  paySession,
                  input({ workDate: tuesday, mode: 'FULL_DAY', agreedPayVnd: '150000' }),
                );
                fullDayId = full.id;
                assert.deepEqual([full.startTime, full.endTime], ['09:00', '21:00']);
                // Branch hours change later: the agreed occurrence keeps its snapshot.
                await tx.branchOperatingHours.update({
                  where: { branchId_isoWeekday: { branchId: A, isoWeekday: 2 } },
                  data: { opensAtMinute: 600, closesAtMinute: 1200, rowVersion: { increment: 1 } },
                });
                const kept = await rowOf(fullDayId);
                assert.deepEqual([kept.startMinute, kept.endMinute], [540, 1260]);
                // A pay-only edit keeps the snapshot too.
                const repriced = await work.update(paySession, fullDayId, {
                  expectedVersion: full.version,
                  agreedPayVnd: '160000',
                });
                assert.deepEqual(
                  [repriced.startTime, repriced.endTime, repriced.agreedPayVnd],
                  ['09:00', '21:00', '160000'],
                );
                await tx.branchOperatingHours.update({
                  where: { branchId_isoWeekday: { branchId: A, isoWeekday: 2 } },
                  data: { opensAtMinute: 540, closesAtMinute: 1260, rowVersion: { increment: 1 } },
                });
                await fails(
                  work.create(paySession, input({ workDate: sunday, mode: 'FULL_DAY' })),
                  'CONFLICT',
                  'branchClosed',
                );
              },
            );

            await context.test(
              '5, 7–9. hours, order and overlap (same and cross branch)',
              async () => {
                await fails(
                  work.create(schedulerSession, input({ startTime: '07:00', endTime: '10:00' })),
                  'CONFLICT',
                  'branchHours',
                );
                await fails(
                  work.create(schedulerSession, input({ startTime: '20:00', endTime: '22:00' })),
                  'CONFLICT',
                  'branchHours',
                );
                for (const [startTime, endTime] of <[string, string][]>[
                  ['14:00', '14:00'],
                  ['15:00', '14:00'],
                ]) {
                  await fails(
                    work.create(schedulerSession, input({ startTime, endTime })),
                    'VALIDATION_FAILED',
                    'endTime',
                  );
                }
                // 8. same branch overlap with 13:00–18:00.
                await fails(
                  work.create(schedulerSession, input({ startTime: '17:00', endTime: '19:00' })),
                  'CONFLICT',
                  'overlap',
                );
                // 9. cross-branch overlap.
                await fails(
                  work.create(
                    schedulerSession,
                    input({ branchId: B, startTime: '10:00', endTime: '13:30' }),
                  ),
                  'CONFLICT',
                  'overlap',
                );
                // Adjacent is fine; FULL_DAY conflicts with any other work that date.
                const morning = await work.create(
                  schedulerSession,
                  input({ branchId: B, startTime: '09:00', endTime: '13:00' }),
                );
                assert.equal(morning.status, 'SCHEDULED');
                await fails(
                  work.create(schedulerSession, input({ branchId: B, mode: 'FULL_DAY' })),
                  'CONFLICT',
                  'overlap',
                );
                await fails(
                  work.create(
                    schedulerSession,
                    input({ workDate: tuesday, startTime: '09:00', endTime: '10:00' }),
                  ),
                  'CONFLICT',
                  'overlap',
                );
              },
            );

            await context.test(
              '10–11, 26. who can be scheduled; the Owner acts without a profile',
              async () => {
                for (const target of [official, trainee]) {
                  await fails(
                    work.create(schedulerSession, input({ employeeId: target })),
                    'CONFLICT',
                    'classification',
                  );
                }
                const owner = existingOwner?.id ?? (await principal('OWNER'));
                await fails(
                  work.create(schedulerSession, input({ employeeId: owner })),
                  'NOT_FOUND',
                );
                // 11. ctv2 has no assignment at B.
                await fails(
                  work.create(schedulerSession, input({ employeeId: ctv2, branchId: B })),
                  'CONFLICT',
                  'branchAssignment',
                );
                // Never oneself.
                await grant(ctv2, ['MANAGE_WORK_SCHEDULE'], [A]);
                await fails(
                  work.create(
                    await login(ctv2),
                    input({ employeeId: ctv2, startTime: '09:00', endTime: '10:00' }),
                  ),
                  'FORBIDDEN',
                );
                // 26. the Owner schedules and sets pay with no employee profile of their own.
                const ownerSession = await login(owner);
                const byOwner = await work.create(
                  ownerSession,
                  input({ employeeId: ctv2, workDate: next(3), agreedPayVnd: '70000' }),
                );
                assert.equal(byOwner.agreedPayVnd, '70000');
                assert.equal(await tx.employeeProfile.count({ where: { userId: owner } }), 0);
                // Options: hours and who can be scheduled at A that date.
                const options = await work.options(ownerSession, { branchId: A, workDate: monday });
                assert.deepEqual(options.window, { startTime: '09:00', endTime: '21:00' });
                const ids = options.collaborators.map((row) => row.id);
                assert.ok(ids.includes(ctv) && ids.includes(ctv2));
                assert.ok(!ids.includes(official) && !ids.includes(trainee));
                assert.equal(
                  (await work.options(ownerSession, { branchId: A, workDate: sunday })).window,
                  null,
                );
              },
            );

            await context.test(
              '14–15, 24. pay needs the pay permission; stale versions refused',
              async () => {
                await fails(
                  work.create(
                    schedulerSession,
                    input({ workDate: next(4), agreedPayVnd: '50000' }),
                  ),
                  'FORBIDDEN',
                  'agreedPayVnd',
                );
                // A scheduler may create without pay (not agreed yet) and never sees pay.
                const unpriced = await work.create(schedulerSession, input({ workDate: next(4) }));
                assert.ok(!('agreedPayVnd' in unpriced));
                const seen = (await work.list(schedulerSession, { from: monday, to: monday }))
                  .items;
                assert.ok(seen.length > 0 && seen.every((row) => !('agreedPayVnd' in row)));
                await fails(
                  work.update(schedulerSession, unpriced.id, {
                    expectedVersion: unpriced.version,
                    agreedPayVnd: '60000',
                  }),
                  'FORBIDDEN',
                  'agreedPayVnd',
                );
                // A scheduler can still move the time; the (absent) pay is untouched.
                const moved = await work.update(schedulerSession, unpriced.id, {
                  expectedVersion: unpriced.version,
                  startTime: '14:00',
                  endTime: '17:00',
                });
                const priced = await work.update(paySession, unpriced.id, {
                  expectedVersion: moved.version,
                  agreedPayVnd: '60000',
                });
                assert.equal(priced.agreedPayVnd, '60000');
                // Moving a priced occurrence needs pay authority too.
                await fails(
                  work.update(schedulerSession, priced.id, {
                    expectedVersion: priced.version,
                    branchId: B,
                  }),
                  'FORBIDDEN',
                  'agreedPayVnd',
                );
                // 24. stale version.
                await fails(
                  work.update(paySession, priced.id, {
                    expectedVersion: moved.version,
                    agreedPayVnd: '1',
                  }),
                  'CONFLICT',
                );
                assert.equal((await rowOf(priced.id)).agreedPayVnd, 60_000n);
              },
            );

            await context.test(
              '13, 25. attendance never changes pay; the booking read contract',
              async () => {
                // ctv checks in today at A (attendance is separate from the schedule).
                await tx.$executeRaw`
                INSERT INTO attendance_records (employee_user_id, branch_id, business_date, check_in_at)
                VALUES (${ctv}::uuid, ${A}::uuid,
                  (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, now())`;
                assert.equal((await rowOf(shiftId)).agreedPayVnd, 80_000n);
                const date = new Date(`${monday}T00:00:00.000Z`);
                const covered = (branchId: string, start: number, end: number) =>
                  collaboratorWorkCovering(tx, {
                    employeeUserId: ctv,
                    branchId,
                    workDate: date,
                    startMinute: start,
                    endMinute: end,
                  });
                assert.equal((await covered(A, 13 * 60, 14 * 60))?.id, shiftId);
                assert.equal((await covered(A, 13 * 60, 18 * 60))?.id, shiftId);
                assert.equal(await covered(A, 12 * 60, 14 * 60), null, 'starts before the shift');
                assert.equal(await covered(A, 17 * 60, 19 * 60), null, 'ends after the shift');
                assert.equal(await covered(B, 13 * 60, 14 * 60), null, 'another branch');
                // FULL_DAY uses its snapshot window.
                const full = await collaboratorWorkCovering(tx, {
                  employeeUserId: ctv,
                  branchId: A,
                  workDate: new Date(`${tuesday}T00:00:00.000Z`),
                  startMinute: 9 * 60,
                  endMinute: 21 * 60,
                });
                assert.equal(full?.id, fullDayId);
              },
            );

            await context.test(
              '16–17. past dates need a reason; cancel keeps the row',
              async () => {
                const yesterday = shift(today, -1);
                const pastWeekday = isoWeekday(new Date(`${yesterday}T00:00:00.000Z`));
                const workDate = pastWeekday === 7 ? shift(today, -2) : yesterday;
                await fails(
                  work.create(paySession, input({ workDate, agreedPayVnd: '80000' })),
                  'VALIDATION_FAILED',
                  'reason',
                );
                const past = await work.create(
                  paySession,
                  input({ workDate, agreedPayVnd: '80000', reason: 'Ghi nhận buổi làm hôm qua' }),
                );
                await fails(
                  work.update(paySession, past.id, {
                    expectedVersion: past.version,
                    agreedPayVnd: '90000',
                  }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                await fails(
                  work.cancel(paySession, shiftId, { expectedVersion: 1, reason: '   ' }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                const cancelled = await work.cancel(paySession, shiftId, {
                  expectedVersion: 1,
                  reason: 'Khách hủy lịch',
                });
                assert.equal(cancelled.status, 'CANCELLED');
                const row = await rowOf(shiftId);
                assert.equal(row.status, 'CANCELLED');
                assert.equal(row.cancelledByUserId, payManager);
                assert.equal(row.agreedPayVnd, 80_000n, 'history kept');
                await fails(
                  work.update(paySession, shiftId, {
                    expectedVersion: cancelled.version,
                    startTime: '14:00',
                  }),
                  'CONFLICT',
                  'status',
                );
                // The database refuses deletes and rewriting a cancelled row.
                await assert.rejects(
                  isolated(() => tx.collaboratorWorkOccurrence.delete({ where: { id: shiftId } })),
                  /never deleted/,
                );
                await assert.rejects(
                  isolated(() =>
                    tx.collaboratorWorkOccurrence.update({
                      where: { id: shiftId },
                      data: {
                        status: 'SCHEDULED',
                        cancelledAt: null,
                        cancelledByUserId: null,
                        cancelReason: null,
                        rowVersion: { increment: 1 },
                      },
                    }),
                  ),
                  /cannot be rewritten/,
                );
                const audit = await tx.auditEvent.findMany({
                  where: { entityId: shiftId },
                  orderBy: { occurredAt: 'asc' },
                });
                assert.deepEqual(
                  audit.map((row) => row.action),
                  ['COLLABORATOR_WORK_SCHEDULED', 'COLLABORATOR_WORK_CANCELLED'],
                );
                assert.equal(audit[1]?.reason, 'Khách hủy lịch');
                assert.equal(audit[1]?.dataClassification, 'EMPLOYEE_PAY');
              },
            );

            await context.test(
              '20–23. leave refused for CTV; own view with pay; others by permission',
              async () => {
                await fails(
                  leave.create(ctvSession, {
                    leaveType: 'PERSONAL',
                    startDate: shift(today, 7),
                    endDate: shift(today, 7),
                    reason: 'Personal',
                  }),
                  'CONFLICT',
                  'classification',
                );
                const range = { from: shift(today, -3), to: shift(today, 14) };
                const mine = (await work.mine(ctvSession, range)).items;
                assert.ok(mine.length >= 3);
                assert.ok(mine.every((row) => row.employeeId === ctv && 'agreedPayVnd' in row));
                assert.ok(mine.some((row) => row.agreedPayVnd === '160000'));
                // 22. ctv cannot read another collaborator's pay (or the schedule list at all).
                const theirs = (await work.mine(ctv2Session, range)).items;
                assert.ok(theirs.every((row) => row.employeeId === ctv2));
                // Without a schedule permission the management list shows nothing.
                assert.deepEqual((await work.list(ctvSession, range)).items, []);
                // 23. viewer: branch A only, no pay; pay manager: both branches with pay.
                const viewed = (await work.list(viewerSession, range)).items;
                assert.ok(viewed.length > 0);
                assert.ok(viewed.every((row) => row.branchId === A && !('agreedPayVnd' in row)));
                const managed = (await work.list(paySession, range)).items;
                assert.ok(managed.some((row) => row.branchId === B));
                assert.ok(managed.every((row) => 'agreedPayVnd' in row));
                await fails(
                  work.options(viewerSession, { branchId: A, workDate: monday }),
                  'FORBIDDEN',
                );
              },
            );

            await context.test(
              '18–19. COLLABORATOR → ENDED cancels future work only, atomically',
              async () => {
                const ended = await principal('EMPLOYEE', [A], 'COLLABORATOR');
                const yesterday = shift(today, -1);
                const pastDate =
                  isoWeekday(new Date(`${yesterday}T00:00:00.000Z`)) === 7
                    ? shift(today, -2)
                    : yesterday;
                const past = await work.create(
                  paySession,
                  input({
                    employeeId: ended,
                    workDate: pastDate,
                    agreedPayVnd: '80000',
                    reason: 'Đã làm',
                  }),
                );
                const soon = await work.create(
                  paySession,
                  input({ employeeId: ended, workDate: monday }),
                );
                const later = await work.create(
                  paySession,
                  input({ employeeId: ended, workDate: next(1, monday), mode: 'FULL_DAY' }),
                );
                const employee = await employees.get(paySession, ended);
                // Ends after `monday`: the occurrence on monday stays; the later one is cancelled.
                await employees.changeClassification(paySession, ended, {
                  expectedVersion: employee.version,
                  classification: 'ENDED',
                  effectiveDate: shift(monday, 1),
                  reason: 'Nghỉ việc',
                });
                assert.equal((await rowOf(past.id)).status, 'SCHEDULED', 'history untouched');
                assert.equal((await rowOf(soon.id)).status, 'SCHEDULED', 'before the end date');
                const cancelled = await rowOf(later.id);
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelReason, 'Nghỉ việc');
                assert.ok(
                  await tx.auditEvent.findFirst({
                    where: { entityId: later.id, action: 'COLLABORATOR_WORK_CANCELLED' },
                  }),
                );
                // Nothing new can be scheduled after the end date.
                await fails(
                  work.create(paySession, input({ employeeId: ended, workDate: next(2, monday) })),
                  'CONFLICT',
                  'classification',
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(await database.branch.count({ where: { code: { endsWith: run } } }), 0);
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

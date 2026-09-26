import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { IncomePeriod, MyIncomeResponse } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { businessToday, day } from '../employees/employment.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { MyIncomeService } from './my-income.service.js';

const PASSWORD = 'a calm lotus evening 2026';
const shift = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'My Income (follow-up Step 7): a read model over authoritative sources; all fixtures roll back',
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
    const rollback = new Error('Intentional My Income integration rollback');
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
            const income = new MyIncomeService(runner, throttle);
            await syncPermissionCatalog(tx);
            let sequence = 0;
            const branch = async (label: string, timezone: string) =>
              (
                await tx.branch.create({
                  data: { code: `IT-MI-${label}-${run}`, name: `Branch ${label}`, timezone },
                  select: { id: true },
                })
              ).id;
            const A = await branch('A', 'Asia/Ho_Chi_Minh');
            const T = await branch('T', 'Asia/Tokyo');
            const today = day(await businessToday(tx, [A]));
            const phone = () => `+84914${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            const principal = async (
              kind: 'EMPLOYEE' | 'OWNER' | 'CUSTOMER',
              classifications: [string, string][] = [],
              extra: { baseSalaryVnd?: bigint } = {},
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
                  emailCanonical: `mi-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `mi-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `MI-${sequence}-${run}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture address',
                            baseSalaryVnd: extra.baseSalaryVnd ?? null,
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              if (kind === 'EMPLOYEE') {
                for (const branchId of [A, T]) {
                  await tx.employeeBranchAssignment.create({
                    data: { employeeUserId: id, branchId, grantedByUserId: id },
                  });
                }
              }
              for (const [classification, since] of classifications) {
                await tx.$executeRaw`
                  INSERT INTO employment_classification_changes
                    (employee_user_id, classification, effective_date, reason)
                  VALUES (${id}::uuid, ${classification}::"EmploymentClassification",
                    ${since}::date, 'fixture')`;
              }
              return id;
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              return (
                await sessions.rotateAuthenticated(
                  (await sessions.createAnonymous(tx)).token,
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
            // Occurrences inserted directly (the Step 6 rules are tested there).
            const work = async (
              employeeUserId: string,
              branchId: string,
              workDate: string,
              pay: bigint | null,
              mode: 'SHIFT' | 'FULL_DAY' = 'SHIFT',
              minutes: [number, number] = [780, 1080],
            ) =>
              (
                await tx.collaboratorWorkOccurrence.create({
                  data: {
                    employeeUserId,
                    branchId,
                    workDate: new Date(`${workDate}T00:00:00.000Z`),
                    mode,
                    startMinute: minutes[0],
                    endMinute: minutes[1],
                    agreedPayVnd: pay,
                    createdByUserId: employeeUserId,
                    updatedByUserId: employeeUserId,
                  },
                  select: { id: true },
                })
              ).id;
            const fails = (promise: Promise<unknown>, code: string) =>
              assert.rejects(
                promise,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const view = (token: string, period: IncomePeriod, date?: string) =>
              income.get(token, { period, ...(date ? { date } : {}) });
            const totals = (response: MyIncomeResponse) => [
              response.collaboratorWork?.totalAgreedPayVnd,
              response.collaboratorWork?.occurrenceCount,
              response.collaboratorWork?.unagreedCount,
            ];

            const ctv = await principal('EMPLOYEE', [['COLLABORATOR', '2026-01-01']]);
            const other = await principal('EMPLOYEE', [['COLLABORATOR', '2026-01-01']]);
            // Week of Monday 2026-10-05 … Sunday 2026-10-11.
            await work(ctv, A, '2026-10-05', 80_000n);
            await work(ctv, A, '2026-10-05', null, 'SHIFT', [540, 720]);
            await work(ctv, T, '2026-10-07', 150_000n, 'FULL_DAY', [540, 1260]);
            await work(ctv, A, '2026-10-11', 50_000n, 'SHIFT', [600, 720]);
            await work(ctv, A, '2026-10-12', 70_000n);
            const cancelled = await work(ctv, A, '2026-10-06', 60_000n);
            await tx.collaboratorWorkOccurrence.update({
              where: { id: cancelled },
              data: {
                status: 'CANCELLED',
                cancelledByUserId: ctv,
                cancelledAt: new Date(),
                cancelReason: 'Khách hủy',
                rowVersion: { increment: 1 },
              },
            });
            await work(ctv, A, '2026-09-30', 40_000n);
            await work(ctv, T, '2026-10-31', 30_000n);
            await work(ctv, T, '2026-11-01', 20_000n);
            await work(other, A, '2026-10-05', 999_000n);
            const ctvSession = await login(ctv);

            await context.test(
              '1, 9, 13–19. day: agreed total, count and unagreed (null is never 0)',
              async () => {
                const response = await view(ctvSession, 'DAY', '2026-10-05');
                assert.equal(response.kind, 'EMPLOYEE');
                assert.equal(response.title, 'COLLABORATOR');
                assert.deepEqual(response.period, {
                  kind: 'DAY',
                  date: '2026-10-05',
                  from: '2026-10-05',
                  to: '2026-10-05',
                });
                assert.deepEqual(totals(response), ['80000', 2, 1]);
                const pays = response.collaboratorWork?.items.map((item) => item.agreedPayVnd);
                assert.deepEqual(pays?.slice().sort(), ['80000', null].sort());
                assert.equal(response.baseSalary, null, 'no base salary for a collaborator');
              },
            );

            await context.test(
              '10, 12, 14–16. ISO week (Monday–Sunday) with branch attribution',
              async () => {
                for (const anchor of ['2026-10-05', '2026-10-08', '2026-10-11']) {
                  const week = await view(ctvSession, 'WEEK', anchor);
                  assert.equal(week.period.from, '2026-10-05', anchor);
                  assert.equal(week.period.to, '2026-10-11', anchor);
                  // 80,000 + 150,000 + 50,000; the cancelled 60,000 never counts.
                  assert.deepEqual(totals(week), ['280000', 4, 1], anchor);
                  assert.ok(!week.collaboratorWork?.items.some((item) => item.id === cancelled));
                  assert.deepEqual(
                    week.collaboratorWork?.byBranch.map((row) => [
                      row.branchId,
                      row.totalAgreedPayVnd,
                      row.occurrenceCount,
                      row.unagreedCount,
                    ]),
                    [
                      [A, '130000', 3, 1],
                      [T, '150000', 1, 0],
                    ].sort(([a], [b]) => String(a).localeCompare(String(b))),
                  );
                  const tokyo = week.collaboratorWork?.items.find((item) => item.branchId === T);
                  assert.deepEqual(
                    [tokyo?.mode, tokyo?.startTime, tokyo?.endTime],
                    ['FULL_DAY', '09:00', '21:00'],
                  );
                }
                const next = await view(ctvSession, 'WEEK', '2026-10-12');
                assert.deepEqual([next.period.from, next.period.to], ['2026-10-12', '2026-10-18']);
                assert.deepEqual(totals(next), ['70000', 1, 0]);
                // A week across a month boundary: 2026-09-28 … 2026-10-04.
                const boundary = await view(ctvSession, 'WEEK', '2026-10-01');
                assert.deepEqual(
                  [boundary.period.from, boundary.period.to],
                  ['2026-09-28', '2026-10-04'],
                );
                assert.deepEqual(totals(boundary), ['40000', 1, 0]);
              },
            );

            await context.test('11, 13. calendar month by branch-local work date', async () => {
              const october = await view(ctvSession, 'MONTH', '2026-10-20');
              assert.deepEqual(
                [october.period.from, october.period.to],
                ['2026-10-01', '2026-10-31'],
              );
              // 80k + 150k + 50k + 70k + 30k (Tokyo, 31/10); 30/09 and 01/11 belong elsewhere.
              assert.deepEqual(totals(october), ['380000', 6, 1]);
              const november = await view(ctvSession, 'MONTH', '2026-11-15');
              assert.deepEqual(totals(november), ['20000', 1, 0]);
              assert.equal(november.collaboratorWork?.items[0]?.branchId, T);
              assert.equal(november.collaboratorWork?.items[0]?.workDate, '2026-11-01');
            });

            await context.test(
              '2, 20, 23, 25. own data only; attendance and reads change nothing',
              async () => {
                const october = await view(ctvSession, 'MONTH', '2026-10-01');
                assert.ok(!JSON.stringify(october).includes('999000'), 'no one else’s pay');
                assert.ok(!JSON.stringify(october).includes(other));
                const otherView = await view(await login(other), 'DAY', '2026-10-05');
                assert.deepEqual(totals(otherView), ['999000', 1, 0]);
                const counts = async () => [
                  await tx.collaboratorWorkOccurrence.count(),
                  await tx.auditEvent.count(),
                  await tx.attendanceRecord.count({ where: { employeeUserId: ctv } }),
                ];
                const before = await counts();
                await view(ctvSession, 'WEEK', '2026-10-05');
                assert.deepEqual(await counts(), before, 'a read writes nothing (no ledger)');
                await tx.$executeRaw`
                INSERT INTO attendance_records (employee_user_id, branch_id, business_date, check_in_at)
                VALUES (${ctv}::uuid, ${A}::uuid,
                  (now() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, now())`;
                assert.deepEqual(
                  totals(await view(ctvSession, 'MONTH', '2026-10-01')),
                  totals(october),
                );
                // The default period is the month of the member's business today.
                const current = await income.get(ctvSession, {});
                assert.equal(current.period.kind, 'MONTH');
                assert.equal(current.period.date, today);
              },
            );

            await context.test(
              '6–8, 24. official, manager and trainee: only what exists',
              async () => {
                const official = await principal(
                  'EMPLOYEE',
                  [['OFFICIAL_EMPLOYEE', '2026-01-01']],
                  { baseSalaryVnd: 9_000_000n },
                );
                const response = await view(await login(official), 'MONTH', '2026-10-01');
                assert.deepEqual(response.baseSalary, { amountVnd: '9000000', unit: 'MONTH' });
                assert.equal(response.collaboratorWork, null, 'no invented collaborator income');
                assert.deepEqual(response.unavailableSources, [
                  'SERVICE_TOUR',
                  'COMMISSION',
                  'TIPS',
                  'ADJUSTMENTS',
                ]);
                // No fake zeroes, and no amount derived from the base salary.
                assert.deepEqual(Object.keys(response).sort(), [
                  'baseSalary',
                  'classification',
                  'collaboratorWork',
                  'kind',
                  'period',
                  'title',
                  'unavailableSources',
                ]);
                assert.ok(!/"0"|:0[,}]/.test(JSON.stringify(response)));
                assert.equal(
                  JSON.stringify(await view(await login(official), 'DAY', '2026-10-01')).includes(
                    '9000000',
                  ),
                  true,
                  'the same monthly amount, never prorated per day',
                );
                // Manager = official + manager-group role: same compensation semantics.
                const manager = await principal('EMPLOYEE', [['OFFICIAL_EMPLOYEE', '2026-01-01']], {
                  baseSalaryVnd: 12_000_000n,
                });
                const role = await tx.role.create({
                  data: {
                    code: `IT_MI_MGR_${run}`,
                    displayNameVi: 'QL',
                    displayNameEn: 'M',
                    isManagerGroup: true,
                  },
                  select: { id: true },
                });
                await tx.userRoleAssignment.create({
                  data: { userId: manager, roleId: role.id, scopeKind: 'GLOBAL' },
                });
                const managed = await view(await login(manager), 'MONTH', '2026-10-01');
                assert.equal(managed.title, 'MANAGER');
                assert.equal(managed.classification, 'OFFICIAL_EMPLOYEE');
                assert.deepEqual(managed.baseSalary, { amountVnd: '12000000', unit: 'MONTH' });
                // Official without a configured salary: "not configured", never 0.
                const unset = await principal('EMPLOYEE', [['OFFICIAL_EMPLOYEE', '2026-01-01']]);
                assert.deepEqual((await view(await login(unset), 'MONTH')).baseSalary, {
                  amountVnd: null,
                  unit: 'MONTH',
                });
                // Trainee: nothing fabricated.
                const trainee = await principal('EMPLOYEE', [['TRAINEE', '2026-01-01']]);
                const learner = await view(await login(trainee), 'MONTH');
                assert.deepEqual(
                  [
                    learner.title,
                    learner.baseSalary,
                    learner.collaboratorWork,
                    learner.unavailableSources,
                  ],
                  ['TRAINEE', null, null, []],
                );
              },
            );

            await context.test(
              '21–22. CTV → OFFICIAL keeps the earlier collaborator income as is',
              async () => {
                const promoted = await principal(
                  'EMPLOYEE',
                  [
                    ['COLLABORATOR', shift(today, -100)],
                    ['OFFICIAL_EMPLOYEE', shift(today, -5)],
                  ],
                  { baseSalaryVnd: 8_500_000n },
                );
                const earlier = shift(today, -20);
                await work(promoted, A, earlier, 45_000n);
                const session = await login(promoted);
                const then = await view(session, 'DAY', earlier);
                assert.equal(then.classification, 'OFFICIAL_EMPLOYEE', 'current classification');
                assert.deepEqual(totals(then), ['45000', 1, 0], 'history kept, not converted');
                assert.deepEqual(then.baseSalary, { amountVnd: '8500000', unit: 'MONTH' });
                const now = await view(session, 'DAY', today);
                assert.equal(now.collaboratorWork, null, 'no collaborator work now: not shown');
              },
            );

            await context.test(
              '3–5. anonymous and customers refused; the Owner has no profile',
              async () => {
                await fails(income.get(undefined, { period: 'DAY' }), 'AUTHENTICATION_REQUIRED');
                await fails(
                  income.get((await sessions.createAnonymous(tx)).token, {}),
                  'AUTHENTICATION_REQUIRED',
                );
                const customer = await principal('CUSTOMER');
                await fails(income.get(await login(customer), {}), 'FORBIDDEN');
                await fails(income.get(ctvSession, { period: 'YEAR' }), 'VALIDATION_FAILED');
                const owner = existingOwner?.id ?? (await principal('OWNER'));
                const response = await income.get(await login(owner), {
                  period: 'WEEK',
                  date: '2026-10-08',
                });
                assert.deepEqual(
                  [response.kind, response.title, response.baseSalary, response.collaboratorWork],
                  ['OWNER', 'OWNER', null, null],
                );
                assert.deepEqual(response.unavailableSources, []);
                assert.equal(await tx.employeeProfile.count({ where: { userId: owner } }), 0);
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

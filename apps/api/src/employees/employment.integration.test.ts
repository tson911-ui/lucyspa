import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EmployeeCreateRequest, EmployeeResponse } from '@lucy-spa/contracts';
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
import { EmployeeDirectoryService } from './employee-directory.service.js';
import { EmployeeService } from './employee.service.js';
import { businessToday, day } from './employment.js';

const PASSWORD = 'a calm lotus evening 2026';
const STAFF: PermissionCode[] = ['VIEW_EMPLOYEES', 'CREATE_EMPLOYEES', 'UPDATE_EMPLOYEES'];

const shift = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'employment classification history (Employee management Step 1); all fixtures roll back',
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
    const rollback = new Error('Intentional employment classification integration rollback');
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
            const throttle = new AuthThrottleService(environment);
            const employees = new EmployeeService(environment, runner, throttle);
            const directory = new EmployeeDirectoryService(runner, throttle);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            const branch = async (label: string) =>
              (
                await tx.branch.create({
                  data: { code: `IT-${label}-${run}`, name: `Branch ${label}` },
                  select: { id: true },
                })
              ).id;
            const [A, B] = [await branch('A'), await branch('B')];
            const phone = () => `+84918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            let sequence = 0;

            // Direct fixture principals; the API under test never creates these.
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER',
              branches: string[] = [],
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
                  preferredLocale: 'en',
                  emailCanonical: `fixture-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `fixture-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `FIX-${sequence}-${run}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture address',
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
              for (const branchId of branches) {
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
                  code: `IT_${run}_${sequence}`,
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
            const login = async (userId: string, fresh = false) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              const evidence = {
                userId,
                passwordHash: user.passwordHash!,
                credentialVersion: user.credentialVersion,
                authzVersion: user.authzVersion,
              };
              const anonymous = await sessions.createAnonymous(tx);
              const signedIn = await sessions.rotateAuthenticated(
                anonymous.token,
                evidence,
                { reauthenticated: false },
                tx,
              );
              if (!fresh) return signedIn.token;
              return (
                await sessions.rotateAuthenticated(
                  signedIn.token,
                  evidence,
                  { reauthenticated: true },
                  tx,
                )
              ).token;
            };
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            // SQL guard rejections (23514 / 23505) are asserted directly against the table.
            const rejectedBySql = (work: () => Promise<unknown>, pattern: RegExp) =>
              assert.rejects(isolated(work), (error: unknown) =>
                pattern.test(error instanceof Error ? error.message : String(error)),
              );
            const today = day(await businessToday(tx, [A]));
            const input = (
              branchIds: string[],
              extra: Partial<EmployeeCreateRequest> = {},
            ): EmployeeCreateRequest => {
              sequence += 1;
              return {
                employeeId: `emp-${sequence}-${run.toLowerCase()}`,
                fullName: `Nhân viên ${sequence}`,
                dateOfBirth: '1996-04-12',
                address: '12 Lê Lợi, Quận 1',
                phone: phone().replace('+84', '0'),
                email: null,
                locale: 'vi',
                branchIds,
                classification: 'TRAINEE',
                employmentStartDate: today,
                ...extra,
              };
            };
            const apiCreated: string[] = [];
            const track = (employee: EmployeeResponse) => {
              userIds.push(employee.id);
              apiCreated.push(employee.id);
              return employee;
            };
            const rows = (employeeUserId: string) =>
              tx.employmentClassificationChange.findMany({
                where: { employeeUserId },
                orderBy: { effectiveDate: 'asc' },
              });
            const auditOf = (subjectUserId: string, action: string) =>
              tx.auditEvent.findMany({ where: { subjectUserId, action }, orderBy: { id: 'asc' } });
            const insertRow = (employeeUserId: string, classification: string, date: string) =>
              tx.$executeRaw`
                INSERT INTO employment_classification_changes
                  (employee_user_id, classification, effective_date, reason)
                VALUES (${employeeUserId}::uuid, ${classification}::"EmploymentClassification",
                  ${date}::date, 'direct')`;

            const ownerId = existingOwner?.id ?? (await principal('OWNER'));
            const ownerSession = existingOwner ? null : await login(ownerId, true);
            // Branch A staff manager: can create trainees, cannot touch payroll eligibility.
            const manager = await principal('EMPLOYEE', [A]);
            await grant(manager, STAFF, A);
            const managerSession = await login(manager, true);
            // Branch A payroll manager: may create official employees and change classification.
            const payer = await principal('EMPLOYEE', [A]);
            await grant(payer, [...STAFF, 'MANAGE_EMPLOYEE_PAY'], A);
            const payerSession = await login(payer, true);
            const customer = await principal('CUSTOMER');
            const customerSession = await login(customer, true);

            await context.test(
              'backfill: every pre-existing employee is OFFICIAL_EMPLOYEE',
              async () => {
                const missing = await tx.$queryRaw<{ n: bigint }[]>`
                SELECT count(*) AS n FROM employee_profiles ep
                WHERE NOT (ep.user_id = ANY(${userIds}::uuid[]))
                  AND NOT EXISTS (SELECT 1 FROM employment_classification_changes c
                                  WHERE c.employee_user_id = ep.user_id)`;
                assert.equal(
                  Number(missing[0]?.n),
                  0,
                  'no employee without classification history',
                );
                const backfilled = await tx.employmentClassificationChange.findMany({
                  where: { recordedByUserId: null },
                  select: { classification: true },
                });
                assert.ok(backfilled.every((row) => row.classification === 'OFFICIAL_EMPLOYEE'));
              },
            );

            await context.test('1. create directly as TRAINEE', async () => {
              const created = track(await employees.create(managerSession, input([A])));
              const history = await rows(created.id);
              assert.deepEqual(
                history.map((row) => [row.classification, day(row.effectiveDate)]),
                [['TRAINEE', today]],
              );
              assert.equal(history[0]?.recordedByUserId, manager);
              const read = await employees.employment(payerSession, created.id, {});
              assert.equal(read.current?.classification, 'TRAINEE');
              assert.equal(read.payrollEligibleToday, false);
              assert.equal(read.today, today);
              const [audit] = await auditOf(created.id, 'EMPLOYMENT_CLASSIFICATION_RECORDED');
              assert.equal(audit?.actorUserId, manager);
              assert.deepEqual(audit?.after, { classification: 'TRAINEE', effectiveDate: today });
            });

            await context.test(
              '2–3. create directly as OFFICIAL_EMPLOYEE, no trainee history',
              async () => {
                const candidate = input([A], { classification: 'OFFICIAL_EMPLOYEE' });
                // Official employment creates payroll eligibility: CREATE_EMPLOYEES is not enough.
                await fails(employees.create(managerSession, candidate), 'FORBIDDEN');
                const created = track(await employees.create(payerSession, candidate));
                const history = await rows(created.id);
                assert.deepEqual(
                  history.map((row) => [row.classification, day(row.effectiveDate)]),
                  [['OFFICIAL_EMPLOYEE', today]],
                  'no artificial TRAINEE entry',
                );
                const read = await employees.employment(payerSession, created.id, {});
                assert.equal(read.current?.classification, 'OFFICIAL_EMPLOYEE');
                assert.equal(read.payrollEligibleToday, true);
                // The directory shows the latest recorded classification (Step 2 label).
                const [listed] = (await directory.list(payerSession, { q: created.employeeId }))
                  .items;
                assert.equal(listed?.id, created.id);
                assert.equal(listed?.classification, 'OFFICIAL_EMPLOYEE');
                assert.equal(listed?.classificationEffectiveDate, today);
              },
            );

            await context.test('4. ENDED is never an initial classification', async () => {
              const candidate = input([A], { classification: 'ENDED' as 'TRAINEE' });
              await fails(
                employees.create(payerSession, candidate),
                'VALIDATION_FAILED',
                'classification',
              );
              assert.equal(
                await tx.user.count({
                  where: { phoneCanonical: `+84${candidate.phone.slice(1)}` },
                }),
                0,
              );
              // The SQL guard also refuses ENDED as the first history row.
              const bare = await principal('EMPLOYEE', [A]);
              await rejectedBySql(() => insertRow(bare, 'ENDED', today), /cannot start as ENDED/);
            });

            let trainee = '';
            const start = shift(today, -30);
            const promotion = shift(today, 5);
            await context.test(
              '5–8. promotion keeps history; classification on a date',
              async () => {
                // A past start date records existing staff and needs a reason.
                await fails(
                  employees.create(managerSession, input([A], { employmentStartDate: start })),
                  'VALIDATION_FAILED',
                  'employmentReason',
                );
                trainee = track(
                  await employees.create(
                    managerSession,
                    input([A], {
                      employmentStartDate: start,
                      employmentReason: 'Joined last month',
                    }),
                  ),
                ).id;
                const [initial] = await rows(trainee);
                const before = await employees.employment(payerSession, trainee, {});
                const changed = await employees.changeClassification(payerSession, trainee, {
                  expectedVersion: before.version,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: promotion,
                  reason: 'Training completed',
                });
                assert.equal(changed.version, before.version + 1);
                assert.deepEqual(
                  changed.history.map((entry) => [entry.classification, entry.effectiveDate]),
                  [
                    ['TRAINEE', start],
                    ['OFFICIAL_EMPLOYEE', promotion],
                  ],
                );
                // The trainee entry is untouched.
                assert.deepEqual((await rows(trainee))[0], initial);
                // Promotion is in the future: today is still TRAINEE, not payroll-eligible.
                assert.equal(changed.current?.classification, 'TRAINEE');
                assert.equal(changed.payrollEligibleToday, false);
                const on = async (date: string) =>
                  (await employees.employment(payerSession, trainee, { date })).onDate?.entry
                    ?.classification ?? null;
                assert.equal(await on(shift(start, -1)), null, 'before employment started');
                assert.equal(await on(start), 'TRAINEE');
                assert.equal(await on(shift(promotion, -1)), 'TRAINEE');
                assert.equal(await on(promotion), 'OFFICIAL_EMPLOYEE');
                assert.equal(await on(shift(promotion, 400)), 'OFFICIAL_EMPLOYEE');
                const [audit] = await auditOf(trainee, 'EMPLOYMENT_CLASSIFICATION_CHANGED');
                assert.equal(audit?.actorUserId, payer);
                assert.equal(audit?.reason, 'Training completed');
                assert.deepEqual(audit?.before, {
                  classification: 'TRAINEE',
                  effectiveDate: start,
                });
                assert.deepEqual(audit?.after, {
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: promotion,
                  backdated: false,
                });
                await fails(
                  employees.employment(payerSession, trainee, { date: '2026-02-30' }),
                  'VALIDATION_FAILED',
                  'date',
                );
              },
            );

            await context.test(
              '9. invalid transitions are rejected; nothing follows ENDED',
              async () => {
                const version = async (id: string) =>
                  (await employees.employment(payerSession, id, {})).version;
                await fails(
                  employees.changeClassification(payerSession, trainee, {
                    expectedVersion: await version(trainee),
                    classification: 'OFFICIAL_EMPLOYEE',
                    effectiveDate: shift(promotion, 10),
                    reason: 'Again',
                  }),
                  'CONFLICT',
                  'classification',
                );
                await fails(
                  employees.changeClassification(payerSession, trainee, {
                    expectedVersion: await version(trainee),
                    classification: 'TRAINEE' as 'ENDED',
                    effectiveDate: shift(promotion, 10),
                    reason: 'Demote',
                  }),
                  'VALIDATION_FAILED',
                  'classification',
                );
                const ended = await employees.changeClassification(payerSession, trainee, {
                  expectedVersion: await version(trainee),
                  classification: 'ENDED',
                  effectiveDate: shift(promotion, 20),
                  reason: 'Left the spa',
                });
                assert.deepEqual(
                  ended.history.map((entry) => entry.classification),
                  ['TRAINEE', 'OFFICIAL_EMPLOYEE', 'ENDED'],
                );
                for (const classification of ['OFFICIAL_EMPLOYEE', 'ENDED'] as const) {
                  await fails(
                    employees.changeClassification(payerSession, trainee, {
                      expectedVersion: ended.version,
                      classification,
                      effectiveDate: shift(promotion, 30),
                      reason: 'Rehire',
                    }),
                    'CONFLICT',
                    'classification',
                  );
                }
                // TRAINEE → ENDED directly is allowed.
                const leaver = track(await employees.create(managerSession, input([A]))).id;
                const left = await employees.changeClassification(payerSession, leaver, {
                  expectedVersion: await version(leaver),
                  classification: 'ENDED',
                  effectiveDate: shift(today, 1),
                  reason: 'Did not continue training',
                });
                assert.equal(left.onDate, null);
                assert.equal(left.history.at(-1)?.classification, 'ENDED');
                // Stale version.
                await fails(
                  employees.changeClassification(payerSession, leaver, {
                    expectedVersion: left.version - 1,
                    classification: 'ENDED',
                    effectiveDate: shift(today, 2),
                    reason: 'x',
                  }),
                  'CONFLICT',
                );
                // SQL guard: disallowed transitions and any mutation of recorded history.
                await rejectedBySql(
                  () => insertRow(trainee, 'TRAINEE', shift(promotion, 40)),
                  /transition is not allowed/,
                );
                await rejectedBySql(
                  () =>
                    tx.$executeRaw`UPDATE employment_classification_changes
                    SET reason = 'rewritten' WHERE employee_user_id = ${trainee}::uuid`,
                  /append-only/,
                );
                await rejectedBySql(
                  () =>
                    tx.$executeRaw`DELETE FROM employment_classification_changes
                    WHERE employee_user_id = ${trainee}::uuid`,
                  /append-only/,
                );
                assert.equal((await rows(trainee)).length, 3);
              },
            );

            await context.test(
              '10. duplicate or earlier effective dates are rejected',
              async () => {
                const id = track(await employees.create(managerSession, input([A]))).id;
                const { version } = await employees.employment(payerSession, id, {});
                for (const effectiveDate of [today, shift(today, -1)]) {
                  await fails(
                    employees.changeClassification(ownerSession ?? payerSession, id, {
                      expectedVersion: version,
                      classification: 'OFFICIAL_EMPLOYEE',
                      effectiveDate,
                      reason: 'Same day',
                    }),
                    'VALIDATION_FAILED',
                    'effectiveDate',
                  );
                }
                await rejectedBySql(
                  () => insertRow(id, 'OFFICIAL_EMPLOYEE', today),
                  /later than the latest change|unique/i,
                );
                await rejectedBySql(
                  () => insertRow(id, 'OFFICIAL_EMPLOYEE', shift(today, -3)),
                  /later than the latest change/,
                );
                assert.equal((await rows(id)).length, 1);
              },
            );

            await context.test('11. creation and initial classification are atomic', async () => {
              const candidate = input([A], { classification: 'OFFICIAL_EMPLOYEE' });
              // Fail the transaction after the classification row is written (branch assignment).
              await isolated(async () => {
                await tx.$executeRawUnsafe(`
                  CREATE FUNCTION it_fail_assignment_${run}() RETURNS trigger LANGUAGE plpgsql
                  AS $$ BEGIN RAISE EXCEPTION 'injected assignment failure'; END $$`);
                await tx.$executeRawUnsafe(`
                  CREATE TRIGGER it_fail_assignment_${run} BEFORE INSERT
                  ON employee_branch_assignments FOR EACH ROW
                  EXECUTE FUNCTION it_fail_assignment_${run}()`);
              });
              await assert.rejects(employees.create(payerSession, candidate));
              await isolated(() =>
                tx.$executeRawUnsafe(
                  `DROP TRIGGER it_fail_assignment_${run} ON employee_branch_assignments`,
                ),
              );
              assert.equal(
                await tx.user.count({
                  where: { phoneCanonical: `+84${candidate.phone.slice(1)}` },
                }),
                0,
              );
              const orphans = await tx.$queryRaw<{ n: bigint }[]>`
                SELECT count(*) AS n FROM employment_classification_changes c
                LEFT JOIN employee_profiles ep ON ep.user_id = c.employee_user_id
                WHERE ep.user_id IS NULL`;
              assert.equal(Number(orphans[0]?.n), 0);
              // Every employee created through the API in this run has its history.
              for (const id of apiCreated) assert.ok((await rows(id)).length > 0, id);
            });

            await context.test('12. authorization', async () => {
              const id = track(
                await employees.create(
                  managerSession,
                  input([A], {
                    employmentStartDate: shift(today, -20),
                    employmentReason: 'Existing trainee',
                  }),
                ),
              ).id;
              const change = async (session: string | null, extra = {}) =>
                employees.changeClassification(session ?? undefined, id, {
                  expectedVersion: (await employees.employment(payerSession, id, {})).version,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: shift(today, 3),
                  reason: 'Promotion',
                  ...extra,
                });
              // CREATE/UPDATE_EMPLOYEES without the pay authority cannot change eligibility.
              await fails(change(managerSession), 'FORBIDDEN');
              // Pay authority must cover every branch of the employee.
              const wide = track(await employees.create(ownerSession ?? payerSession, input([A])));
              if (ownerSession) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: wide.id, branchId: B, grantedByUserId: ownerId },
                });
                await fails(
                  employees.changeClassification(payerSession, wide.id, {
                    expectedVersion: (await employees.employment(ownerSession, wide.id, {}))
                      .version,
                    classification: 'OFFICIAL_EMPLOYEE',
                    effectiveDate: shift(today, 3),
                    reason: 'Promotion',
                  }),
                  'FORBIDDEN',
                );
              }
              // Backdating (a date before today's business date) is Owner-only.
              await fails(change(payerSession, { effectiveDate: shift(today, -1) }), 'FORBIDDEN');
              // A reason is always required.
              await fails(change(payerSession, { reason: '   ' }), 'VALIDATION_FAILED', 'reason');
              // Unauthenticated and customer actors never reach the history.
              await assert.rejects(change(null), AuthError);
              await assert.rejects(change(customerSession), AuthError);
              await assert.rejects(employees.employment(customerSession, id, {}), AuthError);
              // Without VIEW_EMPLOYEES over the employee, the history is a 404.
              const outsider = await principal('EMPLOYEE', [B]);
              await insertRow(outsider, 'TRAINEE', today);
              const outsiderSession = await login(outsider, true);
              await fails(employees.employment(outsiderSession, id, {}), 'NOT_FOUND');
              // An employee reads their own history but cannot promote themself.
              const own = await employees.employment(outsiderSession, outsider, {});
              assert.equal(own.current?.classification, 'TRAINEE');
              await grant(outsider, ['MANAGE_EMPLOYEE_PAY'], B);
              const selfSession = await login(outsider, true);
              await fails(
                employees.changeClassification(selfSession, outsider, {
                  expectedVersion: own.version,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: shift(today, 3),
                  reason: 'Self promotion',
                }),
                'FORBIDDEN',
              );
              assert.equal((await rows(id)).length, 1);
              assert.equal((await rows(outsider)).length, 1);
              // Nothing was audited for the rejected attempts.
              assert.equal((await auditOf(id, 'EMPLOYMENT_CLASSIFICATION_CHANGED')).length, 0);
              // The payroll manager may promote from today on.
              const promoted = await change(payerSession);
              assert.equal(promoted.history.length, 2);
            });

            await context.test('13. the Owner is unaffected and may backdate', async () => {
              assert.equal(await tx.employeeProfile.count({ where: { userId: ownerId } }), 0);
              assert.equal(
                await tx.employmentClassificationChange.count({
                  where: { employeeUserId: ownerId },
                }),
                0,
              );
              await fails(employees.employment(payerSession, ownerId, {}), 'NOT_FOUND');
              await fails(
                employees.changeClassification(payerSession, ownerId, {
                  expectedVersion: 0,
                  classification: 'ENDED',
                  effectiveDate: today,
                  reason: 'x',
                }),
                'NOT_FOUND',
              );
              if (!ownerSession) {
                context.diagnostic('Owner exists locally: Owner backdating check skipped.');
                return;
              }
              const id = track(
                await employees.create(
                  ownerSession,
                  input([A], {
                    employmentStartDate: shift(today, -60),
                    employmentReason: 'Records',
                  }),
                ),
              ).id;
              const backdated = await employees.changeClassification(ownerSession, id, {
                expectedVersion: (await employees.employment(ownerSession, id, {})).version,
                classification: 'OFFICIAL_EMPLOYEE',
                effectiveDate: shift(today, -10),
                reason: 'Promotion recorded late',
              });
              assert.equal(backdated.current?.classification, 'OFFICIAL_EMPLOYEE');
              const [audit] = await auditOf(id, 'EMPLOYMENT_CLASSIFICATION_CHANGED');
              assert.equal((audit?.after as { backdated: boolean }).backdated, true);
              // Never before the latest recorded change (the initial start date).
              await fails(
                employees.changeClassification(ownerSession, id, {
                  expectedVersion: backdated.version,
                  classification: 'ENDED',
                  effectiveDate: shift(today, -61),
                  reason: 'x',
                }),
                'VALIDATION_FAILED',
                'effectiveDate',
              );
            });

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(
        await database.employmentClassificationChange.count({
          where: { employeeUserId: { in: userIds } },
        }),
        0,
      );
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

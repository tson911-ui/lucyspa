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
import { LoginService, type LoginPrincipal } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { EmployeeDirectoryService } from './employee-directory.service.js';
import { EmployeeService } from './employee.service.js';
import { businessToday, day } from './employment.js';

const PASSWORD = 'a calm lotus evening 2026';
const STAFF: PermissionCode[] = ['VIEW_EMPLOYEES', 'CREATE_EMPLOYEES', 'UPDATE_EMPLOYEES'];
const ACCESS_ADMIN: PermissionCode[] = [
  ...STAFF,
  'MANAGE_EMPLOYEE_ACCESS',
  'MANAGE_EMPLOYEE_PAY',
  'MANAGE_EMPLOYEE_STATUS',
];
// Workforce passwords set by the Owner/manager (existing policy: 15+ characters).
const PASSWORD_A = 'hoa sen xanh buổi sáng 2026';
const PASSWORD_B = 'một mật khẩu mới rất dài 2027';
const EMPLOYEE_ID: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMPLOYEE_ID' };

const shift = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'workforce account management: Owner/manager-set credentials and ending employment; all fixtures roll back',
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
    const rollback = new Error('Intentional workforce account integration rollback');
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
            const employees = new EmployeeService(environment, runner, throttle, passwords);
            const directory = new EmployeeDirectoryService(runner, throttle);
            const logins = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              {
                withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
                rotateAuthenticated: (token, evidence, options) =>
                  sessions.rotateAuthenticated(token, evidence, options, tx),
                resolve: (token) => sessions.resolve(token, tx),
                resolveForMutation: (token) => sessions.resolveForMutation(token, tx),
              },
              passwords,
              throttle,
            );
            await logins.onModuleInit();
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
            const A = await branch('A');
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
            // Branch A workforce administrator: creation, access, pay and status in A only.
            const admin = await principal('EMPLOYEE', [A]);
            await grant(admin, ACCESS_ADMIN, A);
            await insertRow(admin, 'OFFICIAL_EMPLOYEE', '2020-01-01');
            const adminSession = await login(admin, true);
            // The same administrator without a recent password confirmation.
            const staleSession = await login(admin, false);
            // Creates staff in A (incl. official employees) but cannot manage sign-in access.
            const creator = await principal('EMPLOYEE', [A]);
            await grant(creator, [...STAFF, 'MANAGE_EMPLOYEE_PAY'], A);
            const creatorSession = await login(creator, true);
            const customer = await principal('CUSTOMER');

            const signIn = async (employeeCode: string, password: string) =>
              (
                await logins.login(
                  employeeCode,
                  password,
                  (await sessions.createAnonymous(tx)).token,
                  `198.51.100.${randomInt(1, 250)}`,
                  undefined,
                  EMPLOYEE_ID,
                )
              ).token;
            const userRow = (id: string) =>
              tx.user.findUniqueOrThrow({
                where: { id },
                select: { status: true, passwordHash: true, credentialVersion: true },
              });
            const noPasswordAnywhere = async (id: string, ...secrets: string[]) => {
              const audits = await tx.auditEvent.findMany({ where: { subjectUserId: id } });
              const text = JSON.stringify(audits);
              for (const secret of secrets)
                assert.ok(!text.includes(secret), 'audit has no password');
            };
            const version = async (id: string) => (await employees.get(adminSession, id)).version;
            const past = shift(today, -10);
            const hiredEarlier = (extra: Partial<EmployeeCreateRequest> = {}) =>
              input([A], {
                employmentStartDate: past,
                employmentReason: 'Existing staff',
                ...extra,
              });

            await context.test(
              '1–2. the employee code is the login ID; no username column',
              async () => {
                const columns = await tx.$queryRaw<{ column_name: string }[]>`
                SELECT column_name FROM information_schema.columns
                WHERE table_name IN ('users', 'employee_profiles')
                  AND (column_name ILIKE '%username%' OR column_name ILIKE '%login%')`;
                assert.deepEqual(columns, []);
                const created = track(
                  await employees.create(
                    adminSession,
                    input([A], { employeeId: `nv-${run}`, initialPassword: PASSWORD_A }),
                  ),
                );
                assert.equal(created.employeeId, `NV-${run}`);
                // Case-insensitive employee code, WORKFORCE realm, EMPLOYEE_ID identifier.
                const token = await signIn(`nv-${run.toLowerCase()}`, PASSWORD_A);
                assert.equal((await sessions.resolve(token, tx))?.userId, created.id);
                // Not usable as a customer email identifier.
                await fails(
                  logins.login(
                    `NV-${run}`,
                    PASSWORD_A,
                    (await sessions.createAnonymous(tx)).token,
                    '198.51.100.9',
                  ),
                  'AUTHENTICATION_FAILED',
                );
              },
            );

            await context.test(
              '3–7, 11. TRAINEE and OFFICIAL_EMPLOYEE created ACTIVE; classification unchanged',
              async () => {
                for (const classification of ['TRAINEE', 'OFFICIAL_EMPLOYEE'] as const) {
                  const created = track(
                    await employees.create(
                      adminSession,
                      input([A], { classification, initialPassword: PASSWORD_A }),
                    ),
                  );
                  assert.equal(created.status, 'ACTIVE');
                  assert.ok(!JSON.stringify(created).includes(PASSWORD_A), 'not in the response');
                  const row = await userRow(created.id);
                  assert.equal(row.credentialVersion, 1);
                  assert.match(row.passwordHash ?? '', /^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
                  assert.ok((await passwords.verify(PASSWORD_A, row.passwordHash!)).verified);
                  assert.deepEqual(
                    (await rows(created.id)).map((entry) => entry.classification),
                    [classification],
                    'credentials never touch the employment classification',
                  );
                  const [provisioned] = await auditOf(created.id, 'ACCESS_PASSWORD_SET');
                  assert.deepEqual(provisioned?.after, {
                    status: 'ACTIVE',
                    credentialVersion: 1,
                    method: 'INITIAL_PROVISIONING',
                  });
                  await noPasswordAnywhere(created.id, PASSWORD_A, row.passwordHash!);
                  await signIn(created.employeeId, PASSWORD_A);
                }
              },
            );

            await context.test(
              '6. the existing password policy applies to initial passwords',
              async () => {
                for (const weak of [
                  'too short 1',
                  '123456789987654321',
                  '\uD800 lone surrogate pw',
                ]) {
                  const candidate = input([A], { initialPassword: weak });
                  await fails(
                    employees.create(adminSession, candidate),
                    'VALIDATION_FAILED',
                    'initialPassword',
                  );
                  assert.equal(
                    await tx.employeeProfile.count({
                      where: { employeeCodeCanonical: candidate.employeeId.toUpperCase() },
                    }),
                    0,
                  );
                }
              },
            );

            await context.test('12. creation without a password stays PENDING_SETUP', async () => {
              const created = track(await employees.create(adminSession, input([A])));
              assert.equal(created.status, 'PENDING_SETUP');
              assert.equal((await userRow(created.id)).passwordHash, null);
              assert.equal((await auditOf(created.id, 'ACCESS_PASSWORD_SET')).length, 0);
              await fails(signIn(created.employeeId, PASSWORD_A), 'AUTHENTICATION_FAILED');
            });

            await context.test(
              '8–10. access permission, fresh reauthentication, atomicity',
              async () => {
                const count = (code: string) =>
                  tx.employeeProfile.count({
                    where: { employeeCodeCanonical: code.toUpperCase() },
                  });
                // 8. CREATE_EMPLOYEES (+ pay) is not enough to provision sign-in access.
                const noAccess = input([A], { initialPassword: PASSWORD_A });
                await fails(employees.create(creatorSession, noAccess), 'FORBIDDEN');
                assert.equal(await count(noAccess.employeeId), 0);
                // ...but the same creator still creates without credentials.
                track(await employees.create(creatorSession, input([A])));
                // 9. A session without a recent password confirmation is refused.
                const stale = input([A], { initialPassword: PASSWORD_A });
                await fails(employees.create(staleSession, stale), 'REAUTHENTICATION_REQUIRED');
                assert.equal(await count(stale.employeeId), 0);
                // 10. A failure after the credentials are written leaves nothing behind.
                const atomic = input([A], { initialPassword: PASSWORD_A });
                await isolated(async () => {
                  await tx.$executeRawUnsafe(`
                  CREATE FUNCTION it_fail_acct_${run}() RETURNS trigger LANGUAGE plpgsql
                  AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$`);
                  await tx.$executeRawUnsafe(`
                  CREATE TRIGGER it_fail_acct_${run} BEFORE INSERT ON audit_events
                  FOR EACH ROW WHEN (NEW.action = 'ACCESS_PASSWORD_SET')
                  EXECUTE FUNCTION it_fail_acct_${run}()`);
                });
                await assert.rejects(employees.create(adminSession, atomic));
                await isolated(() =>
                  tx.$executeRawUnsafe(`DROP TRIGGER it_fail_acct_${run} ON audit_events`),
                );
                assert.equal(await count(atomic.employeeId), 0);
                assert.equal(
                  await tx.user.count({ where: { phoneCanonical: `+84${atomic.phone.slice(1)}` } }),
                  0,
                );
              },
            );

            await context.test(
              '13–14. direct set/reset: ACTIVE, version increments, old sessions revoked',
              async () => {
                const pending = track(await employees.create(adminSession, input([A])));
                const provisioned = await employees.setCredentials(adminSession, pending.id, {
                  expectedVersion: pending.version,
                  newPassword: PASSWORD_A,
                  reason: 'Account for the new trainee',
                });
                assert.equal(provisioned.status, 'ACTIVE');
                assert.equal((await userRow(pending.id)).credentialVersion, 2);
                const oldToken = await signIn(pending.employeeId, PASSWORD_A);
                assert.ok(await sessions.resolve(oldToken, tx));
                // Reset: new password, next credential version, every old session revoked.
                const reset = await employees.setCredentials(adminSession, pending.id, {
                  expectedVersion: provisioned.version,
                  newPassword: PASSWORD_B,
                  reason: 'Forgot password',
                });
                assert.equal(reset.status, 'ACTIVE');
                const row = await userRow(pending.id);
                assert.equal(row.credentialVersion, 3);
                assert.equal(await sessions.resolve(oldToken, tx), null, 'old session revoked');
                await fails(signIn(pending.employeeId, PASSWORD_A), 'AUTHENTICATION_FAILED');
                await signIn(pending.employeeId, PASSWORD_B);
                // Audit ids are random UUIDs: order by the recorded credential version.
                const audits = (await auditOf(pending.id, 'ACCESS_PASSWORD_SET')).sort(
                  (left, right) =>
                    (left.after as { credentialVersion: number }).credentialVersion -
                    (right.after as { credentialVersion: number }).credentialVersion,
                );
                assert.deepEqual(
                  audits.map((entry) => entry.after),
                  [
                    {
                      status: 'ACTIVE',
                      credentialVersion: 2,
                      method: 'MANAGER_SET',
                      replacedExisting: false,
                    },
                    {
                      status: 'ACTIVE',
                      credentialVersion: 3,
                      method: 'MANAGER_SET',
                      replacedExisting: true,
                    },
                  ],
                );
                assert.equal(audits[1]?.reason, 'Forgot password');
                assert.equal((await auditOf(pending.id, 'SESSIONS_REVOKED')).length, 1);
                await noPasswordAnywhere(pending.id, PASSWORD_A, PASSWORD_B, row.passwordHash!);
                // Refusals: stale confirmation, weak password, stale version, oneself, no access.
                const current = await version(pending.id);
                const attempt = (session: string, extra: Record<string, unknown> = {}) =>
                  employees.setCredentials(session, pending.id, {
                    expectedVersion: current,
                    newPassword: PASSWORD_A,
                    reason: 'Reset',
                    ...extra,
                  });
                await fails(attempt(staleSession), 'REAUTHENTICATION_REQUIRED');
                await fails(
                  attempt(adminSession, { newPassword: 'short' }),
                  'VALIDATION_FAILED',
                  'newPassword',
                );
                await fails(attempt(adminSession, { expectedVersion: current - 1 }), 'CONFLICT');
                await fails(attempt(creatorSession), 'FORBIDDEN');
                await fails(
                  employees.setCredentials(adminSession, admin, {
                    expectedVersion: 1,
                    newPassword: PASSWORD_A,
                    reason: 'Self',
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  employees.setCredentials(undefined, pending.id, {
                    expectedVersion: current,
                    newPassword: PASSWORD_A,
                    reason: 'x',
                  }),
                  'AUTHENTICATION_REQUIRED',
                );
                assert.equal((await userRow(pending.id)).credentialVersion, 3, 'nothing changed');
              },
            );

            await context.test('17–18. Owner protection and containment', async () => {
              for (const target of [ownerId, customer]) {
                await fails(
                  employees.setCredentials(adminSession, target, {
                    expectedVersion: 1,
                    newPassword: PASSWORD_A,
                    reason: 'Takeover',
                  }),
                  'NOT_FOUND',
                );
              }
              // A colleague with a power the administrator lacks cannot be taken over.
              const senior = await principal('EMPLOYEE', [A]);
              await grant(senior, ['MANAGE_PERMISSIONS'], A);
              await insertRow(senior, 'OFFICIAL_EMPLOYEE', '2020-01-01');
              const before = await userRow(senior);
              await fails(
                employees.setCredentials(adminSession, senior, {
                  expectedVersion: await version(senior),
                  newPassword: PASSWORD_A,
                  reason: 'Takeover',
                }),
                'FORBIDDEN',
              );
              assert.deepEqual(await userRow(senior), before);
              if (ownerSession) {
                // The Owner may reset anyone's workforce password.
                const reset = await employees.setCredentials(ownerSession, senior, {
                  expectedVersion: await version(senior),
                  newPassword: PASSWORD_B,
                  reason: 'Owner reset',
                });
                assert.equal(reset.status, 'ACTIVE');
              }
            });

            await context.test(
              '19–20, 15–16. ending today disables access, keeps history, blocks re-enabling',
              async () => {
                const leaver = track(
                  await employees.create(
                    adminSession,
                    hiredEarlier({ initialPassword: PASSWORD_A }),
                  ),
                );
                const token = await signIn(leaver.employeeId, PASSWORD_A);
                await tx.attendanceRecord.create({
                  data: {
                    employeeUserId: leaver.id,
                    branchId: A,
                    businessDate: new Date(`${past}T00:00:00.000Z`),
                    checkInAt: new Date(`${past}T02:00:00.000Z`),
                    checkOutAt: new Date(`${past}T10:00:00.000Z`),
                  },
                });
                // Disabling access needs MANAGE_EMPLOYEE_STATUS as well.
                const payOnly = await principal('EMPLOYEE', [A]);
                await grant(payOnly, ['VIEW_EMPLOYEES', 'MANAGE_EMPLOYEE_PAY'], A);
                await fails(
                  employees.endEmployment(await login(payOnly, true), leaver.id, {
                    expectedVersion: leaver.version,
                    effectiveDate: today,
                    reason: 'Left',
                    disableAccess: true,
                  }),
                  'FORBIDDEN',
                );
                assert.equal((await rows(leaver.id)).length, 1, 'nothing recorded');
                const ended = await employees.endEmployment(adminSession, leaver.id, {
                  expectedVersion: leaver.version,
                  effectiveDate: today,
                  reason: 'Left Lucy Spa',
                  disableAccess: true,
                });
                assert.equal(ended.access, 'DISABLED');
                assert.equal(ended.employee.status, 'INACTIVE');
                assert.equal(ended.employment.current?.classification, 'ENDED');
                assert.deepEqual(
                  ended.employment.history.map((entry) => entry.classification),
                  ['TRAINEE', 'ENDED'],
                );
                assert.equal(await sessions.resolve(token, tx), null, 'sessions revoked');
                await fails(signIn(leaver.employeeId, PASSWORD_A), 'AUTHENTICATION_FAILED');
                // 19. Nothing is deleted.
                assert.equal(await tx.employeeProfile.count({ where: { userId: leaver.id } }), 1);
                assert.equal(
                  await tx.attendanceRecord.count({ where: { employeeUserId: leaver.id } }),
                  1,
                );
                assert.equal((await auditOf(leaver.id, 'EMPLOYEE_CREATED')).length, 1);
                const [endAudit] = await auditOf(leaver.id, 'EMPLOYMENT_ENDED');
                assert.deepEqual(endAudit?.after, {
                  effectiveDate: today,
                  disableAccessRequested: true,
                  access: 'DISABLED',
                });
                // 16. No reactivation through the ordinary status command (no rehire).
                await fails(
                  employees.changeStatus(adminSession, leaver.id, {
                    expectedVersion: ended.employee.version,
                    status: 'ACTIVE',
                    reason: 'Back again',
                  }),
                  'CONFLICT',
                  'employment',
                );
                // 15. Ended but still ACTIVE (access kept deliberately): no new credentials.
                const kept = track(
                  await employees.create(
                    adminSession,
                    hiredEarlier({ initialPassword: PASSWORD_A }),
                  ),
                );
                const endedKept = await employees.endEmployment(adminSession, kept.id, {
                  expectedVersion: kept.version,
                  effectiveDate: today,
                  reason: 'Left; access handled separately',
                  disableAccess: false,
                });
                assert.equal(endedKept.access, 'UNCHANGED');
                assert.equal(endedKept.employee.status, 'ACTIVE');
                await fails(
                  employees.setCredentials(adminSession, kept.id, {
                    expectedVersion: endedKept.employee.version,
                    newPassword: PASSWORD_B,
                    reason: 'Reset',
                  }),
                  'CONFLICT',
                  'employment',
                );
                await fails(
                  employees.issueSetup(adminSession, kept.id, {
                    expectedVersion: endedKept.employee.version,
                    reason: 'Setup',
                  }),
                  'CONFLICT',
                  'employment',
                );
                // Disabling it later still works and the history stays as recorded.
                const disabled = await employees.changeStatus(adminSession, kept.id, {
                  expectedVersion: endedKept.employee.version,
                  status: 'INACTIVE',
                  reason: 'Disable access',
                });
                assert.equal(disabled.status, 'INACTIVE');
                assert.equal((await rows(kept.id)).length, 2);
              },
            );

            await context.test('21. a future end date never disables access now', async () => {
              const future = shift(today, 14);
              const staying = track(
                await employees.create(adminSession, hiredEarlier({ initialPassword: PASSWORD_A })),
              );
              const token = await signIn(staying.employeeId, PASSWORD_A);
              const scheduled = await employees.endEmployment(adminSession, staying.id, {
                expectedVersion: staying.version,
                effectiveDate: future,
                reason: 'Contract ends in two weeks',
                disableAccess: true,
              });
              assert.equal(scheduled.access, 'UNCHANGED_FUTURE_DATE');
              assert.equal(scheduled.employee.status, 'ACTIVE');
              assert.ok(await sessions.resolve(token, tx), 'still signed in');
              assert.equal(scheduled.employment.current?.classification, 'TRAINEE');
              assert.equal(scheduled.employment.history.at(-1)?.effectiveDate, future);
              // Until the end date, access management still works normally.
              const reset = await employees.setCredentials(adminSession, staying.id, {
                expectedVersion: scheduled.employee.version,
                newPassword: PASSWORD_B,
                reason: 'Reset before leaving',
              });
              assert.equal(reset.status, 'ACTIVE');
            });

            await context.test('23. directory and plain creation still work', async () => {
              const listed = await directory.list(adminSession, { q: run });
              assert.ok(listed.items.length > 0);
              const ours = listed.items.filter((item) => apiCreated.includes(item.id));
              assert.ok(ours.length > 0);
              assert.ok(ours.every((item) => item.classification !== null));
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

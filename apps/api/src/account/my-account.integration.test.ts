import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EmployeeProfileUpdateRequest } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { EmployeeService } from '../employees/employee.service.js';
import { businessToday, day } from '../employees/employment.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { MyAccountService } from './my-account.service.js';

const PASSWORD = 'a calm lotus evening 2026';
const shift = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'My Account: one authoritative profile, self-service view and edit (follow-up Step 3); all fixtures roll back',
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
    const rollback = new Error('Intentional My Account integration rollback');
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
            const employees = new EmployeeService(environment, runner, throttle, passwords);
            const accounts = new MyAccountService(runner, throttle);
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
            const A = (
              await tx.branch.create({
                data: { code: `IT-A-${run}`, name: `Branch A ${run}` },
                select: { id: true },
              })
            ).id;
            const phone = () => `+84918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            let sequence = 0;
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
                  preferredLocale: 'vi',
                  emailCanonical: `acct-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `acct-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `ACCT-${sequence}-${run}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture address',
                            baseSalaryVnd: 9_000_000n,
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
            const role = async (codes: PermissionCode[], managerGroup = false) => {
              sequence += 1;
              return (
                await tx.role.create({
                  data: {
                    code: `IT_${run}_${sequence}`,
                    displayNameVi: 'Vai trò',
                    displayNameEn: 'Role',
                    isManagerGroup: managerGroup,
                    permissions: {
                      create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                    },
                  },
                  select: { id: true },
                })
              ).id;
            };
            const assign = (userId: string, roleId: string, branchId: string) =>
              tx.userRoleAssignment.create({
                data: { userId, roleId, scopeKind: 'BRANCH', branchId },
              });
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
            const classify = (userId: string, classification: string, date: string) =>
              tx.$executeRaw`
                INSERT INTO employment_classification_changes
                  (employee_user_id, classification, effective_date, reason)
                VALUES (${userId}::uuid, ${classification}::"EmploymentClassification",
                  ${date}::date, 'fixture')`;
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const today = day(await businessToday(tx, [A]));

            // Management: branch A people administrator (not the Owner).
            const hr = await principal('EMPLOYEE', [A]);
            await classify(hr, 'OFFICIAL_EMPLOYEE', today);
            await assign(hr, await role(['VIEW_EMPLOYEES', 'UPDATE_EMPLOYEES']), A);
            const hrSession = await login(hr);
            const member = await principal('EMPLOYEE', [A]);
            await classify(member, 'OFFICIAL_EMPLOYEE', today);
            const memberSession = await login(member);
            const other = await principal('EMPLOYEE', [A]);
            await classify(other, 'TRAINEE', today);
            const otherSession = await login(other);
            const skill = await tx.skill.create({
              data: { code: `IT_SKILL_${run}`, nameVi: 'Gội đầu', nameEn: 'Hair wash' },
              select: { id: true },
            });
            await tx.employeeSkill.create({
              data: { employeeUserId: member, skillId: skill.id, grantedByUserId: hr },
            });

            await context.test(
              'A. a self-edit is what employee detail reads (one copy)',
              async () => {
                const before = await accounts.get(memberSession);
                assert.equal(before.kind, 'EMPLOYEE');
                assert.equal(before.title, 'EMPLOYEE');
                assert.equal(before.employee?.classification, 'OFFICIAL_EMPLOYEE');
                assert.deepEqual(
                  before.employee?.branches.map((row) => row.id),
                  [A],
                );
                assert.deepEqual(
                  before.employee?.skills.map((row) => row.nameEn),
                  ['Hair wash'],
                );
                assert.ok(!('baseSalaryVnd' in before), 'no pay in My Account');
                const management = await employees.get(hrSession, member);
                assert.equal(before.version, management.version, 'one shared version');
                const after = await accounts.updateProfile(memberSession, {
                  expectedVersion: before.version,
                  fullName: '  Anh Thư  ',
                  phone: '0905 123 456',
                  dateOfBirth: '1995-03-08',
                  address: '5 Hai Bà Trưng',
                  locale: 'en',
                });
                assert.equal(after.fullName, 'Anh Thư');
                assert.equal(after.phone, '+84905123456');
                assert.equal(after.version, before.version + 1);
                const seen = await employees.get(hrSession, member);
                assert.deepEqual(
                  [seen.fullName, seen.phone, seen.dateOfBirth, seen.address, seen.locale],
                  ['Anh Thư', '+84905123456', '1995-03-08', '5 Hai Bà Trưng', 'en'],
                );
                assert.equal(seen.version, after.version);
                // Audited as the subject acting on themself; field names only, no values.
                const audit = await tx.auditEvent.findFirst({
                  where: { subjectUserId: member, action: 'PROFILE_UPDATED' },
                  orderBy: { occurredAt: 'desc' },
                  select: { actorUserId: true, after: true },
                });
                assert.equal(audit?.actorUserId, member);
                assert.deepEqual(audit?.after, {
                  fields: ['address', 'dateOfBirth', 'fullName', 'locale', 'phone'],
                  via: 'MY_ACCOUNT',
                });
                assert.ok(!JSON.stringify(audit?.after).includes('Anh Thư'));
                // A stale version is refused (optimistic concurrency shared with management).
                await fails(
                  accounts.updateProfile(memberSession, {
                    expectedVersion: before.version,
                    fullName: 'Stale',
                  }),
                  'CONFLICT',
                );
              },
            );

            await context.test('B. a management edit is what My Account shows', async () => {
              const current = await employees.get(hrSession, member);
              await employees.updateProfile(hrSession, member, {
                expectedVersion: current.version,
                fullName: 'Nguyễn Anh Thư',
                phone: '0905 654 321',
                address: '7 Lý Tự Trọng',
              });
              const mine = await accounts.get(memberSession);
              assert.deepEqual(
                [mine.fullName, mine.phone, mine.employee?.address],
                ['Nguyễn Anh Thư', '+84905654321', '7 Lý Tự Trọng'],
              );
              assert.equal(mine.version, current.version + 1);
            });

            await context.test('C. administrative fields cannot be self-edited', async () => {
              const before = await accounts.get(memberSession);
              const salary = await tx.employeeProfile.findUniqueOrThrow({
                where: { userId: member },
                select: { baseSalaryVnd: true, employeeCodeCanonical: true },
              });
              // Smuggled fields are ignored by the allowlist (the HTTP DTO rejects them outright).
              const smuggled = {
                expectedVersion: before.version,
                fullName: 'Chỉ tên',
                employeeId: 'HACKED',
                classification: 'ENDED',
                status: 'INACTIVE',
                branchIds: [randomUUID()],
                skillIds: [],
                roleIds: [],
                baseSalaryVnd: '99999999',
                email: 'x@example.com',
                kind: 'OWNER',
              } as unknown as EmployeeProfileUpdateRequest;
              const after = await accounts.updateProfile(memberSession, smuggled);
              assert.equal(after.fullName, 'Chỉ tên');
              assert.equal(after.employee?.employeeId, before.employee?.employeeId);
              assert.equal(after.employee?.classification, 'OFFICIAL_EMPLOYEE');
              assert.equal(after.status, 'ACTIVE');
              assert.equal(after.kind, 'EMPLOYEE');
              assert.deepEqual(after.employee?.branches, before.employee?.branches);
              assert.deepEqual(after.employee?.skills, before.employee?.skills);
              assert.deepEqual(after.email, before.email);
              assert.deepEqual(
                await tx.employeeProfile.findUniqueOrThrow({
                  where: { userId: member },
                  select: { baseSalaryVnd: true, employeeCodeCanonical: true },
                }),
                salary,
              );
              assert.equal(await tx.userRoleAssignment.count({ where: { userId: member } }), 0);
              // Only allowlisted fields: nothing else means nothing to do.
              await fails(
                accounts.updateProfile(memberSession, {
                  expectedVersion: after.version,
                } as EmployeeProfileUpdateRequest),
                'VALIDATION_FAILED',
              );
              // Shared validation: invalid values and phone clashes (no holder revealed).
              await fails(
                accounts.updateProfile(memberSession, {
                  expectedVersion: after.version,
                  phone: 'abc',
                }),
                'VALIDATION_FAILED',
                'phone',
              );
              const otherPhone = (await tx.user.findUniqueOrThrow({
                where: { id: other },
                select: { phoneCanonical: true },
              }))!.phoneCanonical!;
              await fails(
                accounts.updateProfile(memberSession, {
                  expectedVersion: after.version,
                  phone: otherPhone,
                }),
                'CONFLICT',
                'phone',
              );
              await fails(
                accounts.updateProfile(memberSession, {
                  expectedVersion: after.version,
                  dateOfBirth: '2999-01-01',
                }),
                'VALIDATION_FAILED',
              );
            });

            await context.test(
              'D. the session is the only identity: no other account is reachable',
              async () => {
                const otherBefore = await tx.user.findUniqueOrThrow({
                  where: { id: other },
                  select: { fullName: true, rowVersion: true },
                });
                const self = await accounts.get(otherSession);
                assert.equal(self.id, other);
                const changed = await accounts.updateProfile(otherSession, {
                  expectedVersion: self.version,
                  fullName: 'Chính mình',
                });
                assert.equal(changed.id, other);
                const memberRow = await tx.user.findUniqueOrThrow({
                  where: { id: member },
                  select: { fullName: true },
                });
                assert.equal(memberRow.fullName, 'Chỉ tên', 'the member is untouched');
                assert.notEqual(otherBefore.fullName, 'Chính mình');
                // Customers and anonymous callers are refused.
                const customer = await principal('CUSTOMER');
                await fails(accounts.get(await login(customer)), 'FORBIDDEN');
                await fails(accounts.get(undefined), 'AUTHENTICATION_REQUIRED');
                await fails(accounts.get('not-a-session'), 'AUTHENTICATION_REQUIRED');
              },
            );

            await context.test(
              'E. the Owner has My Account without an employee profile',
              async () => {
                const owner = existingOwner?.id ?? (await principal('OWNER'));
                const ownerSession = await login(owner);
                const mine = await accounts.get(ownerSession);
                assert.equal(mine.kind, 'OWNER');
                assert.equal(mine.title, 'OWNER');
                assert.equal(mine.employee, null);
                const changed = await accounts.updateProfile(ownerSession, {
                  expectedVersion: mine.version,
                  fullName: 'Chủ Lucy',
                  phone: '0909 111 222',
                  locale: 'en',
                });
                assert.deepEqual(
                  [changed.fullName, changed.phone, changed.locale],
                  ['Chủ Lucy', '+84909111222', 'en'],
                );
                // No fake profile: fields that do not exist for the Owner are refused.
                await fails(
                  accounts.updateProfile(ownerSession, {
                    expectedVersion: changed.version,
                    address: 'x',
                  }),
                  'VALIDATION_FAILED',
                  'address',
                );
                await fails(
                  accounts.updateProfile(ownerSession, {
                    expectedVersion: changed.version,
                    dateOfBirth: '1980-01-01',
                  }),
                  'VALIDATION_FAILED',
                  'dateOfBirth',
                );
                assert.equal(
                  await tx.employeeProfile.count({ where: { userId: owner } }),
                  0,
                  'no employee profile created',
                );
                // Employee administration still never targets the Owner.
                await fails(employees.get(hrSession, owner), 'NOT_FOUND');
              },
            );

            await context.test(
              'F–G. every workforce kind sees its own authoritative title',
              async () => {
                const managerRole = await role(['VIEW_ATTENDANCE'], true);
                const cases: [string, string | null, string][] = [
                  ['OFFICIAL_EMPLOYEE', null, 'EMPLOYEE'],
                  ['OFFICIAL_EMPLOYEE', 'manager', 'MANAGER'],
                  ['COLLABORATOR', null, 'COLLABORATOR'],
                  ['TRAINEE', null, 'TRAINEE'],
                  ['TRAINEE', 'future', 'NOT_STARTED'],
                ];
                for (const [classification, extra, title] of cases) {
                  const id = await principal('EMPLOYEE', [A]);
                  await classify(id, classification, extra === 'future' ? shift(today, 5) : today);
                  if (extra === 'manager') await assign(id, managerRole, A);
                  const session = await login(id);
                  const mine = await accounts.get(session);
                  assert.equal(mine.title, title, `${classification}/${extra}`);
                  assert.equal(
                    mine.employee?.classification,
                    extra === 'future' ? null : classification,
                  );
                  // The same title /auth/me reports (one server rule).
                  assert.equal((await logins.currentAccount(session)).workforceTitle, title);
                }
              },
            );

            await context.test(
              'H. email and recovery-email state come from the same row as /auth/me',
              async () => {
                const mine = await accounts.get(memberSession);
                const me = await logins.currentAccount(memberSession);
                assert.deepEqual(mine.email, me.recoveryEmail);
                assert.equal(mine.email?.verified, false);
                await tx.user.update({
                  where: { id: member },
                  data: { emailVerifiedAt: new Date() },
                });
                const verified = await accounts.get(memberSession);
                assert.equal(verified.email?.verified, true);
                assert.deepEqual(
                  verified.email,
                  (await logins.currentAccount(memberSession)).recoveryEmail,
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
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

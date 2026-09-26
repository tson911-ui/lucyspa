import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EmployeeCreateRequest, EmployeeResponse } from '@lucy-spa/contracts';
import {
  collaboratorPrecheck,
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { RoleAdminService } from '../authorization/role-admin.service.js';
import { LoginService } from '../auth/login.service.js';
import { LeaveService } from '../leave/leave.service.js';
import { EmployeeDirectoryService } from './employee-directory.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { EmployeeService } from './employee.service.js';
import { businessToday, day } from './employment.js';

const PASSWORD = 'a calm lotus evening 2026';
const STAFF: PermissionCode[] = ['VIEW_EMPLOYEES', 'CREATE_EMPLOYEES', 'UPDATE_EMPLOYEES'];
const shift = (date: string, days: number) =>
  day(new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000));

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'COLLABORATOR classification, manager invariant, titles and sections (follow-up Step 2); all fixtures roll back',
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
    const rollback = new Error('Intentional collaborator integration rollback');
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
            const insertRow = (employeeUserId: string, classification: string, date: string) =>
              tx.$executeRaw`
                INSERT INTO employment_classification_changes
                  (employee_user_id, classification, effective_date, reason)
                VALUES (${employeeUserId}::uuid, ${classification}::"EmploymentClassification",
                  ${date}::date, 'direct')`;

            const ownerId = existingOwner?.id ?? (await principal('OWNER'));
            const ownerSession = existingOwner ? null : await login(ownerId, true);
            const roles = new RoleAdminService(runner, throttle);
            const directory = new EmployeeDirectoryService(runner, throttle);
            const leave = new LeaveService(runner, throttle);
            const logins = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              {
                withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
                rotateAuthenticated: (token, evidence, options) =>
                  sessions.rotateAuthenticated(token, evidence, options, tx),
                resolve: (token) => sessions.resolve(token, tx),
                resolveForMutation: (token) => sessions.resolveForMutation(token, tx),
                continueAfterCredentialChange: (t, previous, requestId) =>
                  sessions.continueAfterCredentialChange(t, previous, requestId),
              },
              passwords,
              throttle,
            );
            await logins.onModuleInit();
            const role = async (code: string, managerGroup: boolean, isActive = true) =>
              (
                await tx.role.create({
                  data: {
                    code: `${code}_${run}`,
                    displayNameVi: code,
                    displayNameEn: code,
                    isActive,
                    isManagerGroup: managerGroup,
                    permissions: {
                      create: [{ permissionId: permissions.get('VIEW_ATTENDANCE')! }],
                    },
                  },
                  select: { id: true },
                })
              ).id;
            const managerRole = await role('MANAGER', true);
            const ktvRole = await role('KTV', false);
            // Branch A administrator: people, pay, status, roles (not the Owner).
            const hr = await principal('EMPLOYEE', [A]);
            await grant(hr, [
              ...STAFF,
              'MANAGE_EMPLOYEE_PAY',
              'MANAGE_EMPLOYEE_STATUS',
              'MANAGE_PERMISSIONS',
              'VIEW_ATTENDANCE',
            ]);
            await insertRow(hr, 'OFFICIAL_EMPLOYEE', '2020-01-01');
            const hrSession = await login(hr, true);
            // Creates staff but holds no pay permission.
            const creator = await principal('EMPLOYEE', [A]);
            await grant(creator, STAFF, A);
            await insertRow(creator, 'OFFICIAL_EMPLOYEE', '2020-01-01');
            const creatorSession = await login(creator, true);
            const hired = (classification: EmployeeCreateRequest['classification'], extra = {}) =>
              input([A], {
                classification,
                employmentStartDate: shift(today, -30),
                employmentReason: 'Existing staff',
                ...extra,
              });
            const version = async (id: string) => (await employees.get(hrSession, id)).version;
            const change = async (
              id: string,
              classification: 'COLLABORATOR' | 'OFFICIAL_EMPLOYEE' | 'ENDED',
              effectiveDate: string,
            ) =>
              employees.changeClassification(hrSession, id, {
                expectedVersion: await version(id),
                classification,
                effectiveDate,
                reason: 'Classification change',
              });
            const assign = async (id: string, roleId: string) =>
              roles.assignRole(hrSession, id, {
                expectedVersion: (await roles.employeeAuthorization(hrSession, id)).version,
                roleId,
                scope: { kind: 'BRANCH', branchId: A },
                reason: 'Role assignment',
              });
            const groupOf = async (id: string) => {
              const found: string[] = [];
              for (const group of ['MANAGERS', 'EMPLOYEES', 'COLLABORATORS', 'TRAINEES']) {
                const page = await directory.list(hrSession, {
                  q: run,
                  group,
                  page: '1',
                  limit: '100',
                });
                if (page.items.some((item) => item.id === id)) found.push(group);
              }
              return found;
            };
            const entryOf = async (id: string) =>
              (await directory.list(hrSession, { q: run, limit: '100' })).items.find(
                (item) => item.id === id,
              );

            await context.test(
              'COLLABORATOR at creation needs no pay permission; title and section follow',
              async () => {
                const ctv = track(
                  await employees.create(
                    creatorSession,
                    input([A], { classification: 'COLLABORATOR' }),
                  ),
                );
                assert.deepEqual(
                  (await rows(ctv.id)).map((row) => row.classification),
                  ['COLLABORATOR'],
                );
                assert.equal(
                  (await employees.employment(hrSession, ctv.id, {})).title,
                  'COLLABORATOR',
                );
                assert.equal((await entryOf(ctv.id))?.title, 'COLLABORATOR');
                assert.deepEqual(await groupOf(ctv.id), ['COLLABORATORS']);
                // OFFICIAL_EMPLOYEE still needs the pay permission.
                await fails(
                  employees.create(
                    creatorSession,
                    input([A], { classification: 'OFFICIAL_EMPLOYEE' }),
                  ),
                  'FORBIDDEN',
                );
              },
            );

            await context.test('transitions: the new matrix, in the API and in SQL', async () => {
              const trainee = track(await employees.create(hrSession, hired('TRAINEE')));
              // Future dates: backdating stays Owner-only.
              await change(trainee.id, 'COLLABORATOR', shift(today, 1));
              await change(trainee.id, 'OFFICIAL_EMPLOYEE', shift(today, 2));
              await change(trainee.id, 'ENDED', shift(today, 5));
              assert.deepEqual(
                (await rows(trainee.id)).map((row) => row.classification),
                ['TRAINEE', 'COLLABORATOR', 'OFFICIAL_EMPLOYEE', 'ENDED'],
              );
              const collaborator = track(await employees.create(hrSession, hired('COLLABORATOR')));
              await change(collaborator.id, 'ENDED', today);
              await fails(
                change(collaborator.id, 'COLLABORATOR', shift(today, 3)),
                'CONFLICT',
                'classification',
              );
              const official = track(await employees.create(hrSession, hired('OFFICIAL_EMPLOYEE')));
              // Q1: never from official back to collaborator.
              await fails(
                change(official.id, 'COLLABORATOR', shift(today, 3)),
                'CONFLICT',
                'classification',
              );
              await assert.rejects(
                isolated(() => insertRow(official.id, 'COLLABORATOR', shift(today, 4))),
                /transition is not allowed/,
              );
              await assert.rejects(
                isolated(() => insertRow(collaborator.id, 'TRAINEE', shift(today, 6))),
                /transition is not allowed/,
              );
            });

            await context.test(
              'manager invariant: E1 assign, E2 flag/activate, E3 end',
              async () => {
                const ctv = track(await employees.create(hrSession, hired('COLLABORATOR')));
                const trainee = track(await employees.create(hrSession, hired('TRAINEE')));
                const official = track(
                  await employees.create(hrSession, hired('OFFICIAL_EMPLOYEE')),
                );
                // E1: a manager-group role only for OFFICIAL_EMPLOYEE today.
                await fails(assign(ctv.id, managerRole), 'CONFLICT', 'employmentClassification');
                await fails(
                  assign(trainee.id, managerRole),
                  'CONFLICT',
                  'employmentClassification',
                );
                await assign(official.id, managerRole);
                // A normal role never depends on or changes the classification.
                await assign(ctv.id, ktvRole);
                assert.deepEqual(
                  (await rows(ctv.id)).map((row) => row.classification),
                  ['COLLABORATOR'],
                );
                assert.equal(
                  (await employees.employment(hrSession, ctv.id, {})).title,
                  'COLLABORATOR',
                );
                // E2: flagging a role held by a collaborator as manager group is refused.
                const ktv = (await roles.listRoles(hrSession)).roles.find((r) => r.id === ktvRole)!;
                await fails(
                  roles.updateRole(hrSession, ktvRole, {
                    expectedVersion: ktv.version,
                    isManagerGroup: true,
                    reason: 'Promote KTV role',
                  }),
                  'CONFLICT',
                  'managerGroupHolders',
                );
                // ...and so is re-activating a switched-off manager-group role held by one.
                const dormant = await role('OLD_MANAGER', true, false);
                await assign(trainee.id, dormant);
                const dormantRole = (await roles.listRoles(hrSession)).roles.find(
                  (r) => r.id === dormant,
                )!;
                await fails(
                  roles.updateRole(hrSession, dormant, {
                    expectedVersion: dormantRole.version,
                    isActive: true,
                    reason: 'Reactivate',
                  }),
                  'CONFLICT',
                  'managerGroupHolders',
                );
                // E3: an official manager cannot leave official employment while holding it.
                await fails(
                  employees.endEmployment(hrSession, official.id, {
                    expectedVersion: await version(official.id),
                    effectiveDate: today,
                    reason: 'Left',
                    disableAccess: true,
                  }),
                  'CONFLICT',
                  'managerRole',
                );
                await fails(
                  change(official.id, 'ENDED', shift(today, 2)),
                  'CONFLICT',
                  'managerRole',
                );
                assert.equal((await rows(official.id)).length, 1, 'nothing recorded');
                // Remove the manager role first (explicit), then ending works.
                const held = await roles.employeeAuthorization(hrSession, official.id);
                await roles.revokeRole(hrSession, official.id, {
                  expectedVersion: held.version,
                  assignmentId: held.roleAssignments[0]!.id,
                  reason: 'Stepping down',
                });
                const ended = await employees.endEmployment(hrSession, official.id, {
                  expectedVersion: await version(official.id),
                  effectiveDate: today,
                  reason: 'Left',
                  disableAccess: true,
                });
                assert.equal(ended.employment.title, 'ENDED');
              },
            );

            await context.test(
              'titles and four exclusive sections, incl. ended and not started',
              async () => {
                const manager = track(
                  await employees.create(hrSession, hired('OFFICIAL_EMPLOYEE')),
                );
                await assign(manager.id, managerRole);
                const employee = track(
                  await employees.create(hrSession, hired('OFFICIAL_EMPLOYEE')),
                );
                const future = track(
                  await employees.create(
                    hrSession,
                    input([A], {
                      classification: 'OFFICIAL_EMPLOYEE',
                      employmentStartDate: shift(today, 10),
                    }),
                  ),
                );
                const endedCtv = track(await employees.create(hrSession, hired('COLLABORATOR')));
                await change(endedCtv.id, 'ENDED', today);
                const expectations: [string, string, string][] = [
                  [manager.id, 'MANAGER', 'MANAGERS'],
                  [employee.id, 'EMPLOYEE', 'EMPLOYEES'],
                  [future.id, 'NOT_STARTED', 'EMPLOYEES'],
                  [endedCtv.id, 'ENDED', 'COLLABORATORS'],
                ];
                for (const [id, title, group] of expectations) {
                  assert.equal((await entryOf(id))?.title, title, title);
                  assert.equal((await employees.employment(hrSession, id, {})).title, title);
                  assert.deepEqual(await groupOf(id), [group], `${title} in exactly one section`);
                }
                // /auth/me carries the same title for the signed-in person.
                const staff = await principal('EMPLOYEE', [A]);
                await insertRow(staff, 'OFFICIAL_EMPLOYEE', '2020-01-01');
                await assign(staff, managerRole);
                assert.equal(
                  (await logins.currentAccount(await login(staff, false))).workforceTitle,
                  'MANAGER',
                );
                const ctvLogin = await principal('EMPLOYEE', [A]);
                await insertRow(ctvLogin, 'COLLABORATOR', '2020-01-01');
                assert.equal(
                  (await logins.currentAccount(await login(ctvLogin, false))).workforceTitle,
                  'COLLABORATOR',
                );
                if (ownerSession) {
                  assert.equal((await logins.currentAccount(ownerSession)).workforceTitle, 'OWNER');
                }
              },
            );

            await context.test('Q16 base salary and Q15 leave for collaborators', async () => {
              await fails(
                employees.create(
                  hrSession,
                  input([A], { classification: 'COLLABORATOR', baseSalaryVnd: '5000000' }),
                ),
                'VALIDATION_FAILED',
                'baseSalaryVnd',
              );
              for (const classification of ['COLLABORATOR', 'TRAINEE'] as const) {
                const member = track(await employees.create(hrSession, hired(classification)));
                await fails(
                  employees.setBaseSalary(hrSession, member.id, {
                    expectedVersion: member.version,
                    baseSalaryVnd: '5000000',
                    reason: 'Salary',
                  }),
                  'CONFLICT',
                  'classification',
                );
                // Clearing a salary is always allowed.
                const cleared = await employees.setBaseSalary(hrSession, member.id, {
                  expectedVersion: member.version,
                  baseSalaryVnd: null,
                  reason: 'No salary',
                });
                assert.equal(cleared.baseSalaryVnd ?? null, null);
              }
              const official = track(
                await employees.create(
                  hrSession,
                  hired('OFFICIAL_EMPLOYEE', { baseSalaryVnd: '8000000' }),
                ),
              );
              assert.equal(
                (await tx.employeeProfile.findUniqueOrThrow({ where: { userId: official.id } }))
                  .baseSalaryVnd,
                8_000_000n,
                'official employment may have a base salary',
              );
              // Collaborators never use the leave workflow.
              const ctv = await principal('EMPLOYEE', [A]);
              await insertRow(ctv, 'COLLABORATOR', '2020-01-01');
              await fails(
                leave.create(await login(ctv, true), {
                  leaveType: 'PERSONAL',
                  startDate: shift(today, 7),
                  endDate: shift(today, 7),
                  reason: 'Personal',
                }),
                'CONFLICT',
                'classification',
              );
            });

            await context.test('production pre-check reports invalid legacy states', async () => {
              const before = await collaboratorPrecheck(tx);
              const mine = <T extends { employee_code: string }>(rows: T[]) =>
                rows.filter((row) => row.employee_code.endsWith(run.toUpperCase()));
              assert.deepEqual([mine(before.managers), mine(before.salaries)], [[], []]);
              // Legacy data written behind the API's back (what the pre-check exists for).
              const legacyManager = track(await employees.create(hrSession, hired('COLLABORATOR')));
              await tx.userRoleAssignment.create({
                data: { userId: legacyManager.id, roleId: managerRole, scopeKind: 'GLOBAL' },
              });
              const legacySalary = track(await employees.create(hrSession, hired('TRAINEE')));
              await tx.employeeProfile.update({
                where: { userId: legacySalary.id },
                data: { baseSalaryVnd: 1_000_000n },
              });
              const after = await collaboratorPrecheck(tx);
              assert.deepEqual(
                mine(after.managers).map((row) => [row.employee_code, row.classification]),
                [[legacyManager.employeeId, 'COLLABORATOR']],
              );
              assert.deepEqual(
                mine(after.salaries).map((row) => [row.employee_code, row.classification]),
                [[legacySalary.employeeId, 'TRAINEE']],
              );
              // Read-side safety: a legacy non-official holder is never shown as a manager.
              assert.equal((await entryOf(legacyManager.id))?.title, 'COLLABORATOR');
              assert.deepEqual(await groupOf(legacyManager.id), ['COLLABORATORS']);
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

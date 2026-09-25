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
import { RoleAdminService } from '../authorization/role-admin.service.js';
import { EmployeeDirectoryService } from './employee-directory.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { EmployeeService } from './employee.service.js';
import { businessToday, day } from './employment.js';

const PASSWORD = 'a calm lotus evening 2026';
const STAFF: PermissionCode[] = ['VIEW_EMPLOYEES', 'CREATE_EMPLOYEES', 'UPDATE_EMPLOYEES'];
// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'employee directory groups: managers vs employees with numbered pages; all fixtures roll back',
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
    const rollback = new Error('Intentional directory group integration rollback');
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
            const insertRow = (employeeUserId: string, classification: string, date: string) =>
              tx.$executeRaw`
                INSERT INTO employment_classification_changes
                  (employee_user_id, classification, effective_date, reason)
                VALUES (${employeeUserId}::uuid, ${classification}::"EmploymentClassification",
                  ${date}::date, 'direct')`;

            const roles = new RoleAdminService(runner, throttle);
            const directory = new EmployeeDirectoryService(runner, throttle);
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
            const managerRole = await role('BRANCH_MANAGER', true);
            const ktvRole = await role('KTV', false);
            const offManagerRole = await role('OLD_MANAGER', true, false);
            // Global people administrator (not the Owner): creates, assigns and manages roles.
            const hr = await principal('EMPLOYEE', [A]);
            await grant(hr, [
              ...STAFF,
              'MANAGE_PERMISSIONS',
              'VIEW_ATTENDANCE',
              'MANAGE_EMPLOYEE_PAY',
            ]);
            await insertRow(hr, 'OFFICIAL_EMPLOYEE', '2020-01-01');
            const hrSession = await login(hr, true);
            const assign = async (id: string, roleId: string) =>
              roles.assignRole(hrSession, id, {
                expectedVersion: (await roles.employeeAuthorization(hrSession, id)).version,
                roleId,
                scope: { kind: 'BRANCH', branchId: A },
                reason: 'Directory grouping test',
              });
            const person = async (label: string, extra: Partial<EmployeeCreateRequest> = {}) =>
              track(
                await employees.create(
                  hrSession,
                  input([A], { employeeId: `${label}-${run}`, ...extra }),
                ),
              );
            // Codes sort as: a-manager, b-both, c-official, d-trainee, e-oldrole, f..h extra.
            const manager = await person('a-mgr', { classification: 'OFFICIAL_EMPLOYEE' });
            const both = await person('b-both', { classification: 'OFFICIAL_EMPLOYEE' });
            const official = await person('c-off', { classification: 'OFFICIAL_EMPLOYEE' });
            const trainee = await person('d-trn');
            const oldRole = await person('e-old');
            await assign(manager.id, managerRole);
            await assign(both.id, ktvRole);
            await assign(both.id, managerRole);
            await assign(oldRole.id, offManagerRole);
            await assign(official.id, ktvRole);
            const list = (query: Record<string, string>) =>
              directory.list(hrSession, { q: run, ...query });
            const ids = async (query: Record<string, string>) =>
              (await list(query)).items.map((item) => item.id);

            await context.test(
              '1–6. one group per member, from active manager-group roles',
              async () => {
                const managers = await ids({ group: 'MANAGERS', page: '1' });
                const others = await ids({ group: 'EMPLOYEES', page: '1' });
                assert.deepEqual(managers, [manager.id, both.id], 'manager, and manager + KTV');
                assert.ok(others.includes(official.id), 'OFFICIAL_EMPLOYEE + KTV is an employee');
                assert.ok(others.includes(trainee.id), 'TRAINEE is an employee');
                assert.ok(
                  others.includes(oldRole.id),
                  'a switched-off manager role does not count',
                );
                assert.equal(
                  others.filter((id) => managers.includes(id)).length,
                  0,
                  'no duplicates',
                );
                const all = await ids({});
                assert.deepEqual(
                  [...managers, ...others].sort(),
                  [...all].sort(),
                  'complete split',
                );
              },
            );

            await context.test(
              '7–11. server-side numbered pages with totals, per group',
              async () => {
                const first = await list({ group: 'EMPLOYEES', page: '1', limit: '2' });
                const second = await list({ group: 'EMPLOYEES', page: '2', limit: '2' });
                const total = first.page!.total;
                assert.ok(total >= 3);
                assert.deepEqual(first.page, { number: 1, size: 2, total });
                assert.deepEqual(second.page, { number: 2, size: 2, total });
                assert.equal(first.items.length, 2);
                assert.equal(
                  first.items.filter((a) => second.items.some((b) => b.id === a.id)).length,
                  0,
                  'pages do not overlap',
                );
                assert.equal(first.nextCursor, null);
                // Beyond the last page: empty items, the same total.
                const beyond = await list({ group: 'EMPLOYEES', page: '99', limit: '2' });
                assert.deepEqual([beyond.items.length, beyond.page!.total], [0, total]);
                // Managers page independently with their own total.
                const managers = await list({ group: 'MANAGERS', page: '1', limit: '1' });
                assert.deepEqual(managers.page, { number: 1, size: 1, total: 2 });
                // Invalid combinations are rejected, not guessed.
                await fails(list({ group: 'OWNERS' }), 'VALIDATION_FAILED', 'group');
                await fails(list({ page: '0' }), 'VALIDATION_FAILED', 'page');
                const cursor = (await list({ limit: '1' })).nextCursor!;
                await fails(list({ page: '1', cursor }), 'VALIDATION_FAILED', 'cursor');
              },
            );

            await context.test(
              '12. search and status filters apply within each group',
              async () => {
                assert.deepEqual(await ids({ group: 'MANAGERS', page: '1', q: `a-mgr-${run}` }), [
                  manager.id,
                ]);
                assert.deepEqual(
                  await ids({ group: 'EMPLOYEES', page: '1', q: `a-mgr-${run}` }),
                  [],
                );
                const pending = await ids({
                  group: 'MANAGERS',
                  page: '1',
                  status: 'PENDING_SETUP',
                });
                assert.deepEqual(pending, [manager.id, both.id]);
                assert.deepEqual(
                  await ids({ group: 'MANAGERS', page: '1', status: 'INACTIVE' }),
                  [],
                );
              },
            );

            await context.test(
              '17. the manager flag moves display only; nothing is mutated',
              async () => {
                const snapshot = async () =>
                  tx.user.findMany({
                    where: { id: { in: [manager.id, both.id, official.id, trainee.id] } },
                    orderBy: { id: 'asc' },
                    select: {
                      status: true,
                      authzVersion: true,
                      rowVersion: true,
                      roleAssignments: { select: { id: true, roleId: true } },
                      employeeProfile: {
                        select: { classificationChanges: { select: { id: true } } },
                      },
                    },
                  });
                const before = await snapshot();
                await ids({ group: 'MANAGERS', page: '1' });
                await ids({ group: 'EMPLOYEES', page: '1' });
                assert.deepEqual(await snapshot(), before, 'listing changes nothing');
                // Flagging KTV as a manager role (role API) regroups its holders, grants nothing.
                const ktv = (await roles.listRoles(hrSession)).roles.find((r) => r.id === ktvRole)!;
                assert.equal(ktv.isManagerGroup, false);
                const flagged = await roles.updateRole(hrSession, ktvRole, {
                  expectedVersion: ktv.version,
                  isManagerGroup: true,
                  reason: 'Show KTV leads as managers',
                });
                assert.equal(flagged.isManagerGroup, true);
                assert.ok((await ids({ group: 'MANAGERS', page: '1' })).includes(official.id));
                assert.deepEqual(await snapshot(), before, 'no authorization or data change');
                const created = await roles.createRole(hrSession, {
                  code: `lead_${run}`,
                  displayNameVi: 'Trưởng nhóm',
                  displayNameEn: 'Team lead',
                  permissions: [],
                  isManagerGroup: true,
                  reason: 'Manager group role',
                });
                assert.equal(created.isManagerGroup, true);
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

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
  'role assignment (Employee management Step 4): roles stay separate from employment; all fixtures roll back',
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
    const rollback = new Error('Intentional role assignment integration rollback');
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
            const roles = new RoleAdminService(runner, throttle);
            const B = await branch('B');
            // Catalog roles are database rows (the API has no seeded roles); names are data.
            const catalogRole = async (code: string, codes: PermissionCode[]) =>
              (
                await tx.role.create({
                  data: {
                    code: `${code}_${run}`,
                    displayNameVi: code,
                    displayNameEn: code,
                    permissions: {
                      create: codes.map((permission) => ({
                        permissionId: permissions.get(permission)!,
                      })),
                    },
                  },
                  select: { id: true },
                })
              ).id;
            const ktv = await catalogRole('KTV', ['VIEW_ATTENDANCE']);
            const branchManager = await catalogRole('BRANCH_MANAGER', [
              'VIEW_ATTENDANCE',
              'APPROVE_LEAVE',
            ]);
            const accessRole = await catalogRole('ACCESS', ['MANAGE_EMPLOYEE_ACCESS']);
            // Branch A people administrator: may grant what it holds, in A only.
            const hr = await principal('EMPLOYEE', [A]);
            await grant(
              hr,
              [
                ...STAFF,
                'MANAGE_PERMISSIONS',
                'VIEW_ATTENDANCE',
                'APPROVE_LEAVE',
                'MANAGE_EMPLOYEE_PAY',
                'MANAGE_EMPLOYEE_STATUS',
              ],
              A,
            );
            await insertRow(hr, 'OFFICIAL_EMPLOYEE', '2020-01-01');
            const hrSession = await login(hr, true);
            const authz = async (id: string) => roles.employeeAuthorization(hrSession, id);
            const snapshot = async (id: string) => ({
              user: await tx.user.findUniqueOrThrow({
                where: { id },
                select: {
                  status: true,
                  passwordHash: true,
                  credentialVersion: true,
                  employeeProfile: {
                    select: {
                      employeeCodeCanonical: true,
                      skills: { select: { skillId: true } },
                      branchAssignments: { select: { id: true, revokedAt: true } },
                    },
                  },
                },
              }),
              classifications: await rows(id),
            });

            await context.test(
              '8–9. roles are not employment classifications (enum unchanged)',
              async () => {
                const values = await tx.$queryRaw<{ value: string }[]>`
                SELECT unnest(enum_range(NULL::"EmploymentClassification"))::text AS value`;
                assert.deepEqual(
                  values.map((row) => row.value),
                  ['TRAINEE', 'OFFICIAL_EMPLOYEE', 'ENDED'],
                );
              },
            );

            await context.test(
              '1–4, 10–13. branch-scoped KTV and manager roles; nothing else changes',
              async () => {
                const member = track(await employees.create(hrSession, input([A])));
                const before = await snapshot(member.id);
                const initial = await authz(member.id);
                assert.deepEqual(initial.roleAssignments, []);
                const assigned = await roles.assignRole(hrSession, member.id, {
                  expectedVersion: initial.version,
                  roleId: ktv,
                  scope: { kind: 'BRANCH', branchId: A },
                  reason: 'KTV at branch A',
                });
                const both = await roles.assignRole(hrSession, member.id, {
                  expectedVersion: assigned.version,
                  roleId: branchManager,
                  scope: { kind: 'BRANCH', branchId: A },
                  reason: 'Also manages branch A',
                });
                assert.deepEqual(
                  both.roleAssignments.map((row) => [row.roleCode, row.scope]).sort(),
                  [
                    [`BRANCH_MANAGER_${run}`, { kind: 'BRANCH', branchId: A }],
                    [`KTV_${run}`, { kind: 'BRANCH', branchId: A }],
                  ],
                );
                // Classification, employee code, account status, password and skills unchanged.
                assert.deepEqual(await snapshot(member.id), before);
                const [audit] = await auditOf(member.id, 'ROLE_ASSIGNED');
                assert.ok(audit, 'audited');
              },
            );

            await context.test('14–17. containment, self, Owner and scope rules hold', async () => {
              const member = track(await employees.create(hrSession, input([A])));
              const { version } = await authz(member.id);
              const attempt = (
                session: string,
                target: string,
                roleId: string,
                scope: { kind: 'GLOBAL' } | { kind: 'BRANCH'; branchId: string },
              ) =>
                roles.assignRole(session, target, {
                  expectedVersion: version,
                  roleId,
                  scope,
                  reason: 'Attempt',
                });
              // 14. A role carrying a permission the actor lacks.
              await fails(
                attempt(hrSession, member.id, accessRole, { kind: 'BRANCH', branchId: A }),
                'FORBIDDEN',
              );
              // 15. No self-escalation, even with a role the actor holds.
              await fails(
                roles.assignRole(hrSession, hr, {
                  expectedVersion: (await tx.user.findUniqueOrThrow({ where: { id: hr } }))
                    .authzVersion,
                  roleId: branchManager,
                  scope: { kind: 'BRANCH', branchId: A },
                  reason: 'Self',
                }),
                'FORBIDDEN',
              );
              // 16. The Owner is never a role target.
              await fails(
                attempt(hrSession, ownerId, ktv, { kind: 'BRANCH', branchId: A }),
                'NOT_FOUND',
              );
              // 17. GLOBAL needs GLOBAL MANAGE_PERMISSIONS; branch B is outside the actor's scope.
              await fails(attempt(hrSession, member.id, ktv, { kind: 'GLOBAL' }), 'FORBIDDEN');
              await fails(
                attempt(hrSession, member.id, ktv, { kind: 'BRANCH', branchId: B }),
                'FORBIDDEN',
              );
              assert.deepEqual((await authz(member.id)).roleAssignments, []);
              if (ownerSession) {
                const global = await roles.assignRole(ownerSession, member.id, {
                  expectedVersion: version,
                  roleId: ktv,
                  scope: { kind: 'GLOBAL' },
                  reason: 'Owner grants globally',
                });
                assert.deepEqual(global.roleAssignments[0]?.scope, { kind: 'GLOBAL' });
              }
            });

            await context.test(
              '18–19. ENDED employment: no new roles, existing ones visible, history kept',
              async () => {
                const leaver = track(
                  await employees.create(
                    hrSession,
                    input([A], {
                      employmentStartDate: shift(today, -10),
                      employmentReason: 'Existing staff',
                    }),
                  ),
                );
                const assigned = await roles.assignRole(hrSession, leaver.id, {
                  expectedVersion: (await authz(leaver.id)).version,
                  roleId: ktv,
                  scope: { kind: 'BRANCH', branchId: A },
                  reason: 'KTV',
                });
                await employees.endEmployment(hrSession, leaver.id, {
                  expectedVersion: (await employees.get(hrSession, leaver.id)).version,
                  effectiveDate: today,
                  reason: 'Left',
                  disableAccess: true,
                });
                const after = await authz(leaver.id);
                assert.equal(after.roleAssignments.length, 1, 'not silently removed');
                await fails(
                  roles.assignRole(hrSession, leaver.id, {
                    expectedVersion: after.version,
                    roleId: branchManager,
                    scope: { kind: 'BRANCH', branchId: A },
                    reason: 'After leaving',
                  }),
                  'CONFLICT',
                  'employment',
                );
                // Revocation stays possible; the audit trail keeps both events.
                const revoked = await roles.revokeRole(hrSession, leaver.id, {
                  expectedVersion: after.version,
                  assignmentId: assigned.roleAssignments[0]!.id,
                  reason: 'Clean up after leaving',
                });
                assert.deepEqual(revoked.roleAssignments, []);
                const [assignedAudit] = await auditOf(leaver.id, 'ROLE_ASSIGNED');
                const [revokedAudit] = await auditOf(leaver.id, 'ROLE_REVOKED');
                assert.ok(assignedAudit);
                assert.deepEqual(
                  (revokedAudit?.before as { roleCode: string; scope: unknown }).scope,
                  { kind: 'BRANCH', branchId: A },
                );
                assert.equal(revokedAudit?.reason, 'Clean up after leaving');
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

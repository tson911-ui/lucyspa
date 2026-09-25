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
import { EmployeeService } from './employee.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'operational branch assignments via EmployeeBranchAssignment; all fixtures roll back',
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
    const rollback = new Error('Intentional branch assignment integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            let exclusiveCommands = 0;
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
                isolated(async () => {
                  exclusiveCommands += 1;
                  await takeExclusiveAuthGraphLock(tx);
                  return work(tx);
                }),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const employees = new EmployeeService(
              environment,
              runner,
              new AuthThrottleService(environment),
              new PasswordService(),
            );
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            const branch = async (label: string, isActive = true) =>
              (
                await tx.branch.create({
                  data: { code: `BA-${label}-${run}`, name: `Branch ${label}`, isActive },
                  select: { id: true },
                })
              ).id;
            const [A, B, C] = [await branch('A'), await branch('B'), await branch('C')];
            const closed = await branch('X', false);
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
                  emailCanonical: `ba-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `ba-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84919${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `BAE-${sequence}-${run}`,
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
                  code: `BA_${run}_${sequence}`,
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
            const version = async (userId: string) =>
              (await tx.user.findUniqueOrThrow({ where: { id: userId } })).rowVersion;
            const reason = 'Staffing change';

            const admin = await principal('EMPLOYEE');
            await grantRole(admin, ['MANAGE_EMPLOYEE_SCOPE', 'VIEW_EMPLOYEES']);
            const adminSession = await login(admin);
            const managerA = await principal('EMPLOYEE', [A]);
            await grantRole(managerA, ['MANAGE_EMPLOYEE_SCOPE', 'VIEW_EMPLOYEES'], A);
            const managerASession = await login(managerA);
            const managerAB = await principal('EMPLOYEE', [A, B]);
            await grantRole(managerAB, ['MANAGE_EMPLOYEE_SCOPE'], A);
            await grantRole(managerAB, ['MANAGE_EMPLOYEE_SCOPE'], B);
            const managerABSession = await login(managerAB);
            const customer = await principal('CUSTOMER');

            await context.test(
              'assign and revoke: history, multi-branch, invalidation, audit',
              async () => {
                const employee = await principal('EMPLOYEE', [A]);
                const employeeSession = await login(employee);
                const before = exclusiveCommands;
                const assigned = await employees.assignBranch(adminSession, employee, {
                  expectedVersion: await version(employee),
                  branchId: B,
                  reason,
                });
                assert.ok(exclusiveCommands > before, 'exclusive graph lock');
                assert.deepEqual(assigned.active.map((row) => row.branchId).sort(), [A, B].sort());
                assert.deepEqual(assigned.history, []);
                // Security graph change: authz version bumped, sessions revoked, audited.
                assert.equal(await sessions.resolve(employeeSession, tx), null);
                assert.equal(
                  (await tx.user.findUniqueOrThrow({ where: { id: employee } })).authzVersion,
                  2,
                );
                const events = await tx.auditEvent.findMany({
                  where: {
                    subjectUserId: employee,
                    action: { in: ['BRANCH_SCOPE_CHANGED', 'SESSIONS_REVOKED'] },
                  },
                  orderBy: { action: 'asc' },
                });
                assert.deepEqual(
                  events.map((event) => event.action),
                  ['BRANCH_SCOPE_CHANGED', 'SESSIONS_REVOKED'],
                );
                assert.equal(events[0]?.actorUserId, admin);
                assert.equal(events[0]?.reason, reason);
                assert.deepEqual(events[0]?.before, { branchIds: [A] });
                assert.equal((events[0]?.after as { operation: string }).operation, 'ASSIGN');
                assert.equal((events[0]?.after as { branchId: string }).branchId, B);

                // Duplicate active assignment: 409, still one active row; the DB also refuses.
                await fails(
                  employees.assignBranch(adminSession, employee, {
                    expectedVersion: assigned.version,
                    branchId: B,
                    reason,
                  }),
                  'CONFLICT',
                );
                assert.equal(
                  await tx.employeeBranchAssignment.count({
                    where: { employeeUserId: employee, branchId: B, revokedAt: null },
                  }),
                  1,
                );
                await tx.$executeRawUnsafe('SAVEPOINT duplicate_membership');
                await assert.rejects(
                  tx.employeeBranchAssignment.create({
                    data: { employeeUserId: employee, branchId: B, grantedByUserId: admin },
                  }),
                );
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT duplicate_membership');
                await fails(
                  employees.assignBranch(adminSession, employee, {
                    expectedVersion: assigned.version - 1,
                    branchId: C,
                    reason,
                  }),
                  'CONFLICT',
                );

                // Revoke keeps history; revoked rows no longer count as active membership.
                const revoked = await employees.revokeBranch(adminSession, employee, B, {
                  expectedVersion: assigned.version,
                  reason,
                });
                assert.deepEqual(
                  revoked.active.map((row) => row.branchId),
                  [A],
                );
                assert.deepEqual(
                  revoked.history.map((row) => row.branchId),
                  [B],
                );
                assert.ok(revoked.history[0]?.revokedAt);
                const graph = await tx.employeeBranchAssignment.findMany({
                  where: { employeeUserId: employee, revokedAt: null },
                });
                assert.deepEqual(
                  graph.map((row) => row.branchId),
                  [A],
                );
                await fails(
                  employees.revokeBranch(adminSession, employee, B, {
                    expectedVersion: revoked.version,
                    reason,
                  }),
                  'NOT_FOUND',
                );
                // Re-assignment after revocation creates a new row; history stays.
                const again = await employees.assignBranch(adminSession, employee, {
                  expectedVersion: revoked.version,
                  branchId: B,
                  reason,
                });
                assert.equal(again.active.length, 2);
                assert.equal(again.history.length, 1);
                assert.equal(
                  await tx.employeeBranchAssignment.count({ where: { employeeUserId: employee } }),
                  3,
                );
              },
            );

            await context.test(
              'branch scope and containment for single and multi-branch employees',
              async () => {
                const inA = await principal('EMPLOYEE', [A]);
                const inAB = await principal('EMPLOYEE', [A, B]);
                // A branch-A manager can't expand an employee into B.
                await fails(
                  employees.assignBranch(managerASession, inA, {
                    expectedVersion: await version(inA),
                    branchId: B,
                    reason,
                  }),
                  'FORBIDDEN',
                );
                // Nor revoke from an employee who also belongs to B (needs every branch).
                await fails(
                  employees.revokeBranch(managerASession, inAB, A, {
                    expectedVersion: await version(inAB),
                    reason,
                  }),
                  'FORBIDDEN',
                );
                // A manager of A and B may move within A and B.
                const moved = await employees.assignBranch(managerABSession, inA, {
                  expectedVersion: await version(inA),
                  branchId: B,
                  reason,
                });
                assert.equal(moved.active.length, 2);
                const back = await employees.revokeBranch(managerABSession, inAB, B, {
                  expectedVersion: await version(inAB),
                  reason,
                });
                assert.deepEqual(
                  back.active.map((row) => row.branchId),
                  [A],
                );
                // Branch validity.
                await fails(
                  employees.assignBranch(adminSession, inA, {
                    expectedVersion: await version(inA),
                    branchId: closed,
                    reason,
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  employees.assignBranch(adminSession, inA, {
                    expectedVersion: await version(inA),
                    branchId: randomUUID(),
                    reason,
                  }),
                  'VALIDATION_FAILED',
                );
                // Escalation: B holds a dormant role grant the admin doesn't have.
                const dormant = await principal('EMPLOYEE', [A]);
                await grantRole(dormant, ['APPROVE_LEAVE'], B);
                await fails(
                  employees.assignBranch(adminSession, dormant, {
                    expectedVersion: await version(dormant),
                    branchId: B,
                    reason,
                  }),
                  'FORBIDDEN',
                );
                assert.equal(
                  await tx.employeeBranchAssignment.count({
                    where: { employeeUserId: dormant, branchId: B, revokedAt: null },
                  }),
                  0,
                  'rejected change rolled back',
                );
              },
            );

            await context.test(
              'final branch: allowed, then only GLOBAL authority applies',
              async () => {
                const solo = await principal('EMPLOYEE', [A]);
                const emptied = await employees.revokeBranch(adminSession, solo, A, {
                  expectedVersion: await version(solo),
                  reason: 'Moved to head office',
                });
                assert.deepEqual(emptied.active, []);
                assert.equal(emptied.history.length, 1);
                // A branch-scoped manager can't claim a branchless employee (design section 7).
                await fails(
                  employees.assignBranch(managerASession, solo, {
                    expectedVersion: emptied.version,
                    branchId: A,
                    reason,
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  employees.changeScope(managerASession, solo, {
                    expectedVersion: emptied.version,
                    branchIds: [A],
                    reason,
                  }),
                  'FORBIDDEN',
                );
                const restored = await employees.assignBranch(adminSession, solo, {
                  expectedVersion: emptied.version,
                  branchId: A,
                  reason,
                });
                assert.deepEqual(
                  restored.active.map((row) => row.branchId),
                  [A],
                );
              },
            );

            await context.test('targets, callers, self and reads', async () => {
              const employee = await principal('EMPLOYEE', [A]);
              const owner = existingOwner?.id ?? (await principal('OWNER'));
              for (const target of [customer, owner, randomUUID()]) {
                await fails(
                  employees.assignBranch(adminSession, target, {
                    expectedVersion: 1,
                    branchId: B,
                    reason,
                  }),
                  'NOT_FOUND',
                );
              }
              await fails(
                employees.assignBranch(await login(customer), employee, {
                  expectedVersion: 1,
                  branchId: B,
                  reason,
                }),
                'FORBIDDEN',
              );
              await fails(
                employees.assignBranch(undefined, employee, {
                  expectedVersion: 1,
                  branchId: B,
                  reason,
                }),
                'AUTHENTICATION_REQUIRED',
              );
              await fails(
                employees.branchAssignments(await login(customer), employee),
                'FORBIDDEN',
              );
              // Non-Owners never change their own branch scope.
              await fails(
                employees.assignBranch(managerABSession, managerAB, {
                  expectedVersion: await version(managerAB),
                  branchId: C,
                  reason,
                }),
                'FORBIDDEN',
              );
              // Reads: self and scoped viewers; others 404.
              const self = await employees.branchAssignments(await login(employee), employee);
              assert.deepEqual(
                self.active.map((row) => row.branchId),
                [A],
              );
              assert.equal(
                (await employees.branchAssignments(managerASession, employee)).active.length,
                1,
              );
              const inB = await principal('EMPLOYEE', [B]);
              await fails(employees.branchAssignments(managerASession, inB), 'NOT_FOUND');
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
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
    } finally {
      await database.$disconnect();
    }
  },
);

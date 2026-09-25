import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { PermissionCodeName } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import {
  AUTH_GRAPH_LOCK_KEY,
  AUTH_GRAPH_LOCK_NAMESPACE,
  takeExclusiveAuthGraphLock,
} from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest } from '../auth/crypto.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { EmployeeService } from '../employees/employee.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { AuditReadService } from './audit-read.service.js';
import { RoleAdminService } from './role-admin.service.js';

const PASSWORD = 'a calm lotus evening 2026';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'role, assignment, override and audit-read administration; all fixtures roll back',
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
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const userIds: string[] = [];
    const rollback = new Error('Intentional role administration integration rollback');
    const probeShared = async () => {
      const probeRollback = new Error('Intentional lock probe rollback');
      let acquired: boolean | undefined;
      await assert.rejects(
        database.$transaction(async (probe) => {
          const rows = await probe.$queryRaw<{ acquired: boolean }[]>`
            SELECT pg_try_advisory_xact_lock_shared(${AUTH_GRAPH_LOCK_NAMESPACE}::integer, ${AUTH_GRAPH_LOCK_KEY}::integer) AS acquired`;
          acquired = rows[0]?.acquired;
          throw probeRollback;
        }),
        (error: unknown) => error === probeRollback,
      );
      return acquired;
    };
    try {
      await database.$connect();

      await context.test('the exclusive runner takes the graph lock first', async () => {
        const done = new Error('Intentional exclusive runner rollback');
        await assert.rejects(
          sessions.withExclusiveTransaction(async () => {
            assert.equal(await probeShared(), false, 'shared lock blocked');
            throw done;
          }),
          (error: unknown) => error === done,
        );
        assert.equal(await probeShared(), true, 'released after the transaction');
      });

      const permissionCount = await database.permission.count();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const hash = await new PasswordService().hashForSetting(PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let exclusiveCommands = 0;
            let savepoints = 0;
            // Each command gets its own savepoint, so a rejected command rolls back exactly
            // as its own transaction would in production.
            const isolated = async <T>(work: () => Promise<T>): Promise<T> => {
              savepoints += 1;
              const name = `command_${savepoints}`;
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
            const throttle = new AuthThrottleService(environment);
            const roles = new RoleAdminService(runner, throttle);
            const audit = new AuditReadService(runner, throttle);
            const employees = new EmployeeService(
              environment,
              runner,
              throttle,
              new PasswordService(),
            );
            await syncPermissionCatalog(tx);
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
                  emailCanonical: `role-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `role-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `ROLE-${sequence}-${run}`,
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
            const login = async (userId: string, fresh = false) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true },
              });
              const evidence = {
                userId,
                passwordHash: hash,
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
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const version = async (userId: string) =>
              (await tx.user.findUniqueOrThrow({ where: { id: userId } })).authzVersion;
            const reason = 'Integration change';
            const owner = existingOwner?.id ?? (await principal('OWNER'));
            // With a pre-existing Owner (whose password is unknown), grant a fixture
            // "super admin" instead; Owner-only paths are then skipped.
            const ownerSession = existingOwner ? null : await login(owner, true);
            const customer = await principal('CUSTOMER');
            const customerSession = await login(customer);
            let roleSeq = 0;
            const makeRole = async (permissions: PermissionCodeName[]) => {
              roleSeq += 1;
              assert.ok(ownerSession);
              return roles.createRole(ownerSession, {
                code: `it_${run}_${roleSeq}`,
                displayNameVi: `Vai trò ${roleSeq}`,
                displayNameEn: `Role ${roleSeq}`,
                permissions,
                reason,
              });
            };
            const assign = async (
              session: string,
              userId: string,
              roleId: string,
              branchId?: string,
            ) =>
              roles.assignRole(session, userId, {
                expectedVersion: await version(userId),
                roleId,
                scope: branchId ? { kind: 'BRANCH', branchId } : { kind: 'GLOBAL' },
                reason,
              });

            if (!ownerSession) {
              await context.test(
                'Owner-driven scenarios',
                { skip: 'An Owner already exists.' },
                () => {},
              );
            } else {
              assert.equal(await probeShared(), true, 'no graph writer holds the lock yet');

              await context.test('role create/update: catalog-only, OWNER reserved', async () => {
                const role = await makeRole(['VIEW_EMPLOYEES', 'MANAGE_PERMISSIONS']);
                assert.equal(role.code, `IT_${run}_1`);
                assert.deepEqual(role.permissions, ['MANAGE_PERMISSIONS', 'VIEW_EMPLOYEES']);
                assert.equal(exclusiveCommands, 1);
                assert.equal(await probeShared(), false, 'exclusive graph lock held');
                await fails(
                  roles.createRole(ownerSession, {
                    code: 'owner',
                    displayNameVi: 'Chủ',
                    displayNameEn: 'Owner',
                    permissions: [],
                    reason,
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  roles.createRole(ownerSession, {
                    code: `IT_X_${run}`,
                    displayNameVi: 'X',
                    displayNameEn: 'X',
                    permissions: ['GRANT_EVERYTHING' as PermissionCodeName],
                    reason,
                  }),
                  'VALIDATION_FAILED',
                );
                await fails(
                  roles.createRole(ownerSession, {
                    code: role.code,
                    displayNameVi: 'Trùng',
                    displayNameEn: 'Duplicate',
                    permissions: [],
                    reason,
                  }),
                  'CONFLICT',
                );
                const renamed = await roles.updateRole(ownerSession, role.id, {
                  expectedVersion: role.version,
                  displayNameEn: 'Branch manager',
                  reason,
                });
                assert.equal(renamed.displayNameEn, 'Branch manager');
                assert.equal(renamed.version, role.version + 1);
                await fails(
                  roles.updateRole(ownerSession, role.id, {
                    expectedVersion: role.version,
                    displayNameEn: 'Stale',
                    reason,
                  }),
                  'CONFLICT',
                );
                const listed = await roles.listRoles(ownerSession);
                assert.ok(listed.roles.some((entry) => entry.id === role.id));
                assert.equal(listed.permissions.length, 17);
                // Scope capability comes from the code-owned catalog (Step 4B role UI).
                assert.deepEqual(
                  listed.permissionCatalog.map((entry) => entry.code),
                  listed.permissions,
                );
                assert.deepEqual(
                  listed.permissionCatalog
                    .filter((entry) => entry.scopeCapability === 'GLOBAL_ONLY')
                    .map((entry) => entry.code),
                  ['MANAGE_SERVICE_PRICES'],
                );
                const events = await tx.auditEvent.findMany({
                  where: { entityId: role.id },
                  orderBy: { action: 'asc' },
                });
                assert.deepEqual(
                  events.map((event) => [event.action, event.branchId, event.reason]),
                  [
                    ['ROLE_CREATED', null, reason],
                    ['ROLE_UPDATED', null, reason],
                  ],
                );
                // Customers and anonymous callers never reach role administration.
                await fails(roles.listRoles(customerSession), 'FORBIDDEN');
                await fails(roles.listRoles(undefined), 'AUTHENTICATION_REQUIRED');
              });

              await context.test(
                'assignment: scope, delegation, containment, Owner protection',
                async () => {
                  const managerRole = await makeRole(['VIEW_EMPLOYEES', 'MANAGE_PERMISSIONS']);
                  const viewerRole = await makeRole(['VIEW_EMPLOYEES']);
                  const creatorRole = await makeRole(['CREATE_EMPLOYEES']);
                  const manager = await principal('EMPLOYEE', [A]);
                  const managerOld = await login(manager);
                  const assigned = await assign(ownerSession, manager, managerRole.id, A);
                  assert.equal(assigned.version, 2);
                  assert.equal(await sessions.resolve(managerOld, tx), null, 'sessions revoked');
                  const [event] = await tx.auditEvent.findMany({
                    where: { subjectUserId: manager, action: 'ROLE_ASSIGNED' },
                  });
                  assert.equal(event?.branchId, A);
                  const [revokedEvent] = await tx.auditEvent.findMany({
                    where: { subjectUserId: manager, action: 'SESSIONS_REVOKED' },
                  });
                  assert.deepEqual(revokedEvent?.after, {
                    reason: 'AUTHORIZATION_CHANGED',
                    revokedSessions: 1,
                  });
                  await fails(assign(ownerSession, manager, managerRole.id, A), 'CONFLICT');
                  await fails(
                    roles.assignRole(ownerSession, manager, {
                      expectedVersion: 1,
                      roleId: viewerRole.id,
                      scope: { kind: 'BRANCH', branchId: A },
                      reason,
                    }),
                    'CONFLICT',
                  );

                  const session = await login(manager);
                  const staffA = await principal('EMPLOYEE', [A]);
                  const staffB = await principal('EMPLOYEE', [B]);
                  // Within scope and within the actor's own powers.
                  await assign(session, staffA, viewerRole.id, A);
                  // A permission the actor does not hold.
                  await fails(assign(session, staffA, creatorRole.id, A), 'FORBIDDEN');
                  // Outside the actor's branch, globally, or a target in another branch.
                  await fails(assign(session, staffA, viewerRole.id, B), 'FORBIDDEN');
                  await fails(assign(session, staffA, viewerRole.id), 'FORBIDDEN');
                  await fails(assign(session, staffB, viewerRole.id, A), 'FORBIDDEN');
                  await fails(roles.employeeAuthorization(session, staffB), 'NOT_FOUND');
                  // Never their own roles.
                  await fails(assign(session, manager, viewerRole.id, A), 'FORBIDDEN');
                  // Owner and customers are never grant targets.
                  for (const target of [owner, customer]) {
                    await fails(assign(ownerSession, target, viewerRole.id), 'NOT_FOUND');
                    await fails(roles.employeeAuthorization(ownerSession, target), 'NOT_FOUND');
                  }
                  assert.equal(
                    await tx.userRoleAssignment.count({
                      where: { userId: { in: [owner, customer] } },
                    }),
                    0,
                  );
                  // Revocation.
                  const view = await roles.employeeAuthorization(session, staffA);
                  const revoked = await roles.revokeRole(session, staffA, {
                    expectedVersion: view.version,
                    assignmentId: view.roleAssignments[0]!.id,
                    reason,
                  });
                  assert.equal(revoked.roleAssignments.length, 0);
                  assert.equal(revoked.version, view.version + 1);
                  await fails(
                    roles.revokeRole(session, staffA, {
                      expectedVersion: revoked.version,
                      assignmentId: randomUUID(),
                      reason,
                    }),
                    'NOT_FOUND',
                  );
                },
              );

              await context.test('overrides: removing a DENY is a grant', async () => {
                const managerRole = await makeRole(['VIEW_EMPLOYEES', 'MANAGE_PERMISSIONS']);
                const creatorRole = await makeRole(['CREATE_EMPLOYEES']);
                const manager = await principal('EMPLOYEE', [A]);
                await assign(ownerSession, manager, managerRole.id, A);
                const target = await principal('EMPLOYEE', [A]);
                await assign(ownerSession, target, creatorRole.id, A);
                const denied = await roles.setOverride(ownerSession, target, {
                  expectedVersion: await version(target),
                  permission: 'CREATE_EMPLOYEES',
                  effect: 'DENY',
                  scope: { kind: 'BRANCH', branchId: A },
                  reason,
                });
                const deny = denied.overrides[0]!;
                assert.equal(deny.effect, 'DENY');
                const session = await login(manager);
                // Lifting the DENY would confer CREATE_EMPLOYEES, which the manager lacks.
                await fails(
                  roles.removeOverride(session, target, {
                    expectedVersion: denied.version,
                    overrideId: deny.id,
                    reason,
                  }),
                  'FORBIDDEN',
                );
                await fails(
                  roles.setOverride(session, target, {
                    expectedVersion: denied.version,
                    permission: 'CREATE_EMPLOYEES',
                    effect: 'ALLOW',
                    scope: { kind: 'BRANCH', branchId: A },
                    reason,
                  }),
                  'FORBIDDEN',
                );
                assert.equal(
                  (await tx.userPermissionOverride.findUniqueOrThrow({ where: { id: deny.id } }))
                    .effect,
                  'DENY',
                  'rejected change rolled back',
                );
                // Reducing authority the manager administers is allowed.
                const reduced = await roles.setOverride(session, target, {
                  expectedVersion: denied.version,
                  permission: 'VIEW_EMPLOYEES',
                  effect: 'DENY',
                  scope: { kind: 'BRANCH', branchId: A },
                  reason,
                });
                assert.equal(reduced.overrides.length, 2);
                // GLOBAL_ONLY permissions (service prices) cannot be overridden per branch.
                await fails(
                  roles.setOverride(ownerSession, target, {
                    expectedVersion: reduced.version,
                    permission: 'MANAGE_SERVICE_PRICES',
                    effect: 'DENY',
                    scope: { kind: 'BRANCH', branchId: A },
                    reason,
                  }),
                  'VALIDATION_FAILED',
                );
                const [change] = await tx.auditEvent.findMany({
                  where: {
                    subjectUserId: target,
                    action: 'PERMISSION_OVERRIDE_CHANGED',
                    actorUserId: manager,
                  },
                });
                assert.deepEqual(change?.after, {
                  permission: 'VIEW_EMPLOYEES',
                  scope: { kind: 'BRANCH', branchId: A },
                  effect: 'DENY',
                });
                // The Owner may lift it; inheritance returns.
                const lifted = await roles.removeOverride(ownerSession, target, {
                  expectedVersion: reduced.version,
                  overrideId: deny.id,
                  reason,
                });
                assert.equal(lifted.overrides.length, 1);
              });

              await context.test('shared role edits are checked for every recipient', async () => {
                const shared = await makeRole(['VIEW_EMPLOYEES']);
                const inA = await principal('EMPLOYEE', [A]);
                const inB = await principal('EMPLOYEE', [B]);
                await assign(ownerSession, inA, shared.id, A);
                await assign(ownerSession, inB, shared.id, B);
                const sessionA = await login(inA);
                const sessionB = await login(inB);
                // A GLOBAL delegator with a branch DENY cannot edit a role held in B.
                const delegatorRole = await makeRole([
                  'MANAGE_PERMISSIONS',
                  'VIEW_EMPLOYEES',
                  'UPDATE_EMPLOYEES',
                ]);
                const delegator = await principal('EMPLOYEE', [A]);
                await assign(ownerSession, delegator, delegatorRole.id);
                await roles.setOverride(ownerSession, delegator, {
                  expectedVersion: await version(delegator),
                  permission: 'MANAGE_PERMISSIONS',
                  effect: 'DENY',
                  scope: { kind: 'BRANCH', branchId: B },
                  reason,
                });
                const delegatorSession = await login(delegator);
                const current = (await roles.listRoles(delegatorSession)).roles.find(
                  (role) => role.id === shared.id,
                )!;
                await fails(
                  roles.setRolePermissions(delegatorSession, shared.id, {
                    expectedVersion: current.version,
                    permissions: ['VIEW_EMPLOYEES', 'UPDATE_EMPLOYEES'],
                    reason,
                  }),
                  'FORBIDDEN',
                );
                // A permission the delegator does not hold cannot enter a bundle.
                await fails(
                  roles.setRolePermissions(delegatorSession, shared.id, {
                    expectedVersion: current.version,
                    permissions: ['VIEW_EMPLOYEES', 'MANAGE_EMPLOYEE_PAY'],
                    reason,
                  }),
                  'FORBIDDEN',
                );
                // Nor can a non-Owner edit a role assigned to themselves.
                await fails(
                  roles.updateRole(delegatorSession, delegatorRole.id, {
                    expectedVersion: delegatorRole.version,
                    displayNameEn: 'Mine',
                    reason,
                  }),
                  'FORBIDDEN',
                );
                const before = [await version(inA), await version(inB)];
                const edited = await roles.setRolePermissions(ownerSession, shared.id, {
                  expectedVersion: current.version,
                  permissions: ['VIEW_EMPLOYEES', 'UPDATE_EMPLOYEES'],
                  reason,
                });
                assert.deepEqual(edited.permissions, ['UPDATE_EMPLOYEES', 'VIEW_EMPLOYEES']);
                assert.deepEqual(
                  [await version(inA), await version(inB)],
                  [before[0]! + 1, before[1]! + 1],
                );
                assert.equal(await sessions.resolve(sessionA, tx), null);
                assert.equal(await sessions.resolve(sessionB, tx), null);
                const [changed] = await tx.auditEvent.findMany({
                  where: { entityId: shared.id, action: 'ROLE_PERMISSIONS_CHANGED' },
                });
                assert.deepEqual(changed?.after, {
                  permissions: ['UPDATE_EMPLOYEES', 'VIEW_EMPLOYEES'],
                  affectedUsers: 2,
                });
                // Deactivation also invalidates every recipient.
                await roles.updateRole(ownerSession, shared.id, {
                  expectedVersion: edited.version,
                  isActive: false,
                  reason,
                });
                assert.deepEqual(
                  [await version(inA), await version(inB)],
                  [before[0]! + 2, before[1]! + 2],
                );
              });

              await context.test(
                'graph changes retire outstanding setup capabilities',
                async () => {
                  const viewer = await makeRole(['VIEW_EMPLOYEES']);
                  const created = await employees.create(ownerSession, {
                    employeeId: `SETUP-${run}`,
                    fullName: 'Nhân viên mới',
                    dateOfBirth: '1998-02-02',
                    address: '1 Hai Bà Trưng',
                    phone: phone().replace('+84', '0'),
                    locale: 'vi',
                    branchIds: [A],
                    classification: 'TRAINEE',
                    employmentStartDate: '2030-01-01',
                  });
                  userIds.push(created.id);
                  const setup = await employees.issueSetup(ownerSession, created.id, {
                    expectedVersion: created.version,
                    reason: 'Onboarding',
                  });
                  await assign(ownerSession, created.id, viewer.id, A);
                  const challenge = await tx.authChallenge.findUniqueOrThrow({
                    where: { flowTokenHash: new Uint8Array(capabilityDigest(setup.setupToken)!) },
                  });
                  assert.ok(challenge.invalidatedAt, 'assign roles before issuing setup');
                },
              );
            }

            await context.test('audit read: scope, pay restriction, filters, pages', async () => {
              const entityType = `ItAudit${run}`;
              const base = Date.now() - 60_000;
              const seed = [
                { branchId: A, dataClassification: 'STANDARD' },
                { branchId: B, dataClassification: 'STANDARD' },
                { branchId: null, dataClassification: 'STANDARD' },
                { branchId: A, dataClassification: 'EMPLOYEE_PAY' },
                { branchId: null, dataClassification: 'EMPLOYEE_PAY' },
              ] as const;
              const ids: string[] = [];
              for (const [index, row] of seed.entries()) {
                const created = await tx.auditEvent.create({
                  data: {
                    action:
                      row.dataClassification === 'EMPLOYEE_PAY'
                        ? 'BASE_SALARY_CHANGED'
                        : 'PROFILE_UPDATED',
                    actorKind: 'SYSTEM',
                    entityType,
                    entityId: `e${index}`,
                    branchId: row.branchId,
                    occurredAt: new Date(base + index * 1_000),
                    dataClassification: row.dataClassification,
                    after: { index },
                  },
                  select: { id: true },
                });
                ids.push(created.id);
              }
              const reader = async (
                grants: { permission: PermissionCodeName; branchId?: string }[],
                denies: { permission: PermissionCodeName; branchId: string }[] = [],
              ) => {
                const id = await principal('EMPLOYEE', [A]);
                sequence += 1;
                const permissions = await tx.permission.findMany({
                  select: { id: true, code: true },
                });
                const pid = (code: string) => permissions.find((row) => row.code === code)!.id;
                for (const grant of grants) {
                  await tx.userPermissionOverride.create({
                    data: {
                      userId: id,
                      permissionId: pid(grant.permission),
                      effect: 'ALLOW',
                      scopeKind: grant.branchId ? 'BRANCH' : 'GLOBAL',
                      branchId: grant.branchId ?? null,
                    },
                  });
                }
                for (const deny of denies) {
                  await tx.userPermissionOverride.create({
                    data: {
                      userId: id,
                      permissionId: pid(deny.permission),
                      effect: 'DENY',
                      scopeKind: 'BRANCH',
                      branchId: deny.branchId,
                    },
                  });
                }
                return login(id);
              };
              const visible = async (session: string) =>
                (await audit.list(session, { entityType, limit: 100 })).items
                  .map((item) => ids.indexOf(item.id))
                  .sort();
              assert.deepEqual(
                await visible(await reader([{ permission: 'VIEW_AUDIT_LOG', branchId: A }])),
                [0],
              );
              assert.deepEqual(
                await visible(
                  await reader([
                    { permission: 'VIEW_AUDIT_LOG', branchId: A },
                    { permission: 'VIEW_EMPLOYEE_PAY', branchId: A },
                  ]),
                ),
                [0, 3],
              );
              assert.deepEqual(
                await visible(await reader([{ permission: 'VIEW_AUDIT_LOG' }])),
                [0, 1, 2],
              );
              // A branch DENY removes that branch and all null-branch (global) events.
              assert.deepEqual(
                await visible(
                  await reader(
                    [{ permission: 'VIEW_AUDIT_LOG' }],
                    [{ permission: 'VIEW_AUDIT_LOG', branchId: B }],
                  ),
                ),
                [0],
              );
              assert.deepEqual(
                await visible(
                  await reader([
                    { permission: 'VIEW_AUDIT_LOG' },
                    { permission: 'VIEW_EMPLOYEE_PAY' },
                  ]),
                ),
                [0, 1, 2, 3, 4],
              );
              // Pay permission alone grants no audit access.
              await fails(
                audit.list(await reader([{ permission: 'VIEW_EMPLOYEE_PAY' }]), { entityType }),
                'FORBIDDEN',
              );
              await fails(audit.list(customerSession, { entityType }), 'FORBIDDEN');
              await fails(audit.list(undefined, { entityType }), 'AUTHENTICATION_REQUIRED');

              // Keyset pagination, newest first, with filters.
              const all = await reader([
                { permission: 'VIEW_AUDIT_LOG' },
                { permission: 'VIEW_EMPLOYEE_PAY' },
              ]);
              const first = await audit.list(all, { entityType, limit: 2 });
              assert.deepEqual(
                first.items.map((item) => ids.indexOf(item.id)),
                [4, 3],
              );
              assert.ok(first.nextCursor);
              const second = await audit.list(all, {
                entityType,
                limit: 2,
                cursor: first.nextCursor,
              });
              assert.deepEqual(
                second.items.map((item) => ids.indexOf(item.id)),
                [2, 1],
              );
              const third = await audit.list(all, {
                entityType,
                limit: 2,
                cursor: second.nextCursor!,
              });
              assert.deepEqual(
                third.items.map((item) => ids.indexOf(item.id)),
                [0],
              );
              assert.equal(third.nextCursor, null);
              const filtered = await audit.list(all, {
                entityType,
                branchId: A,
                action: 'BASE_SALARY_CHANGED',
              });
              assert.deepEqual(
                filtered.items.map((item) => ids.indexOf(item.id)),
                [3],
              );
              assert.deepEqual(filtered.items[0]?.after, { index: 3 });
              await fails(audit.list(all, { entityType, cursor: 'bad' }), 'VALIDATION_FAILED');
              await fails(audit.list(all, { entityType, limit: 1_000 }), 'VALIDATION_FAILED');

              // Audit history stays append-only for the runtime connection.
              await tx.$executeRaw`SAVEPOINT audit_update`;
              await assert.rejects(
                tx.$executeRaw`UPDATE audit_events SET reason = 'tampered' WHERE id = ${ids[0]}::uuid`,
              );
              await tx.$executeRaw`ROLLBACK TO SAVEPOINT audit_update`;
              assert.equal(
                (await tx.auditEvent.findUniqueOrThrow({ where: { id: ids[0]! } })).reason,
                null,
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
      assert.equal(await database.role.count({ where: { code: { contains: run } } }), 0);
      assert.equal(await database.branch.count({ where: { code: { endsWith: run } } }), 0);
      assert.equal(await database.auditEvent.count({ where: { entityType: `ItAudit${run}` } }), 0);
      assert.equal(await database.permission.count(), permissionCount);
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

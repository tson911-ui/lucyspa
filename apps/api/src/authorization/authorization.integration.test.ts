import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  PERMISSION_CATALOG,
  syncPermissionCatalog,
} from '@lucy-spa/database';
import {
  AUTH_GRAPH_LOCK_KEY,
  AUTH_GRAPH_LOCK_NAMESPACE,
  takeExclusiveAuthGraphLock,
} from '../auth/auth-store.js';
import { authorizationSummary, decide, decideAcross, GLOBAL } from './authorization.js';
import { invalidateAuthorization, loadAuthorityGraph } from './authorization.store.js';

const fixtureHash =
  '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE';

// Explicit opt-in: ordinary unit tests do not connect to PostgreSQL.
test(
  'permission catalog sync and authority graph with actual Step 2 constraints; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 12).toUpperCase();
    const rollback = new Error('Intentional authorization integration rollback');
    const permissionsBefore = await database.permission.count();
    try {
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            await context.test('operator catalog sync is idempotent and exact', async () => {
              const first = await syncPermissionCatalog(tx);
              assert.equal(first.inserted + first.unchanged, PERMISSION_CATALOG.length);
              assert.equal(PERMISSION_CATALOG.length, 26);
              const second = await syncPermissionCatalog(tx);
              assert.deepEqual(second, { inserted: 0, unchanged: PERMISSION_CATALOG.length });
              const stored = await tx.permission.findMany({
                select: { code: true, scopeCapability: true, dataClassification: true },
              });
              assert.deepEqual(
                stored.sort((a, b) => (a.code < b.code ? -1 : 1)),
                [...PERMISSION_CATALOG]
                  .map((entry) => ({ ...entry }))
                  .sort((a, b) => (a.code < b.code ? -1 : 1)),
              );
            });

            const branch = async (label: string, isActive = true) =>
              (
                await tx.branch.create({
                  data: { code: `IT-${run}-${label}`, name: `Integration ${label}`, isActive },
                  select: { id: true },
                })
              ).id;
            const employee = async (label: string, active: boolean) => {
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind: 'EMPLOYEE',
                  status: active ? 'ACTIVE' : 'PENDING_SETUP',
                  fullName: `Employee ${label}`,
                  preferredLocale: 'vi',
                  phoneCanonical: `+84914${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: active ? fixtureHash : null,
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `IT-${run}-${label}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Integration address',
                    },
                  },
                },
                select: { id: true },
              });
              return id;
            };
            const permissionId = async (code: string) =>
              (await tx.permission.findUniqueOrThrow({ where: { code: code as 'VIEW_EMPLOYEES' } }))
                .id;

            await context.test(
              'graph loading applies active roles, memberships and branches',
              async () => {
                const [a, b, c] = [await branch('A'), await branch('B'), await branch('C', false)];
                const grantor = await employee('G', true);
                const target = await employee('T', false);
                await tx.employeeBranchAssignment.createMany({
                  data: [
                    { employeeUserId: target, branchId: a, grantedByUserId: grantor },
                    { employeeUserId: target, branchId: c, grantedByUserId: grantor },
                  ],
                });
                const revoked = await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: target, branchId: b, grantedByUserId: grantor },
                  select: { id: true, grantedAt: true },
                });
                await tx.employeeBranchAssignment.update({
                  where: { id: revoked.id },
                  data: { revokedAt: new Date(revoked.grantedAt.getTime() + 1) },
                });
                const viewer = await tx.role.create({
                  data: {
                    code: `IT_VIEW_${run}`,
                    displayNameVi: 'Xem',
                    displayNameEn: 'View',
                    permissions: {
                      create: [{ permissionId: await permissionId('VIEW_EMPLOYEES') }],
                    },
                  },
                  select: { id: true },
                });
                const dormant = await tx.role.create({
                  data: {
                    code: `IT_DORMANT_${run}`,
                    displayNameVi: 'Tạm ngưng',
                    displayNameEn: 'Inactive',
                    isActive: false,
                    permissions: {
                      create: [{ permissionId: await permissionId('MANAGE_PERMISSIONS') }],
                    },
                  },
                  select: { id: true },
                });
                await tx.userRoleAssignment.createMany({
                  data: [
                    { userId: target, roleId: viewer.id, scopeKind: 'BRANCH', branchId: a },
                    { userId: target, roleId: viewer.id, scopeKind: 'BRANCH', branchId: b },
                    { userId: target, roleId: viewer.id, scopeKind: 'BRANCH', branchId: c },
                    { userId: target, roleId: dormant.id, scopeKind: 'GLOBAL', branchId: null },
                  ],
                });
                const pay = await permissionId('VIEW_EMPLOYEE_PAY');
                await tx.userPermissionOverride.createMany({
                  data: [
                    { userId: target, permissionId: pay, effect: 'ALLOW', scopeKind: 'GLOBAL' },
                    {
                      userId: target,
                      permissionId: pay,
                      effect: 'DENY',
                      scopeKind: 'BRANCH',
                      branchId: a,
                    },
                  ],
                });

                const graph = await loadAuthorityGraph(tx, target);
                assert.ok(graph);
                assert.equal(graph.kind, 'EMPLOYEE');
                assert.deepEqual(
                  [...graph.activeBranchIds],
                  [a],
                  'revoked and inactive-branch memberships excluded',
                );
                assert.equal(graph.roleGrants.length, 3, 'inactive role grants nothing');
                const at = (branchId: string) => ({ kind: 'BRANCH', branchId }) as const;
                assert.equal(decide(graph, 'VIEW_EMPLOYEES', at(a)), true);
                assert.equal(decide(graph, 'VIEW_EMPLOYEES', at(b)), false, 'revoked membership');
                assert.equal(decide(graph, 'VIEW_EMPLOYEES', at(c)), false, 'inactive branch');
                assert.equal(decide(graph, 'VIEW_EMPLOYEES', GLOBAL), false);
                assert.equal(decide(graph, 'MANAGE_PERMISSIONS', GLOBAL), false);
                assert.equal(decide(graph, 'VIEW_EMPLOYEE_PAY', at(b)), true);
                assert.equal(decide(graph, 'VIEW_EMPLOYEE_PAY', at(a)), false, 'branch DENY wins');
                assert.equal(decideAcross(graph, 'VIEW_EMPLOYEE_PAY', [a, b]), false);
                assert.deepEqual(authorizationSummary(graph), {
                  version: 1,
                  grants: [
                    { permission: 'VIEW_EMPLOYEES', scope: at(a) },
                    { permission: 'VIEW_EMPLOYEE_PAY', scope: GLOBAL },
                  ],
                  denies: [{ permission: 'VIEW_EMPLOYEE_PAY', scope: at(a) }],
                });
                assert.equal(await loadAuthorityGraph(tx, randomUUID()), null);

                // A permission change bumps authzVersion and revokes sessions in the same transaction.
                const now = new Date();
                await tx.session.create({
                  data: {
                    tokenHash: new Uint8Array(randomBytes(32)),
                    kind: 'AUTHENTICATED',
                    userId: grantor,
                    credentialVersion: 1,
                    authzVersion: 1,
                    csrfKeyVersion: 1,
                    createdAt: now,
                    lastActivityAt: now,
                    absoluteExpiresAt: new Date(now.getTime() + 60_000),
                  },
                });
                assert.equal(await invalidateAuthorization(tx, [target, grantor, target], now), 1);
                const versions = await tx.user.findMany({
                  where: { id: { in: [grantor, target] } },
                  select: { authzVersion: true },
                });
                assert.deepEqual(
                  versions.map((row) => row.authzVersion),
                  [2, 2],
                );
                assert.equal(
                  await tx.session.count({ where: { userId: grantor, revokedAt: null } }),
                  0,
                );
                assert.equal((await loadAuthorityGraph(tx, target))?.authzVersion, 2);
              },
            );

            await context.test(
              'graph writers hold the exclusive lock against all auth mutations',
              async () => {
                await takeExclusiveAuthGraphLock(tx);
                const probeRollback = new Error('Intentional lock probe rollback');
                await assert.rejects(
                  database.$transaction(async (probe) => {
                    const shared = await probe.$queryRaw<{ acquired: boolean }[]>`
                    SELECT pg_try_advisory_xact_lock_shared(${AUTH_GRAPH_LOCK_NAMESPACE}::integer, ${AUTH_GRAPH_LOCK_KEY}::integer) AS acquired`;
                    assert.equal(shared[0]?.acquired, false);
                    throw probeRollback;
                  }),
                  (error: unknown) => error === probeRollback,
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 60_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(
        await database.permission.count(),
        permissionsBefore,
        'catalog sync rolled back',
      );
      assert.equal(
        await database.branch.count({ where: { code: { startsWith: `IT-${run}` } } }),
        0,
      );
      assert.equal(await database.role.count({ where: { code: { contains: run } } }), 0);
    } finally {
      await database.$disconnect();
    }
  },
);

import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
} from '@lucy-spa/database';
import { canSupervise, decide, loadAuthorityGraph } from '@lucy-spa/server';
import {
  BOOTSTRAP_REASON,
  BOOTSTRAP_SOURCE,
  planOrganizationBootstrap,
  runOrganizationBootstrap,
} from './organization-bootstrap.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'legacy organization bootstrap: derived, contained, idempotent, auditable; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const rollback = new Error('Intentional organization bootstrap integration rollback');
    try {
      await database.$connect();
      const branchCount = await database.branch.count();
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            const user = async (
              kind: 'EMPLOYEE' | 'OWNER',
              member: string[] = [],
              classification:
                'OFFICIAL_EMPLOYEE' | 'TRAINEE' | 'ENDED' | null = 'OFFICIAL_EMPLOYEE',
              status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
            ) => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status,
                  fullName: `Bootstrap ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `boot-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `boot-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84917${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `BOOT-${sequence}-${run}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {}),
                },
              });
              if (kind === 'EMPLOYEE') {
                if (classification) {
                  // Employment cannot start as ENDED: an official period precedes the end.
                  await tx.employmentClassificationChange.create({
                    data: {
                      employeeUserId: id,
                      classification:
                        classification === 'ENDED' ? 'OFFICIAL_EMPLOYEE' : classification,
                      effectiveDate: new Date('2020-01-01'),
                    },
                  });
                  if (classification === 'ENDED') {
                    await tx.employmentClassificationChange.create({
                      data: {
                        employeeUserId: id,
                        classification,
                        effectiveDate: new Date('2021-01-01'),
                      },
                    });
                  }
                }
                for (const branchId of member) {
                  await tx.employeeBranchAssignment.create({
                    data: { employeeUserId: id, branchId, grantedByUserId: ownerId },
                  });
                }
              }
              return id;
            };
            const existingOwner = await tx.user.findFirst({
              where: { kind: 'OWNER' },
              select: { id: true },
            });
            const ownerId = existingOwner?.id ?? randomUUID();
            if (!existingOwner) {
              await tx.user.create({
                data: {
                  id: ownerId,
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Bootstrap owner',
                  preferredLocale: 'vi',
                  emailCanonical: `boot-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `boot-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              });
            }
            const role = async (label: string, codes: PermissionCode[]) =>
              (
                await tx.role.create({
                  data: {
                    code: `BOOT_${label}_${run}`,
                    displayNameVi: 'Vai trò',
                    displayNameEn: 'Role',
                    permissions: {
                      create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                    },
                  },
                })
              ).id;
            const assign = (userId: string, roleId: string, branchId?: string) =>
              tx.userRoleAssignment.create({
                data: {
                  userId,
                  roleId,
                  scopeKind: branchId ? 'BRANCH' : 'GLOBAL',
                  branchId: branchId ?? null,
                },
              });

            const A = (await tx.branch.create({ data: { code: `BOOT-A-${run}`, name: 'A' } })).id;
            const B = (await tx.branch.create({ data: { code: `BOOT-B-${run}`, name: 'B' } })).id;
            const C = (await tx.branch.create({ data: { code: `BOOT-C-${run}`, name: 'C' } })).id;
            const managerRole = await role('MGR', ['APPROVE_LEAVE', 'VIEW_ATTENDANCE']);
            const employeeRole = await role('EMP', ['VIEW_EMPLOYEES', 'MANAGE_SKILLS']);
            const serviceRole = await role('SVC', ['PERFORM_SERVICES', 'MANAGE_BOOKINGS']);

            const mgrA = await user('EMPLOYEE', [A]);
            await assign(mgrA, managerRole, A);
            const mgrMulti = await user('EMPLOYEE', [A, B]);
            await assign(mgrMulti, managerRole, A);
            await assign(mgrMulti, employeeRole, B);
            await assign(mgrMulti, managerRole, C); // dormant: no membership of C
            const globalMgr = await user('EMPLOYEE', [A]);
            await assign(globalMgr, employeeRole);
            const mixed = await user('EMPLOYEE', [A]);
            await assign(mixed, employeeRole);
            await assign(mixed, managerRole, A);
            const plain = await user('EMPLOYEE', [A]);
            await assign(plain, serviceRole, A);
            const trainee = await user('EMPLOYEE', [A], 'TRAINEE');
            await assign(trainee, managerRole, A);
            const ended = await user('EMPLOYEE', [A], 'ENDED');
            await assign(ended, managerRole, A);
            const inactive = await user('EMPLOYEE', [A], 'OFFICIAL_EMPLOYEE', 'INACTIVE');
            await assign(inactive, managerRole, A);
            const already = await user('EMPLOYEE', [A]);
            await assign(already, managerRole, A);
            await tx.organizationAssignment.create({
              data: {
                employeeUserId: already,
                level: 'STORE_MANAGER',
                scopeKind: 'BRANCH',
                branchId: A,
                assignedByUserId: ownerId,
              },
            });
            const denied = await user('EMPLOYEE', [A]);
            await assign(denied, managerRole, A);
            await tx.userPermissionOverride.createMany({
              data: ['APPROVE_LEAVE', 'VIEW_ATTENDANCE'].map((code) => ({
                userId: denied,
                permissionId: permissions.get(code)!,
                effect: 'DENY' as const,
                scopeKind: 'BRANCH' as const,
                branchId: A,
              })),
            });
            const subordinate = await user('EMPLOYEE', [A]);
            const fixtureIds = new Set<string>([
              mgrA,
              mgrMulti,
              globalMgr,
              mixed,
              plain,
              trainee,
              ended,
              inactive,
              already,
              denied,
              subordinate,
            ]);
            const mine = <T extends { userId: string }>(rows: readonly T[]) =>
              rows.filter((row) => fixtureIds.has(row.userId));
            const branchesOf = (
              rows: readonly { userId: string; branchId: string }[],
              id: string,
            ) =>
              rows
                .filter((row) => row.userId === id)
                .map((row) => row.branchId)
                .sort();

            // Capability snapshot: appointments must never change what a permission decides.
            const before = new Map<string, boolean[]>();
            for (const id of fixtureIds) {
              const graph = (await loadAuthorityGraph(tx, id))!;
              before.set(
                id,
                ['APPROVE_LEAVE', 'VIEW_ATTENDANCE', 'VIEW_EMPLOYEES', 'MANAGE_SKILLS'].flatMap(
                  (code) =>
                    [A, B, C].map((branchId) => decide(graph, code, { kind: 'BRANCH', branchId })),
                ),
              );
            }

            // Dry run: derived, deterministic, and changes nothing.
            const plan = await planOrganizationBootstrap(tx);
            const rows = mine(plan.appointments);
            assert.deepEqual(
              branchesOf(rows, mgrA),
              [A],
              'branch-scoped manager maps to its branch only',
            );
            assert.deepEqual(
              branchesOf(rows, mgrMulti),
              [A, B].sort(),
              'each granted branch, never the dormant one',
            );
            assert.deepEqual(branchesOf(rows, mixed), [A]);
            for (const id of [
              globalMgr,
              plain,
              trainee,
              ended,
              inactive,
              already,
              denied,
              subordinate,
            ]) {
              assert.deepEqual(branchesOf(rows, id), [], 'no appointment for that employee');
            }
            assert.ok(
              rows.every((row) => row.level === 'DEPUTY_STORE_MANAGER'),
              'minimum position only',
            );
            const causes = rows.find((row) => row.userId === mgrA)!.causes;
            assert.deepEqual([...new Set(causes.map((cause) => cause.permission))].sort(), [
              'APPROVE_LEAVE',
              'VIEW_ATTENDANCE',
            ]);
            assert.ok(
              causes.every((cause) => cause.roleCode === `BOOT_MGR_${run}`),
              'provenance names the authoritative role',
            );
            assert.ok(
              !plan.appointments.some((row) => row.userId === ownerId),
              'Owner is never an appointment candidate',
            );
            assert.deepEqual(plan, await planOrganizationBootstrap(tx), 'deterministic');
            assert.ok(
              mine(plan.manualReview).some(
                (row) => row.userId === globalMgr && row.reason === 'GLOBAL_LEGACY_AUTHORITY',
              ),
              'SYSTEM authority is surfaced, not guessed',
            );
            assert.ok(
              mine(plan.manualReview).some(
                (row) => row.userId === mixed && row.reason === 'GLOBAL_LEGACY_AUTHORITY',
              ),
              'mixed authority still needs the Owner for the system part',
            );
            assert.ok(
              mine(plan.manualReview).some(
                (row) => row.userId === trainee && row.reason === 'NOT_OFFICIAL_EMPLOYEE',
              ),
            );
            const skips = mine(plan.skipped);
            assert.ok(
              skips.some((row) => row.userId === ended && row.reason === 'EMPLOYMENT_ENDED'),
            );
            assert.ok(skips.some((row) => row.userId === inactive && row.reason === 'NOT_ACTIVE'));
            assert.ok(
              skips.some((row) => row.userId === already && row.reason === 'ALREADY_APPOINTED'),
            );
            assert.ok(
              skips.some((row) => row.userId === denied && row.reason === 'AUTHORITY_FULLY_DENIED'),
            );
            assert.ok(
              skips.some(
                (row) =>
                  row.userId === mgrMulti &&
                  row.branchId === C &&
                  row.reason === 'DORMANT_GRANT_NO_ACTIVE_BRANCH_MEMBERSHIP',
              ),
            );
            assert.ok(
              plan.withoutManagementAuthority >= 2,
              'plain and subordinate hold nothing to migrate',
            );
            const dry = await runOrganizationBootstrap(tx, {
              apply: false,
              executionContext: 'test',
            });
            assert.equal(dry.status, 'OK');
            assert.equal(dry.status === 'OK' && dry.report.mode, 'DRY_RUN');
            assert.equal(
              await tx.organizationAssignment.count({
                where: { employeeUserId: { in: [...fixtureIds] } },
              }),
              1,
              'dry run wrote nothing (only the pre-existing appointment)',
            );

            // Apply.
            const applied = await runOrganizationBootstrap(tx, {
              apply: true,
              executionContext: 'test-apply',
            });
            assert.equal(applied.status, 'OK');
            if (applied.status !== 'OK') return;
            assert.ok(applied.report.created >= 4);
            const created = await tx.organizationAssignment.findMany({
              where: {
                employeeUserId: { in: [...fixtureIds] },
                endedAt: null,
                level: 'DEPUTY_STORE_MANAGER',
              },
            });
            assert.deepEqual(
              created.map((row) => `${row.employeeUserId}:${row.branchId}`).sort(),
              [`${mgrA}:${A}`, `${mgrMulti}:${A}`, `${mgrMulti}:${B}`, `${mixed}:${A}`].sort(),
            );
            assert.ok(
              created.every(
                (row) =>
                  row.assignedByUserId === ownerId &&
                  row.scopeKind === 'BRANCH' &&
                  row.teamId === null,
              ),
            );
            assert.equal(
              await tx.organizationAssignment.count({ where: { employeeUserId: ownerId } }),
              0,
              'Owner never converted',
            );

            // Provenance.
            const audits = await tx.auditEvent.findMany({
              where: {
                action: 'ORGANIZATION_APPOINTED',
                entityId: { in: created.map((row) => row.id) },
              },
            });
            assert.equal(audits.length, created.length);
            for (const audit of audits) {
              assert.equal(audit.actorKind, 'BOOTSTRAP');
              assert.equal(audit.reason, BOOTSTRAP_REASON);
              const after = audit.after as {
                source: string;
                level: string;
                executionContext: string;
                causes: unknown[];
              };
              assert.equal(after.source, BOOTSTRAP_SOURCE);
              assert.equal(after.level, 'DEPUTY_STORE_MANAGER');
              assert.equal(after.executionContext, 'test-apply');
              assert.ok(after.causes.length > 0);
            }
            assert.ok(
              (await tx.auditEvent.count({
                where: {
                  action: 'ORGANIZATION_BOOTSTRAP_RUN',
                  correlationId: audits[0]!.correlationId,
                },
              })) === 1,
            );

            // Never broadens: every permission decision is unchanged; supervision now works.
            for (const id of fixtureIds) {
              const graph = (await loadAuthorityGraph(tx, id))!;
              const now = [
                'APPROVE_LEAVE',
                'VIEW_ATTENDANCE',
                'VIEW_EMPLOYEES',
                'MANAGE_SKILLS',
              ].flatMap((code) =>
                [A, B, C].map((branchId) => decide(graph, code, { kind: 'BRANCH', branchId })),
              );
              assert.deepEqual(now, before.get(id), 'permission decisions unchanged');
            }
            const manager = (await loadAuthorityGraph(tx, mgrA))!;
            const sub = (await loadAuthorityGraph(tx, subordinate))!;
            assert.equal(canSupervise(manager, sub), true, 'preserves supervision of subordinates');
            assert.equal(
              canSupervise(manager, (await loadAuthorityGraph(tx, mgrMulti))!),
              false,
              'peers stay peers',
            );
            assert.equal(
              canSupervise(manager, (await loadAuthorityGraph(tx, already))!),
              false,
              'no supervision of a higher position',
            );
            const multi = (await loadAuthorityGraph(tx, mgrMulti))!;
            assert.equal(canSupervise(multi, (await loadAuthorityGraph(tx, mixed))!), false);
            assert.equal(
              canSupervise(multi, sub),
              true,
              'multi-branch manager covers each of its own branches',
            );

            // Idempotent: a repeat finds every branch covered and changes nothing.
            const total = await tx.organizationAssignment.count();
            const audited = await tx.auditEvent.count({
              where: { action: { in: ['ORGANIZATION_APPOINTED', 'ORGANIZATION_BOOTSTRAP_RUN'] } },
            });
            const again = await runOrganizationBootstrap(tx, {
              apply: true,
              executionContext: 'test-repeat',
            });
            assert.equal(again.status === 'OK' && again.report.created, 0);
            assert.equal(again.status === 'OK' && again.report.appointments.length, 0);
            assert.equal(
              await tx.organizationAssignment.count(),
              total,
              'no duplicate active appointment',
            );
            assert.equal(
              await tx.auditEvent.count({
                where: { action: { in: ['ORGANIZATION_APPOINTED', 'ORGANIZATION_BOOTSTRAP_RUN'] } },
              }),
              audited,
              'no audit noise on repeat',
            );
            assert.ok(
              again.status === 'OK' &&
                again.report.skipped.some(
                  (row) => row.userId === mgrA && row.reason === 'ALREADY_APPOINTED',
                ),
            );
            assert.ok(
              again.status === 'OK' &&
                mine(again.report.manualReview).length === mine(plan.manualReview).length,
              'manual-review cases remain surfaced',
            );

            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.branch.count(), branchCount, 'all fixtures rolled back');
    } finally {
      await database.$disconnect();
    }
  },
);

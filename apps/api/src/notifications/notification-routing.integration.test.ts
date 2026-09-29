import assert from 'node:assert/strict';
import { randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog } from '@lucy-spa/database';
import { resolveSupervisorRecipients, takeSharedAuthGraphLock } from '@lucy-spa/server';

type Level =
  | 'CEO'
  | 'REGIONAL_MANAGER'
  | 'AREA_MANAGER'
  | 'STORE_MANAGER'
  | 'DEPUTY_STORE_MANAGER'
  | 'TEAM_LEADER';
type Where =
  | { kind: 'GLOBAL' }
  | { kind: 'REGION'; id: string }
  | { kind: 'AREA'; id: string }
  | { kind: 'BRANCH'; id: string };

// Explicit opt-in: ordinary unit tests do not connect to PostgreSQL. All fixtures roll back.
test(
  'supervisor routing: lowest eligible level only, same-level peers all, escalation, Owner last',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const database = createDatabaseClient(databaseUrl);
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const rollback = new Error('Intentional notification routing rollback');
    try {
      await database.$connect();
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            await takeSharedAuthGraphLock(tx);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            const PERMISSION = 'APPROVE_LEAVE';
            let sequence = 0;
            const existingOwner = await tx.user.findFirst({
              where: { kind: 'OWNER' },
              select: { id: true, status: true },
            });
            const ownerId = existingOwner?.id ?? randomUUID();
            if (!existingOwner) {
              await tx.user.create({
                data: {
                  id: ownerId,
                  kind: 'OWNER',
                  status: 'ACTIVE',
                  fullName: 'Routing owner',
                  preferredLocale: 'vi',
                  emailCanonical: `route-owner-${run.toLowerCase()}@example.com`,
                  emailDelivery: `route-owner-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                },
              });
            }
            const employee = async (
              branches: string[],
              options: { status?: 'ACTIVE' | 'INACTIVE'; ended?: boolean } = {},
            ) => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind: 'EMPLOYEE',
                  status: options.status ?? 'ACTIVE',
                  fullName: `Route ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `route-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `route-${sequence}-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  phoneCanonical: `+84915${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  employeeProfile: {
                    create: {
                      employeeCodeCanonical: `ROUTE-${sequence}-${run}`,
                      dateOfBirth: new Date('1990-01-01'),
                      address: 'Fixture',
                    },
                  },
                },
              });
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2020-01-01'),
                },
              });
              if (options.ended) {
                await tx.employmentClassificationChange.create({
                  data: {
                    employeeUserId: id,
                    classification: 'ENDED',
                    effectiveDate: new Date('2021-01-01'),
                  },
                });
              }
              for (const branchId of branches) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: ownerId },
                });
              }
              return id;
            };
            const role = async (codes: string[]) =>
              (
                await tx.role.create({
                  data: {
                    code: `ROUTE_${run}_${++sequence}`,
                    displayNameVi: 'Vai trò',
                    displayNameEn: 'Role',
                    permissions: {
                      create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                    },
                  },
                })
              ).id;
            const grant = async (userId: string, where: Where, codes = [PERMISSION]) => {
              await tx.userRoleAssignment.create({
                data: {
                  userId,
                  roleId: await role(codes),
                  scopeKind: where.kind,
                  regionId: where.kind === 'REGION' ? where.id : null,
                  areaId: where.kind === 'AREA' ? where.id : null,
                  branchId: where.kind === 'BRANCH' ? where.id : null,
                },
              });
            };
            const appoint = (userId: string, level: Level, where: Where, teamId?: string) =>
              tx.organizationAssignment.create({
                data: {
                  employeeUserId: userId,
                  level,
                  scopeKind: where.kind,
                  regionId: where.kind === 'REGION' ? where.id : null,
                  areaId: where.kind === 'AREA' ? where.id : null,
                  branchId: where.kind === 'BRANCH' ? where.id : null,
                  teamId: teamId ?? null,
                  assignedByUserId: ownerId,
                },
              });
            const deny = (userId: string, branchId: string) =>
              tx.userPermissionOverride.create({
                data: {
                  userId,
                  permissionId: permissions.get(PERMISSION)!,
                  effect: 'DENY',
                  scopeKind: 'BRANCH',
                  branchId,
                },
              });
            const route = (
              subjectUserId: string,
              extra: { exclude?: string[]; branchIds?: string[] } = {},
            ) =>
              resolveSupervisorRecipients(tx, { subjectUserId, permission: PERMISSION, ...extra });
            const ids = (...values: string[]) => [...values].sort();

            // Geography and branches.
            const region = await tx.region.create({ data: { code: `RT_${run}`, name: 'Region' } });
            const area1 = await tx.area.create({
              data: { code: `RA1_${run}`, name: 'A1', regionId: region.id },
            });
            const area2 = await tx.area.create({
              data: { code: `RA2_${run}`, name: 'A2', regionId: region.id },
            });
            const b1 = (
              await tx.branch.create({ data: { code: `RB1-${run}`, name: 'B1', areaId: area1.id } })
            ).id;
            const b2 = (
              await tx.branch.create({ data: { code: `RB2-${run}`, name: 'B2', areaId: area1.id } })
            ).id;
            const b3 = (
              await tx.branch.create({ data: { code: `RB3-${run}`, name: 'B3', areaId: area2.id } })
            ).id;
            const team1 = await tx.team.create({
              data: { branchId: b1, code: `T1_${run}`, name: 'T1' },
            });
            const team2 = await tx.team.create({
              data: { branchId: b1, code: `T2_${run}`, name: 'T2' },
            });

            // The subject (a member of team 1) and the management ladder above them.
            const subject = await employee([b1]);
            await tx.teamMembership.create({
              data: {
                teamId: team1.id,
                branchId: b1,
                employeeUserId: subject,
                assignedByUserId: ownerId,
              },
            });
            const tl = await employee([b1]);
            await appoint(tl, 'TEAM_LEADER', { kind: 'BRANCH', id: b1 }, team1.id);
            await grant(tl, { kind: 'BRANCH', id: b1 });
            const otherTeamLeader = await employee([b1]);
            await appoint(otherTeamLeader, 'TEAM_LEADER', { kind: 'BRANCH', id: b1 }, team2.id);
            await grant(otherTeamLeader, { kind: 'BRANCH', id: b1 });
            const deputies = [await employee([b1]), await employee([b1]), await employee([b1])];
            for (const deputy of deputies) {
              await appoint(deputy, 'DEPUTY_STORE_MANAGER', { kind: 'BRANCH', id: b1 });
              await grant(deputy, { kind: 'BRANCH', id: b1 });
            }
            const [d1, d2, d3] = deputies as [string, string, string];
            const store = await employee([b1]);
            await appoint(store, 'STORE_MANAGER', { kind: 'BRANCH', id: b1 });
            await grant(store, { kind: 'BRANCH', id: b1 });
            const wrongScope = await employee([b1]); // position, but the permission is at another branch
            await appoint(wrongScope, 'STORE_MANAGER', { kind: 'BRANCH', id: b1 });
            await grant(wrongScope, { kind: 'BRANCH', id: b2 });
            const noPermission = await employee([b1]); // position, but not the permission
            await appoint(noPermission, 'DEPUTY_STORE_MANAGER', { kind: 'BRANCH', id: b1 });
            await grant(noPermission, { kind: 'BRANCH', id: b1 }, ['VIEW_ATTENDANCE']);
            const areaManager = await employee([]);
            const areaAppointment = await appoint(areaManager, 'AREA_MANAGER', {
              kind: 'AREA',
              id: area1.id,
            });
            await grant(areaManager, { kind: 'AREA', id: area1.id });
            const otherArea = await employee([]); // AREA_MANAGER of a DIFFERENT area
            await appoint(otherArea, 'AREA_MANAGER', { kind: 'AREA', id: area2.id });
            await grant(otherArea, { kind: 'AREA', id: area2.id });
            const regional = await employee([]);
            await appoint(regional, 'REGIONAL_MANAGER', { kind: 'REGION', id: region.id });
            await grant(regional, { kind: 'REGION', id: region.id });
            const ceo = await employee([]);
            await appoint(ceo, 'CEO', { kind: 'GLOBAL' });
            await grant(ceo, { kind: 'GLOBAL' });

            // 1. The lowest eligible level (the subject's own Team Leader) alone; Owner is not a
            //    routine recipient; nothing above, and the other team's leader is not eligible.
            let result = await route(subject);
            assert.deepEqual(result, {
              recipients: [tl],
              source: 'SUPERVISOR',
              level: 'TEAM_LEADER',
            });
            assert.ok(!result.recipients.includes(ownerId));

            // 2. A subject who is not in that team: Team Leaders never qualify; all Deputies do.
            const outsider = await employee([b1]);
            result = await route(outsider);
            assert.deepEqual(result.recipients, ids(d1, d2, d3), 'every eligible same-level peer');
            assert.equal(result.level, 'DEPUTY_STORE_MANAGER');
            // Not the Deputy without the permission, nor anyone above.
            assert.ok(
              ![noPermission, store, areaManager, regional, ceo, ownerId].some((id) =>
                result.recipients.includes(id),
              ),
            );

            // 3. The requester/subject and an explicit exclusion are never recipients (escalation).
            assert.deepEqual((await route(subject, { exclude: [tl] })).recipients, ids(d1, d2, d3));
            assert.deepEqual(
              (await route(d1)).recipients,
              [store],
              'peers do not supervise a peer',
            );
            assert.equal((await route(d1)).level, 'STORE_MANAGER');

            // 4. Multi-branch subject: every branch must be covered, at the lowest covering level.
            const multi = await employee([b1, b2]);
            result = await route(multi);
            assert.deepEqual(result.recipients, [areaManager], 'B1-only managers do not cover B2');
            assert.equal(result.level, 'AREA_MANAGER');
            // A subject with no branch is reached only by a GLOBAL position holding the permission.
            const floating = await employee([]);
            assert.deepEqual(await route(floating), {
              recipients: [ceo],
              source: 'SUPERVISOR',
              level: 'CEO',
            });
            // The caller may pin the branches an action authorizes against.
            assert.deepEqual((await route(multi, { branchIds: [b1] })).recipients, ids(d1, d2, d3));

            // 5. Escalation, one ineligibility at a time: DENY, inactive account, ended employment.
            await deny(tl, b1);
            assert.deepEqual(
              (await route(subject)).recipients,
              ids(d1, d2, d3),
              'DENY skips the Team Leader',
            );
            await deny(d1, b1);
            await tx.user.update({ where: { id: d2 }, data: { status: 'INACTIVE' } });
            await tx.employmentClassificationChange.create({
              data: {
                employeeUserId: d3,
                classification: 'ENDED',
                effectiveDate: new Date('2021-01-01'),
              },
            });
            result = await route(subject);
            assert.deepEqual(
              result.recipients,
              [store],
              'no Deputy is eligible; the Store Manager is next',
            );
            assert.equal(result.level, 'STORE_MANAGER');
            await deny(store, b1);
            result = await route(subject);
            assert.deepEqual(result, {
              recipients: [areaManager],
              source: 'SUPERVISOR',
              level: 'AREA_MANAGER',
            });
            assert.ok(!result.recipients.includes(otherArea), 'a different area never qualifies');
            await tx.organizationAssignment.update({
              where: { id: areaAppointment.id },
              data: { endedAt: new Date(Date.now() + 1000) },
            });
            result = await route(subject);
            assert.deepEqual(result, {
              recipients: [regional],
              source: 'SUPERVISOR',
              level: 'REGIONAL_MANAGER',
            });
            await deny(regional, b1);
            assert.deepEqual(await route(subject), {
              recipients: [ceo],
              source: 'SUPERVISOR',
              level: 'CEO',
            });

            // 6. Owner is the final fallback only, and can be excluded.
            await tx.user.update({ where: { id: ceo }, data: { status: 'INACTIVE' } });
            const ownerActive = (existingOwner?.status ?? 'ACTIVE') === 'ACTIVE';
            result = await route(subject);
            if (ownerActive) {
              assert.deepEqual(result, {
                recipients: [ownerId],
                source: 'OWNER_FALLBACK',
                level: null,
              });
              assert.deepEqual(await route(subject, { exclude: [ownerId] }), {
                recipients: [],
                source: 'NONE',
                level: null,
              });
            }
            // The Owner is not an employee subject.
            assert.deepEqual(await route(ownerId), { recipients: [], source: 'NONE', level: null });

            // 7. A Store Manager of both branches covers a multi-branch subject at their level.
            const both = await employee([b1, b2]);
            await appoint(both, 'STORE_MANAGER', { kind: 'BRANCH', id: b1 });
            await appoint(both, 'STORE_MANAGER', { kind: 'BRANCH', id: b2 });
            await grant(both, { kind: 'BRANCH', id: b1 });
            await grant(both, { kind: 'BRANCH', id: b2 });
            result = await route(multi);
            assert.deepEqual(result, {
              recipients: [both],
              source: 'SUPERVISOR',
              level: 'STORE_MANAGER',
            });
            // Missing the permission at one of the branches makes them ineligible again.
            await deny(both, b2);
            assert.equal((await route(multi)).source, ownerActive ? 'OWNER_FALLBACK' : 'NONE');
            void b3;

            throw rollback;
          },
          { timeout: 240_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

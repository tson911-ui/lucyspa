import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

// The partial unique indexes below are what make concurrent team commands safe: a racing
// writer that loses violates the key instead of producing a second active relationship.
test('organization hierarchy and team integrity constraints (all fixtures roll back)', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional organization foundation rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          let sequence = 0;
          const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
          const employee = async (branchIds: string[]) => {
            sequence += 1;
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind: 'EMPLOYEE',
                status: 'ACTIVE',
                fullName: `Org fixture ${sequence}`,
                preferredLocale: 'vi',
                emailCanonical: `org-${sequence}-${run.toLowerCase()}@example.com`,
                emailDelivery: `org-${sequence}-${run.toLowerCase()}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+849${phoneBase}${String(sequence).padStart(3, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                employeeProfile: {
                  create: {
                    employeeCodeCanonical: `ORG_${run}_${sequence}`,
                    dateOfBirth: new Date('1990-01-01'),
                    address: 'Fixture',
                  },
                },
              },
            });
            for (const branchId of branchIds) {
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: id, branchId, grantedByUserId: actor },
              });
            }
            return id;
          };
          const owner = randomUUID();
          await tx.user.create({
            data: {
              id: owner,
              kind: 'OWNER',
              status: 'ACTIVE',
              fullName: 'Org owner',
              preferredLocale: 'vi',
              emailCanonical: `org-owner-${run.toLowerCase()}@example.com`,
              emailDelivery: `org-owner-${run.toLowerCase()}@example.com`,
              emailVerifiedAt: new Date(),
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture-password-hash',
            },
          });
          const actor = owner;

          // Catalog: the operator sync (not run here on real data) covers the new codes.
          await syncPermissionCatalog(tx);
          for (const code of [
            'VIEW_ORGANIZATION',
            'MANAGE_ORGANIZATION',
            'MANAGE_ORG_ASSIGNMENTS',
            'VIEW_TEAMS',
            'MANAGE_TEAMS',
          ]) {
            assert.equal(await tx.permission.count({ where: { code: code as never } }), 1, code);
          }

          // Geography is configurable data.
          const region = await tx.region.create({
            data: { code: `R_${run}`, name: 'Region fixture' },
          });
          const area = await tx.area.create({
            data: { code: `A_${run}`, name: 'Area fixture', regionId: region.id },
          });
          await rejects(
            () => tx.region.create({ data: { code: `R_${run}`, name: 'Duplicate' } }),
            /Unique|unique/,
          );
          await rejects(
            () => tx.region.create({ data: { code: 'lower case', name: 'Bad code' } }),
            /regions_values|check/i,
          );
          const branch = await tx.branch.create({
            data: { code: `IT-ORG-${run}`, name: 'Org branch', areaId: area.id },
          });
          const other = await tx.branch.create({
            data: { code: `IT-ORG2-${run}`, name: 'Org branch 2' },
          });

          // Scope columns must agree with scope_kind on role assignments/overrides.
          const role = await tx.role.create({
            data: { code: `ORG_ROLE_${run}`, displayNameVi: 'Vai trò', displayNameEn: 'Role' },
          });
          const lead = await employee([branch.id]);
          const ktvA = await employee([branch.id]);
          const ktvB = await employee([branch.id]);
          const outsider = await employee([other.id]);
          await tx.userRoleAssignment.create({
            data: { userId: lead, roleId: role.id, scopeKind: 'REGION', regionId: region.id },
          });
          await rejects(
            () =>
              tx.userRoleAssignment.create({
                data: { userId: ktvA, roleId: role.id, scopeKind: 'REGION' },
              }),
            /scope_consistency|check/i,
          );
          await rejects(
            () =>
              tx.userRoleAssignment.create({
                data: {
                  userId: ktvA,
                  roleId: role.id,
                  scopeKind: 'AREA',
                  areaId: area.id,
                  branchId: branch.id,
                },
              }),
            /scope_consistency|check/i,
          );
          await rejects(
            () =>
              tx.userRoleAssignment.create({
                data: { userId: lead, roleId: role.id, scopeKind: 'REGION', regionId: region.id },
              }),
            /Unique|unique/,
          );

          // Appointments: scope must match the level; Deputy Store Managers are unlimited.
          const appoint = (
            userId: string,
            level:
              | 'CEO'
              | 'REGIONAL_MANAGER'
              | 'AREA_MANAGER'
              | 'STORE_MANAGER'
              | 'DEPUTY_STORE_MANAGER'
              | 'TEAM_LEADER',
            scope: Record<string, string>,
            kind: 'GLOBAL' | 'REGION' | 'AREA' | 'BRANCH',
          ) =>
            tx.organizationAssignment.create({
              data: {
                employeeUserId: userId,
                level,
                scopeKind: kind,
                ...scope,
                assignedByUserId: actor,
              },
            });
          await rejects(
            () => appoint(lead, 'STORE_MANAGER', { regionId: region.id }, 'REGION'),
            /scope_consistency|check/i,
          );
          await appoint(lead, 'REGIONAL_MANAGER', { regionId: region.id }, 'REGION');
          const deputies: { employeeUserId: string }[] = [];
          for (let index = 0; index < 5; index += 1) {
            const id = await employee([branch.id]);
            deputies.push(
              await appoint(id, 'DEPUTY_STORE_MANAGER', { branchId: branch.id }, 'BRANCH'),
            );
          }
          assert.equal(deputies.length, 5, 'no maximum number of Deputy Store Managers');
          await rejects(
            () =>
              appoint(
                deputies[0]!.employeeUserId,
                'DEPUTY_STORE_MANAGER',
                { branchId: branch.id },
                'BRANCH',
              ),
            /Unique|unique/,
          );
          await rejects(
            () => appoint(outsider, 'STORE_MANAGER', { branchId: branch.id }, 'BRANCH'),
            /active branch membership/,
          );

          // Teams are unlimited per branch; codes are unique per branch only.
          const teams: { id: string }[] = [];
          for (let index = 0; index < 4; index += 1)
            teams.push(
              await tx.team.create({
                data: { branchId: branch.id, code: `T${index}`, name: `Team ${index}` },
              }),
            );
          await tx.team.create({
            data: { branchId: other.id, code: 'T0', name: 'Other branch team' },
          });
          await rejects(
            () => tx.team.create({ data: { branchId: branch.id, code: 'T0', name: 'Duplicate' } }),
            /Unique|unique/,
          );
          const [team1, team2, team3] = teams as [{ id: string }, { id: string }, { id: string }];

          // One active Team Leader per team; one leader may lead several teams.
          await appoint(ktvA, 'TEAM_LEADER', { branchId: branch.id, teamId: team1.id }, 'BRANCH');
          await appoint(ktvA, 'TEAM_LEADER', { branchId: branch.id, teamId: team2.id }, 'BRANCH');
          await rejects(
            () => appoint(ktvB, 'TEAM_LEADER', { branchId: branch.id, teamId: team1.id }, 'BRANCH'),
            /Unique|unique/,
          );
          await rejects(
            () => appoint(ktvB, 'TEAM_LEADER', { branchId: other.id, teamId: team3.id }, 'BRANCH'),
            /foreign key|teams_id_branch|violat|active branch membership/i,
          );

          // One active team membership per employee per branch; teams are branch-bound.
          const membership = await tx.teamMembership.create({
            data: {
              teamId: team1.id,
              branchId: branch.id,
              employeeUserId: ktvB,
              assignedByUserId: actor,
            },
          });
          await rejects(
            () =>
              tx.teamMembership.create({
                data: {
                  teamId: team2.id,
                  branchId: branch.id,
                  employeeUserId: ktvB,
                  assignedByUserId: actor,
                },
              }),
            /Unique|unique/,
          );
          await rejects(
            () =>
              tx.teamMembership.create({
                data: {
                  teamId: team2.id,
                  branchId: other.id,
                  employeeUserId: ktvA,
                  assignedByUserId: actor,
                },
              }),
            /foreign key|teams_id_branch|violat|active branch membership/i,
          );
          await rejects(
            () =>
              tx.teamMembership.create({
                data: {
                  teamId: team3.id,
                  branchId: branch.id,
                  employeeUserId: outsider,
                  assignedByUserId: actor,
                },
              }),
            /active branch membership/,
          );

          // History is retained: ending is allowed once, rewriting or deleting is refused.
          await rejects(
            () =>
              tx.teamMembership.update({
                where: { id: membership.id },
                data: { teamId: team2.id },
              }),
            /End organization relationships/,
          );
          await rejects(
            () => tx.teamMembership.delete({ where: { id: membership.id } }),
            /cannot be deleted/,
          );
          const ended = await tx.teamMembership.update({
            where: { id: membership.id },
            data: { endedAt: new Date(Date.now() + 1000) },
          });
          assert.ok(ended.endedAt);
          await rejects(
            () =>
              tx.teamMembership.update({ where: { id: membership.id }, data: { endedAt: null } }),
            /End organization relationships/,
          );
          // Transfer = end + new membership; the employee then has exactly one active row.
          await tx.teamMembership.create({
            data: {
              teamId: team2.id,
              branchId: branch.id,
              employeeUserId: ktvB,
              assignedByUserId: actor,
            },
          });
          assert.equal(
            await tx.teamMembership.count({ where: { employeeUserId: ktvB, endedAt: null } }),
            1,
          );
          assert.equal(await tx.teamMembership.count({ where: { employeeUserId: ktvB } }), 2);

          // Archive is refused while relationships are active, and team branch is immutable.
          await rejects(
            () => tx.team.update({ where: { id: team2.id }, data: { isActive: false } }),
            /End active team relationships/,
          );
          await rejects(
            () => tx.team.update({ where: { id: team2.id }, data: { branchId: other.id } }),
            /immutable/,
          );
          await tx.teamMembership.updateMany({
            where: { teamId: team2.id, endedAt: null },
            data: { endedAt: new Date(Date.now() + 2000) },
          });
          await tx.organizationAssignment.updateMany({
            where: { teamId: team2.id, endedAt: null },
            data: { endedAt: new Date(Date.now() + 2000) },
          });
          const archived = await tx.team.update({
            where: { id: team2.id },
            data: { isActive: false },
          });
          assert.equal(archived.isActive, false);
          assert.equal(
            await tx.employeeProfile.count({ where: { userId: { in: [ktvA, ktvB] } } }),
            2,
            'archiving keeps employees',
          );
          assert.ok(
            (await tx.teamMembership.count({ where: { teamId: team2.id } })) > 0,
            'archiving keeps membership history',
          );
          await rejects(
            () =>
              tx.teamMembership.create({
                data: {
                  teamId: team2.id,
                  branchId: branch.id,
                  employeeUserId: ktvA,
                  assignedByUserId: actor,
                },
              }),
            /active team/,
          );

          // Geography and teams cannot be hard-deleted out from under history.
          await rejects(
            () => tx.area.delete({ where: { id: area.id } }),
            /foreign key|violat|restrict/i,
          );
          await rejects(
            () => tx.team.delete({ where: { id: team1.id } }),
            /foreign key|violat|restrict/i,
          );

          throw rollback;
        },
        { timeout: 120_000 },
      ),
      (error: unknown) => error === rollback,
    );
    assert.equal(await database.region.count({ where: { code: `R_${run}` } }), 0);
  } finally {
    await database.$disconnect();
  }
});

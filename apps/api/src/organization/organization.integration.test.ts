import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { takeExclusiveAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { TeamService } from '../teams/team.service.js';
import { OrganizationService } from './organization.service.js';
import { validVnMobile } from '../testing/phone.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
// Regression for the production report "the Owner is denied when creating an Area": the
// Owner (and a correctly positioned employee) must pass the Organization/Team SERVICE paths.
test(
  'organization and team administration: Owner and positioned employees pass, others are refused',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async () => {
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
    const rollback = new Error('Intentional organization service integration rollback');
    try {
      await database.$connect();
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
                isolated(async () => {
                  await takeExclusiveAuthGraphLock(tx);
                  return work(tx);
                }),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const organization = new OrganizationService(runner, throttle);
            const teams = new TeamService(runner, throttle);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            let sequence = 0;
            const principal = async (kind: 'OWNER' | 'EMPLOYEE', member: string[] = []) => {
              sequence += 1;
              const id = randomUUID();
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Org ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `orgsvc-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `orgsvc-${sequence}-${run.toLowerCase()}@example.com`,
                  normalizationVersion: 1,
                  passwordHash: '$argon2id$fixture',
                  phoneCanonical: kind === 'OWNER' ? null : validVnMobile(),
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `ORGSVC-${sequence}-${run}`,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {}),
                },
              });
              if (kind === 'EMPLOYEE') {
                await tx.employmentClassificationChange.create({
                  data: {
                    employeeUserId: id,
                    classification: 'OFFICIAL_EMPLOYEE',
                    effectiveDate: new Date('2020-01-01'),
                  },
                });
                for (const branchId of member) {
                  await tx.employeeBranchAssignment.create({
                    data: { employeeUserId: id, branchId, grantedByUserId: id },
                  });
                }
              }
              return id;
            };
            const grant = async (userId: string, codes: string[], branchId?: string) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `ORGSVC_${run}_${sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                  },
                },
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
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const reason = 'Regression';

            const existingOwner = await tx.user.findFirst({
              where: { kind: 'OWNER' },
              select: { id: true },
            });
            const ownerId = existingOwner?.id ?? (await principal('OWNER'));
            const ownerSession = await login(ownerId);
            const branch = await tx.branch.create({ data: { code: `ORGSVC-${run}`, name: 'B' } });

            // Owner: every structural operation, exactly the production sequence.
            const region = await organization.createRegion(ownerSession, {
              code: `MIEN_TRUNG_${run}`,
              name: 'Miền Trung',
              reason,
            });
            const area = await organization.createArea(ownerSession, {
              regionId: region.id,
              code: `DA_NANG_${run}`,
              name: 'Đà Nẵng',
              reason,
            });
            assert.equal(area.regionId, region.id);
            const renamed = await organization.updateArea(ownerSession, area.id, {
              name: 'Đà Nẵng 2',
              expectedVersion: area.version,
              reason,
            });
            const placed = await organization.placeBranch(ownerSession, branch.id, {
              areaId: area.id,
              expectedVersion: branch.rowVersion,
              reason,
            });
            assert.equal(placed.areaId, area.id);
            assert.equal(placed.regionId, region.id);
            const unplaced = await organization.placeBranch(ownerSession, branch.id, {
              areaId: null,
              expectedVersion: placed.version,
              reason,
            });
            assert.equal(unplaced.areaId, null);
            assert.equal(renamed.name, 'Đà Nẵng 2');
            const team = await teams.create(ownerSession, {
              branchId: branch.id,
              code: `TEAM_${run}`,
              name: 'Nhóm 1',
              reason,
            });
            assert.equal(team.branchId, branch.id);

            // Owner protection and validation still hold.
            await fails(
              organization.createArea(ownerSession, {
                regionId: randomUUID(),
                code: `X_${run}`,
                name: 'Nowhere',
                reason,
              }),
              'CONFLICT',
            );

            // An employee needs BOTH the permission and a position that outranks the level.
            const plain = await principal('EMPLOYEE', [branch.id]);
            await grant(plain, ['MANAGE_ORGANIZATION', 'MANAGE_TEAMS'], branch.id);
            const plainSession = await login(plain);
            await fails(
              teams.create(plainSession, {
                branchId: branch.id,
                code: `NOPE_${run}`,
                name: 'No position',
                reason,
              }),
              'FORBIDDEN',
            );
            await fails(
              organization.createRegion(plainSession, {
                code: `NOPE_${run}`,
                name: 'No position',
                reason,
              }),
              'FORBIDDEN',
            );
            // A Deputy Store Manager with MANAGE_TEAMS may create a team in their branch...
            const deputy = await principal('EMPLOYEE', [branch.id]);
            await grant(deputy, ['MANAGE_TEAMS'], branch.id);
            await tx.organizationAssignment.create({
              data: {
                employeeUserId: deputy,
                level: 'DEPUTY_STORE_MANAGER',
                scopeKind: 'BRANCH',
                branchId: branch.id,
                assignedByUserId: ownerId,
              },
            });
            const deputySession = await login(deputy);
            const second = await teams.create(deputySession, {
              branchId: branch.id,
              code: `TEAM2_${run}`,
              name: 'Nhóm 2',
              reason,
            });
            assert.equal(second.branchId, branch.id);
            // ...but has no authority to reshape geography.
            await fails(
              organization.createArea(deputySession, {
                regionId: region.id,
                code: `NOPE2_${run}`,
                name: 'No',
                reason,
              }),
              'FORBIDDEN',
            );
            // A CEO with MANAGE_ORGANIZATION (a position above every structure) may.
            const ceo = await principal('EMPLOYEE');
            await grant(ceo, ['MANAGE_ORGANIZATION']);
            await tx.organizationAssignment.create({
              data: {
                employeeUserId: ceo,
                level: 'CEO',
                scopeKind: 'GLOBAL',
                assignedByUserId: ownerId,
              },
            });
            const ceoSession = await login(ceo);
            const byCeo = await organization.createArea(ceoSession, {
              regionId: region.id,
              code: `CEO_AREA_${run}`,
              name: 'Khu vực CEO',
              reason,
            });
            assert.equal(byCeo.regionId, region.id);
            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

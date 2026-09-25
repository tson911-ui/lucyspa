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
import { SkillService } from '../skills/skill.service.js';
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
  'employee skills (Employee management Step 5): qualifications stay separate; all fixtures roll back',
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
    const rollback = new Error('Intentional employee skill integration rollback');
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
            const roles = new RoleAdminService(runner, throttle);
            const skills = new SkillService(runner, throttle);
            const B = await branch('B');
            // Catalog skills are database rows created here as fixtures (none are invented by
            // the UI); a role is also created to prove roles and skills stay independent.
            const skill = async (code: string) =>
              (
                await tx.skill.create({
                  data: { code: `${code}_${run}`, nameVi: code, nameEn: code },
                  select: { id: true },
                })
              ).id;
            const nail = await skill('NAIL');
            const massage = await skill('MASSAGE');
            const ktv = (
              await tx.role.create({
                data: {
                  code: `KTV_${run}`,
                  displayNameVi: 'KTV',
                  displayNameEn: 'KTV',
                  permissions: {
                    create: [{ permissionId: permissions.get('VIEW_ATTENDANCE')! }],
                  },
                },
                select: { id: true },
              })
            ).id;
            // Branch A workforce administrator with skills, pay, status and role rights in A.
            const hr = await principal('EMPLOYEE', [A]);
            await grant(
              hr,
              [
                ...STAFF,
                'MANAGE_SKILLS',
                'MANAGE_EMPLOYEE_PAY',
                'MANAGE_EMPLOYEE_STATUS',
                'MANAGE_PERMISSIONS',
                'VIEW_ATTENDANCE',
              ],
              A,
            );
            await insertRow(hr, 'OFFICIAL_EMPLOYEE', '2020-01-01');
            const hrSession = await login(hr, true);
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
                      branchAssignments: { select: { id: true, revokedAt: true } },
                    },
                  },
                },
              }),
              roles: await tx.userRoleAssignment.findMany({
                where: { userId: id },
                select: { id: true, roleId: true, scopeKind: true, branchId: true },
              }),
              classifications: await rows(id),
            });
            const skillRows = (id: string) =>
              tx.employeeSkill.findMany({
                where: { employeeUserId: id },
                select: { id: true, skillId: true, revokedAt: true },
                orderBy: { grantedAt: 'asc' },
              });
            const hired = (extra: Partial<EmployeeCreateRequest> = {}) =>
              input([A], {
                employmentStartDate: shift(today, -10),
                employmentReason: 'Existing staff',
                ...extra,
              });

            await context.test(
              '6–7, 11–14. trainees can hold skills; nothing else changes; no automatic skills',
              async () => {
                const trainee = track(await employees.create(hrSession, hired()));
                const official = track(
                  await employees.create(hrSession, hired({ classification: 'OFFICIAL_EMPLOYEE' })),
                );
                // 7. Official employment brings no skills by itself.
                assert.deepEqual((await skills.employeeSkills(hrSession, official.id)).skills, []);
                const before = await snapshot(trainee.id);
                const granted = await skills.grantEmployeeSkill(hrSession, trainee.id, {
                  skillId: nail,
                  reason: 'Qualified for nail services',
                });
                assert.deepEqual(
                  granted.skills.map((entry) => entry.skill.id),
                  [nail],
                  '6. a TRAINEE can hold a skill',
                );
                assert.deepEqual(granted.history, []);
                // 10–14. Roles, classification, account, employee code and branches unchanged.
                assert.deepEqual(await snapshot(trainee.id), before);
              },
            );

            await context.test(
              '1, 3–5. assign and revoke keep history; re-granting starts a new row',
              async () => {
                const member = track(await employees.create(hrSession, hired()));
                await skills.grantEmployeeSkill(hrSession, member.id, { skillId: nail });
                await skills.grantEmployeeSkill(hrSession, member.id, { skillId: massage });
                const revoked = await skills.revokeEmployeeSkill(hrSession, member.id, nail, {
                  reason: 'No longer offering nail',
                });
                assert.deepEqual(
                  revoked.skills.map((entry) => entry.skill.id),
                  [massage],
                );
                assert.deepEqual(
                  revoked.history.map((entry) => entry.skill.id),
                  [nail],
                );
                assert.ok(revoked.history[0]!.revokedAt >= revoked.history[0]!.grantedAt);
                // Re-granting creates a new grant; the old one stays as history.
                const again = await skills.grantEmployeeSkill(hrSession, member.id, {
                  skillId: nail,
                });
                assert.deepEqual(
                  again.skills.map((entry) => entry.skill.id).sort(),
                  [massage, nail].sort(),
                );
                assert.equal(again.history.length, 1);
                const stored = await skillRows(member.id);
                assert.equal(stored.length, 3, 'no row is ever deleted');
                const audits = await auditOf(member.id, 'EMPLOYEE_SKILL_REVOKED');
                assert.equal(audits[0]?.reason, 'No longer offering nail');
              },
            );

            await context.test(
              '8–10. promotion and role assignment do not touch skills',
              async () => {
                const member = track(await employees.create(hrSession, hired()));
                await skills.grantEmployeeSkill(hrSession, member.id, { skillId: nail });
                const before = await skillRows(member.id);
                const version = (await employees.get(hrSession, member.id)).version;
                await employees.changeClassification(hrSession, member.id, {
                  expectedVersion: version,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: today,
                  reason: 'Promotion',
                });
                assert.deepEqual(await skillRows(member.id), before, '8. promotion');
                const authorization = await roles.employeeAuthorization(hrSession, member.id);
                await roles.assignRole(hrSession, member.id, {
                  expectedVersion: authorization.version,
                  roleId: ktv,
                  scope: { kind: 'BRANCH', branchId: A },
                  reason: 'KTV at A',
                });
                assert.deepEqual(await skillRows(member.id), before, '9. role assignment');
                // 10. Granting a skill never assigns or removes a role.
                const rolesBefore = await tx.userRoleAssignment.count({
                  where: { userId: member.id },
                });
                await skills.grantEmployeeSkill(hrSession, member.id, { skillId: massage });
                assert.equal(
                  await tx.userRoleAssignment.count({ where: { userId: member.id } }),
                  rolesBefore,
                );
              },
            );

            await context.test(
              '15–17. ENDED receives no new skill; history stays; authorization enforced',
              async () => {
                const leaver = track(await employees.create(hrSession, hired()));
                await skills.grantEmployeeSkill(hrSession, leaver.id, { skillId: nail });
                // Ended with access kept on purpose: the ENDED guard (not the status) refuses.
                await employees.endEmployment(hrSession, leaver.id, {
                  expectedVersion: (await employees.get(hrSession, leaver.id)).version,
                  effectiveDate: today,
                  reason: 'Left',
                  disableAccess: false,
                });
                await fails(
                  skills.grantEmployeeSkill(hrSession, leaver.id, { skillId: massage }),
                  'CONFLICT',
                  'employment',
                );
                const after = await skills.employeeSkills(hrSession, leaver.id);
                assert.deepEqual(
                  after.skills.map((entry) => entry.skill.id),
                  [nail],
                  '16. still visible after employment ended',
                );
                // Revocation stays possible and becomes history.
                const revoked = await skills.revokeEmployeeSkill(hrSession, leaver.id, nail, {});
                assert.equal(revoked.history.length, 1);
                // 17. Authorization: no MANAGE_SKILLS, another branch, oneself, the Owner.
                const member = track(await employees.create(hrSession, hired()));
                const viewer = await principal('EMPLOYEE', [A]);
                await grant(viewer, ['VIEW_EMPLOYEES'], A);
                await fails(
                  skills.grantEmployeeSkill(await login(viewer, true), member.id, {
                    skillId: nail,
                  }),
                  'FORBIDDEN',
                );
                const other = await principal('EMPLOYEE', [B]);
                await insertRow(other, 'OFFICIAL_EMPLOYEE', '2020-01-01');
                await fails(
                  skills.grantEmployeeSkill(hrSession, other, { skillId: nail }),
                  'FORBIDDEN',
                );
                await fails(
                  skills.grantEmployeeSkill(hrSession, hr, { skillId: nail }),
                  'FORBIDDEN',
                );
                await fails(
                  skills.grantEmployeeSkill(hrSession, ownerId, { skillId: nail }),
                  'NOT_FOUND',
                );
                assert.deepEqual((await skills.employeeSkills(hrSession, member.id)).skills, []);
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

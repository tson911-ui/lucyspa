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
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { ServiceCatalogService } from '../catalog/service-catalog.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { SkillService } from './skill.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'skill catalog, service eligible skills and employee skills; all fixtures roll back',
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
    const rollback = new Error('Intentional skills integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const skillCount = await database.skill.count();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
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
            const skills = new SkillService(runner, throttle);
            const catalog = new ServiceCatalogService(runner, throttle);
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
                  data: { code: `SK-${label}-${run}`, name: `Branch ${label}` },
                  select: { id: true },
                })
              ).id;
            const [A, B] = [await branch('A'), await branch('B')];
            let sequence = 0;
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER',
              member: string[] = [],
              status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
            ) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status,
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `skill-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `skill-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical:
                    kind === 'OWNER'
                      ? null
                      : `+84918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `SKE-${sequence}-${run}`,
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
                  code: `SK_${run}_${sequence}`,
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
            const actor = async (
              codes: PermissionCode[],
              branchScope?: string,
              member: string[] = [],
            ) => {
              const id = await principal('EMPLOYEE', member);
              if (codes.length > 0) await grantRole(id, codes, branchScope);
              return { id, session: await login(id) };
            };
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({
                where: { entityId, action },
                orderBy: { occurredAt: 'asc' },
              });

            const ownerSession = existingOwner
              ? (await actor(['MANAGE_SKILLS', 'MANAGE_SERVICES', 'MANAGE_SERVICE_PRICES'])).session
              : await login(await principal('OWNER'));
            const skillAdmin = await actor(['MANAGE_SKILLS']);
            const branchSkills = await actor(['MANAGE_SKILLS'], A, [A]);
            const serviceAdmin = await actor(['MANAGE_SERVICES']);
            const branchServices = await actor(['MANAGE_SERVICES'], A, [A]);
            const customer = await login(await principal('CUSTOMER'));

            const ids: Record<string, string> = {};
            await context.test(
              'skill catalog: GLOBAL MANAGE_SKILLS only, versioned, audited',
              async () => {
                for (const [key, code, vi, en] of [
                  ['hair', `hair_${run}`, 'Gội đầu', 'Hair wash'],
                  ['herbal', `herbal_${run}`, 'Dưỡng sinh', 'Herbal'],
                  ['facial', `facial_${run}`, 'Chăm sóc da', 'Facial'],
                  ['nail', `nail_${run}`, 'Làm móng', 'Nail'],
                ] as const) {
                  const created = await skills.createSkill(skillAdmin.session, {
                    code,
                    nameVi: vi,
                    nameEn: en,
                  });
                  ids[key] = created.id;
                  assert.equal(created.code, code.toUpperCase());
                  assert.equal(created.version, 1);
                }
                assert.equal((await audit(ids['hair']!, 'SKILL_CREATED')).length, 1);
                await fails(
                  skills.createSkill(skillAdmin.session, {
                    code: `hair_${run}`,
                    nameVi: 'x',
                    nameEn: 'y',
                  }),
                  'CONFLICT',
                );
                await fails(
                  skills.createSkill(skillAdmin.session, {
                    code: '1BAD',
                    nameVi: 'x',
                    nameEn: 'y',
                  }),
                  'VALIDATION_FAILED',
                );
                // Branch-scoped MANAGE_SKILLS and MANAGE_SERVICES never change the catalog.
                for (const denied of [branchSkills.session, serviceAdmin.session]) {
                  await fails(
                    skills.createSkill(denied, { code: `NO_${run}`, nameVi: 'x', nameEn: 'y' }),
                    'FORBIDDEN',
                  );
                  await fails(
                    skills.updateSkill(denied, ids['hair']!, { expectedVersion: 1, nameEn: 'X' }),
                    'FORBIDDEN',
                  );
                }
                await fails(skills.listSkills(customer), 'FORBIDDEN');
                await fails(skills.listSkills(undefined), 'AUTHENTICATION_REQUIRED');

                const updated = await skills.updateSkill(skillAdmin.session, ids['hair']!, {
                  expectedVersion: 1,
                  nameEn: 'Hair care',
                });
                assert.equal(updated.version, 2);
                const [event] = await audit(ids['hair']!, 'SKILL_UPDATED');
                assert.deepEqual(event?.before, { nameEn: 'Hair wash' });
                assert.deepEqual(event?.after, { nameEn: 'Hair care' });
                await fails(
                  skills.updateSkill(skillAdmin.session, ids['hair']!, {
                    expectedVersion: 1,
                    nameEn: 'Stale',
                  }),
                  'CONFLICT',
                );
                const off = await skills.setSkillStatus(skillAdmin.session, ids['nail']!, {
                  expectedVersion: 1,
                  isActive: false,
                  reason: 'Not offered',
                });
                assert.equal(off.isActive, false);
                assert.equal(
                  (await audit(ids['nail']!, 'SKILL_STATUS_CHANGED'))[0]?.reason,
                  'Not offered',
                );
                await fails(
                  skills.setSkillStatus(skillAdmin.session, ids['nail']!, {
                    expectedVersion: 2,
                    isActive: false,
                    reason: 'Again',
                  }),
                  'CONFLICT',
                );
                const staffView = (await skills.listSkills(branchSkills.session)).skills.map(
                  (s) => s.id,
                );
                assert.ok(
                  !staffView.includes(ids['nail']!),
                  'inactive hidden from non-catalog managers',
                );
                assert.ok(
                  (await skills.listSkills(skillAdmin.session)).skills.some(
                    (s) => s.id === ids['nail'],
                  ),
                );
              },
            );

            await context.test(
              'service eligible skills: GLOBAL MANAGE_SERVICES only, ANY-one set',
              async () => {
                const category = await catalog.createCategory(ownerSession, {
                  code: `SKCAT_${run}`,
                  nameVi: 'Gội',
                  nameEn: 'Hair',
                });
                const service = await catalog.createService(ownerSession, {
                  code: `HERBAL_WASH_${run}`,
                  categoryId: category.id,
                  nameVi: 'Gội dưỡng sinh',
                  nameEn: 'Herbal hair wash',
                  priceVnd: '200000',
                  durationMinutes: 90,
                });
                assert.deepEqual(service.eligibleSkills, [], 'zero eligible skills is valid');
                const set = (session: string, version: number, skillIds: string[]) =>
                  catalog.setEligibleSkills(session, service.id, {
                    expectedVersion: version,
                    skillIds,
                  });
                for (const denied of [
                  skillAdmin.session,
                  branchServices.session,
                  branchSkills.session,
                ]) {
                  await fails(set(denied, service.version, [ids['hair']!]), 'FORBIDDEN');
                }
                const multi = await set(serviceAdmin.session, service.version, [
                  ids['herbal']!,
                  ids['hair']!,
                  ids['hair']!,
                ]);
                assert.deepEqual(
                  multi.eligibleSkills.map((skill) => skill.id).sort(),
                  [ids['hair']!, ids['herbal']!].sort(),
                  'multiple skills, duplicates collapsed',
                );
                assert.equal(multi.version, service.version + 1);
                const [event] = await audit(service.id, 'SERVICE_SKILLS_CHANGED');
                assert.equal(event?.branchId, null);
                assert.equal((event?.after as { added: unknown[] }).added.length, 2);
                await fails(
                  set(serviceAdmin.session, service.version, [ids['facial']!]),
                  'CONFLICT',
                );
                await fails(
                  set(serviceAdmin.session, multi.version, [ids['hair']!, ids['herbal']!]),
                  'VALIDATION_FAILED',
                );
                // Inactive or unknown skills can't be newly assigned.
                await fails(
                  set(serviceAdmin.session, multi.version, [
                    ids['hair']!,
                    ids['herbal']!,
                    ids['nail']!,
                  ]),
                  'VALIDATION_FAILED',
                );
                await fails(
                  set(serviceAdmin.session, multi.version, [ids['hair']!, randomUUID()]),
                  'VALIDATION_FAILED',
                );
                // Removing a relation keeps the skill.
                const reduced = await set(serviceAdmin.session, multi.version, [ids['hair']!]);
                assert.deepEqual(
                  reduced.eligibleSkills.map((skill) => skill.id),
                  [ids['hair']!],
                );
                assert.equal(await tx.skill.count({ where: { id: ids['herbal']! } }), 1);
                const cleared = await set(serviceAdmin.session, reduced.version, []);
                assert.deepEqual(cleared.eligibleSkills, []);
                ids['service'] = service.id;
                ids['serviceVersion'] = String(cleared.version);
              },
            );

            await context.test(
              'employee skills: branch scope, multi-branch containment, history',
              async () => {
                const inA = await principal('EMPLOYEE', [A]);
                const inAB = await principal('EMPLOYEE', [A, B]);
                const noBranch = await principal('EMPLOYEE');
                const inactive = await principal('EMPLOYEE', [A], 'INACTIVE');
                const grant = (session: string, employee: string, skillId: string) =>
                  skills.grantEmployeeSkill(session, employee, { skillId });

                const granted = await grant(branchSkills.session, inA, ids['herbal']!);
                assert.deepEqual(
                  granted.skills.map((entry) => entry.skill.id),
                  [ids['herbal']!],
                );
                const [event] = await audit(inA, 'EMPLOYEE_SKILL_GRANTED');
                assert.equal(event?.subjectUserId, inA);
                assert.equal(event?.branchId, A);
                assert.equal((event?.after as { skillCode: string }).skillCode, `HERBAL_${run}`);
                // One active grant per (employee, skill), not per branch.
                await fails(grant(branchSkills.session, inA, ids['herbal']!), 'CONFLICT');
                assert.equal(
                  await tx.employeeSkill.count({ where: { employeeUserId: inA, revokedAt: null } }),
                  1,
                );
                // A branch-A manager can't manage an employee who also works at B.
                await fails(grant(branchSkills.session, inAB, ids['hair']!), 'FORBIDDEN');
                await fails(grant(branchSkills.session, noBranch, ids['hair']!), 'FORBIDDEN');
                // A GLOBAL MANAGE_SKILLS holder covers every branch.
                const multi = await grant(skillAdmin.session, inAB, ids['hair']!);
                assert.equal(multi.skills.length, 1);
                assert.equal((await audit(inAB, 'EMPLOYEE_SKILL_GRANTED'))[0]?.branchId, null);
                // MANAGE_SERVICES alone is not employee-skill authority.
                await fails(grant(serviceAdmin.session, inA, ids['hair']!), 'FORBIDDEN');
                // Invalid targets and skills.
                for (const target of [await principal('CUSTOMER'), randomUUID()]) {
                  await fails(grant(skillAdmin.session, target, ids['hair']!), 'NOT_FOUND');
                }
                if (!existingOwner) {
                  const owner = await tx.user.findFirstOrThrow({
                    where: { kind: 'OWNER' },
                    select: { id: true },
                  });
                  await fails(grant(skillAdmin.session, owner.id, ids['hair']!), 'NOT_FOUND');
                }
                await fails(grant(skillAdmin.session, inA, ids['nail']!), 'VALIDATION_FAILED');
                await fails(grant(skillAdmin.session, inA, randomUUID()), 'VALIDATION_FAILED');
                await fails(grant(skillAdmin.session, inactive, ids['hair']!), 'CONFLICT');
                // Non-Owners never grant themselves skills.
                await fails(
                  grant(branchSkills.session, branchSkills.id, ids['hair']!),
                  'FORBIDDEN',
                );

                // Revocation keeps history and the catalog; re-granting creates a new row.
                const revoked = await skills.revokeEmployeeSkill(
                  branchSkills.session,
                  inA,
                  ids['herbal']!,
                  {
                    reason: 'Retrained',
                  },
                );
                assert.deepEqual(revoked.skills, []);
                assert.equal(await tx.employeeSkill.count({ where: { employeeUserId: inA } }), 1);
                assert.equal(await tx.skill.count({ where: { id: ids['herbal']! } }), 1);
                assert.equal((await audit(inA, 'EMPLOYEE_SKILL_REVOKED'))[0]?.reason, 'Retrained');
                await fails(
                  skills.revokeEmployeeSkill(branchSkills.session, inA, ids['herbal']!, {}),
                  'NOT_FOUND',
                );
                await grant(branchSkills.session, inA, ids['herbal']!);
                assert.equal(await tx.employeeSkill.count({ where: { employeeUserId: inA } }), 2);
                await fails(
                  skills.revokeEmployeeSkill(branchSkills.session, inAB, ids['hair']!, {}),
                  'FORBIDDEN',
                );

                // Reads: the employee themself, scoped managers; others get 404.
                const selfSession = await login(inA);
                assert.equal((await skills.employeeSkills(selfSession, inA)).skills.length, 1);
                assert.equal(
                  (await skills.employeeSkills(branchSkills.session, inA)).skills.length,
                  1,
                );
                await fails(skills.employeeSkills(branchSkills.session, inAB), 'NOT_FOUND');
                await fails(skills.employeeSkills(selfSession, inAB), 'NOT_FOUND');
                await fails(skills.employeeSkills(customer, inA), 'FORBIDDEN');

                // Future qualification rule (Phase 3), checked as data only: a service with
                // eligible skills {hair, herbal} and an employee holding {herbal} intersect.
                const configured = await catalog.setEligibleSkills(
                  serviceAdmin.session,
                  ids['service']!,
                  {
                    expectedVersion: Number(ids['serviceVersion']),
                    skillIds: [ids['hair']!, ids['herbal']!],
                  },
                );
                const eligible = new Set(configured.eligibleSkills.map((skill) => skill.id));
                const held = (await skills.employeeSkills(skillAdmin.session, inA)).skills.map(
                  (entry) => entry.skill.id,
                );
                assert.ok(
                  held.some((skillId) => eligible.has(skillId)),
                  'ANY-one intersection',
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.skill.count(), skillCount);
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

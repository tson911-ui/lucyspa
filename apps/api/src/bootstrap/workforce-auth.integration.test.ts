import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { LOGIN_POLICY, LoginService, type LoginPrincipal } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { RateLimitedError } from '../auth/registration.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { bootstrapOwner, type OwnerBootstrapInput } from './owner-bootstrap.js';

const PASSWORD = 'a calm lotus evening 2026';
const WORKFORCE_EMAIL: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMAIL' };
const EMPLOYEE_ID: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMPLOYEE_ID' };

function sqlState(error: unknown): string {
  if (Reflect.get(Object(error), 'code') === 'P2002') return '23505';
  const text = `${String(Reflect.get(Object(error), 'code'))} ${String(Reflect.get(Object(error), 'message'))}`;
  return /\b(42501|23505|55P03)\b/.exec(text)?.[1] ?? text;
}

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Owner bootstrap and workforce authentication with actual Step 2 constraints; all fixtures roll back',
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
    const run = randomUUID().replaceAll('-', '').slice(0, 10);
    const rollback = new Error('Intentional workforce integration rollback');
    try {
      await database.$connect();
      const preexistingOwner = (await database.user.count({ where: { kind: 'OWNER' } })) > 0;
      const hash = await passwords.hashForSetting(PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const service = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              {
                withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
                rotateAuthenticated: (token, evidence, options) =>
                  sessions.rotateAuthenticated(token, evidence, options, tx),
                resolve: (token) => sessions.resolve(token, tx),
                resolveForMutation: (token) => sessions.resolveForMutation(token, tx),
              },
              passwords,
              new AuthThrottleService(environment),
            );
            await service.onModuleInit();
            const anonymous = async () => (await sessions.createAnonymous(tx)).token;
            const phone = () => `+84915${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            const fails = (work: Promise<unknown>, code = 'AUTHENTICATION_FAILED') =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const ownerEmail = `owner-${run}@example.com`;
            const ownerInput: OwnerBootstrapInput = {
              fullName: 'Lucy Owner',
              emailCanonical: ownerEmail,
              emailDelivery: ownerEmail,
              phoneCanonical: null,
              normalizationVersion: 1,
              locale: 'vi',
              passwordHash: hash,
              executionContext: 'integration-test',
            };

            await context.test(
              'bootstrap creates exactly one Owner, audited, and repeats safely',
              { skip: preexistingOwner && 'An Owner already exists in this database.' },
              async () => {
                const created = await bootstrapOwner(tx, ownerInput);
                assert.equal(created.status, 'CREATED');
                const ownerId = created.status === 'CREATED' ? created.ownerId : '';
                const owner = await tx.user.findUniqueOrThrow({ where: { id: ownerId } });
                assert.equal(owner.kind, 'OWNER');
                assert.equal(owner.status, 'ACTIVE');
                assert.equal(owner.emailVerifiedAt, null, 'bootstrap does not claim verification');
                assert.equal(owner.passwordHash, hash);
                const audit = await tx.auditEvent.findMany({ where: { subjectUserId: ownerId } });
                assert.equal(audit.length, 1);
                assert.equal(audit[0]?.action, 'OWNER_BOOTSTRAPPED');
                assert.equal(audit[0]?.actorKind, 'BOOTSTRAP');
                assert.equal(audit[0]?.actorUserId, null);
                assert.equal(JSON.stringify(audit).includes(hash), false);
                assert.equal(JSON.stringify(audit).includes(ownerEmail), false);

                const repeated = await bootstrapOwner(tx, {
                  ...ownerInput,
                  emailCanonical: `other-${run}@example.com`,
                  emailDelivery: `other-${run}@example.com`,
                  passwordHash: await passwords.hashForSetting(`${PASSWORD} changed`),
                });
                assert.deepEqual(repeated, { status: 'ALREADY_INITIALIZED' });
                assert.equal(await tx.user.count({ where: { kind: 'OWNER' } }), 1);
                assert.equal(
                  (await tx.user.findUniqueOrThrow({ where: { id: ownerId } })).passwordHash,
                  hash,
                  'never overwrites credentials',
                );
              },
            );

            await context.test(
              'concurrent bootstrap is serialized and a second Owner is impossible',
              { skip: preexistingOwner && 'An Owner already exists in this database.' },
              async () => {
                // This transaction holds the exclusive graph lock from bootstrap: a
                // concurrent bootstrap waits and cannot proceed.
                const probeRollback = new Error('Intentional concurrent bootstrap probe rollback');
                await assert.rejects(
                  database.$transaction(async (probe) => {
                    await probe.$executeRaw`SET LOCAL lock_timeout = '300ms'`;
                    try {
                      await bootstrapOwner(probe, {
                        ...ownerInput,
                        emailCanonical: `race-${run}@example.com`,
                        emailDelivery: `race-${run}@example.com`,
                      });
                    } catch (error) {
                      assert.equal(sqlState(error), '55P03');
                      throw probeRollback;
                    }
                    assert.fail('concurrent bootstrap was not serialized');
                  }),
                  (error: unknown) => error === probeRollback,
                );
                // Even a privileged direct insert cannot create a second Owner.
                await tx.$executeRaw`SAVEPOINT second_owner`;
                await assert.rejects(
                  tx.user.create({
                    data: {
                      kind: 'OWNER',
                      status: 'ACTIVE',
                      fullName: 'Second Owner',
                      preferredLocale: 'vi',
                      emailCanonical: `second-${run}@example.com`,
                      emailDelivery: `second-${run}@example.com`,
                      normalizationVersion: 1,
                      passwordHash: hash,
                    },
                  }),
                  (error: unknown) => sqlState(error) === '23505',
                );
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT second_owner`;
              },
            );

            await context.test(
              'the ordinary application role cannot create an Owner',
              async (child) => {
                const privileges = await tx.$queryRaw<{ can: boolean }[]>`
                SELECT rolcreaterole OR rolsuper AS can FROM pg_roles WHERE rolname = current_user`;
                if (!privileges[0]?.can) {
                  child.skip(
                    'Database credentials lack CREATEROLE; restricted role not exercised.',
                  );
                  return;
                }
                const role = `lucy_it_app_${run}`;
                await tx.$executeRaw`SAVEPOINT restricted_role`;
                await tx.$executeRawUnsafe(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
                await tx.$executeRawUnsafe(`GRANT USAGE ON SCHEMA public TO ${role}`);
                await tx.$executeRawUnsafe(
                  `GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO ${role}`,
                );
                await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
                await assert.rejects(
                  tx.$executeRaw`
                  INSERT INTO users (kind, status, full_name, preferred_locale, email_canonical,
                    email_delivery, normalization_version, password_hash)
                  VALUES ('OWNER', 'ACTIVE', 'Not An Owner', 'vi', ${`app-${run}@example.com`},
                    ${`app-${run}@example.com`}, 1, ${hash})`,
                  (error: unknown) => sqlState(error) === '42501',
                );
                // Also removes the temporary role, its grants and the role switch.
                await tx.$executeRaw`ROLLBACK TO SAVEPOINT restricted_role`;
              },
            );

            await context.test('Owner signs in by email in the WORKFORCE realm only', async () => {
              const owner = await tx.user.findFirst({
                where: { kind: 'OWNER', emailCanonical: ownerEmail },
                select: { id: true },
              });
              if (!owner) return; // Pre-existing Owner: creation subtests were skipped.
              const peer = `${run}-owner`;
              await fails(service.login(ownerEmail, PASSWORD, await anonymous(), peer));
              await fails(
                service.login(
                  ownerEmail,
                  PASSWORD,
                  await anonymous(),
                  peer,
                  undefined,
                  EMPLOYEE_ID,
                ),
              );
              const result = await service.login(
                ownerEmail.toUpperCase(),
                PASSWORD,
                await anonymous(),
                peer,
                undefined,
                WORKFORCE_EMAIL,
              );
              assert.deepEqual(result.account, {
                id: owner.id,
                kind: 'OWNER',
                displayName: 'Lucy Owner',
                locale: 'vi',
                authorization: { version: 1, owner: true },
                // Bootstrap never verifies the address; the Owner verifies it after sign-in.
                recoveryEmail: { address: ownerEmail, verified: false },
              });
              assert.deepEqual(await service.currentAccount(result.token), result.account);
              await fails(service.currentAccount(await anonymous()), 'AUTHENTICATION_REQUIRED');
              await fails(service.currentAccount(undefined), 'AUTHENTICATION_REQUIRED');
            });

            await context.test(
              'employee login by ID or verified email, never in the customer realm',
              async () => {
                await syncPermissionCatalog(tx);
                const branch = await tx.branch.create({
                  data: { code: `IT-${run}`, name: 'Integration' },
                  select: { id: true },
                });
                const employee = async (label: string, status: 'ACTIVE' | 'PENDING_SETUP') => {
                  const id = randomUUID();
                  await tx.user.create({
                    data: {
                      id,
                      kind: 'EMPLOYEE',
                      status,
                      fullName: `Employee ${label}`,
                      preferredLocale: 'en',
                      emailCanonical: `${label}-${run}@example.com`,
                      emailDelivery: `${label}-${run}@example.com`,
                      phoneCanonical: phone(),
                      normalizationVersion: 1,
                      passwordHash: status === 'ACTIVE' ? hash : null,
                      employeeProfile: {
                        create: {
                          employeeCodeCanonical: `KTV-${label.toUpperCase()}-${run.toUpperCase()}`,
                          dateOfBirth: new Date('1995-05-05'),
                          address: 'Integration address',
                        },
                      },
                    },
                    select: { id: true },
                  });
                  return { id, code: `ktv-${label}-${run}`, email: `${label}-${run}@example.com` };
                };
                const active = await employee('a', 'ACTIVE');
                const pending = await employee('p', 'PENDING_SETUP');
                await tx.employeeBranchAssignment.create({
                  data: {
                    employeeUserId: active.id,
                    branchId: branch.id,
                    grantedByUserId: active.id,
                  },
                });
                const viewer = await tx.permission.findUniqueOrThrow({
                  where: { code: 'VIEW_EMPLOYEES' },
                });
                const role = await tx.role.create({
                  data: {
                    code: `IT_VIEW_${run.toUpperCase()}`,
                    displayNameVi: 'Xem',
                    displayNameEn: 'View',
                    permissions: { create: [{ permissionId: viewer.id }] },
                  },
                  select: { id: true },
                });
                await tx.userRoleAssignment.create({
                  data: {
                    userId: active.id,
                    roleId: role.id,
                    scopeKind: 'BRANCH',
                    branchId: branch.id,
                  },
                });
                const peer = `${run}-employee`;

                // Employee ID is trimmed and uppercased by the Step 3 normalization.
                const byId = await service.login(
                  ` ${active.code} `,
                  PASSWORD,
                  await anonymous(),
                  peer,
                  undefined,
                  EMPLOYEE_ID,
                );
                assert.equal(byId.account.kind, 'EMPLOYEE');
                assert.deepEqual(byId.account.authorization, {
                  version: 1,
                  grants: [
                    {
                      permission: 'VIEW_EMPLOYEES',
                      scope: { kind: 'BRANCH', branchId: branch.id },
                    },
                  ],
                  denies: [],
                });
                // Unverified employee email is not a workforce identifier; customer realm never.
                await fails(
                  service.login(
                    active.email,
                    PASSWORD,
                    await anonymous(),
                    peer,
                    undefined,
                    WORKFORCE_EMAIL,
                  ),
                );
                await fails(service.login(active.email, PASSWORD, await anonymous(), peer));
                await tx.user.update({
                  where: { id: active.id },
                  data: { emailVerifiedAt: new Date() },
                });
                const byEmail = await service.login(
                  active.email,
                  PASSWORD,
                  await anonymous(),
                  peer,
                  undefined,
                  WORKFORCE_EMAIL,
                );
                assert.equal(byEmail.account.id, active.id);
                await fails(service.login(active.email, PASSWORD, await anonymous(), peer));
                // PENDING_SETUP has no credential yet: same generic failure after dummy work.
                await fails(
                  service.login(
                    pending.code,
                    PASSWORD,
                    await anonymous(),
                    peer,
                    undefined,
                    EMPLOYEE_ID,
                  ),
                );

                // Reauthentication rotates without extending absolute lifetime.
                const before = await tx.session.findFirstOrThrow({
                  where: { user: { id: active.id }, revokedAt: null },
                  orderBy: { createdAt: 'desc' },
                });
                await fails(service.reauthenticate(byEmail.token, `${PASSWORD}!`, peer));
                assert.equal((await sessions.resolve(byEmail.token, tx))?.userId, active.id);
                const fresh = await service.reauthenticate(
                  byEmail.token,
                  PASSWORD,
                  peer,
                  randomUUID(),
                );
                assert.notEqual(fresh, byEmail.token);
                assert.equal(await sessions.resolve(byEmail.token, tx), null, 'no overlap window');
                const after = await sessions.resolve(fresh, tx);
                assert.equal(after?.kind, 'AUTHENTICATED');
                assert.ok(after?.reauthenticatedAt);
                assert.equal(
                  after?.absoluteExpiresAt.getTime(),
                  before.absoluteExpiresAt.getTime(),
                );
                assert.equal(
                  await tx.auditEvent.count({
                    where: { subjectUserId: active.id, action: 'SESSION_REAUTHENTICATED' },
                  }),
                  1,
                );
                await fails(
                  service.reauthenticate(await anonymous(), PASSWORD, peer),
                  'AUTHENTICATION_REQUIRED',
                );
                await fails(
                  service.reauthenticate(undefined, PASSWORD, peer),
                  'AUTHENTICATION_REQUIRED',
                );

                // logout-all revokes every session of that User, including the caller's.
                assert.ok(
                  (await tx.session.count({ where: { userId: active.id, revokedAt: null } })) >= 2,
                );
                await service.logoutAll(fresh, randomUUID());
                assert.equal(
                  await tx.session.count({ where: { userId: active.id, revokedAt: null } }),
                  0,
                );
                const revokedAudit = await tx.auditEvent.findFirstOrThrow({
                  where: { subjectUserId: active.id, action: 'SESSIONS_REVOKED' },
                });
                assert.equal(revokedAudit.actorUserId, active.id);
                assert.equal(Reflect.get(Object(revokedAudit.after), 'reason'), 'LOGOUT_ALL');
                await fails(service.logoutAll(fresh), 'AUTHENTICATION_REQUIRED');
                await fails(service.logoutAll(await anonymous()), 'AUTHENTICATION_REQUIRED');
              },
            );

            await context.test(
              'workforce identifier failures are throttled independently of existence',
              async () => {
                for (const code of [`ktv-ghost-${run}`, `ktv-a-${run}`]) {
                  for (
                    let attempt = 0;
                    attempt < LOGIN_POLICY.identifierFailureLimit;
                    attempt += 1
                  ) {
                    await fails(
                      service.login(
                        code,
                        `wrong ${PASSWORD}`,
                        await anonymous(),
                        `${run}-t${attempt}`,
                        undefined,
                        EMPLOYEE_ID,
                      ),
                    );
                  }
                  await assert.rejects(
                    service.login(
                      code,
                      PASSWORD,
                      await anonymous(),
                      `${run}-fresh`,
                      undefined,
                      EMPLOYEE_ID,
                    ),
                    RateLimitedError,
                  );
                }
                // A separate realm/identifier budget: the customer-realm budget is untouched.
                await fails(
                  service.login(
                    `ktv-a-${run}@example.com`,
                    PASSWORD,
                    await anonymous(),
                    `${run}-c`,
                  ),
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
      if (!preexistingOwner) {
        assert.equal(
          await database.user.count({ where: { kind: 'OWNER' } }),
          0,
          'no Owner persisted',
        );
      }
      assert.equal(await database.user.count({ where: { emailCanonical: { contains: run } } }), 0);
    } finally {
      await database.$disconnect();
    }
  },
);

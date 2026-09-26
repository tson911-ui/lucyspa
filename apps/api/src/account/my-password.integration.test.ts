import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import {
  AuthDeliveryProcessor,
  type AuthEmailMessage,
  type AuthEmailTransport,
} from '../auth/auth-delivery.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest, throttleDigest } from '../auth/crypto.js';
import { LoginService, type LoginPrincipal } from '../auth/login.service.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { PasswordService } from '../auth/password.service.js';
import { RateLimitedError } from '../auth/registration.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { MyAccountService } from './my-account.service.js';

const PASSWORD = 'a calm lotus evening 2026';
const NEW_PASSWORD = 'jasmine tea by the quiet river';
const RESET_PASSWORD = 'lanterns over the old harbour';
const BY_CODE: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMPLOYEE_ID' };
const BY_EMAIL: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMAIL' };

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Change password (follow-up Step 4): proof, policy, one surviving session, audit; all fixtures roll back',
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
      AUTH_OTP_ACTIVE_VERSION: '1',
      AUTH_OTP_KEYS: ring(),
      AUTH_DELIVERY_ACTIVE_VERSION: '1',
      AUTH_DELIVERY_KEYS: ring(),
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const passwords = new PasswordService();
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const userIds: string[] = [];
    const rollback = new Error('Intentional change-password integration rollback');
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
            const accounts = new MyAccountService(runner, throttle);
            const logins = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              {
                withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                  isolated(() => work(tx)),
                rotateAuthenticated: (token, evidence, options) =>
                  sessions.rotateAuthenticated(token, evidence, options, tx),
                resolve: (token) => sessions.resolve(token, tx),
                resolveForMutation: (token) => sessions.resolveForMutation(token, tx),
                continueAfterCredentialChange: (t, previous, requestId) =>
                  sessions.continueAfterCredentialChange(t, previous, requestId),
              },
              passwords,
              throttle,
            );
            await logins.onModuleInit();
            const resets = new PasswordResetService(environment, runner, passwords, throttle);
            const sent: AuthEmailMessage[] = [];
            const transport: AuthEmailTransport = {
              send: (message) => {
                sent.push(message);
                return Promise.resolve({});
              },
            };
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            const phone = () => `+84917${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            let sequence = 0;
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER',
              classification: string | null = 'OFFICIAL_EMPLOYEE',
            ) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              const email = `pw-${sequence}-${run.toLowerCase()}@example.com`;
              const code = `PW-${sequence}-${run}`;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: email,
                  emailDelivery: email,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: code,
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
              if (kind === 'EMPLOYEE' && classification) {
                await tx.$executeRaw`
                  INSERT INTO employment_classification_changes
                    (employee_user_id, classification, effective_date, reason)
                  VALUES (${id}::uuid, ${classification}::"EmploymentClassification",
                    CURRENT_DATE - 1, 'fixture')`;
              }
              return { id, email, code };
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
            const signIn = async (identifier: string, password: string, by: LoginPrincipal) =>
              logins.login(
                identifier,
                password,
                (await sessions.createAnonymous(tx)).token,
                `203.0.113.${randomInt(1, 250)}`,
                undefined,
                by,
              );
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const peer = () => `198.51.100.${randomInt(1, 250)}`;
            const credential = (id: string) =>
              tx.user.findUniqueOrThrow({
                where: { id },
                select: { passwordHash: true, credentialVersion: true },
              });
            const alive = async (token: string) => (await sessions.resolve(token, tx)) !== null;
            const change = (token: string | undefined, current: string, next: string) =>
              logins.changePassword(token, current, next, peer(), randomUUID());

            const member = await principal('EMPLOYEE');
            const bystander = await principal('EMPLOYEE');

            await context.test(
              'A, I–L. success: one surviving session, old password dead',
              async () => {
                const here = await login(member.id);
                const laptop = await login(member.id);
                const phoneSession = await login(member.id);
                const bystanderSession = await login(bystander.id);
                const before = await credential(member.id);
                const token = await change(here, PASSWORD, NEW_PASSWORD);
                assert.notEqual(token, here, 'a new token for this device');
                const after = await credential(member.id);
                assert.equal(after.credentialVersion, before.credentialVersion + 1);
                assert.notEqual(after.passwordHash, before.passwordHash);
                assert.ok(after.passwordHash?.startsWith('$argon2id$'));
                // K. every other session, and the pre-change token itself, are revoked.
                assert.deepEqual(
                  [await alive(here), await alive(laptop), await alive(phoneSession)],
                  [false, false, false],
                );
                assert.equal(
                  await tx.session.count({ where: { userId: member.id, revokedAt: null } }),
                  1,
                );
                // L. the replacement session works (reads and writes).
                const current = await sessions.resolve(token, tx);
                assert.equal(current?.userId, member.id);
                assert.equal(current?.credentialVersion, after.credentialVersion);
                const mine = await accounts.get(token);
                assert.equal(mine.id, member.id);
                await accounts.updateProfile(token, {
                  expectedVersion: mine.version,
                  fullName: 'Vẫn đăng nhập',
                });
                // Other accounts are untouched.
                assert.ok(await alive(bystanderSession));
                // I–J. the old password no longer signs in; the new one does.
                await fails(signIn(member.code, PASSWORD, BY_CODE), 'AUTHENTICATION_FAILED');
                const fresh = await signIn(member.code, NEW_PASSWORD, BY_CODE);
                assert.equal(fresh.account.id, member.id);
                // The session that changed it can change it again (still authenticated).
                const again = await change(token, NEW_PASSWORD, PASSWORD);
                assert.ok(await alive(again));
                assert.equal(await alive(fresh.token), false);
              },
            );

            await context.test('B. a wrong current password changes nothing', async () => {
              const here = await login(member.id);
              const before = await credential(member.id);
              await fails(change(here, `${PASSWORD}!`, NEW_PASSWORD), 'AUTHENTICATION_FAILED');
              assert.deepEqual(await credential(member.id), before);
              assert.ok(await alive(here), 'the session survives a wrong guess');
            });

            await context.test(
              'C–D. the existing policy applies; the same password is refused',
              async () => {
                const here = await login(member.id);
                const before = await credential(member.id);
                for (const weak of ['short', '123456789987654321', 'x'.repeat(129)]) {
                  await fails(change(here, PASSWORD, weak), 'VALIDATION_FAILED', 'newPassword');
                }
                await fails(
                  change(here, PASSWORD, PASSWORD),
                  'VALIDATION_FAILED',
                  'newPasswordUnchanged',
                );
                // No oracle: with a wrong current password the answer is the generic failure.
                await fails(change(here, `${PASSWORD}?`, `${PASSWORD}?`), 'AUTHENTICATION_FAILED');
                assert.deepEqual(await credential(member.id), before);
                assert.ok(await alive(here));
              },
            );

            await context.test(
              'F–H. identity: anonymous and customers refused, never another user',
              async () => {
                await fails(change(undefined, PASSWORD, NEW_PASSWORD), 'AUTHENTICATION_REQUIRED');
                const anonymous = (await sessions.createAnonymous(tx)).token;
                await fails(change(anonymous, PASSWORD, NEW_PASSWORD), 'AUTHENTICATION_REQUIRED');
                await fails(
                  change('not-a-session', PASSWORD, NEW_PASSWORD),
                  'AUTHENTICATION_REQUIRED',
                );
                const customer = await principal('CUSTOMER');
                const customerSession = await login(customer.id);
                const customerBefore = await credential(customer.id);
                await fails(change(customerSession, PASSWORD, NEW_PASSWORD), 'FORBIDDEN');
                assert.deepEqual(await credential(customer.id), customerBefore);
                // A's session changes A only: B's credential and sessions are untouched.
                const bystanderBefore = await credential(bystander.id);
                const bystanderSession = await login(bystander.id);
                const other = await principal('EMPLOYEE');
                await change(await login(other.id), PASSWORD, NEW_PASSWORD);
                assert.deepEqual(await credential(bystander.id), bystanderBefore);
                assert.ok(await alive(bystanderSession));
              },
            );

            await context.test(
              'rate limit: the reauthentication failure budget applies',
              async () => {
                const limited = await principal('EMPLOYEE');
                const here = await login(limited.id);
                for (let attempt = 0; attempt < 10; attempt += 1) {
                  await fails(
                    change(here, `wrong ${attempt} ${PASSWORD}`, NEW_PASSWORD),
                    'AUTHENTICATION_FAILED',
                  );
                }
                // Even the right password is now refused without password work.
                await assert.rejects(change(here, PASSWORD, NEW_PASSWORD), RateLimitedError);
                const before = await credential(limited.id);
                assert.equal(
                  (await passwords.verify(PASSWORD, before.passwordHash!)).verified,
                  true,
                );
              },
            );

            await context.test(
              'M. forgot password still works; pending resets are retired',
              async () => {
                const target = await principal('EMPLOYEE');
                const expireCooldown = () =>
                  tx.authThrottleBucket.deleteMany({
                    where: {
                      operationBucket: 'OTP_ISSUE_EMAIL_COOLDOWN',
                      pseudonymousKey: new Uint8Array(
                        throttleDigest(
                          'OTP_ISSUE_EMAIL_COOLDOWN',
                          target.email,
                          environment.auth.throttleKeys.get(1)!,
                        ),
                      ),
                    },
                  });
                const challengeFor = (flowToken: string) =>
                  tx.authChallenge.findUnique({
                    where: { flowTokenHash: new Uint8Array(capabilityDigest(flowToken)!) },
                    include: { deliveries: { orderBy: { generation: 'asc' } } },
                  });
                const pending = await resets.request(target.email, 'vi', peer(), 'WORKFORCE');
                assert.equal((await challengeFor(pending.flowToken))?.invalidatedAt, null);
                await change(await login(target.id), PASSWORD, NEW_PASSWORD);
                assert.ok(
                  (await challengeFor(pending.flowToken))?.invalidatedAt,
                  'a reset issued before the change can no longer complete',
                );
                // A fresh forgot-password flow completes as before.
                await expireCooldown();
                const flow = await resets.request(target.email, 'vi', peer(), 'WORKFORCE');
                const delivery = (await challengeFor(flow.flowToken))?.deliveries.at(-1);
                assert.ok(delivery);
                assert.equal(await processor.deliver(delivery.id), 'DELIVERED');
                const message = sent.at(-1)!;
                await resets.complete(flow.flowToken, message.code, RESET_PASSWORD, peer());
                const reset = await signIn(target.code, RESET_PASSWORD, BY_CODE);
                assert.equal(reset.account.id, target.id);
                await fails(signIn(target.code, NEW_PASSWORD, BY_CODE), 'AUTHENTICATION_FAILED');
              },
            );

            await context.test(
              'N. the Owner changes their password without an employee profile',
              async () => {
                const owner = existingOwner
                  ? await (async () => {
                      // Known password for the existing Owner inside this rolled-back transaction.
                      await tx.user.update({
                        where: { id: existingOwner.id },
                        data: { passwordHash: hash },
                      });
                      const row = await tx.user.findUniqueOrThrow({
                        where: { id: existingOwner.id },
                        select: { emailCanonical: true },
                      });
                      return { id: existingOwner.id, email: row.emailCanonical!, code: '' };
                    })()
                  : await principal('OWNER');
                const token = await change(await login(owner.id), PASSWORD, NEW_PASSWORD);
                assert.equal((await sessions.resolve(token, tx))?.userId, owner.id);
                assert.equal(await tx.employeeProfile.count({ where: { userId: owner.id } }), 0);
                assert.equal(
                  (await signIn(owner.email, NEW_PASSWORD, BY_EMAIL)).account.kind,
                  'OWNER',
                );
                await fails(signIn(owner.email, PASSWORD, BY_EMAIL), 'AUTHENTICATION_FAILED');
              },
            );

            await context.test(
              'O. managers, employees, collaborators and trainees can change it',
              async () => {
                for (const classification of ['OFFICIAL_EMPLOYEE', 'COLLABORATOR', 'TRAINEE']) {
                  const person = await principal('EMPLOYEE', classification);
                  if (classification === 'OFFICIAL_EMPLOYEE') {
                    // Also a manager: an active manager-group role (title "Quản lý").
                    const role = await tx.role.create({
                      data: {
                        code: `IT_MGR_${run}`,
                        displayNameVi: 'Quản lý',
                        displayNameEn: 'Manager',
                        isManagerGroup: true,
                      },
                      select: { id: true },
                    });
                    await tx.userRoleAssignment.create({
                      data: { userId: person.id, roleId: role.id, scopeKind: 'GLOBAL' },
                    });
                  }
                  const token = await change(await login(person.id), PASSWORD, NEW_PASSWORD);
                  assert.ok(await alive(token), classification);
                  assert.equal(
                    (await signIn(person.code, NEW_PASSWORD, BY_CODE)).account.id,
                    person.id,
                  );
                }
              },
            );

            await context.test(
              'P. audit: PASSWORD_CHANGED by the user, never a password or hash',
              async () => {
                const events = await tx.auditEvent.findMany({
                  where: { subjectUserId: member.id },
                  orderBy: { occurredAt: 'asc' },
                });
                const changed = events.filter((row) => row.action === 'PASSWORD_CHANGED');
                assert.equal(changed.length, 2);
                assert.equal(changed[0]?.actorUserId, member.id);
                assert.equal(changed[0]?.actorKind, 'USER');
                assert.equal((changed[0]?.after as { method?: string }).method, 'SELF_SERVICE');
                const revoked = events.find(
                  (row) =>
                    row.action === 'SESSIONS_REVOKED' &&
                    (row.after as { reason?: string }).reason === 'PASSWORD_CHANGED',
                );
                assert.deepEqual(revoked?.after, {
                  reason: 'PASSWORD_CHANGED',
                  revokedSessions: 2,
                });
                const all = JSON.stringify(
                  await tx.auditEvent.findMany({ where: { subjectUserId: { in: userIds } } }),
                );
                for (const secret of [PASSWORD, NEW_PASSWORD, RESET_PASSWORD, '$argon2']) {
                  assert.ok(!all.includes(secret), `audit never contains ${secret.slice(0, 7)}…`);
                }
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 240_000 },
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

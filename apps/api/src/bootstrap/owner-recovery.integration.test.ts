import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import type { PrismaService } from '../platform/prisma.service.js';
import {
  AuthDeliveryProcessor,
  type AuthEmailMessage,
  type AuthEmailTransport,
} from '../auth/auth-delivery.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest, throttleDigest } from '../auth/crypto.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { RecoveryEmailService } from '../auth/recovery-email.service.js';
import { SessionService } from '../auth/session.service.js';
import { resetOwnerPassword } from './owner-password-reset.js';

const OLD_PASSWORD = 'a calm lotus evening 2026';
const NEW_PASSWORD = 'a brand new lotus morning 2026';
const EMERGENCY_PASSWORD = 'emergency owner recovery phrase 2026';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Owner lockout recovery: recovery-email status, workforce reset, emergency operator reset; all fixtures roll back',
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
    const run = randomUUID().replaceAll('-', '').slice(0, 10);
    const userIds: string[] = [];
    const rollback = new Error('Intentional owner recovery integration rollback');
    try {
      await database.$connect();
      const preexistingOwner = (await database.user.count({ where: { kind: 'OWNER' } })) > 0;
      const oldHash = await passwords.hashForSetting(OLD_PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const resets = new PasswordResetService(environment, runner, passwords, throttle);
            const recovery = new RecoveryEmailService(environment, runner, throttle);
            const sent: AuthEmailMessage[] = [];
            const transport: AuthEmailTransport = {
              send: (message) => {
                sent.push(message);
                return Promise.resolve({});
              },
            };
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            const phone = () => `+84916${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            const account = async (
              label: string,
              kind: 'OWNER' | 'EMPLOYEE' | 'CUSTOMER',
              options: {
                status?: 'ACTIVE' | 'PENDING_SETUP' | 'INACTIVE';
                verified?: boolean;
              } = {},
            ) => {
              const id = randomUUID();
              userIds.push(id);
              const status = options.status ?? 'ACTIVE';
              // Mixed-case local part: delivery keeps the stored spelling.
              const delivery = `Staff.${label}-${run}@example.com`;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status,
                  fullName: `Recovery ${label}`,
                  preferredLocale: 'en',
                  emailCanonical: delivery.toLowerCase(),
                  emailDelivery: delivery,
                  emailVerifiedAt: options.verified || kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: status === 'PENDING_SETUP' ? null : oldHash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `KTV-${label.toUpperCase()}-${run.toUpperCase()}`,
                            dateOfBirth: new Date('1995-05-05'),
                            address: 'Integration address',
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-02-28'), address: '12 Lê Lợi' },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              return { id, delivery, canonical: delivery.toLowerCase() };
            };
            const login = async (userId: string, fresh: boolean) => {
              const anonymous = await sessions.createAnonymous(tx);
              const evidence = {
                userId,
                passwordHash: oldHash,
                credentialVersion: 1,
                authzVersion: 1,
              };
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
            const challengeFor = (flowToken: string) =>
              tx.authChallenge.findUnique({
                where: { flowTokenHash: new Uint8Array(capabilityDigest(flowToken)!) },
                include: { deliveries: { orderBy: { generation: 'asc' } } },
              });
            const deliverLatest = async (flowToken: string) => {
              const delivery = (await challengeFor(flowToken))?.deliveries.at(-1);
              assert.ok(delivery);
              assert.equal(await processor.deliver(delivery.id), 'DELIVERED');
              return sent.at(-1)!;
            };
            const expireCooldown = async (canonical: string) => {
              // Test-only shortcut for the 60-second cooldown inside the rollback transaction.
              await tx.authThrottleBucket.deleteMany({
                where: {
                  operationBucket: 'OTP_ISSUE_EMAIL_COOLDOWN',
                  pseudonymousKey: new Uint8Array(
                    throttleDigest(
                      'OTP_ISSUE_EMAIL_COOLDOWN',
                      canonical,
                      environment.auth.throttleKeys.get(1)!,
                    ),
                  ),
                },
              });
            };
            const fails = (work: Promise<unknown>, code = 'VERIFICATION_FAILED') =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const snapshot = (id: string) =>
              tx.user.findUniqueOrThrow({
                where: { id },
                select: {
                  status: true,
                  kind: true,
                  emailCanonical: true,
                  emailDelivery: true,
                  passwordHash: true,
                  credentialVersion: true,
                  authzVersion: true,
                  rowVersion: true,
                  preferredLocale: true,
                  phoneCanonical: true,
                },
              });

            const logins = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              {
                withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
                rotateAuthenticated: (token, evidence, options) =>
                  sessions.rotateAuthenticated(token, evidence, options, tx),
                resolve: (token) => sessions.resolve(token, tx),
                resolveForMutation: (token) => sessions.resolveForMutation(token, tx),
                continueAfterCredentialChange: (t, previous, requestId, reason) =>
                  sessions.continueAfterCredentialChange(t, previous, requestId, reason),
              },
              passwords,
              throttle,
            );
            await logins.onModuleInit();
            const signIn = async (email: string, password: string) =>
              logins.login(
                email,
                password,
                (await sessions.createAnonymous(tx)).token,
                `${run}-login-peer`,
                undefined,
                { realm: 'WORKFORCE', identifierType: 'EMAIL' },
              );
            const newHash = await passwords.hashForSetting(NEW_PASSWORD);
            const operator = (email: string) =>
              resetOwnerPassword(tx, {
                confirmEmailCanonical: email,
                passwordHash: newHash,
                executionContext: `integration-test:${run}`,
              });

            await context.test('emergency reset fails safely when there is no Owner', async () => {
              if (preexistingOwner) {
                context.diagnostic('An Owner exists in this database: NO_OWNER case skipped.');
                return;
              }
              assert.deepEqual(await operator(`nobody-${run}@example.com`), {
                status: 'NO_OWNER',
              });
            });
            if (preexistingOwner) {
              context.diagnostic('An Owner exists in this database: Owner fixtures skipped.');
              await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
              throw rollback;
            }
            const owner = await account('owner', 'OWNER');
            const employee = await account('staff', 'EMPLOYEE', { verified: true });
            const customer = await account('client', 'CUSTOMER');

            await context.test(
              'lockout today: an unverified Owner gets the neutral reply and no code',
              async () => {
                const unknown = await resets.request(
                  `nobody-${run}@example.com`,
                  'vi',
                  `${run}-a`,
                  'WORKFORCE',
                );
                const ownerFlow = await resets.request(
                  owner.delivery,
                  'vi',
                  `${run}-b`,
                  'WORKFORCE',
                );
                // Anti-enumeration: identical shape; nothing stored or sent for either.
                assert.deepEqual(Object.keys(ownerFlow).sort(), Object.keys(unknown).sort());
                assert.equal(ownerFlow.status, 'accepted');
                assert.equal(await challengeFor(ownerFlow.flowToken), null);
                assert.equal(await challengeFor(unknown.flowToken), null);
                // /auth/me tells the Owner (and only workforce accounts) the email status.
                const session = await login(owner.id, false);
                const me = await logins.currentAccount(session);
                assert.deepEqual(me.recoveryEmail, { address: owner.delivery, verified: false });
                const customerMe = await logins.currentAccount(await login(customer.id, false));
                assert.equal('recoveryEmail' in customerMe, false, 'customer response unchanged');
              },
            );

            await context.test(
              'in-app recovery: verify the email, then the workforce reset works for the Owner',
              async () => {
                const session = await login(owner.id, true);
                // The neutral request above debited the per-email cooldown (existing throttle).
                await expireCooldown(owner.canonical);
                const verifyFlow = await recovery.request(session, `${run}-c`);
                const verifyCode = (await deliverLatest(verifyFlow.flowToken)).code;
                await recovery.verify(session, verifyFlow.flowToken, verifyCode, `${run}-c`);
                const me = await logins.currentAccount(session);
                assert.deepEqual(me.recoveryEmail, { address: owner.delivery, verified: true });
                await expireCooldown(owner.canonical);
                const flow = await resets.request(owner.delivery, 'vi', `${run}-d`, 'WORKFORCE');
                const code = (await deliverLatest(flow.flowToken)).code;
                await resets.complete(flow.flowToken, code, NEW_PASSWORD, `${run}-d`);
                // Existing completion behaviour: next credential version, sessions revoked.
                assert.equal((await snapshot(owner.id)).credentialVersion, 2);
                assert.equal(await sessions.resolve(session, tx), null);
                await fails(signIn(owner.delivery, OLD_PASSWORD), 'AUTHENTICATION_FAILED');
                const signedIn = await signIn(owner.delivery, NEW_PASSWORD);
                assert.equal(signedIn.account.kind, 'OWNER');
              },
            );

            await context.test(
              'emergency reset: Owner only; password, versions, sessions, flows, audit',
              async () => {
                const before = await snapshot(owner.id);
                const session = (await signIn(owner.delivery, NEW_PASSWORD)).token;
                await expireCooldown(owner.canonical);
                const open = await resets.request(owner.delivery, 'vi', `${run}-e`, 'WORKFORCE');
                const openChallenge = await challengeFor(open.flowToken);
                assert.ok(openChallenge && !openChallenge.invalidatedAt);
                // Refuses anyone who is not the Owner: nothing changes for them or the Owner.
                for (const other of [employee, customer]) {
                  const untouched = await snapshot(other.id);
                  assert.deepEqual(await operator(other.canonical), {
                    status: 'IDENTITY_MISMATCH',
                  });
                  assert.deepEqual(await snapshot(other.id), untouched);
                }
                assert.deepEqual(await snapshot(owner.id), before);
                // Success.
                const emergencyHash = await passwords.hashForSetting(EMERGENCY_PASSWORD);
                const outcome = await resetOwnerPassword(tx, {
                  confirmEmailCanonical: owner.canonical,
                  passwordHash: emergencyHash,
                  executionContext: `integration-test:${run}`,
                });
                assert.equal(outcome.status, 'RESET');
                // Every open Owner session (including the one from the previous step) is signed out.
                assert.ok(outcome.status === 'RESET' && outcome.revokedSessions >= 1);
                assert.equal(
                  await tx.session.count({ where: { userId: owner.id, revokedAt: null } }),
                  0,
                );
                const after = await snapshot(owner.id);
                assert.equal(after.credentialVersion, before.credentialVersion + 1);
                assert.equal(after.status, 'ACTIVE');
                assert.equal(after.emailCanonical, before.emailCanonical);
                assert.ok(
                  (await passwords.verify(EMERGENCY_PASSWORD, after.passwordHash!)).verified,
                );
                assert.equal(await sessions.resolve(session, tx), null, 'sessions revoked');
                assert.ok((await challengeFor(open.flowToken))?.invalidatedAt, 'open flow retired');
                await fails(signIn(owner.delivery, NEW_PASSWORD), 'AUTHENTICATION_FAILED');
                assert.equal(
                  (await signIn(owner.delivery, EMERGENCY_PASSWORD)).account.kind,
                  'OWNER',
                );
                const audits = await tx.auditEvent.findMany({
                  where: { subjectUserId: owner.id, action: 'OWNER_PASSWORD_RESET_BY_OPERATOR' },
                });
                assert.equal(audits.length, 1);
                assert.equal(audits[0]?.actorKind, 'BOOTSTRAP');
                const text = JSON.stringify(audits);
                assert.ok(!text.includes(EMERGENCY_PASSWORD) && !text.includes(emergencyHash));
                // Verification state is untouched by the operator reset.
                const me = await logins.currentAccount(
                  (await signIn(owner.delivery, EMERGENCY_PASSWORD)).token,
                );
                assert.equal(me.recoveryEmail?.verified, true);
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
      assert.equal(await database.authChallenge.count({ where: { userId: { in: userIds } } }), 0);
      assert.equal(
        await database.auditEvent.count({ where: { subjectUserId: { in: userIds } } }),
        0,
      );
      assert.equal(
        (await database.user.count({ where: { kind: 'OWNER' } })) > 0,
        preexistingOwner,
        'no Owner remains after rollback',
      );
    } finally {
      await database.$disconnect();
    }
  },
);

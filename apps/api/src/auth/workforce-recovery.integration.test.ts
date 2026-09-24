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
} from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, generateCapability, throttleDigest } from './crypto.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { RecoveryEmailService } from './recovery-email.service.js';
import { RegistrationService } from './registration.service.js';
import { SessionService } from './session.service.js';

const OLD_PASSWORD = 'a calm lotus evening 2026';
const NEW_PASSWORD = 'a brand new lotus morning 2026';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'workforce recovery email and password reset with actual Step 2 constraints; all fixtures roll back',
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
    const rollback = new Error('Intentional workforce recovery integration rollback');
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
            // The shared resend endpoint forwards reset and recovery-email flows.
            const resend = new RegistrationService(
              environment,
              runner,
              passwords,
              throttle,
              resets,
              recovery,
            );
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
            const wrong = (code: string) =>
              ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');
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

            /**
             * Verifies the stored recovery email end to end for a workforce account and
             * checks that nothing but `emailVerifiedAt` changed.
             */
            const proveRecoveryEmail = async (
              target: { id: string; delivery: string; canonical: string },
              peer: string,
            ) => {
              const stale = await login(target.id, false);
              await fails(recovery.request(stale, peer), 'REAUTHENTICATION_REQUIRED');
              const session = await login(target.id, true);
              const before = await snapshot(target.id);
              // Email budgets are shared across purposes; the earlier reset probe claimed it.
              await expireCooldown(target.canonical);
              const flow = await recovery.request(session, peer);
              const challenge = await challengeFor(flow.flowToken);
              assert.ok(challenge);
              assert.equal(challenge.purpose, 'VERIFY_RECOVERY_EMAIL');
              assert.equal(challenge.userId, target.id);
              assert.equal(challenge.credentialVersion, 1);
              assert.equal(challenge.deliveryEmailSnapshot, target.delivery);
              assert.equal(
                challenge.flowExpiresAt.getTime() - challenge.createdAt.getTime(),
                900_000,
              );
              assert.equal(
                challenge.codeExpiresAt!.getTime() - challenge.codeGeneratedAt!.getTime(),
                300_000,
              );
              const first = await deliverLatest(flow.flowToken);
              assert.equal(first.to, target.delivery);
              assert.equal(first.purpose, 'VERIFY_RECOVERY_EMAIL');
              assert.equal(first.locale, 'en');

              await fails(recovery.verify(session, flow.flowToken, wrong(first.code), peer));
              assert.equal((await challengeFor(flow.flowToken))?.failedAttempts, 1);

              // Shared resend rotates the generation; the old code is then rejected.
              await expireCooldown(target.canonical);
              await resend.resend(flow.flowToken, peer);
              const rotated = await challengeFor(flow.flowToken);
              assert.equal(rotated?.generation, 2);
              assert.equal(rotated?.flowExpiresAt.getTime(), challenge.flowExpiresAt.getTime());
              const second = await deliverLatest(flow.flowToken);
              if (second.code !== first.code) {
                await fails(recovery.verify(session, flow.flowToken, first.code, peer));
              }

              const requestId = randomUUID();
              await recovery.verify(session, flow.flowToken, second.code, peer, requestId);
              await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
              await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
              const verified = await tx.user.findUniqueOrThrow({ where: { id: target.id } });
              assert.ok(verified.emailVerifiedAt, 'stored email is now verified');
              assert.deepEqual(await snapshot(target.id), before, 'nothing else changed');
              assert.ok((await challengeFor(flow.flowToken))?.consumedAt);
              // Sessions remain valid: no credential or authorization version changed.
              assert.equal((await sessions.resolve(session, tx))?.userId, target.id);
              assert.equal((await sessions.resolve(stale, tx))?.userId, target.id);
              const audit = await tx.auditEvent.findMany({
                where: { subjectUserId: target.id, action: 'RECOVERY_EMAIL_VERIFIED' },
              });
              assert.equal(audit.length, 1);
              assert.equal(audit[0]?.actorKind, 'USER');
              assert.equal(audit[0]?.actorUserId, target.id);
              assert.equal(audit[0]?.requestId, requestId);
              const serialized = JSON.stringify(audit);
              for (const secret of [target.canonical, target.delivery, second.code, oldHash]) {
                assert.equal(serialized.includes(secret), false);
              }

              // Replay fails; a verified address gets an inert receipt and no new flow.
              await fails(recovery.verify(session, flow.flowToken, second.code, peer));
              await expireCooldown(target.canonical);
              const inert = await recovery.request(await login(target.id, true), peer);
              assert.equal(await challengeFor(inert.flowToken), null);
              return session;
            };

            /** Full WORKFORCE-realm reset; returns the sessions that were revoked. */
            const resetInWorkforce = async (
              target: { id: string; delivery: string; canonical: string },
              peer: string,
            ) => {
              const open = await login(target.id, false);
              await expireCooldown(target.canonical);
              // A credential match in one realm grants nothing in the other.
              const crossRealm = await resets.request(target.canonical, 'en', peer, 'CUSTOMER');
              assert.equal(await challengeFor(crossRealm.flowToken), null);
              await expireCooldown(target.canonical);
              const flow = await resets.request(
                target.canonical.toUpperCase(),
                'vi',
                peer,
                'WORKFORCE',
              );
              const challenge = await challengeFor(flow.flowToken);
              assert.equal(challenge?.purpose, 'RESET_PASSWORD');
              assert.equal(challenge?.userId, target.id);
              const message = await deliverLatest(flow.flowToken);
              assert.equal(message.to, target.delivery, 'stored verified spelling');
              assert.equal(message.purpose, 'RESET_PASSWORD');
              const requestId = randomUUID();
              await resets.complete(flow.flowToken, message.code, NEW_PASSWORD, peer, requestId);
              await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
              await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
              const user = await tx.user.findUniqueOrThrow({ where: { id: target.id } });
              assert.equal(user.credentialVersion, 2);
              assert.equal(user.status, 'ACTIVE');
              assert.equal(
                (await passwords.verify(NEW_PASSWORD, user.passwordHash!)).verified,
                true,
              );
              assert.equal(await sessions.resolve(open, tx), null);
              assert.equal(
                await tx.session.count({ where: { userId: target.id, revokedAt: null } }),
                0,
              );
              const audit = await tx.auditEvent.findMany({
                where: { subjectUserId: target.id, action: 'PASSWORD_RESET_COMPLETED' },
              });
              assert.deepEqual(
                audit.map((event) => [event.actorKind, event.actorUserId, event.requestId]),
                [['SYSTEM', null, requestId]],
              );
            };

            await context.test(
              'Owner proves the stored recovery email, then recovers the password',
              { skip: preexistingOwner && 'An Owner already exists in this database.' },
              async () => {
                const owner = await account('owner', 'OWNER');
                const peer = `${run}-owner-peer`;
                // Unverified Owner email: self-service recovery is not yet available.
                const early = await resets.request(owner.canonical, 'en', peer, 'WORKFORCE');
                assert.equal(await challengeFor(early.flowToken), null);
                await proveRecoveryEmail(owner, peer);
                await resetInWorkforce(owner, peer);
                assert.equal(await tx.user.count({ where: { kind: 'OWNER' } }), 1);
              },
            );

            await context.test(
              'an employee proves the stored recovery email, then recovers the password',
              async () => {
                const employee = await account('emp', 'EMPLOYEE');
                const peer = `${run}-employee-peer`;
                const early = await resets.request(employee.canonical, 'en', peer, 'WORKFORCE');
                assert.equal(await challengeFor(early.flowToken), null);
                await proveRecoveryEmail(employee, peer);
                await resetInWorkforce(employee, peer);
              },
            );

            await context.test(
              'ineligible accounts, other Users and anonymous callers get nothing',
              async () => {
                const peer = `${run}-ineligible-peer`;
                const pending = await account('pend', 'EMPLOYEE', {
                  status: 'PENDING_SETUP',
                  verified: true,
                });
                const inactive = await account('gone', 'EMPLOYEE', {
                  status: 'INACTIVE',
                  verified: true,
                });
                const customer = await account('cust', 'CUSTOMER');
                // Reset never activates pending setup, reactivates employment or crosses realms.
                for (const target of [pending, inactive, customer]) {
                  const flow = await resets.request(target.canonical, 'en', peer, 'WORKFORCE');
                  assert.equal(await challengeFor(flow.flowToken), null);
                }
                assert.equal(
                  (await tx.user.findUniqueOrThrow({ where: { id: pending.id } })).status,
                  'PENDING_SETUP',
                );

                // Customers have no recovery-email flow.
                await fails(
                  recovery.request(await login(customer.id, true), peer),
                  'REQUEST_NOT_ALLOWED',
                );
                await fails(
                  recovery.request((await sessions.createAnonymous(tx)).token, peer),
                  'AUTHENTICATION_REQUIRED',
                );
                await fails(recovery.request(undefined, peer), 'AUTHENTICATION_REQUIRED');

                // A flow is usable only by the User it was issued to.
                const owner = await account('own2', 'EMPLOYEE');
                const intruder = await account('intr', 'EMPLOYEE');
                const flow = await recovery.request(await login(owner.id, true), peer);
                const { code } = await deliverLatest(flow.flowToken);
                const intruderSession = await login(intruder.id, false);
                await fails(recovery.verify(intruderSession, flow.flowToken, code, peer));
                const untouched = await challengeFor(flow.flowToken);
                assert.equal(untouched?.failedAttempts, 0);
                assert.equal(untouched?.invalidatedAt, null);
                assert.equal(
                  (await tx.user.findUniqueOrThrow({ where: { id: intruder.id } })).emailVerifiedAt,
                  null,
                );
                await fails(
                  recovery.verify(undefined, flow.flowToken, code, peer),
                  'AUTHENTICATION_REQUIRED',
                );
                await fails(recovery.verify(intruderSession, generateCapability(), code, peer));

                // Five failures retire the flow; the right code then fails.
                const session = await login(owner.id, false);
                for (let attempt = 0; attempt < 5; attempt += 1) {
                  await fails(recovery.verify(session, flow.flowToken, wrong(code), peer));
                }
                const exhausted = await challengeFor(flow.flowToken);
                assert.equal(exhausted?.failedAttempts, 5);
                assert.ok(exhausted?.invalidatedAt);
                await fails(recovery.verify(session, flow.flowToken, code, peer));
                assert.equal(
                  (await tx.user.findUniqueOrThrow({ where: { id: owner.id } })).emailVerifiedAt,
                  null,
                );
              },
            );

            await context.test('customer reset is unchanged by the realm parameter', async () => {
              const peer = `${run}-customer-peer`;
              const customer = await account('c2', 'CUSTOMER');
              const flow = await resets.request(customer.canonical, 'en', peer);
              const challenge = await challengeFor(flow.flowToken);
              assert.equal(challenge?.userId, customer.id);
              const { code } = await deliverLatest(flow.flowToken);
              await resets.complete(flow.flowToken, code, NEW_PASSWORD, peer);
              assert.equal(
                (await tx.user.findUniqueOrThrow({ where: { id: customer.id } })).credentialVersion,
                2,
              );
            });

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

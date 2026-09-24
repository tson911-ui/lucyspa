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
import { RegistrationService } from './registration.service.js';
import { SessionService } from './session.service.js';

const OLD_PASSWORD = 'a calm lotus evening 2026';
const NEW_PASSWORD = 'a brand new lotus morning 2026';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'customer password reset with actual Step 2 constraints; all fixtures roll back',
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
    const run = `reset-it-${randomUUID()}`;
    const userIds: string[] = [];
    const rollback = new Error('Intentional password reset integration rollback');
    try {
      await database.$connect();
      const oldHash = await passwords.hashForSetting(OLD_PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
            };
            const throttle = new AuthThrottleService(environment);
            const resets = new PasswordResetService(environment, runner, passwords, throttle);
            // The shared resend endpoint is served by RegistrationService and forwards resets.
            const resend = new RegistrationService(
              environment,
              runner,
              passwords,
              throttle,
              resets,
            );
            const sent: AuthEmailMessage[] = [];
            const transport: AuthEmailTransport = {
              send: (message) => {
                sent.push(message);
                return Promise.resolve({});
              },
            };
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            const peer = `${run}-peer`;
            const customer = async (label: string) => {
              const id = randomUUID();
              userIds.push(id);
              const delivery = `${run}-${label}@example.com`.replace('reset-it', 'Reset-IT');
              await tx.user.create({
                data: {
                  id,
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: 'Nguyễn Thị Linh',
                  preferredLocale: 'en',
                  emailCanonical: delivery.toLowerCase(),
                  emailDelivery: delivery,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+84913${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: oldHash,
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-02-28'), address: '12 Lê Lợi' },
                  },
                },
                select: { id: true },
              });
              return { id, delivery, canonical: delivery.toLowerCase() };
            };
            const login = async (userId: string) => {
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  { userId, passwordHash: oldHash, credentialVersion: 1, authzVersion: 1 },
                  { reauthenticated: false },
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
            const fails = (work: Promise<unknown>) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError && error.code === 'VERIFICATION_FAILED',
              );
            const wrong = (code: string) =>
              ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');

            await context.test('unknown identities receive an inert accepted flow', async () => {
              const flow = await resets.request(`${run}-nobody@example.com`, 'vi', peer);
              assert.equal(flow.status, 'accepted');
              assert.match(flow.flowToken, /^[A-Za-z0-9_-]{43}$/);
              assert.equal(await challengeFor(flow.flowToken), null);
              await fails(resets.complete(flow.flowToken, '123456', NEW_PASSWORD, peer));
              await fails(resets.complete(generateCapability(), '123456', NEW_PASSWORD, peer));
            });

            await context.test(
              'reset changes the credential and revokes every session',
              async () => {
                const linh = await customer('a');
                const first = await login(linh.id);
                const second = await login(linh.id);
                const flow = await resets.request(linh.canonical.toUpperCase(), 'vi', peer);
                const challenge = await challengeFor(flow.flowToken);
                assert.ok(challenge);
                assert.equal(challenge.purpose, 'RESET_PASSWORD');
                assert.equal(challenge.userId, linh.id);
                assert.equal(challenge.credentialVersion, 1);
                assert.equal(challenge.deliveryEmailSnapshot, linh.delivery);
                assert.equal(
                  challenge.flowExpiresAt.getTime() - challenge.createdAt.getTime(),
                  900_000,
                );
                assert.equal(
                  challenge.codeExpiresAt!.getTime() - challenge.codeGeneratedAt!.getTime(),
                  300_000,
                );
                const outbox = await tx.outboxEvent.findMany({
                  where: { aggregateId: challenge.deliveries[0]!.id },
                });
                assert.deepEqual(outbox[0]?.payload, {
                  deliveryId: challenge.deliveries[0]!.id,
                  eventVersion: 1,
                });

                const message = await deliverLatest(flow.flowToken);
                // Sent to the stored verified spelling, never the submitted variant.
                assert.equal(message.to, linh.delivery);
                assert.equal(message.purpose, 'RESET_PASSWORD');
                assert.equal(message.locale, 'vi');

                await fails(
                  resets.complete(flow.flowToken, wrong(message.code), NEW_PASSWORD, peer),
                );
                assert.equal((await challengeFor(flow.flowToken))?.failedAttempts, 1);
                assert.equal((await sessions.resolve(first, tx))?.userId, linh.id);

                // Shared resend: rotated generation, fixed deadline, old code rejected.
                await resend.resend(flow.flowToken, peer);
                assert.equal((await challengeFor(flow.flowToken))?.generation, 1, 'cooldown');
                await expireCooldown(linh.canonical);
                await resend.resend(flow.flowToken, peer);
                const rotated = await challengeFor(flow.flowToken);
                assert.equal(rotated?.generation, 2);
                assert.equal(rotated?.flowExpiresAt.getTime(), challenge.flowExpiresAt.getTime());
                const second_message = await deliverLatest(flow.flowToken);
                assert.equal(second_message.locale, 'en', 'resend uses the stored preference');
                if (second_message.code !== message.code) {
                  await fails(resets.complete(flow.flowToken, message.code, NEW_PASSWORD, peer));
                }

                const requestId = randomUUID();
                await resets.complete(
                  flow.flowToken,
                  second_message.code,
                  NEW_PASSWORD,
                  peer,
                  requestId,
                );
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
                const user = await tx.user.findUnique({ where: { id: linh.id } });
                assert.equal(user?.credentialVersion, 2);
                assert.equal(
                  (await passwords.verify(NEW_PASSWORD, user!.passwordHash!)).verified,
                  true,
                );
                assert.equal(
                  (await passwords.verify(OLD_PASSWORD, user!.passwordHash!)).verified,
                  false,
                );
                assert.equal(await sessions.resolve(first, tx), null);
                assert.equal(await sessions.resolve(second, tx), null);
                assert.equal(
                  await tx.session.count({ where: { userId: linh.id, revokedAt: null } }),
                  0,
                );
                assert.ok((await challengeFor(flow.flowToken))?.consumedAt);
                const audit = await tx.auditEvent.findMany({
                  where: {
                    subjectUserId: linh.id,
                    action: { in: ['PASSWORD_RESET_COMPLETED', 'SESSIONS_REVOKED'] },
                  },
                  orderBy: { action: 'asc' },
                });
                assert.deepEqual(
                  audit.map((event) => [event.action, event.actorKind, event.requestId]),
                  [
                    ['PASSWORD_RESET_COMPLETED', 'SYSTEM', requestId],
                    ['SESSIONS_REVOKED', 'SYSTEM', requestId],
                  ],
                );
                assert.deepEqual(audit[1]?.after, { reason: 'PASSWORD_RESET', revokedSessions: 2 });
                const serialized = JSON.stringify(audit);
                for (const secret of [linh.canonical, second_message.code, user!.passwordHash!]) {
                  assert.equal(serialized.includes(secret), false);
                }

                // Replay after consumption fails and changes nothing.
                await fails(
                  resets.complete(flow.flowToken, second_message.code, OLD_PASSWORD + '!', peer),
                );
                assert.equal(
                  (await tx.user.findUnique({ where: { id: linh.id } }))?.credentialVersion,
                  2,
                );
              },
            );

            await context.test(
              'five failures invalidate the flow and the right code then fails',
              async () => {
                const target = await customer('b');
                const flow = await resets.request(target.canonical, 'en', peer);
                const { code } = await deliverLatest(flow.flowToken);
                for (let attempt = 0; attempt < 5; attempt += 1) {
                  await fails(resets.complete(flow.flowToken, wrong(code), NEW_PASSWORD, peer));
                }
                const exhausted = await challengeFor(flow.flowToken);
                assert.equal(exhausted?.failedAttempts, 5);
                assert.ok(exhausted?.invalidatedAt);
                await fails(resets.complete(flow.flowToken, code, NEW_PASSWORD, peer));
                const user = await tx.user.findUnique({ where: { id: target.id } });
                assert.equal(user?.passwordHash, oldHash);
                assert.equal(user?.credentialVersion, 1);
              },
            );

            await context.test(
              'a newer request or credential change retires the old flow',
              async () => {
                const target = await customer('c');
                const older = await resets.request(target.canonical, 'en', peer);
                const olderCode = (await deliverLatest(older.flowToken)).code;
                await expireCooldown(target.canonical);
                const newer = await resets.request(target.canonical, 'en', peer);
                assert.ok((await challengeFor(older.flowToken))?.invalidatedAt, 'superseded');
                await fails(resets.complete(older.flowToken, olderCode, NEW_PASSWORD, peer));

                const newerCode = (await deliverLatest(newer.flowToken)).code;
                // Any other credential change (version bump) makes the bound flow unusable.
                await tx.user.update({
                  where: { id: target.id },
                  data: { credentialVersion: { increment: 1 } },
                });
                await fails(resets.complete(newer.flowToken, newerCode, NEW_PASSWORD, peer));
                assert.ok((await challengeFor(newer.flowToken))?.invalidatedAt);
                assert.equal(
                  (await tx.user.findUnique({ where: { id: target.id } }))?.passwordHash,
                  oldHash,
                );
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 120_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(await database.authChallenge.count({ where: { userId: { in: userIds } } }), 0);
      assert.equal(
        await database.auditEvent.count({ where: { subjectUserId: { in: userIds } } }),
        0,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

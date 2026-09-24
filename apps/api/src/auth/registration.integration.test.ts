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
} from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, generateCapability, throttleDigest } from './crypto.js';
import { RateLimitedError, RegistrationService } from './registration.service.js';

const fixtureHash =
  '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'customer registration and email OTP activation with actual Step 2 constraints; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const base = {
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
    } as const;
    const environment = parseApiEnvironment(base);
    const database = createDatabaseClient(databaseUrl);
    const run = `reg-it-${randomUUID()}`;
    const emails: string[] = [];
    const rollback = new Error('Intentional registration integration rollback');
    try {
      await database.$connect();
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
            };
            const throttle = new AuthThrottleService(environment);
            let hashes = 0;
            const service = new RegistrationService(
              environment,
              runner,
              {
                hashForSetting: () => {
                  hashes += 1;
                  return Promise.resolve(fixtureHash);
                },
              },
              throttle,
            );
            const sent: AuthEmailMessage[] = [];
            let failTransport = false;
            const transport: AuthEmailTransport = {
              send: (message, idempotencyKey) => {
                assert.equal(idempotencyKey, message.deliveryId);
                if (failTransport)
                  return Promise.reject(new Error(`provider echo ${message.code}`));
                sent.push(message);
                return Promise.resolve({ providerMessageId: `provider-${sent.length}` });
              },
            };
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            const peer = `${run}-peer`;
            const email = (label: string) => {
              const value = `${run}-${label}@Example.COM`;
              emails.push(value.toLowerCase());
              return value;
            };
            const phone = () => `0912${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            const registration = (address: string, phoneNumber = phone()) => ({
              fullName: 'Nguyễn Thị Linh',
              dateOfBirth: '1990-02-28',
              address: '12 Lê Lợi, Quận 1',
              email: address,
              phone: phoneNumber,
              password: 'a calm lotus evening 2026',
              locale: 'vi' as const,
            });
            const challengeFor = async (flowToken: string) =>
              tx.authChallenge.findUnique({
                where: { flowTokenHash: new Uint8Array(capabilityDigest(flowToken)!) },
                include: {
                  deliveries: { orderBy: { generation: 'asc' } },
                  registrationIntent: true,
                },
              });
            const deliverLatest = async (flowToken: string) => {
              const challenge = await challengeFor(flowToken);
              const delivery = challenge?.deliveries.at(-1);
              assert.ok(delivery);
              assert.equal(await processor.deliver(delivery.id), 'DELIVERED');
              return sent.at(-1)!.code;
            };
            const expireCooldown = async (address: string) => {
              // Test-only shortcut for the 60-second cooldown inside the rollback transaction.
              await tx.authThrottleBucket.deleteMany({
                where: {
                  operationBucket: 'OTP_ISSUE_EMAIL_COOLDOWN',
                  pseudonymousKey: new Uint8Array(
                    throttleDigest(
                      'OTP_ISSUE_EMAIL_COOLDOWN',
                      address.toLowerCase(),
                      environment.auth.throttleKeys.get(1)!,
                    ),
                  ),
                },
              });
            };
            const failsVerification = (flowToken: string, otp: string) =>
              assert.rejects(service.verify(flowToken, otp, peer), (error: unknown) => {
                return error instanceof AuthError && error.code === 'VERIFICATION_FAILED';
              });
            const wrong = (code: string) =>
              ((Number(code) + 1) % 1_000_000).toString().padStart(6, '0');

            await context.test(
              'registration stores a candidate, challenge and encrypted delivery only',
              async () => {
                const address = email('a');
                const input = registration(address);
                const flow = await service.register(input, peer);
                assert.deepEqual(Object.keys(flow).sort(), [
                  'codeLifetimeSeconds',
                  'flowToken',
                  'resendAfterSeconds',
                  'status',
                ]);
                const challenge = await challengeFor(flow.flowToken);
                assert.ok(challenge?.registrationIntent);
                assert.equal(challenge.purpose, 'ACTIVATE_CUSTOMER');
                assert.equal(challenge.generation, 1);
                assert.equal(challenge.maxAttempts, 5);
                assert.equal(challenge.deliveryEmailSnapshot, `${run}-a@example.com`);
                assert.equal(
                  challenge.codeExpiresAt!.getTime() - challenge.codeGeneratedAt!.getTime(),
                  300_000,
                );
                assert.equal(
                  challenge.flowExpiresAt.getTime(),
                  challenge.registrationIntent.expiresAt.getTime(),
                );
                assert.equal(
                  challenge.registrationIntent.expiresAt.getTime() -
                    challenge.registrationIntent.createdAt.getTime(),
                  1_800_000,
                );
                assert.equal(challenge.registrationIntent.emailCanonical, `${run}-a@example.com`);
                assert.equal(challenge.registrationIntent.emailDelivery, `${run}-a@example.com`);
                assert.equal(challenge.registrationIntent.passwordHash, fixtureHash);
                assert.equal(
                  challenge.registrationIntent.dateOfBirth.toISOString(),
                  '1990-02-28T00:00:00.000Z',
                );
                assert.equal(challenge.deliveries.length, 1);
                const delivery = challenge.deliveries[0]!;
                assert.equal(delivery.state, 'PENDING');
                assert.ok(delivery.encryptedPayload && delivery.encryptedPayload.length > 0);
                const outbox = await tx.outboxEvent.findMany({
                  where: { aggregateId: delivery.id },
                });
                assert.equal(outbox.length, 1);
                assert.equal(outbox[0]?.eventType, 'auth.email_delivery.requested');
                assert.deepEqual(outbox[0]?.payload, { deliveryId: delivery.id, eventVersion: 1 });
                assert.equal(
                  await tx.user.count({ where: { emailCanonical: `${run}-a@example.com` } }),
                  0,
                );

                assert.equal(await processor.deliver(delivery.id), 'DELIVERED');
                const message = sent.at(-1)!;
                assert.equal(message.to, `${run}-a@example.com`);
                assert.match(message.code, /^[0-9]{6}$/);
                const stored = await tx.authDelivery.findUnique({ where: { id: delivery.id } });
                assert.equal(stored?.state, 'DELIVERED');
                assert.equal(stored?.encryptedPayload, null);
                assert.equal(stored?.providerMessageId, `provider-${sent.length}`);
                assert.equal(await processor.deliver(delivery.id), 'SKIPPED');
                const persisted = JSON.stringify(
                  await tx.$queryRaw`SELECT to_jsonb(c) AS c FROM auth_challenges c WHERE id = ${challenge.id}::uuid`,
                );
                assert.equal(persisted.includes(message.code), false);

                // Wrong code: the failure debit persists although the call errors.
                await failsVerification(flow.flowToken, wrong(message.code));
                assert.equal((await challengeFor(flow.flowToken))?.failedAttempts, 1);

                // Resend inside the cooldown is silently suppressed.
                await service.resend(flow.flowToken, peer);
                assert.equal((await challengeFor(flow.flowToken))?.generation, 1);

                await expireCooldown(address);
                await service.resend(flow.flowToken, peer);
                const rotated = await challengeFor(flow.flowToken);
                assert.equal(rotated?.generation, 2);
                assert.equal(rotated?.failedAttempts, 1);
                assert.equal(
                  rotated?.flowExpiresAt.getTime(),
                  challenge.flowExpiresAt.getTime(),
                  'resend never extends the flow',
                );
                const second = await deliverLatest(flow.flowToken);
                // The previous generation's code is rejected even if it happens to match format.
                if (second !== message.code) await failsVerification(flow.flowToken, message.code);

                // A repeated signup supersedes the pending flow without editing it.
                await expireCooldown(address);
                const replacement = await service.register(registration(address), peer);
                const superseded = await challengeFor(flow.flowToken);
                assert.ok(superseded?.invalidatedAt);
                assert.ok(superseded?.registrationIntent?.invalidatedAt);
                assert.equal(superseded?.registrationIntent?.passwordHash, fixtureHash);
                await failsVerification(flow.flowToken, second);

                const code = await deliverLatest(replacement.flowToken);
                await service.verify(replacement.flowToken, code, peer, randomUUID());
                // Check the deferred kind/profile constraint now, then restore the default.
                await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
                await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
                const user = await tx.user.findUnique({
                  where: { emailCanonical: `${run}-a@example.com` },
                  include: { customerProfile: true, sessions: true },
                });
                assert.ok(user);
                assert.equal(user.kind, 'CUSTOMER');
                assert.equal(user.status, 'ACTIVE');
                assert.ok(user.emailVerifiedAt);
                assert.equal(user.passwordHash, fixtureHash);
                assert.equal(user.preferredLocale, 'vi');
                assert.equal(user.customerProfile?.address, '12 Lê Lợi, Quận 1');
                assert.equal(
                  user.customerProfile?.dateOfBirth.toISOString(),
                  '1990-02-28T00:00:00.000Z',
                );
                assert.equal(user.sessions.length, 0, 'activation never creates a session');
                const completed = await challengeFor(replacement.flowToken);
                assert.ok(completed?.consumedAt);
                assert.equal(completed?.registrationIntent?.completedUserId, user.id);
                const audit = await tx.auditEvent.findMany({
                  where: { subjectUserId: user.id },
                  orderBy: { action: 'asc' },
                });
                assert.deepEqual(
                  audit.map((event) => event.action),
                  ['CUSTOMER_EMAIL_VERIFIED', 'USER_CREATED'],
                );
                assert.ok(audit.every((event) => event.actorKind === 'SYSTEM'));
                assert.equal(JSON.stringify(audit).includes('example.com'), false);
                assert.equal(JSON.stringify(audit).includes(code), false);

                // Replay fails; a duplicate registration for the active User is accepted but inert.
                await failsVerification(replacement.flowToken, code);
                await expireCooldown(address);
                const before = await tx.registrationIntent.count({
                  where: { emailCanonical: `${run}-a@example.com` },
                });
                const duplicate = await service.register(
                  { ...registration(address), password: 'a different candidate password' },
                  peer,
                );
                assert.equal(await challengeFor(duplicate.flowToken), null);
                assert.equal(
                  await tx.registrationIntent.count({
                    where: { emailCanonical: `${run}-a@example.com` },
                  }),
                  before,
                );
                const unchanged = await tx.user.findUnique({ where: { id: user.id } });
                assert.equal(unchanged?.passwordHash, fixtureHash);
                assert.equal(unchanged?.rowVersion, user.rowVersion);
              },
            );

            await context.test(
              'five failures invalidate the flow; the correct code is then rejected',
              async () => {
                const flow = await service.register(registration(email('b')), peer);
                const code = await deliverLatest(flow.flowToken);
                for (let attempt = 0; attempt < 5; attempt += 1) {
                  await failsVerification(flow.flowToken, wrong(code));
                }
                const exhausted = await challengeFor(flow.flowToken);
                assert.equal(exhausted?.failedAttempts, 5);
                assert.ok(exhausted?.invalidatedAt);
                assert.ok(exhausted?.registrationIntent?.invalidatedAt);
                await failsVerification(flow.flowToken, code);
                assert.equal(
                  await tx.user.count({ where: { emailCanonical: `${run}-b@example.com` } }),
                  0,
                );
              },
            );

            await context.test('competing candidates cannot take an activated phone', async () => {
              const shared = phone();
              const first = await service.register(registration(email('c'), shared), peer);
              const second = await service.register(registration(email('d'), shared), peer);
              const firstCode = await deliverLatest(first.flowToken);
              const secondCode = await deliverLatest(second.flowToken);
              await service.verify(first.flowToken, firstCode, peer);
              await failsVerification(second.flowToken, secondCode);
              const loser = await challengeFor(second.flowToken);
              assert.ok(loser?.invalidatedAt);
              assert.equal(
                await tx.user.count({ where: { emailCanonical: `${run}-d@example.com` } }),
                0,
              );
            });

            await context.test('unknown or malformed flows fail generically', async () => {
              await failsVerification(generateCapability(), '123456');
              await failsVerification('not-a-token', '123456');
              await service.resend(generateCapability(), peer);
              await service.resend('not-a-token', peer);
            });

            await context.test(
              'supersession and transport failures never re-send stale codes',
              async () => {
                const address = email('e');
                const first = await service.register(registration(address), peer);
                const pending = (await challengeFor(first.flowToken))!.deliveries[0]!;
                await expireCooldown(address);
                await service.register(registration(address), peer);
                const stale = await tx.authDelivery.findUnique({ where: { id: pending.id } });
                assert.equal(stale?.state, 'INVALIDATED');
                assert.equal(stale?.encryptedPayload, null);
                assert.equal(await processor.deliver(pending.id), 'SKIPPED');

                const other = await service.register(registration(email('f')), peer);
                const delivery = (await challengeFor(other.flowToken))!.deliveries[0]!;
                failTransport = true;
                assert.equal(await processor.deliver(delivery.id), 'RETRY_SCHEDULED');
                failTransport = false;
                const retry = await tx.authDelivery.findUnique({ where: { id: delivery.id } });
                assert.equal(retry?.state, 'PENDING');
                assert.equal(retry?.attempts, 1);
                assert.equal(retry?.leaseToken, null);
                assert.equal(retry?.safeErrorCode, null);
                assert.ok(retry && retry.nextAttemptAt > retry.createdAt);
                assert.equal(
                  await processor.deliver(delivery.id),
                  'SKIPPED',
                  'retry waits for backoff',
                );
              },
            );

            await context.test(
              'IP issuance budget is public and independent of account existence',
              async () => {
                const limited = new RegistrationService(
                  parseApiEnvironment({ ...base, AUTH_OTP_IP_ISSUE_LIMIT: '2' }),
                  runner,
                  { hashForSetting: () => Promise.resolve(fixtureHash) },
                  throttle,
                );
                const limitedPeer = `${run}-limited-peer`;
                await limited.resend(generateCapability(), limitedPeer);
                await limited.resend(generateCapability(), limitedPeer);
                await assert.rejects(
                  limited.resend(generateCapability(), limitedPeer),
                  (error: unknown) =>
                    error instanceof RateLimitedError && error.retryAfterSeconds === 3600,
                );
                const before = hashes;
                await assert.rejects(
                  limited.register(registration(email('g')), limitedPeer),
                  RateLimitedError,
                );
                assert.equal(hashes, before, 'no password work after an IP refusal');
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 60_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { emailCanonical: { in: emails } } }), 0);
      assert.equal(
        await database.registrationIntent.count({ where: { emailCanonical: { in: emails } } }),
        0,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

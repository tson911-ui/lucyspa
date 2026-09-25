import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import {
  AuthCleanup,
  AuthDeliveryProcessor,
  AuthEmailDispatcher,
  AuthEmailSendError,
  FakeAuthEmailTransport,
  parseApiEnvironment,
  type AuthEmailMessage,
  type AuthEmailTransport,
  type RenderedAuthEmail,
} from '@lucy-spa/server';
import { AuthThrottleService } from './auth-throttle.service.js';
import { capabilityDigest, throttleDigest } from './crypto.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL. No real email
// provider is contacted; every send goes to an in-memory transport.
test(
  'auth email dispatch and bounded cleanup with actual Step 2 constraints; all fixtures roll back',
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
    const passwords = new PasswordService();
    const run = randomUUID().replaceAll('-', '').slice(0, 10);
    const userIds: string[] = [];
    const rollback = new Error('Intentional email dispatch integration rollback');
    try {
      await database.$connect();
      const hash = await passwords.hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
            };
            const throttle = new AuthThrottleService(environment);
            const resets = new PasswordResetService(environment, runner, passwords, throttle);
            const transport = new FakeAuthEmailTransport();
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            const dispatcher = new AuthEmailDispatcher(tx, processor);
            const customer = async (label: string, locale: 'vi' | 'en') => {
              const id = randomUUID();
              userIds.push(id);
              const delivery = `Mail.${label}-${run}@example.com`;
              await tx.user.create({
                data: {
                  id,
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: 'Nguyễn Thị Linh',
                  preferredLocale: locale,
                  emailCanonical: delivery.toLowerCase(),
                  emailDelivery: delivery,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+84919${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-02-28'), address: '12 Lê Lợi' },
                  },
                },
                select: { id: true },
              });
              return { id, delivery, canonical: delivery.toLowerCase() };
            };
            const deliveryOf = async (flowToken: string) => {
              const challenge = await tx.authChallenge.findUniqueOrThrow({
                where: { flowTokenHash: new Uint8Array(capabilityDigest(flowToken)!) },
                include: { deliveries: { orderBy: { generation: 'desc' } } },
              });
              return { challenge, delivery: challenge.deliveries[0]! };
            };
            const reset = async (label: string, locale: 'vi' | 'en' = 'vi') => {
              const user = await customer(label, locale);
              const flow = await resets.request(user.canonical, locale, `${run}-peer`);
              return { user, flow, ...(await deliveryOf(flow.flowToken)) };
            };
            // Keep the dispatcher's global poll scoped to this test's rows.
            const only = async (ids: string[]) => {
              await tx.authDelivery.updateMany({
                where: { state: 'PENDING', id: { notIn: ids } },
                data: { nextAttemptAt: new Date(Date.now() + 86_400_000) },
              });
            };
            const due = (id: string) =>
              tx.authDelivery.update({
                where: { id },
                data: { nextAttemptAt: new Date(Date.now() - 1_000) },
                select: { id: true },
              });

            await context.test(
              'dispatch sends once, erases ciphertext, publishes outbox',
              async () => {
                const { user, delivery, challenge } = await reset('ok');
                await only([delivery.id]);
                const summary = await dispatcher.dispatchDue(10);
                assert.equal(summary.examined, 1);
                assert.equal(summary.outcomes.DELIVERED, 1);
                const [sent] = transport.sent;
                assert.equal(sent?.to, user.delivery, 'stored verified spelling');
                assert.equal(sent?.purpose, 'RESET_PASSWORD');
                assert.equal(sent?.locale, 'vi');
                assert.equal(sent?.subject, 'Lucy Spa – Mã đặt lại mật khẩu');
                assert.match(sent?.code ?? '', /^[0-9]{6}$/);
                assert.ok(sent?.text.includes(sent.code));
                assert.equal(sent?.idempotencyKey, delivery.id);
                assert.equal(sent?.expiresAt.getTime(), challenge.codeExpiresAt?.getTime());
                const stored = await tx.authDelivery.findUniqueOrThrow({
                  where: { id: delivery.id },
                });
                assert.equal(stored.state, 'DELIVERED');
                assert.equal(stored.encryptedPayload, null);
                assert.equal(stored.leaseToken, null);
                assert.equal(stored.providerMessageId, 'fake-1');
                const outbox = await tx.outboxEvent.findFirstOrThrow({
                  where: { aggregateId: delivery.id },
                });
                assert.ok(outbox.publishedAt);
                // Idempotent: a second pass finds nothing to send.
                assert.equal((await dispatcher.dispatchDue(10)).examined, 0);
                assert.equal(transport.sent.length, 1);
              },
            );

            await context.test(
              'transient failure retries the same code; permanent fails',
              async () => {
                const transient = await reset('retry', 'en');
                await only([transient.delivery.id]);
                transport.failNext(new AuthEmailSendError('PROVIDER_DEFERRED', false));
                assert.equal((await dispatcher.dispatchDue(10)).outcomes.RETRY_SCHEDULED, 1);
                const waiting = await tx.authDelivery.findUniqueOrThrow({
                  where: { id: transient.delivery.id },
                });
                assert.equal(waiting.state, 'PENDING');
                assert.equal(waiting.attempts, 1);
                assert.equal(waiting.safeErrorCode, null, 'no code until final');
                assert.ok(waiting.encryptedPayload, 'ciphertext kept for the retry');
                assert.ok(waiting.nextAttemptAt > new Date(Date.now() + 10_000), 'backoff');
                assert.equal(waiting.leaseToken, null);
                assert.equal((await dispatcher.dispatchDue(10)).examined, 0, 'not yet due');
                await due(transient.delivery.id);
                const before = transport.sent.length;
                assert.equal((await dispatcher.dispatchDue(10)).outcomes.DELIVERED, 1);
                const retried = transport.sent[before]!;
                assert.equal(retried.idempotencyKey, transient.delivery.id, 'same delivery');
                assert.equal(retried.subject, 'Lucy Spa – Your password reset code');

                const permanent = await reset('reject');
                await only([permanent.delivery.id]);
                transport.failNext(new AuthEmailSendError('PROVIDER_REJECTED', true));
                assert.equal((await dispatcher.dispatchDue(10)).outcomes.FAILED, 1);
                const failed = await tx.authDelivery.findUniqueOrThrow({
                  where: { id: permanent.delivery.id },
                });
                assert.equal(failed.state, 'FAILED');
                assert.equal(failed.safeErrorCode, 'PROVIDER_REJECTED');
                assert.equal(failed.encryptedPayload, null, 'ciphertext erased');

                // An arbitrary error that echoes the code is stored only as a safe code.
                const leaky = await reset('leaky');
                await only([leaky.delivery.id]);
                let seen = '';
                const echo: AuthEmailTransport = {
                  send: (message) => {
                    seen = message.code;
                    return Promise.reject(new Error(`rejected ${message.to} ${message.code}`));
                  },
                };
                const leakyDispatcher = new AuthEmailDispatcher(
                  tx,
                  new AuthDeliveryProcessor(runner, environment.auth, echo),
                );
                const summary = await leakyDispatcher.dispatchDue(10);
                assert.equal(summary.outcomes.RETRY_SCHEDULED, 1);
                assert.equal(JSON.stringify(summary).includes(seen), false);
                // Exhaust retries: the final state records only the safe classification.
                for (let attempt = 0; attempt < 10; attempt += 1) {
                  const current = await tx.authDelivery.findUniqueOrThrow({
                    where: { id: leaky.delivery.id },
                  });
                  if (current.state !== 'PENDING') break;
                  await due(leaky.delivery.id);
                  await leakyDispatcher.dispatchDue(10);
                }
                const row = await tx.authDelivery.findUniqueOrThrow({
                  where: { id: leaky.delivery.id },
                });
                assert.equal(row.state, 'FAILED');
                assert.equal(row.safeErrorCode, 'RETRIES_EXHAUSTED');
                assert.equal(row.encryptedPayload, null);
                assert.equal(JSON.stringify(row).includes(seen), false);
              },
            );

            await context.test('a leased delivery is never sent twice', async () => {
              const { delivery } = await reset('lease');
              await only([delivery.id]);
              const inner: string[] = [];
              // A second worker arriving while the first is mid-send sees the lease.
              const reentrant: AuthEmailTransport = {
                send: async (message: AuthEmailMessage & RenderedAuthEmail) => {
                  inner.push(await secondWorker.deliver(message.deliveryId));
                  return { providerMessageId: 'first' };
                },
              };
              const secondWorker = new AuthDeliveryProcessor(
                runner,
                environment.auth,
                new FakeAuthEmailTransport(),
              );
              const first = new AuthDeliveryProcessor(runner, environment.auth, reentrant);
              assert.equal(await first.deliver(delivery.id), 'DELIVERED');
              assert.deepEqual(inner, ['SKIPPED']);
              assert.equal(await secondWorker.deliver(delivery.id), 'SKIPPED', 'terminal');
            });

            await context.test('superseded codes are invalidated without sending', async () => {
              const older = await reset('super');
              // A resend-equivalent: a newer request supersedes the older flow.
              await tx.authThrottleBucket.deleteMany({
                where: {
                  operationBucket: 'OTP_ISSUE_EMAIL_COOLDOWN',
                  pseudonymousKey: new Uint8Array(
                    throttleDigest(
                      'OTP_ISSUE_EMAIL_COOLDOWN',
                      older.user.canonical,
                      environment.auth.throttleKeys.get(1)!,
                    ),
                  ),
                },
              });
              await resets.request(older.user.canonical, 'vi', `${run}-peer`);
              const stale = await tx.authDelivery.findUniqueOrThrow({
                where: { id: older.delivery.id },
              });
              assert.equal(stale.state, 'INVALIDATED', 'supersession erased it already');
              const before = transport.sent.length;
              assert.equal(await processor.deliver(older.delivery.id), 'SKIPPED');
              assert.equal(transport.sent.length, before);
            });

            await context.test('cleanup is bounded, idempotent and spares live state', async () => {
              const cleanup = new AuthCleanup(runner);
              // One clock reading, so related timestamps keep their exact order.
              const reference = Date.now();
              const past = (ms: number) => new Date(reference - ms);
              // A live flow and its pending delivery must survive.
              const live = await reset('live');
              // A consumed (terminal) flow and a flow-expired one, inserted directly.
              const owner = await customer('expired', 'en');
              const expiredChallenge = await tx.authChallenge.create({
                data: {
                  purpose: 'RESET_PASSWORD',
                  flowTokenHash: new Uint8Array(randomBytes(32)),
                  identityKey: new Uint8Array(randomBytes(32)),
                  identityKeyVersion: 1,
                  userId: owner.id,
                  verifierDigest: new Uint8Array(randomBytes(32)),
                  keyVersion: 1,
                  credentialVersion: 1,
                  authzVersion: 1,
                  deliveryEmailSnapshot: owner.delivery,
                  maxAttempts: 5,
                  createdAt: past(7_200_000),
                  flowExpiresAt: past(3_600_000),
                  codeGeneratedAt: past(7_200_000),
                  codeExpiresAt: past(6_900_000),
                },
                select: { id: true },
              });
              const expiredDelivery = await tx.authDelivery.create({
                data: {
                  challengeId: expiredChallenge.id,
                  generation: 1,
                  state: 'PENDING',
                  encryptedPayload: new Uint8Array(randomBytes(40)),
                  nonce: new Uint8Array(randomBytes(12)),
                  tag: new Uint8Array(randomBytes(16)),
                  keyVersion: 1,
                  createdAt: past(7_200_000),
                  expiresAt: past(6_900_000),
                  nextAttemptAt: past(7_200_000),
                },
                select: { id: true },
              });
              const consumed = await reset('consumed');
              await tx.authChallenge.update({
                where: { id: consumed.challenge.id },
                data: { invalidatedAt: new Date() },
                select: { id: true },
              });
              // Registration intents: one expired (no challenge), one live.
              const intent = (expiresAt: Date, label: string) =>
                tx.registrationIntent.create({
                  data: {
                    emailCanonical: `intent-${label}-${run}@example.com`,
                    emailDelivery: `intent-${label}-${run}@example.com`,
                    phoneCanonical: '+84912345678',
                    normalizationVersion: 1,
                    passwordHash: hash,
                    fullName: 'Ứng viên',
                    dateOfBirth: new Date('1995-01-01'),
                    address: '1 Lê Lợi',
                    preferredLocale: 'vi',
                    createdAt: past(7_200_000),
                    expiresAt,
                  },
                  select: { id: true },
                });
              const staleIntent = await intent(past(3_600_000), 'stale');
              const liveIntent = await intent(new Date(Date.now() + 1_800_000), 'live');
              // Sessions: expired anonymous (removed), live anonymous and an expired
              // authenticated one (both kept: only anonymous sessions are eligible).
              const session = (kind: 'ANONYMOUS' | 'AUTHENTICATED', expired: boolean) =>
                tx.session.create({
                  data: {
                    tokenHash: new Uint8Array(randomBytes(32)),
                    kind,
                    userId: kind === 'AUTHENTICATED' ? owner.id : null,
                    credentialVersion: kind === 'AUTHENTICATED' ? 1 : null,
                    authzVersion: kind === 'AUTHENTICATED' ? 1 : null,
                    csrfKeyVersion: 1,
                    createdAt: past(7_200_000),
                    lastActivityAt: past(7_200_000),
                    absoluteExpiresAt: expired ? past(3_600_000) : new Date(Date.now() + 600_000),
                  },
                  select: { id: true },
                });
              const staleAnonymous = await session('ANONYMOUS', true);
              const liveAnonymous = await session('ANONYMOUS', false);
              const staleAuthenticated = await session('AUTHENTICATED', true);
              const auditBefore = await tx.auditEvent.count();
              const usersBefore = await tx.user.count();

              // Bounded: one row per table per run at most.
              const first = await cleanup.run({ batchSize: 1, maxBatches: 1 });
              for (const count of [
                first.expiredDeliveries,
                first.deletedChallenges,
                first.deletedIntents,
                first.deletedAnonymousSessions,
              ]) {
                assert.ok(count <= 1);
              }
              // Repeat until converged; the final run changes nothing.
              let last = first;
              for (let index = 0; index < 10_000; index += 1) {
                last = await cleanup.run({ batchSize: 200, maxBatches: 5 });
                if (Object.values(last).every((count) => count === 0)) break;
              }
              assert.deepEqual(last, {
                expiredDeliveries: 0,
                deletedChallenges: 0,
                deletedDeliveries: 0,
                deletedIntents: 0,
                deletedAnonymousSessions: 0,
              });
              const exists = {
                challenge: (id: string) => tx.authChallenge.count({ where: { id } }),
                delivery: (id: string) => tx.authDelivery.count({ where: { id } }),
                intent: (id: string) => tx.registrationIntent.count({ where: { id } }),
                session: (id: string) => tx.session.count({ where: { id } }),
              };
              assert.equal(await exists.challenge(expiredChallenge.id), 0);
              assert.equal(await exists.delivery(expiredDelivery.id), 0);
              assert.equal(await exists.challenge(consumed.challenge.id), 0);
              assert.equal(await exists.intent(staleIntent.id), 0);
              assert.equal(await exists.session(staleAnonymous.id), 0);
              // Live and non-eligible state survives.
              assert.equal(await exists.challenge(live.challenge.id), 1);
              assert.equal(
                (await tx.authDelivery.findUniqueOrThrow({ where: { id: live.delivery.id } }))
                  .state,
                'PENDING',
              );
              assert.equal(await exists.intent(liveIntent.id), 1);
              assert.equal(await exists.session(liveAnonymous.id), 1);
              assert.equal(await exists.session(staleAuthenticated.id), 1);
              assert.equal(await tx.auditEvent.count(), auditBefore, 'audit untouched');
              assert.equal(await tx.user.count(), usersBefore, 'users untouched');
              // The outbox history of deleted deliveries is retained.
              assert.equal(
                await tx.outboxEvent.count({ where: { aggregateId: consumed.delivery.id } }),
                1,
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
    } finally {
      await database.$disconnect();
    }
  },
);

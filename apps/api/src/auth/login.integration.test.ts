import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import * as argon2 from 'argon2';
import type { PrismaService } from '../platform/prisma.service.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { throttleDigest } from './crypto.js';
import { LOGIN_POLICY, LoginService } from './login.service.js';
import { PasswordService } from './password.service.js';
import { RateLimitedError } from './registration.service.js';
import { SessionService } from './session.service.js';

const PASSWORD = 'a calm lotus evening 2026';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'customer login/logout with actual Step 2 constraints; all fixtures roll back',
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
    const realPasswords = new PasswordService();
    const run = `login-it-${randomUUID()}`;
    const userIds: string[] = [];
    const rollback = new Error('Intentional login integration rollback');
    try {
      await database.$connect();
      const strongHash = await realPasswords.hashForSetting(PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let verifications = 0;
            const passwords: Pick<
              PasswordService,
              'hashForSetting' | 'verify' | 'verifyAndRehash'
            > = {
              hashForSetting: (input) => realPasswords.hashForSetting(input),
              verify: (input, hash) => {
                verifications += 1;
                return realPasswords.verify(input, hash);
              },
              verifyAndRehash: (input, snapshot, db) => {
                verifications += 1;
                return realPasswords.verifyAndRehash(input, snapshot, db);
              },
            };
            const service = new LoginService(
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
              new AuthThrottleService(environment),
            );
            await service.onModuleInit();
            const anonymous = async () => (await sessions.createAnonymous(tx)).token;
            const customer = async (label: string, passwordHash = strongHash) => {
              const id = randomUUID();
              userIds.push(id);
              const email = `${run}-${label}@example.com`;
              await tx.user.create({
                data: {
                  id,
                  kind: 'CUSTOMER',
                  status: 'ACTIVE',
                  fullName: 'Nguyễn Thị Linh',
                  preferredLocale: 'vi',
                  emailCanonical: email,
                  emailDelivery: email,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: `+84912${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash,
                  customerProfile: {
                    create: { dateOfBirth: new Date('1990-02-28'), address: '12 Lê Lợi' },
                  },
                },
                select: { id: true },
              });
              return { id, email };
            };
            const failsWith = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const failures = async (operation: string, identifier: string) => {
              const buckets = await tx.authThrottleBucket.findMany({
                where: {
                  operationBucket: operation,
                  pseudonymousKey: new Uint8Array(
                    throttleDigest(operation, identifier, environment.auth.throttleKeys.get(1)!),
                  ),
                },
              });
              return buckets.reduce((sum, bucket) => sum + bucket.count, 0);
            };

            await context.test(
              'login rotates the pre-auth session; logout revokes it',
              async () => {
                const linh = await customer('a');
                const peer = `${run}-peer-a`;
                const before = verifications;
                await failsWith(
                  service.login(`${run}-unknown@example.com`, PASSWORD, await anonymous(), peer),
                  'AUTHENTICATION_FAILED',
                );
                await failsWith(
                  service.login('not an email', PASSWORD, await anonymous(), peer),
                  'AUTHENTICATION_FAILED',
                );
                await failsWith(
                  service.login(linh.email, `${PASSWORD}!`, await anonymous(), peer),
                  'AUTHENTICATION_FAILED',
                );
                assert.equal(verifications - before, 3, 'one real or dummy verification each');
                assert.equal(await failures('LOGIN_FAILURE_IP', peer), 3);
                assert.equal(await failures('LOGIN_FAILURE_CUSTOMER_EMAIL', linh.email), 1);
                const bucketDump = JSON.stringify(await tx.authThrottleBucket.findMany());
                assert.equal(bucketDump.includes(linh.email), false);

                const preAuth = await anonymous();
                const requestId = randomUUID();
                // Canonical comparison: the delivery spelling's case is not a separate identity.
                const result = await service.login(
                  linh.email.toUpperCase(),
                  PASSWORD,
                  preAuth,
                  peer,
                  requestId,
                );
                assert.deepEqual(result.account, {
                  id: linh.id,
                  kind: 'CUSTOMER',
                  displayName: 'Nguyễn Thị Linh',
                  locale: 'vi',
                  authorization: { version: 1, grants: [], denies: [] },
                });
                assert.notEqual(result.token, preAuth);
                assert.equal(await sessions.resolve(preAuth, tx), null, 'no overlap window');
                const session = await sessions.resolve(result.token, tx);
                assert.equal(session?.kind, 'AUTHENTICATED');
                assert.equal(session?.userId, linh.id);
                const stored = await tx.session.findUnique({ where: { id: session!.id } });
                assert.equal(
                  stored?.absoluteExpiresAt.getTime(),
                  stored!.createdAt.getTime() + environment.auth.absoluteTtlSeconds * 1_000,
                );
                const created = await tx.auditEvent.findMany({
                  where: { subjectUserId: linh.id, action: 'SESSION_CREATED' },
                });
                assert.equal(created.length, 1);
                assert.equal(created[0]?.requestId, requestId);
                assert.equal(JSON.stringify(created).includes(result.token), false);

                // A revoked pre-auth session cannot be replayed into a second login.
                await failsWith(
                  service.login(linh.email, PASSWORD, preAuth, peer),
                  'AUTHENTICATION_FAILED',
                );

                assert.equal(await sessions.revoke(result.token, randomUUID(), tx), true);
                assert.equal(await sessions.resolve(result.token, tx), null);
                assert.equal(
                  await tx.auditEvent.count({
                    where: { subjectUserId: linh.id, action: 'SESSIONS_REVOKED' },
                  }),
                  1,
                );
              },
            );

            await context.test(
              'an outdated hash is rehashed and the new session uses it',
              async () => {
                const weak = await argon2.hash(PASSWORD, {
                  type: argon2.argon2id,
                  memoryCost: 19_456,
                  timeCost: 2,
                  parallelism: 1,
                });
                const legacy = await customer('b', weak);
                const result = await service.login(
                  legacy.email,
                  PASSWORD,
                  await anonymous(),
                  `${run}-peer-b`,
                );
                const user = await tx.user.findUnique({ where: { id: legacy.id } });
                assert.notEqual(user?.passwordHash, weak);
                assert.match(user?.passwordHash ?? '', /^\$argon2id\$v=19\$m=65536,p=1,t=3\$/);
                assert.equal(user?.credentialVersion, 1, 'a cost-only rehash keeps the version');
                assert.equal((await sessions.resolve(result.token, tx))?.userId, legacy.id);
              },
            );

            await context.test(
              'identifier failure budget blocks further password work',
              async () => {
                const target = await customer('c');
                for (let attempt = 0; attempt < LOGIN_POLICY.identifierFailureLimit; attempt += 1) {
                  await failsWith(
                    service.login(
                      target.email,
                      `wrong ${PASSWORD}`,
                      await anonymous(),
                      `${run}-peer-c${attempt}`,
                    ),
                    'AUTHENTICATION_FAILED',
                  );
                }
                const before = verifications;
                const token = await anonymous();
                await assert.rejects(
                  service.login(target.email, PASSWORD, token, `${run}-peer-fresh`),
                  (error: unknown) =>
                    error instanceof RateLimitedError && error.retryAfterSeconds === 900,
                );
                // The same limit applies to unknown identifiers, so it is not an existence oracle.
                for (let attempt = 0; attempt < LOGIN_POLICY.identifierFailureLimit; attempt += 1) {
                  await failsWith(
                    service.login(
                      `${run}-ghost@example.com`,
                      PASSWORD,
                      await anonymous(),
                      `${run}-peer-g${attempt}`,
                    ),
                    'AUTHENTICATION_FAILED',
                  );
                }
                await assert.rejects(
                  service.login(`${run}-ghost@example.com`, PASSWORD, token, `${run}-peer-fresh`),
                  RateLimitedError,
                );
                assert.equal(verifications - before, LOGIN_POLICY.identifierFailureLimit);
                assert.equal((await sessions.resolve(token, tx))?.kind, 'ANONYMOUS');
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
      assert.equal(await database.session.count({ where: { userId: { in: userIds } } }), 0);
      assert.equal(
        await database.auditEvent.count({ where: { subjectUserId: { in: userIds } } }),
        0,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { Server } from 'node:http';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { configureHttp } from '../platform/configure-http.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { API_ENVIRONMENT } from '../platform/tokens.js';
import { AuthContextController } from './auth-context.controller.js';
import {
  AUTH_GRAPH_LOCK_KEY,
  AUTH_GRAPH_LOCK_NAMESPACE,
  assertAuthTransaction,
  takeSharedAuthGraphLock,
} from './auth-store.js';
import { AuthError } from './auth.error.js';
import { ContextThrottleService } from './context-throttle.service.js';
import { capabilityDigest, throttleDigest } from './crypto.js';
import { SessionService, type CredentialEvidence } from './session.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'session runtime with actual Step 2 constraints; all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_CSRF_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    });
    const database = createDatabaseClient(databaseUrl);
    const service = new SessionService({ client: database } as PrismaService, environment);
    const userId = randomUUID();
    const sessionIds: string[] = [];
    const rollback = new Error('Intentional session integration rollback');
    const fixtureHash =
      '$argon2id$v=19$m=19456,t=2,p=1$YWFhYWFhYWFhYWFhYWFhYQ$YWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWE';
    const evidence: CredentialEvidence = {
      userId,
      passwordHash: fixtureHash,
      credentialVersion: 1,
      authzVersion: 1,
    };
    try {
      await database.$connect();
      assert.throws(() => assertAuthTransaction(database), /require an active Prisma transaction/);
      await assert.rejects(
        database.$transaction(
          async (transaction) => {
            await takeSharedAuthGraphLock(transaction);
            await context.test(
              'concurrent security-graph writer cannot overlap authentication readers',
              async () => {
                const probeRollback = new Error('Intentional lock probe rollback');
                await assert.rejects(
                  database.$transaction(async (probe) => {
                    const writers = await probe.$queryRaw<{ acquired: boolean }[]>`
                SELECT pg_try_advisory_xact_lock(${AUTH_GRAPH_LOCK_NAMESPACE}::integer, ${AUTH_GRAPH_LOCK_KEY}::integer) AS acquired
              `;
                    assert.equal(writers[0]?.acquired, false);
                    const readers = await probe.$queryRaw<{ acquired: boolean }[]>`
                SELECT pg_try_advisory_xact_lock_shared(${AUTH_GRAPH_LOCK_NAMESPACE}::integer, ${AUTH_GRAPH_LOCK_KEY}::integer) AS acquired
              `;
                    assert.equal(readers[0]?.acquired, true);
                    throw probeRollback;
                  }),
                  (error: unknown) => error === probeRollback,
                );
              },
            );
            await context.test(
              'real HTTP context, session storage and admission share the rollback transaction',
              async () => {
                const boundSessions: Pick<
                  SessionService,
                  'resolve' | 'createAnonymous' | 'withTransaction'
                > = {
                  resolve: (token) => service.resolve(token, transaction),
                  createAnonymous: () => service.createAnonymous(transaction),
                  withTransaction: (work) => work(transaction),
                };
                const module = await Test.createTestingModule({
                  controllers: [AuthContextController],
                  providers: [
                    { provide: API_ENVIRONMENT, useValue: environment },
                    { provide: SessionService, useValue: boundSessions },
                    ContextThrottleService,
                  ],
                }).compile();
                const app = module.createNestApplication({ logger: false });
                configureHttp(app, environment, pino({ level: 'silent' }));
                await app.init();
                try {
                  const server = app.getHttpServer() as Server;
                  const first = await request(server)
                    .get('/api/v1/auth/context')
                    .set('Origin', environment.webOrigin)
                    .expect(200);
                  assert.deepEqual(Object.keys(first.body as object).sort(), [
                    'authenticated',
                    'csrfToken',
                  ]);
                  assert.equal((first.body as { authenticated: boolean }).authenticated, false);
                  assert.equal(first.headers['cache-control'], 'no-store');
                  const cookieHeaders = first.headers['set-cookie'] as string[] | undefined;
                  assert.ok(cookieHeaders?.[0]);
                  assert.match(
                    cookieHeaders[0],
                    /^lucy_session_dev=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax$/,
                  );
                  const cookie = cookieHeaders[0].split(';')[0];
                  assert.ok(cookie);
                  const token = cookie.slice(cookie.indexOf('=') + 1);
                  const digest = capabilityDigest(token);
                  assert.ok(digest);
                  const persisted = await transaction.session.findUniqueOrThrow({
                    where: { tokenHash: new Uint8Array(digest) },
                  });
                  sessionIds.push(persisted.id);
                  assert.equal(persisted.kind, 'ANONYMOUS');
                  const second = await request(server)
                    .get('/api/v1/auth/context')
                    .set('Cookie', cookie)
                    .expect(200);
                  assert.deepEqual(second.body, first.body);
                  assert.equal(second.headers['set-cookie'], undefined);
                  const unchanged = await transaction.session.findUniqueOrThrow({
                    where: { id: persisted.id },
                  });
                  assert.equal(
                    unchanged.lastActivityAt.getTime(),
                    persisted.lastActivityAt.getTime(),
                  );
                } finally {
                  await app.close();
                }
              },
            );
            await transaction.user.create({
              data: {
                id: userId,
                kind: 'EMPLOYEE',
                status: 'ACTIVE',
                fullName: 'Session rollback fixture',
                preferredLocale: 'vi',
                normalizationVersion: 1,
                phoneCanonical: `+849${randomBytes(4).readUInt32BE().toString().padStart(10, '0')}`,
                passwordHash: fixtureHash,
                employeeProfile: {
                  create: {
                    employeeCodeCanonical: `SESSION_${userId.replaceAll('-', '').toUpperCase()}`,
                    dateOfBirth: new Date('1990-01-01'),
                    address: 'Session rollback fixture',
                  },
                },
              },
            });
            const anonymous = await service.createAnonymous(transaction);
            sessionIds.push(anonymous.session.id);
            await context.test(
              'anonymous stores only a digest and no audit; context reads do not touch',
              async () => {
                const stored = await transaction.session.findUniqueOrThrow({
                  where: { id: anonymous.session.id },
                });
                assert.equal(anonymous.token.length, 43);
                assert.deepEqual(Buffer.from(stored.tokenHash), capabilityDigest(anonymous.token));
                assert.equal(stored.userId, null);
                assert.equal(
                  stored.absoluteExpiresAt.getTime() - stored.createdAt.getTime(),
                  900_000,
                );
                assert.equal(
                  await transaction.auditEvent.count({ where: { entityId: stored.id } }),
                  0,
                );
                await service.resolve(anonymous.token, transaction);
                const reread = await transaction.session.findUniqueOrThrow({
                  where: { id: stored.id },
                });
                assert.equal(reread.lastActivityAt.getTime(), stored.lastActivityAt.getTime());
              },
            );
            await context.test(
              'stale checked password and versions cannot issue a session',
              async () => {
                for (const stale of [
                  { ...evidence, passwordHash: `${fixtureHash}changed` },
                  { ...evidence, credentialVersion: 2 },
                  { ...evidence, authzVersion: 2 },
                ]) {
                  await assert.rejects(
                    service.rotateAuthenticated(
                      anonymous.token,
                      stale,
                      { reauthenticated: false },
                      transaction,
                    ),
                  );
                }
                assert.ok(await service.resolve(anonymous.token, transaction));
              },
            );
            const authenticated = await service.rotateAuthenticated(
              anonymous.token,
              evidence,
              { reauthenticated: false },
              transaction,
            );
            sessionIds.push(authenticated.session.id);
            await context.test(
              'anonymous promotion rotates identity and revokes old capability atomically with audit',
              async () => {
                assert.notEqual(authenticated.token, anonymous.token);
                assert.equal(await service.resolve(anonymous.token, transaction), null);
                assert.equal(
                  (await service.resolve(authenticated.token, transaction))?.userId,
                  userId,
                );
                assert.equal(
                  await transaction.auditEvent.count({
                    where: { entityId: authenticated.session.id, action: 'SESSION_CREATED' },
                  }),
                  1,
                );
                const events = await transaction.auditEvent.findMany({
                  where: { subjectUserId: userId },
                });
                const serialized = JSON.stringify(events);
                assert.ok(!serialized.includes(authenticated.token));
                assert.ok(!serialized.includes(fixtureHash));
                assert.ok(!serialized.includes('tokenHash'));
              },
            );
            const rotated = await service.rotateAuthenticated(
              authenticated.token,
              evidence,
              { reauthenticated: true },
              transaction,
            );
            sessionIds.push(rotated.session.id);
            await context.test(
              'reauthentication revokes old token with no overlap and preserves absolute lifetime',
              async () => {
                assert.equal(await service.resolve(authenticated.token, transaction), null);
                assert.ok(await service.resolve(rotated.token, transaction));
                assert.ok(rotated.session.reauthenticatedAt);
                assert.equal(
                  rotated.session.absoluteExpiresAt.getTime(),
                  authenticated.session.absoluteExpiresAt.getTime(),
                );
                assert.equal(
                  await transaction.auditEvent.count({
                    where: { entityId: rotated.session.id, action: 'SESSION_REAUTHENTICATED' },
                  }),
                  1,
                );
                const sessionCount = await transaction.session.count({ where: { userId } });
                await assert.rejects(
                  service.rotateAuthenticated(
                    authenticated.token,
                    evidence,
                    { reauthenticated: true },
                    transaction,
                  ),
                  (error: unknown) =>
                    error instanceof AuthError && error.code === 'AUTHENTICATION_REQUIRED',
                );
                assert.equal(await transaction.session.count({ where: { userId } }), sessionCount);
              },
            );
            await context.test(
              'audit error rolls back rotation when composed in its mutation transaction',
              async () => {
                await transaction.$executeRaw`SAVEPOINT audit_failure`;
                const countBefore = await transaction.session.count({ where: { userId } });
                const failingAudit = new Proxy(transaction, {
                  get(target, property, receiver) {
                    if (property === 'auditEvent') {
                      return {
                        create: () => Promise.reject(new Error('Audit storage unavailable')),
                      };
                    }
                    return Reflect.get(target, property, receiver);
                  },
                }) as Prisma.TransactionClient;
                await assert.rejects(
                  service.rotateAuthenticated(
                    rotated.token,
                    evidence,
                    { reauthenticated: true },
                    failingAudit,
                  ),
                  /Audit storage unavailable/,
                );
                await transaction.$executeRaw`ROLLBACK TO SAVEPOINT audit_failure`;
                await transaction.$executeRaw`RELEASE SAVEPOINT audit_failure`;
                assert.equal(await transaction.session.count({ where: { userId } }), countBefore);
                assert.ok(await service.resolve(rotated.token, transaction));
              },
            );
            await context.test(
              'foreground touch only updates valid authenticated sessions; revocation is final',
              async () => {
                assert.equal(await service.touch(anonymous.token, transaction), false);
                assert.equal(await service.touch(rotated.token, transaction), true);
                assert.equal(await service.revoke(rotated.token, undefined, transaction), true);
                assert.equal(await service.resolve(rotated.token, transaction), null);
                assert.equal(await service.revoke(rotated.token, undefined, transaction), false);
                assert.equal(await service.touch(rotated.token, transaction), false);
                assert.equal(
                  await transaction.auditEvent.count({
                    where: { entityId: rotated.session.id, action: 'SESSIONS_REVOKED' },
                  }),
                  1,
                );
              },
            );
            await context.test(
              'current credential/authz changes invalidate session immediately without cached grants',
              async () => {
                const contextSession = await service.createAnonymous(transaction);
                sessionIds.push(contextSession.session.id);
                const session = await service.rotateAuthenticated(
                  contextSession.token,
                  evidence,
                  { reauthenticated: false },
                  transaction,
                );
                sessionIds.push(session.session.id);
                await transaction.user.update({
                  where: { id: userId },
                  data: { authzVersion: { increment: 1 } },
                });
                assert.equal(await service.resolve(session.token, transaction), null);
                assert.equal(await service.touch(session.token, transaction), false);
              },
            );
            await context.test(
              'anonymous creation budget is persisted and retained keys cannot reset it',
              async () => {
                const peer = `session-integration-${randomUUID()}`;
                const oldKey = randomBytes(32);
                const newKey = randomBytes(32);
                const oldThrottle = new ContextThrottleService({
                  ...environment,
                  auth: {
                    ...environment.auth,
                    contextLimit: 2,
                    contextWindowSeconds: 86_400,
                    throttleActiveVersion: 1,
                    throttleKeys: new Map([[1, oldKey]]),
                  },
                });
                await oldThrottle.consume(transaction, peer);
                await oldThrottle.consume(transaction, peer);
                const rotatedThrottle = new ContextThrottleService({
                  ...environment,
                  auth: {
                    ...environment.auth,
                    contextLimit: 2,
                    contextWindowSeconds: 86_400,
                    throttleActiveVersion: 2,
                    throttleKeys: new Map([
                      [1, oldKey],
                      [2, newKey],
                    ]),
                  },
                });
                const sessionCount = await transaction.session.count();
                await transaction.$executeRaw`SAVEPOINT exhausted_context_budget`;
                await assert.rejects(
                  async () => {
                    await rotatedThrottle.consume(transaction, peer);
                    await service.createAnonymous(transaction);
                  },
                  (error: unknown) => error instanceof AuthError && error.code === 'RATE_LIMITED',
                );
                await transaction.$executeRaw`ROLLBACK TO SAVEPOINT exhausted_context_budget`;
                await transaction.$executeRaw`RELEASE SAVEPOINT exhausted_context_budget`;
                assert.equal(await transaction.session.count(), sessionCount);
                const buckets = await transaction.authThrottleBucket.findMany({
                  where: {
                    pseudonymousKey: {
                      in: [
                        new Uint8Array(throttleDigest('ANONYMOUS_CONTEXT_IP', peer, oldKey)),
                        new Uint8Array(throttleDigest('ANONYMOUS_CONTEXT_IP', peer, newKey)),
                      ],
                    },
                  },
                });
                assert.equal(buckets.length, 1);
                assert.equal(buckets[0]?.count, 2);
                assert.ok(!JSON.stringify(buckets).includes(peer));
                const freshPeer = `session-integration-${randomUUID()}`;
                await rotatedThrottle.consume(transaction, freshPeer);
                const allowed = await service.createAnonymous(transaction);
                sessionIds.push(allowed.session.id);
                const bothVersions = await transaction.authThrottleBucket.findMany({
                  where: {
                    pseudonymousKey: {
                      in: [
                        new Uint8Array(throttleDigest('ANONYMOUS_CONTEXT_IP', freshPeer, oldKey)),
                        new Uint8Array(throttleDigest('ANONYMOUS_CONTEXT_IP', freshPeer, newKey)),
                      ],
                    },
                  },
                });
                assert.equal(bothVersions.length, 2);
                assert.ok(bothVersions.every((bucket) => bucket.count === 1));
              },
            );
            await transaction.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 30_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { id: userId } }), 0);
      assert.equal(await database.session.count({ where: { id: { in: sessionIds } } }), 0);
      assert.equal(await database.auditEvent.count({ where: { subjectUserId: userId } }), 0);
    } finally {
      await database.$disconnect();
    }
  },
);

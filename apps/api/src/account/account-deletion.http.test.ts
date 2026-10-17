import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { RateLimitedError } from '../auth/otp-flow.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { AccountDeletionService } from './account-deletion.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('account deletion HTTP (session 10 A2): session identity, password only, CSRF on the write, cookie cleared, stable codes', async () => {
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
    MEDIA_STORAGE_DIR: '/var/lib/lucy-spa/media',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'https://spa.example',
    AUTH_CSRF_KEYS: ring(),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: ring(),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  });
  const token = generateCapability();
  const now = new Date(Date.now() - 100);
  const record: SessionRecord = {
    id: randomUUID(),
    kind: 'AUTHENTICATED',
    userId: randomUUID(),
    credentialVersion: 1,
    authzVersion: 1,
    csrfKeyVersion: 1,
    createdAt: now,
    lastActivityAt: now,
    absoluteExpiresAt: new Date(Date.now() + 900_000),
    revokedAt: null,
    reauthenticatedAt: null,
    user: {
      kind: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: new Date(),
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  const calls: unknown[][] = [];
  let outcome: Error | null = null;
  const check = {
    canDelete: true,
    blockers: { combos: [], orders: [], atSpa: false, openReturns: 0 },
    losses: { points: null, upcomingBookings: [] },
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, pino({ level: 'silent' }))],
  })
    .overrideProvider(InfrastructureService)
    .useValue({})
    .overrideProvider(SessionService)
    .useValue({
      resolve: (supplied: string | undefined) =>
        Promise.resolve(
          supplied === token ? sessionPrincipal(record, new Date(), environment.auth) : null,
        ),
      withTransaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work({} as Prisma.TransactionClient),
    })
    .overrideProvider(PasswordService)
    .useValue({})
    .overrideProvider(AuthThrottleService)
    .useValue({})
    .overrideProvider(LoginService)
    .useValue({})
    .overrideProvider(AccountDeletionService)
    .useValue({
      check: (...args: unknown[]) => {
        calls.push(['check', ...args]);
        return outcome ? Promise.reject(outcome) : Promise.resolve(check);
      },
      delete: (...args: unknown[]) => {
        calls.push(['delete', ...args]);
        return outcome ? Promise.reject(outcome) : Promise.resolve();
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const server = app.getHttpServer() as Server;
  const cookie = `${environment.auth.cookieName}=${token}`;
  const headers = {
    Origin: environment.webOrigin,
    Cookie: cookie,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  const route = '/api/v1/me/account-deletion';
  try {
    // Read: the session token is all the service receives; the answer is never cached.
    const read = await request(server).get(route).set({ Cookie: cookie }).expect(200);
    assert.equal(read.headers['cache-control'], 'no-store');
    assert.deepEqual(read.body, check);
    assert.deepEqual(calls.at(-1), ['check', token]);

    // Delete: the password and the request id reach the service; the session cookie is cleared.
    const deleted = await request(server)
      .post(route)
      .set(headers)
      .send({ currentPassword: 'a calm lotus evening' })
      .expect(204);
    const call = calls.at(-1)!;
    assert.equal(call[0], 'delete');
    assert.equal(call[1], token);
    assert.equal(call[2], 'a calm lotus evening');
    assert.equal(typeof call[3], 'string', 'the peer address, for the reauthentication budget');
    const setCookie = String(deleted.headers['set-cookie'] ?? '');
    assert.match(setCookie, new RegExp(`${environment.auth.cookieName}=;`));
    assert.match(setCookie, /Expires=Thu, 01 Jan 1970|Max-Age=0/i);

    // No id, email or anything else is accepted; a missing or oversized password is refused before the service.
    const before = calls.length;
    for (const bad of [
      {},
      { currentPassword: 7 },
      { currentPassword: 'x'.repeat(1_025) },
      { currentPassword: 'pw', userId: randomUUID() },
      { currentPassword: 'pw', email: 'lan@example.com' },
    ]) {
      await request(server).post(route).set(headers).send(bad).expect(400);
    }
    // The write needs the session-bound CSRF token and the exact Origin (the global guard).
    await request(server)
      .post(route)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send({ currentPassword: 'pw' })
      .expect(403);
    await request(server)
      .post(route)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send({ currentPassword: 'pw' })
      .expect(403);
    assert.equal(calls.length, before, 'nothing reached the service');
    for (const method of ['put', 'patch', 'delete'] as const) {
      await request(server)[method](route).set(headers).send({}).expect(404);
    }

    // Domain outcomes reach the client as stable codes; a failed delete keeps the cookie.
    for (const [code, status] of [
      ['AUTHENTICATION_FAILED', 401],
      ['AUTHENTICATION_REQUIRED', 401],
      ['FORBIDDEN', 403],
      ['ACCOUNT_DELETION_BLOCKED', 409],
      ['SERVICE_UNAVAILABLE', 503],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .post(route)
        .set(headers)
        .send({ currentPassword: 'pw' })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.equal(failed.headers['set-cookie'], undefined);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|user_id|SQL/i);
    }
    // Too many wrong passwords: 429 with Retry-After.
    outcome = new RateLimitedError(900);
    const limited = await request(server)
      .post(route)
      .set(headers)
      .send({ currentPassword: 'pw' })
      .expect(429);
    assert.equal(limited.headers['retry-after'], '900');
  } finally {
    await app.close();
  }
});

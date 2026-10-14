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
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { CustomerProfileService } from './customer-profile.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('customer profile HTTP (session 7b): session identity, name only, CSRF on the write, stable codes', async () => {
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
  const answer =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return outcome ? Promise.reject(outcome) : Promise.resolve({ ok: name });
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
    .overrideProvider(CustomerProfileService)
    .useValue({ get: answer('get'), update: answer('update') })
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
  try {
    // Read: the session token is all the service receives; the answer is never cached.
    const read = await request(server)
      .get('/api/v1/me/profile')
      .set({ Cookie: cookie })
      .expect(200);
    assert.equal(read.headers['cache-control'], 'no-store');
    assert.deepEqual(calls.at(-1), ['get', token]);

    // Write: the name and the version it was read at, nothing else; the request id is passed for the audit trail.
    await request(server)
      .post('/api/v1/me/profile')
      .set(headers)
      .send({ expectedVersion: 3, fullName: 'Hoàng Thị Lan' })
      .expect(200);
    const written = calls.at(-1)!;
    assert.deepEqual(
      [written[0], written[1], JSON.parse(JSON.stringify(written[2]))],
      ['update', token, { expectedVersion: 3, fullName: 'Hoàng Thị Lan' }],
    );

    // The phone (customer key), birthday (birthday gift), email (verified flow) and any id are rejected, never passed on.
    const before = calls.length;
    for (const extra of [
      { phone: '0901234567' },
      { dateOfBirth: '1990-01-31' },
      { email: 'new@example.com' },
      { emailDelivery: 'new@example.com' },
      { userId: randomUUID() },
      { locale: 'en' },
    ]) {
      await request(server)
        .post('/api/v1/me/profile')
        .set(headers)
        .send({ expectedVersion: 3, fullName: 'Lan', ...extra })
        .expect(400);
    }
    // A missing or malformed version or name is refused too.
    for (const bad of [
      { fullName: 'Lan' },
      { expectedVersion: 0, fullName: 'Lan' },
      { expectedVersion: '3', fullName: 'Lan' },
      { expectedVersion: 3 },
      { expectedVersion: 3, fullName: 7 },
      { expectedVersion: 3, fullName: 'x'.repeat(1_001) },
    ]) {
      await request(server).post('/api/v1/me/profile').set(headers).send(bad).expect(400);
    }
    assert.equal(calls.length, before, 'nothing reached the service');

    // The write needs the session-bound CSRF token and the exact Origin (the global guard).
    await request(server)
      .post('/api/v1/me/profile')
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send({ expectedVersion: 3, fullName: 'Lan' })
      .expect(403);
    await request(server)
      .post('/api/v1/me/profile')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send({ expectedVersion: 3, fullName: 'Lan' })
      .expect(403);
    assert.equal(calls.length, before);

    // No other verb exists on the route.
    for (const method of ['put', 'patch', 'delete'] as const) {
      await request(server)[method]('/api/v1/me/profile').set(headers).send({}).expect(404);
    }

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['VALIDATION_FAILED', 400],
      ['CONFLICT', 409],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .post('/api/v1/me/profile')
        .set(headers)
        .send({ expectedVersion: 3, fullName: 'Lan' })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|user_id|SQL/i);
    }
  } finally {
    await app.close();
  }
});

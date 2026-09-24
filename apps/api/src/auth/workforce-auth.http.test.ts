import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { ApiErrorResponse, CurrentAccountResponse } from '@lucy-spa/contracts';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { AuthError } from './auth.error.js';
import { csrfToken, generateCapability } from './crypto.js';
import { LoginService } from './login.service.js';
import { RateLimitedError } from './registration.service.js';
import { sessionPrincipal, type SessionRecord } from './session.policy.js';
import { SessionService } from './session.service.js';

const owner: CurrentAccountResponse = {
  id: randomUUID(),
  kind: 'OWNER',
  displayName: 'Lucy Owner',
  locale: 'vi',
  authorization: { version: 1, owner: true },
};

test('workforce login, /me, reauthenticate and logout-all HTTP contracts', async () => {
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'https://spa.example',
    AUTH_CSRF_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  });
  const token = generateCapability();
  const now = new Date(Date.now() - 100);
  const record: SessionRecord = {
    id: randomUUID(),
    kind: 'ANONYMOUS',
    userId: null,
    credentialVersion: null,
    authzVersion: null,
    csrfKeyVersion: 1,
    createdAt: now,
    lastActivityAt: now,
    absoluteExpiresAt: new Date(Date.now() + 900_000),
    revokedAt: null,
    reauthenticatedAt: null,
    user: null,
  };
  const rotated = generateCapability();
  const calls: unknown[][] = [];
  let failure: Error | null = null;
  const respond =
    <T>(name: string, value: T) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return failure ? Promise.reject(failure) : Promise.resolve(value);
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
    })
    .overrideProvider(LoginService)
    .useValue({
      login: respond('login', { token: rotated, account: owner }),
      currentAccount: respond('me', owner),
      reauthenticate: respond('reauthenticate', rotated),
      logoutAll: respond('logoutAll', undefined),
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
  const expectedCookie = `__Host-lucy_session=${rotated}; Path=/; HttpOnly; SameSite=Lax; Secure`;
  try {
    // Realm/identifier combinations: EMPLOYEE_ID is WORKFORCE-only.
    const workforce = {
      realm: 'WORKFORCE',
      identifierType: 'EMPLOYEE_ID',
      identifier: 'ktv-001',
      password: 'a calm lotus evening 2026',
    };
    const invalid = await request(server)
      .post('/api/v1/auth/login')
      .set(headers)
      .send({ ...workforce, realm: 'CUSTOMER' })
      .expect(400);
    assert.equal((invalid.body as ApiErrorResponse).message, 'Validation failed: identifierType');
    const signedIn = await request(server)
      .post('/api/v1/auth/login')
      .set(headers)
      .send(workforce)
      .expect(200);
    assert.deepEqual(signedIn.body, owner);
    assert.equal(String(signedIn.headers['set-cookie']?.[0]), expectedCookie);
    assert.deepEqual(calls.at(-1)?.slice(1, 4), ['ktv-001', workforce.password, token]);
    assert.deepEqual(calls.at(-1)?.[6], { realm: 'WORKFORCE', identifierType: 'EMPLOYEE_ID' });

    // GET /me needs no CSRF token and returns only the caller's own account.
    const me = await request(server).get('/api/v1/auth/me').set('Cookie', cookie).expect(200);
    assert.deepEqual(me.body, owner);
    assert.equal(me.headers['cache-control'], 'no-store');
    assert.equal(calls.at(-1)?.[1], token);

    // Unsafe routes need CSRF/origin; bodies are strict.
    await request(server)
      .post('/api/v1/auth/reauthenticate')
      .set('Cookie', cookie)
      .send({ password: 'x' })
      .expect(403);
    await request(server)
      .post('/api/v1/auth/logout-all')
      .set('Cookie', cookie)
      .send({})
      .expect(403);
    await request(server)
      .post('/api/v1/auth/reauthenticate')
      .set(headers)
      .send({ password: 'x', userId: randomUUID() })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/logout-all')
      .set(headers)
      .send({ everyone: true })
      .expect(400);

    const reauthenticated = await request(server)
      .post('/api/v1/auth/reauthenticate')
      .set(headers)
      .send({ password: workforce.password })
      .expect(204);
    assert.equal(String(reauthenticated.headers['set-cookie']?.[0]), expectedCookie);

    const everywhere = await request(server)
      .post('/api/v1/auth/logout-all')
      .set(headers)
      .send({})
      .expect(204);
    assert.equal(
      String(everywhere.headers['set-cookie']?.[0]),
      '__Host-lucy_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    );

    for (const [error, status, code, retryAfter] of [
      [new AuthError('AUTHENTICATION_REQUIRED'), 401, 'AUTHENTICATION_REQUIRED', undefined],
      [new AuthError('AUTHENTICATION_FAILED'), 401, 'AUTHENTICATION_FAILED', undefined],
      [new RateLimitedError(900), 429, 'RATE_LIMITED', '900'],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post('/api/v1/auth/reauthenticate')
        .set(headers)
        .send({ password: workforce.password })
        .expect(status);
      assert.equal((response.body as ApiErrorResponse).code, code);
      assert.equal(response.headers['retry-after'], retryAfter);
      assert.equal(response.headers['set-cookie'], undefined);
      assert.equal(JSON.stringify(response.body).includes(workforce.password), false);
    }
    failure = new AuthError('AUTHENTICATION_REQUIRED');
    await request(server).get('/api/v1/auth/me').expect(401);
    const refused = await request(server)
      .post('/api/v1/auth/logout-all')
      .set(headers)
      .send({})
      .expect(401);
    assert.equal(refused.headers['set-cookie'], undefined);
  } finally {
    await app.close();
  }
});

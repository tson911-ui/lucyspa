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

const account: CurrentAccountResponse = {
  id: randomUUID(),
  kind: 'CUSTOMER',
  displayName: 'Nguyễn Thị Linh',
  locale: 'vi',
  authorization: { version: 1, grants: [], denies: [] },
};
const credentials = {
  realm: 'CUSTOMER',
  identifierType: 'EMAIL',
  identifier: 'linh@example.com',
  password: 'a calm lotus evening 2026',
};

test('login and logout enforce CSRF, strict DTOs, cookie rotation and generic failures', async () => {
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
  const issued = generateCapability();
  const logins: unknown[][] = [];
  const revoked: unknown[][] = [];
  let loginResult: Error | null = null;
  let revokeFails = false;
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
      revoke: (...args: unknown[]) => {
        revoked.push(args);
        return revokeFails ? Promise.reject(new Error('driver detail')) : Promise.resolve(true);
      },
    })
    .overrideProvider(LoginService)
    .useValue({
      login: (...args: unknown[]) => {
        logins.push(args);
        return loginResult
          ? Promise.reject(loginResult)
          : Promise.resolve({ token: issued, account });
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const server = app.getHttpServer() as Server;
  const headers = {
    Origin: environment.webOrigin,
    Cookie: `${environment.auth.cookieName}=${token}`,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  try {
    // Login and logout are unsafe methods: forged or missing CSRF/origin fails first.
    await request(server).post('/api/v1/auth/login').send(credentials).expect(403);
    await request(server)
      .post('/api/v1/auth/login')
      .set({ ...headers, 'X-CSRF-Token': generateCapability() })
      .send(credentials)
      .expect(403);
    await request(server).post('/api/v1/auth/logout').send({}).expect(403);
    assert.equal(logins.length + revoked.length, 0);

    for (const invalid of [
      { ...credentials, realm: 'ADMIN' },
      { ...credentials, identifierType: 'EMPLOYEE_ID' },
      { ...credentials, userId: randomUUID() },
      { ...credentials, password: 123 },
    ]) {
      await request(server).post('/api/v1/auth/login').set(headers).send(invalid).expect(400);
    }
    assert.equal(logins.length, 0);

    const success = await request(server)
      .post('/api/v1/auth/login')
      .set(headers)
      .send(credentials)
      .expect(200);
    assert.deepEqual(success.body, account);
    assert.equal(success.headers['cache-control'], 'no-store');
    const cookie = String(success.headers['set-cookie']?.[0]);
    assert.equal(cookie, `__Host-lucy_session=${issued}; Path=/; HttpOnly; SameSite=Lax; Secure`);
    assert.equal(logins[0]?.[0], credentials.identifier);
    assert.equal(logins[0]?.[1], credentials.password);
    assert.equal(logins[0]?.[2], token, 'the current pre-auth session is the one rotated');

    for (const [error, status, code] of [
      [new AuthError('AUTHENTICATION_FAILED'), 401, 'AUTHENTICATION_FAILED'],
      [new RateLimitedError(900), 429, 'RATE_LIMITED'],
      [new AuthError('SERVICE_UNAVAILABLE'), 503, 'SERVICE_UNAVAILABLE'],
    ] as const) {
      loginResult = error;
      const failed = await request(server)
        .post('/api/v1/auth/login')
        .set(headers)
        .send(credentials)
        .expect(status);
      const body = failed.body as ApiErrorResponse;
      assert.equal(body.code, code);
      assert.equal(failed.headers['set-cookie'], undefined);
      assert.equal(JSON.stringify(body).includes(credentials.identifier), false);
      assert.equal(JSON.stringify(body).includes(credentials.password), false);
      assert.equal(failed.headers['retry-after'], status === 429 ? '900' : undefined);
    }

    await request(server).post('/api/v1/auth/logout').set(headers).send({ all: true }).expect(400);
    const loggedOut = await request(server)
      .post('/api/v1/auth/logout')
      .set(headers)
      .send({})
      .expect(204);
    assert.equal(revoked.length, 1);
    assert.equal(revoked[0]?.[0], token);
    assert.equal(
      String(loggedOut.headers['set-cookie']?.[0]),
      '__Host-lucy_session=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0',
    );

    revokeFails = true;
    const unavailable = await request(server)
      .post('/api/v1/auth/logout')
      .set(headers)
      .send({})
      .expect(503);
    assert.equal((unavailable.body as ApiErrorResponse).code, 'SERVICE_UNAVAILABLE');
    assert.equal(JSON.stringify(unavailable.body).includes('driver'), false);
  } finally {
    await app.close();
  }
});

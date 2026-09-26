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

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('change password: session-only identity, CSRF/Origin, strict DTO, rotated cookie', async () => {
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'https://spa.example',
    AUTH_CSRF_KEYS: ring(),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: ring(),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  });
  const token = generateCapability();
  const rotated = generateCapability();
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
      kind: 'EMPLOYEE',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  const calls: unknown[][] = [];
  let outcome: Error | null = null;
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
    .useValue({
      changePassword: (...args: unknown[]) => {
        calls.push(args);
        return outcome ? Promise.reject(outcome) : Promise.resolve(rotated);
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
  const path = '/api/v1/me/password';
  const body = { currentPassword: 'a calm lotus evening 2026', newPassword: 'jasmine tea river' };
  try {
    // Missing CSRF token, wrong Origin and missing Origin are refused before the service.
    await request(server)
      .post(path)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send(body)
      .expect(403);
    await request(server)
      .post(path)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    await request(server)
      .post(path)
      .set({ Cookie: cookie, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .send(body)
      .expect(403);
    // Identity is the session: user or employee identifiers are rejected outright.
    for (const extra of [
      { userId: randomUUID() },
      { employeeId: 'NV001' },
      { employeeCode: 'NV001' },
      { id: randomUUID() },
      { confirmNewPassword: body.newPassword },
      { currentPassword: 123 },
      { newPassword: null },
    ]) {
      await request(server)
        .post(path)
        .set(headers)
        .send({ ...body, ...extra })
        .expect(400);
    }
    await request(server)
      .post(path)
      .set(headers)
      .send({ newPassword: body.newPassword })
      .expect(400);
    assert.equal(calls.length, 0, 'nothing reached the service');
    // Success: 204 and a rotated session cookie (the old token is never reissued).
    const done = await request(server).post(path).set(headers).send(body).expect(204);
    const setCookie = String(done.headers['set-cookie']);
    assert.ok(setCookie.includes(`${environment.auth.cookieName}=${rotated}`));
    assert.ok(!setCookie.includes(token));
    assert.equal(calls[0]?.[0], token);
    assert.deepEqual(calls[0]?.slice(1, 3), [body.currentPassword, body.newPassword]);
    // Refusals stay generic and never rotate the cookie.
    for (const [error, status, code] of [
      [new AuthError('AUTHENTICATION_FAILED'), 401, 'AUTHENTICATION_FAILED'],
      [new AuthError('VALIDATION_FAILED', 'newPassword'), 400, 'VALIDATION_FAILED'],
      [new AuthError('FORBIDDEN'), 403, 'FORBIDDEN'],
    ] as const) {
      outcome = error;
      const refused = await request(server).post(path).set(headers).send(body).expect(status);
      assert.equal(refused.body.code, code);
      assert.equal(refused.headers['set-cookie'], undefined);
      assert.ok(!JSON.stringify(refused.body).includes(body.currentPassword));
    }
    outcome = new RateLimitedError(900);
    const limited = await request(server).post(path).set(headers).send(body).expect(429);
    assert.equal(limited.headers['retry-after'], '900');
  } finally {
    await app.close();
  }
});

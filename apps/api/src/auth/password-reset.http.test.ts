import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { ApiErrorResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { csrfToken, generateCapability } from './crypto.js';
import { LoginService } from './login.service.js';
import { accepted, RateLimitedError } from './otp-flow.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { sessionPrincipal, type SessionRecord } from './session.policy.js';
import { SessionService } from './session.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

async function application(extra: NodeJS.ProcessEnv, resets?: Partial<PasswordResetService>) {
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'https://spa.example',
    AUTH_CSRF_KEYS: ring(),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: ring(),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
    ...extra,
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
  let transactions = 0;
  let hashes = 0;
  let builder = Test.createTestingModule({
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
      withTransaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
        transactions += 1;
        return work({} as Prisma.TransactionClient);
      },
    })
    .overrideProvider(PasswordService)
    .useValue({
      hashForSetting: () => {
        hashes += 1;
        return Promise.resolve('$argon2id$fixture');
      },
    })
    .overrideProvider(AuthThrottleService)
    .useValue({})
    .overrideProvider(LoginService)
    .useValue({});
  if (resets) builder = builder.overrideProvider(PasswordResetService).useValue(resets);
  const module = await builder.compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const headers = {
    Origin: environment.webOrigin,
    Cookie: `${environment.auth.cookieName}=${token}`,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  return {
    app,
    server: app.getHttpServer() as Server,
    headers,
    counts: () => ({ transactions, hashes }),
  };
}

test('password reset routes enforce CSRF, strict DTOs and the accepted/204 contracts', async () => {
  const calls: unknown[][] = [];
  let completeResult: Error | null = null;
  const { app, server, headers } = await application(
    {},
    {
      request: (...args: unknown[]) => {
        calls.push(['request', ...args]);
        return Promise.resolve(accepted(generateCapability()));
      },
      complete: (...args: unknown[]) => {
        calls.push(['complete', ...args]);
        return completeResult ? Promise.reject(completeResult) : Promise.resolve();
      },
    },
  );
  const requestBody = { realm: 'CUSTOMER', email: 'linh@example.com', locale: 'vi' };
  const flowToken = generateCapability();
  const completeBody = { flowToken, otp: '012345', newPassword: 'a brand new lotus evening' };
  try {
    await request(server).post('/api/v1/auth/password-reset/request').send(requestBody).expect(403);
    await request(server)
      .post('/api/v1/auth/password-reset/complete')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(completeBody)
      .expect(403);
    for (const invalid of [
      { ...requestBody, realm: 'WORKFORCE' },
      { ...requestBody, locale: 'fr' },
      { ...requestBody, userId: randomUUID() },
    ]) {
      await request(server)
        .post('/api/v1/auth/password-reset/request')
        .set(headers)
        .send(invalid)
        .expect(400);
    }
    for (const invalid of [
      { ...completeBody, otp: '12345' },
      { ...completeBody, credentialVersion: 1 },
      { flowToken, otp: '012345' },
    ]) {
      await request(server)
        .post('/api/v1/auth/password-reset/complete')
        .set(headers)
        .send(invalid)
        .expect(400);
    }
    assert.equal(calls.length, 0);

    const requested = await request(server)
      .post('/api/v1/auth/password-reset/request')
      .set(headers)
      .send(requestBody)
      .expect(202);
    const body = requested.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      'codeLifetimeSeconds',
      'flowToken',
      'resendAfterSeconds',
      'status',
    ]);
    assert.equal(body['codeLifetimeSeconds'], 300);
    assert.equal(body['resendAfterSeconds'], 60);

    const completed = await request(server)
      .post('/api/v1/auth/password-reset/complete')
      .set(headers)
      .send(completeBody)
      .expect(204);
    assert.equal(completed.headers['set-cookie'], undefined, 'reset never logs in');
    assert.equal(completed.text, '');

    completeResult = new AuthError('VERIFICATION_FAILED');
    const failed = await request(server)
      .post('/api/v1/auth/password-reset/complete')
      .set(headers)
      .send(completeBody)
      .expect(400);
    assert.equal((failed.body as ApiErrorResponse).code, 'VERIFICATION_FAILED');
    for (const secret of [flowToken, completeBody.newPassword, completeBody.otp]) {
      assert.equal(JSON.stringify(failed.body).includes(secret), false);
    }

    completeResult = new RateLimitedError(900);
    const limited = await request(server)
      .post('/api/v1/auth/password-reset/complete')
      .set(headers)
      .send(completeBody)
      .expect(429);
    assert.equal(limited.headers['retry-after'], '900');

    assert.deepEqual(calls[0], ['request', 'linh@example.com', 'vi', calls[0]?.[3]]);
    assert.equal(typeof calls[0]?.[3], 'string');
    assert.deepEqual(calls[1]?.slice(0, 4), [
      'complete',
      flowToken,
      '012345',
      completeBody.newPassword,
    ]);
  } finally {
    await app.close();
  }
});

test('reset fails closed or rejects invalid input before any transaction or hashing', async () => {
  const keys = {
    AUTH_OTP_KEYS: ring(),
    AUTH_OTP_ACTIVE_VERSION: '1',
    AUTH_DELIVERY_KEYS: ring(),
    AUTH_DELIVERY_ACTIVE_VERSION: '1',
  };
  const unconfigured = await application({});
  try {
    const response = await request(unconfigured.server)
      .post('/api/v1/auth/password-reset/request')
      .set(unconfigured.headers)
      .send({ realm: 'CUSTOMER', email: 'linh@example.com', locale: 'en' })
      .expect(503);
    assert.equal((response.body as ApiErrorResponse).code, 'SERVICE_UNAVAILABLE');
    assert.deepEqual(unconfigured.counts(), { transactions: 0, hashes: 0 });
  } finally {
    await unconfigured.app.close();
  }
  const configured = await application(keys);
  try {
    const email = await request(configured.server)
      .post('/api/v1/auth/password-reset/request')
      .set(configured.headers)
      .send({ realm: 'CUSTOMER', email: 'secret-not-an-email', locale: 'en' })
      .expect(400);
    assert.equal((email.body as ApiErrorResponse).message, 'Validation failed: email');
    assert.equal(JSON.stringify(email.body).includes('secret-not'), false);
    const weak = await request(configured.server)
      .post('/api/v1/auth/password-reset/complete')
      .set(configured.headers)
      .send({ flowToken: generateCapability(), otp: '012345', newPassword: 'short-secret' })
      .expect(400);
    assert.equal((weak.body as ApiErrorResponse).message, 'Validation failed: newPassword');
    assert.equal(JSON.stringify(weak.body).includes('short-secret'), false);
    assert.deepEqual(configured.counts(), { transactions: 0, hashes: 0 });
  } finally {
    await configured.app.close();
  }
});

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
import { PasswordService } from './password.service.js';
import { RecoveryEmailService } from './recovery-email.service.js';
import { sessionPrincipal, type SessionRecord } from './session.policy.js';
import { SessionService } from './session.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

async function application(recovery: Partial<RecoveryEmailService>) {
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
    reauthenticatedAt: now,
    user: {
      kind: 'OWNER',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
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
    .overrideProvider(RecoveryEmailService)
    .useValue(recovery)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const headers = {
    Origin: environment.webOrigin,
    Cookie: `${environment.auth.cookieName}=${token}`,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  return { app, server: app.getHttpServer() as Server, headers, token };
}

test('recovery-email routes enforce CSRF, strict bodies and the accepted/204 contracts', async () => {
  const calls: unknown[][] = [];
  let requestResult: Error | null = null;
  let verifyResult: Error | null = null;
  const { app, server, headers, token } = await application({
    request: (...args: unknown[]) => {
      calls.push(['request', ...args]);
      return requestResult
        ? Promise.reject(requestResult)
        : Promise.resolve(accepted(generateCapability()));
    },
    verify: (...args: unknown[]) => {
      calls.push(['verify', ...args]);
      return verifyResult ? Promise.reject(verifyResult) : Promise.resolve();
    },
  });
  const flowToken = generateCapability();
  const verifyBody = { flowToken, otp: '012345' };
  try {
    await request(server).post('/api/v1/auth/recovery-email/request').send({}).expect(403);
    await request(server)
      .post('/api/v1/auth/recovery-email/verify')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(verifyBody)
      .expect(403);
    // The request body is an empty object: no address, User or flag may be supplied.
    for (const invalid of [
      { email: 'other@example.com' },
      { userId: randomUUID() },
      { emailVerified: true },
    ]) {
      await request(server)
        .post('/api/v1/auth/recovery-email/request')
        .set(headers)
        .send(invalid)
        .expect(400);
    }
    for (const invalid of [
      { ...verifyBody, otp: '12345' },
      { ...verifyBody, email: 'other@example.com' },
      { flowToken },
    ]) {
      await request(server)
        .post('/api/v1/auth/recovery-email/verify')
        .set(headers)
        .send(invalid)
        .expect(400);
    }
    assert.equal(calls.length, 0);

    const requested = await request(server)
      .post('/api/v1/auth/recovery-email/request')
      .set(headers)
      .send({})
      .expect(202);
    assert.deepEqual(Object.keys(requested.body as object).sort(), [
      'codeLifetimeSeconds',
      'flowToken',
      'resendAfterSeconds',
      'status',
    ]);
    assert.equal(requested.headers['set-cookie'], undefined);

    const verified = await request(server)
      .post('/api/v1/auth/recovery-email/verify')
      .set(headers)
      .send(verifyBody)
      .expect(204);
    assert.equal(verified.text, '');
    assert.equal(verified.headers['set-cookie'], undefined, 'no session change');

    requestResult = new AuthError('REAUTHENTICATION_REQUIRED');
    const stale = await request(server)
      .post('/api/v1/auth/recovery-email/request')
      .set(headers)
      .send({})
      .expect(403);
    assert.equal((stale.body as ApiErrorResponse).code, 'REAUTHENTICATION_REQUIRED');

    requestResult = new AuthError('REQUEST_NOT_ALLOWED');
    await request(server)
      .post('/api/v1/auth/recovery-email/request')
      .set(headers)
      .send({})
      .expect(403);

    requestResult = new AuthError('AUTHENTICATION_REQUIRED');
    await request(server)
      .post('/api/v1/auth/recovery-email/request')
      .set(headers)
      .send({})
      .expect(401);

    requestResult = new RateLimitedError(3_600);
    const limitedRequest = await request(server)
      .post('/api/v1/auth/recovery-email/request')
      .set(headers)
      .send({})
      .expect(429);
    assert.equal(limitedRequest.headers['retry-after'], '3600');

    verifyResult = new AuthError('VERIFICATION_FAILED');
    const failed = await request(server)
      .post('/api/v1/auth/recovery-email/verify')
      .set(headers)
      .send(verifyBody)
      .expect(400);
    assert.equal((failed.body as ApiErrorResponse).code, 'VERIFICATION_FAILED');
    for (const secret of [flowToken, verifyBody.otp, token]) {
      assert.equal(JSON.stringify(failed.body).includes(secret), false);
    }

    verifyResult = new RateLimitedError(900);
    const limited = await request(server)
      .post('/api/v1/auth/recovery-email/verify')
      .set(headers)
      .send(verifyBody)
      .expect(429);
    assert.equal(limited.headers['retry-after'], '900');

    // The session cookie, never a body field, identifies the User.
    assert.deepEqual(calls[0], ['request', token, calls[0]?.[2]]);
    assert.equal(typeof calls[0]?.[2], 'string');
    assert.deepEqual(calls[1]?.slice(0, 4), ['verify', token, flowToken, '012345']);
  } finally {
    await app.close();
  }
});

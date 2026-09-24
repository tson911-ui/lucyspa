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
import { PasswordService } from './password.service.js';
import { accepted, RateLimitedError, RegistrationService } from './registration.service.js';
import { sessionPrincipal, type SessionRecord } from './session.policy.js';
import { SessionService } from './session.service.js';

const registration = {
  fullName: 'Nguyễn Thị Linh',
  dateOfBirth: '1990-02-28',
  address: '12 Lê Lợi, Quận 1',
  email: 'linh@example.com',
  phone: '0912345678',
  password: 'a calm lotus evening 2026',
  locale: 'vi',
};

function environmentWith(extra: NodeJS.ProcessEnv = {}) {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  return parseApiEnvironment({
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
}

async function application(
  environment: ReturnType<typeof environmentWith>,
  registrationService?: Partial<RegistrationService>,
) {
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
    .useValue({ hashForSetting: () => Promise.reject(new Error('not expected')) })
    .overrideProvider(AuthThrottleService)
    .useValue({});
  if (registrationService) {
    builder = builder.overrideProvider(RegistrationService).useValue(registrationService);
  }
  const module = await builder.compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const headers = {
    Origin: environment.webOrigin,
    Cookie: `${environment.auth.cookieName}=${token}`,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  return { app, server: app.getHttpServer() as Server, headers, transactions: () => transactions };
}

test('registration routes enforce CSRF, strict DTOs and the public accepted/verify contracts', async () => {
  const calls: unknown[][] = [];
  let verifyResult: Error | null = null;
  const { app, server, headers } = await application(environmentWith(), {
    register: (...args: unknown[]) => {
      calls.push(['register', ...args]);
      return Promise.resolve(accepted(generateCapability()));
    },
    verify: (...args: unknown[]) => {
      calls.push(['verify', ...args]);
      return verifyResult ? Promise.reject(verifyResult) : Promise.resolve();
    },
    resend: (...args: unknown[]) => {
      calls.push(['resend', ...args]);
      return Promise.resolve();
    },
  });
  try {
    // Unauthenticated authentication routes still require the session-bound CSRF token.
    await request(server).post('/api/v1/auth/register').send(registration).expect(403);
    await request(server)
      .post('/api/v1/auth/register')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(registration)
      .expect(403);
    assert.equal(calls.length, 0);

    for (const extra of [{ role: 'OWNER' }, { kind: 'EMPLOYEE' }, { status: 'ACTIVE' }]) {
      await request(server)
        .post('/api/v1/auth/register')
        .set(headers)
        .send({ ...registration, ...extra })
        .expect(400);
    }
    const missing: Partial<typeof registration> = { ...registration };
    delete missing.password;
    await request(server).post('/api/v1/auth/register').set(headers).send(missing).expect(400);
    await request(server)
      .post('/api/v1/auth/register')
      .set(headers)
      .send({ ...registration, locale: 'fr' })
      .expect(400);
    assert.equal(calls.length, 0);

    const registered = await request(server)
      .post('/api/v1/auth/register')
      .set(headers)
      .send(registration)
      .expect(202);
    const body = registered.body as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), [
      'codeLifetimeSeconds',
      'flowToken',
      'resendAfterSeconds',
      'status',
    ]);
    assert.equal(body['status'], 'accepted');
    assert.equal(body['codeLifetimeSeconds'], 300);
    assert.equal(body['resendAfterSeconds'], 60);
    assert.match(String(body['flowToken']), /^[A-Za-z0-9_-]{43}$/);
    assert.equal(registered.headers['cache-control'], 'no-store');
    assert.equal(registered.headers['set-cookie'], undefined);

    const flowToken = generateCapability();
    await request(server)
      .post('/api/v1/auth/activation/verify')
      .set(headers)
      .send({ flowToken, otp: '12345' })
      .expect(400);
    await request(server)
      .post('/api/v1/auth/activation/verify')
      .set(headers)
      .send({ flowToken, otp: '012345', userId: randomUUID() })
      .expect(400);
    const verified = await request(server)
      .post('/api/v1/auth/activation/verify')
      .set(headers)
      .send({ flowToken, otp: '012345' })
      .expect(204);
    // Activation never logs the customer in.
    assert.equal(verified.headers['set-cookie'], undefined);
    assert.equal(verified.text, '');

    verifyResult = new AuthError('VERIFICATION_FAILED');
    const failed = await request(server)
      .post('/api/v1/auth/activation/verify')
      .set(headers)
      .send({ flowToken, otp: '999999' })
      .expect(400);
    const error = failed.body as ApiErrorResponse;
    assert.equal(error.code, 'VERIFICATION_FAILED');
    assert.equal(JSON.stringify(error).includes('999999'), false);
    assert.equal(JSON.stringify(error).includes(flowToken), false);

    verifyResult = new RateLimitedError(900);
    const limited = await request(server)
      .post('/api/v1/auth/activation/verify')
      .set(headers)
      .send({ flowToken, otp: '999999' })
      .expect(429);
    assert.equal(limited.headers['retry-after'], '900');
    assert.equal((limited.body as ApiErrorResponse).code, 'RATE_LIMITED');

    const resent = await request(server)
      .post('/api/v1/auth/challenges/resend')
      .set(headers)
      .send({ flowToken })
      .expect(202);
    assert.deepEqual(resent.body, { status: 'accepted', resendAfterSeconds: 60 });

    assert.deepEqual(
      calls.map((call) => call[0]),
      ['register', 'verify', 'verify', 'verify', 'resend'],
    );
    const registerCall = calls[0]!;
    assert.deepEqual(
      Object.keys(registerCall[1] as object).sort(),
      Object.keys(registration).sort(),
    );
    assert.equal(typeof registerCall[2], 'string');
  } finally {
    await app.close();
  }
});

test('registration fails closed before any write when OTP or delivery keys are absent', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  for (const extra of [
    {},
    { AUTH_OTP_KEYS: ring(), AUTH_OTP_ACTIVE_VERSION: '1' },
    { AUTH_DELIVERY_KEYS: ring(), AUTH_DELIVERY_ACTIVE_VERSION: '1' },
  ]) {
    const { app, server, headers, transactions } = await application(environmentWith(extra));
    try {
      const response = await request(server)
        .post('/api/v1/auth/register')
        .set(headers)
        .send(registration)
        .expect(503);
      assert.equal((response.body as ApiErrorResponse).code, 'SERVICE_UNAVAILABLE');
      await request(server)
        .post('/api/v1/auth/challenges/resend')
        .set(headers)
        .send({ flowToken: generateCapability() })
        .expect(503);
      assert.equal(transactions(), 0);
    } finally {
      await app.close();
    }
  }
});

test('domain validation errors use VALIDATION_FAILED with a safe field identifier', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  const { app, server, headers, transactions } = await application(
    environmentWith({
      AUTH_OTP_KEYS: ring(),
      AUTH_OTP_ACTIVE_VERSION: '1',
      AUTH_DELIVERY_KEYS: ring(),
      AUTH_DELIVERY_ACTIVE_VERSION: '1',
    }),
  );
  try {
    const response = await request(server)
      .post('/api/v1/auth/register')
      .set(headers)
      .send({ ...registration, email: 'secret-value-not-an-email' })
      .expect(400);
    const body = response.body as ApiErrorResponse;
    assert.equal(body.code, 'VALIDATION_FAILED');
    assert.equal(body.message, 'Validation failed: email');
    assert.equal(JSON.stringify(body).includes('secret-value'), false);
    assert.equal(transactions(), 0);
  } finally {
    await app.close();
  }
});

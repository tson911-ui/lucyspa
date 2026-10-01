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
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { ServiceExecutionService } from './service-execution.service.js';

// Phase 4 Step 2 transport contract: CSRF/Origin, strict bodies, deterministic safe errors.
test('visit completion HTTP: strict bodies, CSRF/Origin and safe conflict responses', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
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
      kind: 'EMPLOYEE',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  const calls: { action: string; body: unknown }[] = [];
  let outcome: AuthError | null = null;
  const result = { lineId: randomUUID(), visitStatus: 'COMPLETED' };
  const answer = (action: string) => (_token: unknown, _id: unknown, body: unknown) => {
    calls.push({ action, body });
    return outcome ? Promise.reject(outcome) : Promise.resolve(result);
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, pino({ level: 'silent' }))],
  })
    .overrideProvider(InfrastructureService)
    .useValue({})
    .overrideProvider(SessionService)
    .useValue({
      resolve: (value: string | undefined) =>
        Promise.resolve(
          value === token ? sessionPrincipal(record, new Date(), environment.auth) : null,
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
    .overrideProvider(ServiceExecutionService)
    .useValue({ resolve: answer('resolve'), cancelLine: answer('cancel') })
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
  const routes = [
    { path: 'resolve-end', action: 'resolve' },
    { path: 'cancel', action: 'cancel' },
  ];
  try {
    for (const { path, action } of routes) {
      const url = `/api/v1/operations/service-lines/${result.lineId}/${path}`;
      await request(server)
        .post(url)
        .set({ Cookie: cookie, Origin: headers.Origin })
        .send({ reason: 'r' })
        .expect(403);
      await request(server)
        .post(url)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send({ reason: 'r' })
        .expect(403);
      for (const body of [
        {},
        { reason: 5 },
        { reason: 'r', startedAt: now.toISOString() },
        { reason: 'r', executionId: randomUUID() },
        { reason: 'r', status: 'DONE' },
        { reason: 'r', cancelledAt: now.toISOString() },
        { reason: 'x'.repeat(2049) },
        [],
      ])
        await request(server).post(url).set(headers).send(body).expect(400);
      assert.ok(!calls.some((call) => call.action === action));
      const response = await request(server)
        .post(url)
        .set(headers)
        .send({ reason: 'khách đi rồi' })
        .expect(200);
      assert.deepEqual(response.body, result);
    }
    // The end time is the only optional field of the resolution; it is passed through untouched.
    await request(server)
      .post(`/api/v1/operations/service-lines/${result.lineId}/resolve-end`)
      .set(headers)
      .send({ reason: 'r', endedAt: now.toISOString() })
      .expect(200);
    assert.deepEqual(
      { ...(calls.at(-1)?.body as object) },
      { reason: 'r', endedAt: now.toISOString() },
    );
    for (const code of [
      'SERVICE_RESOLUTION_NOT_ALLOWED',
      'SERVICE_LINE_CANCEL_NOT_ALLOWED',
      'SERVICE_EXECUTION_CONFLICT',
    ] as const) {
      outcome = new AuthError(code);
      for (const { path } of routes) {
        const response = await request(server)
          .post(`/api/v1/operations/service-lines/${result.lineId}/${path}`)
          .set(headers)
          .send({ reason: 'r' })
          .expect(409);
        assert.equal(response.body.code, code);
        assert.doesNotMatch(JSON.stringify(response.body), /prisma|SELECT|constraint|postgres/i);
      }
    }
  } finally {
    await app.close();
  }
});

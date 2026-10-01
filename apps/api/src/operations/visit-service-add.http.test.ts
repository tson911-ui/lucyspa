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

// Phase 4 Step 3 transport contract: ids only, CSRF/Origin, deterministic safe errors.
test('staff-added service HTTP: ids-only body, CSRF/Origin and safe conflict responses', async () => {
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
  const result = { lineId: randomUUID(), status: 'PLANNED' };
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
    .useValue({ addLine: answer('add'), addOptions: answer('options') })
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
  const visitId = randomUUID();
  const url = `/api/v1/operations/visits/${visitId}/lines`;
  const good = {
    participantId: randomUUID(),
    serviceId: randomUUID(),
    idempotencyKey: randomUUID(),
  };
  try {
    await request(server)
      .post(url)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send(good)
      .expect(403);
    await request(server)
      .post(url)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(good)
      .expect(403);
    for (const body of [
      {},
      { serviceId: good.serviceId, idempotencyKey: good.idempotencyKey },
      { ...good, name: 'Massage tuỳ ý' },
      { ...good, serviceName: 'Free text' },
      { ...good, priceVnd: '1' },
      { ...good, price: 1 },
      { ...good, quantity: 2 },
      { ...good, plannedStartAt: now.toISOString() },
      { ...good, status: 'PLANNED' },
      { ...good, addedOnBehalf: false },
      { ...good, employeeUserId: randomUUID() },
      { ...good, serviceId: 5 },
      { ...good, requestedEmployeeUserId: 5 },
      [],
    ])
      await request(server).post(url).set(headers).send(body).expect(400);
    assert.equal(calls.length, 0, 'no invalid body reaches the service');
    const created = await request(server).post(url).set(headers).send(good).expect(200);
    assert.deepEqual(created.body, result);
    await request(server)
      .post(url)
      .set(headers)
      .send({ ...good, requestedEmployeeUserId: null })
      .expect(200);
    await request(server)
      .post(url)
      .set(headers)
      .send({ ...good, requestedEmployeeUserId: randomUUID() })
      .expect(200);
    assert.equal(calls.length, 3);
    await request(server)
      .get(`/api/v1/operations/visits/${visitId}/add-service-options`)
      .set({ Cookie: cookie })
      .expect(200);
    for (const code of [
      'VISIT_LINE_ADD_NOT_ALLOWED',
      'BOOKING_SERVICE_UNAVAILABLE',
      'SERVICE_EXECUTION_CONFLICT',
      'CONFLICT',
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server).post(url).set(headers).send(good).expect(409);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), /prisma|SELECT|constraint|postgres/i);
    }
  } finally {
    await app.close();
  }
});

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
import { WalkInService } from './walkin.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('walk-in HTTP: CSRF and Origin, strict bodies (no times, KTV or owner), stable codes', async () => {
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
    .overrideProvider(WalkInService)
    .useValue({
      lookup: answer('lookup'),
      options: answer('options'),
      create: answer('create'),
      assign: answer('assign'),
      changeIntent: answer('changeIntent'),
      cancel: answer('cancel'),
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
  const branch = randomUUID();
  const path = `/api/v1/operations/branches/${branch}/walk-ins`;
  const body = {
    idempotencyKey: randomUUID(),
    participants: [{ key: 'g', kind: 'GUEST', displayName: 'Khách' }],
    lines: [{ participantKey: 'g', serviceId: randomUUID(), requestedEmployeeUserId: null }],
  };
  const creates = () => calls.filter(([name]) => name === 'create').length;
  try {
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
    assert.equal(creates(), 0);
    // Server-owned facts are never accepted from the browser.
    for (const extra of [
      { arrivedAt: new Date().toISOString() },
      { ownerUserId: randomUUID() },
      { bookingId: randomUUID() },
      { status: 'OPEN' },
      { lines: [{ ...body.lines[0], employeeUserId: randomUUID() }] },
      { lines: [{ ...body.lines[0], plannedStartAt: new Date().toISOString() }] },
      { participants: [{ key: 'g', kind: 'GUEST', displayName: 'X', password: 'secret123' }] },
      { participants: [{ key: 'g', kind: 'ADMIN' }] },
      { lines: [] },
    ]) {
      await request(server)
        .post(path)
        .set(headers)
        .send({ ...body, ...extra })
        .expect(400);
    }
    assert.equal(creates(), 0, 'nothing reached the service');
    await request(server).post(path).set(headers).send(body).expect(201);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['create', token, branch]);

    await request(server)
      .get(`/api/v1/operations/branches/${branch}/members`)
      .query({ phone: '0905000111' })
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get(`/api/v1/operations/branches/${branch}/members`)
      .query({ name: 'Lan' })
      .set({ Cookie: cookie })
      .expect(400);
    await request(server)
      .get(`/api/v1/operations/branches/${branch}/walk-in-options`)
      .set({ Cookie: cookie })
      .expect(200);
    const assign = `/api/v1/operations/visits/${randomUUID()}/participants/${randomUUID()}/assign`;
    await request(server)
      .post(assign)
      .set(headers)
      .send({ employeeUserId: randomUUID() })
      .expect(400);
    await request(server).post(assign).set(headers).send({}).expect(200);
    const intent = `/api/v1/operations/visits/${randomUUID()}/lines/${randomUUID()}/intent`;
    await request(server)
      .post(intent)
      .set(headers)
      .send({ requestedEmployeeUserId: null, employeeUserId: 'x' })
      .expect(400);
    await request(server)
      .post(intent)
      .set(headers)
      .send({ requestedEmployeeUserId: null })
      .expect(200);

    const cancelPath = `/api/v1/operations/visits/${randomUUID()}/cancel-walk-in`;
    await request(server)
      .post(cancelPath)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send({ reason: 'x' })
      .expect(403);
    await request(server).post(cancelPath).set(headers).send({}).expect(400);
    await request(server)
      .post(cancelPath)
      .set(headers)
      .send({ reason: 'x', status: 'NO_SHOW' })
      .expect(400);
    await request(server).post(cancelPath).set(headers).send({ reason: 'Khách về' }).expect(200);
    assert.equal(calls.at(-1)?.[0], 'cancel');

    for (const [errorCode, status] of [
      ['WALKIN_LINE_NOT_WAITING', 409],
      ['WALKIN_NOT_ASSIGNABLE', 409],
      ['WALKIN_CANCEL_NOT_ALLOWED', 409],
      ['BOOKING_SERVICE_UNAVAILABLE', 409],
      ['FORBIDDEN', 403],
    ] as const) {
      outcome = new AuthError(errorCode);
      const failed = await request(server)
        .post(intent)
        .set(headers)
        .send({ requestedEmployeeUserId: null })
        .expect(status);
      assert.equal(failed.body.code, errorCode);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|visit_service_lines|SQL/i);
    }
  } finally {
    await app.close();
  }
});

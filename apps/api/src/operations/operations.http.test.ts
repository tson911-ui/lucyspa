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
import { OperationsService } from './operations.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('operations HTTP: CSRF and Origin, strict bodies, reason required, stable codes', async () => {
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
    (name: string, value: unknown) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return outcome ? Promise.reject(outcome) : Promise.resolve(value);
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
    .overrideProvider(OperationsService)
    .useValue({
      today: answer('today', { bookings: [] }),
      arrive: answer('arrive', { visitId: 'v' }),
      noShow: answer('noShow', undefined),
      advance: answer('advance', undefined),
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
  const id = randomUUID();
  try {
    await request(server)
      .get(`/api/v1/operations/branches/${id}/today`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), ['today', token, id]);
    // CSRF and Origin are checked before the service.
    await request(server)
      .post(`/api/v1/operations/bookings/${id}/arrive`)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send({})
      .expect(403);
    await request(server)
      .post(`/api/v1/operations/bookings/${id}/arrive`)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send({})
      .expect(403);
    assert.equal(calls.filter(([name]) => name === 'arrive').length, 0);
    // Arrival accepts no input; NO_SHOW and advance need a reason and nothing else.
    await request(server)
      .post(`/api/v1/operations/bookings/${id}/arrive`)
      .set(headers)
      .send({ branchId: id })
      .expect(400);
    await request(server)
      .post(`/api/v1/operations/bookings/${id}/no-show`)
      .set(headers)
      .send({})
      .expect(400);
    await request(server)
      .post(`/api/v1/operations/bookings/${id}/no-show`)
      .set(headers)
      .send({ reason: 'x', status: 'NO_SHOW' })
      .expect(400);
    await request(server)
      .post(`/api/v1/operations/visits/${id}/advance`)
      .set(headers)
      .send({ reason: 'x', position: 1 })
      .expect(400);
    const arrived = await request(server)
      .post(`/api/v1/operations/bookings/${id}/arrive`)
      .set(headers)
      .send({})
      .expect(200);
    assert.deepEqual(arrived.body, { visitId: 'v' });
    await request(server)
      .post(`/api/v1/operations/bookings/${id}/no-show`)
      .set(headers)
      .send({ reason: 'x' })
      .expect(204);
    await request(server)
      .post(`/api/v1/operations/visits/${id}/advance`)
      .set(headers)
      .send({ reason: 'x' })
      .expect(204);
    for (const [errorCode, status] of [
      ['BOOKING_ARRIVAL_TOO_EARLY', 409],
      ['BOOKING_HOLD_ACTIVE', 409],
      ['BOOKING_NO_SHOW_NOT_ALLOWED', 409],
      ['FORBIDDEN', 403],
    ] as const) {
      outcome = new AuthError(errorCode);
      const failed = await request(server)
        .post(`/api/v1/operations/bookings/${id}/arrive`)
        .set(headers)
        .send({})
        .expect(status);
      assert.equal(failed.body.code, errorCode);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|visits_booking_id_key|SQL/i);
    }
  } finally {
    await app.close();
  }
});

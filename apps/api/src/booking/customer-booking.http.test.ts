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
import { CustomerBookingService } from './customer-booking.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('customer booking HTTP: session identity, CSRF and Origin, strict bodies, stable codes', async () => {
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
      kind: 'CUSTOMER',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: new Date(),
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
    .overrideProvider(CustomerBookingService)
    .useValue({
      branches: answer('branches'),
      branch: answer('branch'),
      employees: answer('employees'),
      availability: answer('availability'),
      list: answer('list'),
      create: answer('create'),
      detail: answer('detail'),
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
  const body = {
    idempotencyKey: randomUUID(),
    branchId: randomUUID(),
    date: '2027-03-01',
    startTime: '10:00',
    recipients: [{ key: 'me', relation: 'SELF' }],
    lines: [{ serviceId: randomUUID(), recipientKey: 'me', employeeUserId: null }],
  };
  const creates = () => calls.filter(([name]) => name === 'create').length;
  try {
    // Missing CSRF token, wrong Origin and missing Origin are refused before the service.
    await request(server)
      .post('/api/v1/me/bookings')
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/me/bookings')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/me/bookings')
      .set({ Cookie: cookie, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .send(body)
      .expect(403);
    assert.equal(creates(), 0);

    // No mass assignment: owner, status, price, code or a nested unknown field are rejected.
    for (const extra of [
      { ownerUserId: randomUUID() },
      { customerId: randomUUID() },
      { status: 'CONFIRMED' },
      { code: 'BK-1' },
      { channel: 'DESK' },
      { lines: [{ ...body.lines[0], priceVnd: '1' }] },
      { recipients: [{ key: 'me', relation: 'SELF', userId: randomUUID() }] },
      { recipients: [{ key: 'me', relation: 'PARENT' }] },
      { lines: [] },
      { startTime: '10:00:00' },
    ]) {
      await request(server)
        .post('/api/v1/me/bookings')
        .set(headers)
        .send({ ...body, ...extra })
        .expect(400);
    }
    assert.equal(creates(), 0, 'nothing reached the service');

    const created = await request(server)
      .post('/api/v1/me/bookings')
      .set(headers)
      .send(body)
      .expect(201);
    assert.equal(created.headers['cache-control'], 'no-store');
    // The session token is the identity handed to the service; the body carries no owner.
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['create', token]);

    await request(server).get('/api/v1/me/bookings').set({ Cookie: cookie }).expect(200);
    await request(server)
      .get(`/api/v1/me/bookings/${randomUUID()}`)
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get('/api/v1/me/booking/availability')
      .query({
        branchId: randomUUID(),
        date: '2027-03-01',
        serviceIds: randomUUID(),
        employees: 'ANY',
      })
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get('/api/v1/me/booking/availability')
      .query({
        branchId: randomUUID(),
        date: '2027-03-01',
        serviceIds: randomUUID(),
        employees: 'ANY',
        ownerUserId: 'x',
      })
      .set({ Cookie: cookie })
      .expect(400);
    await request(server)
      .post(`/api/v1/me/bookings/${randomUUID()}/cancel`)
      .set(headers)
      .send({ reason: 'x', status: 'CANCELLED' })
      .expect(400);
    await request(server)
      .post(`/api/v1/me/bookings/${randomUUID()}/cancel`)
      .set(headers)
      .send({})
      .expect(200);

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['BOOKING_SLOT_UNAVAILABLE', 409],
      ['BOOKING_KTV_UNAVAILABLE', 409],
      ['BOOKING_NO_SUITABLE_KTV', 409],
      ['BOOKING_OUTSIDE_HORIZON', 400],
      ['BOOKING_CANCEL_NOT_ALLOWED', 409],
      ['NOT_FOUND', 404],
      ['AUTHENTICATION_REQUIRED', 401],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .post('/api/v1/me/bookings')
        .set(headers)
        .send(body)
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|ktv_occupancies|23P01|SQL/i);
    }
  } finally {
    await app.close();
  }
});

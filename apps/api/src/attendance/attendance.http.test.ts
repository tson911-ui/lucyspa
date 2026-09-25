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
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { AttendanceService } from './attendance.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('attendance routes enforce CSRF/origin, strict DTOs and their contracts', async () => {
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
  let failure: Error | null = null;
  const respond =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return (failure ? Promise.reject(failure) : Promise.resolve({ ok: name })) as Promise<never>;
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
    .overrideProvider(AttendanceService)
    .useValue({
      checkIn: respond('checkIn'),
      checkOut: respond('checkOut'),
      correct: respond('correct'),
      listOwn: respond('listOwn'),
      listBranch: respond('listBranch'),
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
  const id = randomUUID();
  const branchId = randomUUID();
  const correction = {
    expectedVersion: 1,
    checkOutAt: '2026-09-24T17:30:00.000Z',
    reason: 'Forgot to check out',
  };
  const commands: [string, object, number][] = [
    ['/api/v1/attendance/check-in', { branchId }, 201],
    [`/api/v1/attendance/${id}/check-out`, {}, 200],
    [`/api/v1/attendance/${id}/correct`, correction, 200],
  ];
  try {
    for (const [path, body] of commands) {
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, Origin: headers.Origin })
        .send(body)
        .expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send(body)
        .expect(403);
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, 'X-CSRF-Token': headers['X-CSRF-Token'] })
        .send(body)
        .expect(403);
    }
    for (const [path, body] of [
      ['/api/v1/attendance/check-in', {}],
      ['/api/v1/attendance/check-in', { branchId, employeeId: randomUUID() }],
      ['/api/v1/attendance/check-in', { branchId, checkInAt: new Date().toISOString() }],
      [`/api/v1/attendance/${id}/check-out`, { checkOutAt: new Date().toISOString() }],
      [
        `/api/v1/attendance/${id}/correct`,
        { expectedVersion: 1, checkOutAt: correction.checkOutAt },
      ],
      [`/api/v1/attendance/${id}/correct`, { checkOutAt: correction.checkOutAt, reason: 'x' }],
      [`/api/v1/attendance/${id}/correct`, { ...correction, checkOutAt: 'yesterday' }],
      [`/api/v1/attendance/${id}/correct`, { ...correction, businessDate: '2026-09-24' }],
      [`/api/v1/attendance/${id}/correct`, { ...correction, employeeId: randomUUID() }],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    await request(server)
      .get('/api/v1/attendance/me?from=24-09-2026')
      .set({ Cookie: headers.Cookie })
      .expect(400);
    await request(server)
      .get('/api/v1/attendance?extra=1')
      .set({ Cookie: headers.Cookie })
      .expect(400);
    assert.equal(calls.length, 0);

    for (const [path, body, status] of commands) {
      await request(server).post(path).set(headers).send(body).expect(status);
    }
    await request(server)
      .get('/api/v1/attendance/me?from=2026-09-01&to=2026-09-25')
      .set({ Cookie: headers.Cookie })
      .expect(200);
    await request(server)
      .get(`/api/v1/attendance?branchId=${branchId}`)
      .set({ Cookie: headers.Cookie })
      .expect(200);
    assert.deepEqual(calls[0]?.slice(0, 2), ['checkIn', token]);
    assert.deepEqual({ ...(calls[0]?.[2] as object) }, { branchId });
    assert.deepEqual(calls[1]?.slice(0, 3), ['checkOut', token, id]);
    assert.deepEqual(calls[2]?.slice(0, 3), ['correct', token, id]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[2]?.[3])), correction);
    assert.deepEqual(calls[3]?.slice(0, 3), [
      'listOwn',
      token,
      { from: '2026-09-01', to: '2026-09-25' },
    ]);
    assert.deepEqual(calls[4]?.slice(0, 3), ['listBranch', token, { branchId }]);

    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('CONFLICT', 'businessDate'), 409],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post(commands[0]![0])
        .set(headers)
        .send(commands[0]![1])
        .expect(status);
      assert.equal((response.body as ApiErrorResponse).code, error.code);
    }
  } finally {
    await app.close();
  }
});

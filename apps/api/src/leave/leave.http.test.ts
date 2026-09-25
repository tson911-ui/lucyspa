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
import { LeaveService } from './leave.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('leave routes enforce CSRF/origin, strict DTOs and their contracts', async () => {
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
    .overrideProvider(LeaveService)
    .useValue({
      create: respond('create'),
      cancel: respond('cancel'),
      approve: respond('approve'),
      reject: respond('reject'),
      listOwn: respond('listOwn'),
      listScoped: respond('listScoped'),
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
  const create = {
    leaveType: 'SICK',
    startDate: '2027-03-10',
    endDate: '2027-03-11',
    reason: 'Fever',
  };
  const base = '/api/v1/leave-requests';
  const commands: [string, object, number][] = [
    [base, create, 201],
    [`${base}/${id}/cancel`, { expectedVersion: 1 }, 200],
    [`${base}/${id}/approve`, { expectedVersion: 1, reason: 'Get well' }, 200],
    [`${base}/${id}/reject`, { expectedVersion: 1, reason: 'Short staffed' }, 200],
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
      [base, { ...create, leaveType: 'UNPAID' }],
      [base, { ...create, leaveType: undefined }],
      [base, { ...create, startDate: '2027-03-10T00:00:00Z' }],
      [base, { ...create, endDate: '10/03/2027' }],
      [base, { ...create, reason: undefined }],
      [base, { ...create, employeeId: randomUUID() }],
      [base, { ...create, status: 'APPROVED' }],
      [base, { ...create, halfDay: true }],
      [base, { ...create, isPaid: true }],
      [`${base}/${id}/cancel`, {}],
      [`${base}/${id}/cancel`, { expectedVersion: 1, status: 'CANCELLED' }],
      [`${base}/${id}/approve`, { reason: 'x' }],
      [`${base}/${id}/approve`, { expectedVersion: 0 }],
      [`${base}/${id}/reject`, { expectedVersion: 1, decidedByUserId: randomUUID() }],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    for (const query of ['from=10-03-2027', 'status=DELETED', 'extra=1']) {
      await request(server).get(`${base}/me?${query}`).set({ Cookie: headers.Cookie }).expect(400);
    }
    assert.equal(calls.length, 0);

    for (const [path, body, status] of commands) {
      await request(server).post(path).set(headers).send(body).expect(status);
    }
    await request(server)
      .get(`${base}/me?from=2027-01-01&to=2027-12-31&status=PENDING`)
      .set({ Cookie: headers.Cookie })
      .expect(200);
    await request(server)
      .get(`${base}?employeeId=${id}`)
      .set({ Cookie: headers.Cookie })
      .expect(200);
    const plain = (value: unknown) => JSON.parse(JSON.stringify(value)) as unknown;
    assert.deepEqual(calls[0]?.slice(0, 2), ['create', token]);
    assert.deepEqual(plain(calls[0]?.[2]), create);
    assert.deepEqual(calls[1]?.slice(0, 3), ['cancel', token, id]);
    assert.deepEqual(plain(calls[1]?.[3]), { expectedVersion: 1 });
    assert.deepEqual(calls[2]?.slice(0, 3), ['approve', token, id]);
    assert.deepEqual(plain(calls[2]?.[3]), { expectedVersion: 1, reason: 'Get well' });
    assert.deepEqual(calls[3]?.slice(0, 3), ['reject', token, id]);
    assert.deepEqual(calls[4]?.slice(0, 3), [
      'listOwn',
      token,
      { from: '2027-01-01', to: '2027-12-31', status: 'PENDING' },
    ]);
    assert.deepEqual(calls[5]?.slice(0, 3), ['listScoped', token, { employeeId: id }]);

    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('CONFLICT', 'startDate'), 409],
      [new AuthError('VALIDATION_FAILED', 'endDate'), 400],
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

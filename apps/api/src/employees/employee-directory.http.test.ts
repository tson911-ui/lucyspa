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
import { EmployeeDirectoryService } from './employee-directory.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('employee directory route enforces a strict query and its contract', async () => {
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
    .overrideProvider(EmployeeDirectoryService)
    .useValue({ list: respond('list') })
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
  const branchId = randomUUID();
  const cookie = { Cookie: headers.Cookie };
  try {
    for (const query of [
      'limit=0',
      'limit=abc',
      'limit=1000',
      'status=DELETED',
      'phone=0912',
      'email=a@example.com',
      `q=${'x'.repeat(401)}`,
      // Directory groups and numbered pages (managers vs employees).
      'group=OWNERS',
      'group=managers',
      'page=0',
      'page=abc',
      'role=MANAGER',
    ]) {
      await request(server).get(`/api/v1/employees?${query}`).set(cookie).expect(400);
    }
    assert.equal(calls.length, 0);
    await request(server).get('/api/v1/employees').set(cookie).expect(200);
    await request(server)
      .get(`/api/v1/employees?q=lan&branchId=${branchId}&status=ACTIVE&limit=20&cursor=QUJD`)
      .set(cookie)
      .expect(200);
    assert.deepEqual(calls[0], ['list', token, {}]);
    assert.deepEqual(calls[1], [
      'list',
      token,
      { q: 'lan', branchId, status: 'ACTIVE', limit: '20', cursor: 'QUJD' },
    ]);
    await request(server)
      .get('/api/v1/employees?group=MANAGERS&page=3&limit=20')
      .set(cookie)
      .expect(200);
    for (const group of ['EMPLOYEES', 'COLLABORATORS', 'TRAINEES']) {
      await request(server).get(`/api/v1/employees?group=${group}&page=1`).set(cookie).expect(200);
    }
    assert.deepEqual(calls[2], ['list', token, { group: 'MANAGERS', page: '3', limit: '20' }]);
    // The single-employee read keeps its own route.
    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
      [new AuthError('VALIDATION_FAILED', 'cursor'), 400],
    ] as const) {
      failure = error;
      const response = await request(server).get('/api/v1/employees').set(cookie).expect(status);
      assert.equal((response.body as ApiErrorResponse).code, error.code);
    }
  } finally {
    await app.close();
  }
});

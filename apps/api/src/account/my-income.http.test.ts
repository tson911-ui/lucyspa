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
import { generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { MyIncomeService } from './my-income.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('my income: session-only identity; no identifier or unknown query accepted', async () => {
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
    .overrideProvider(MyIncomeService)
    .useValue({
      get: (...args: unknown[]) => {
        calls.push(['get', ...args]);
        return outcome ? Promise.reject(outcome) : Promise.resolve({ kind: 'EMPLOYEE' });
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const server = app.getHttpServer() as Server;
  const cookie = `${environment.auth.cookieName}=${token}`;
  try {
    for (const query of [
      'employeeId=11111111-1111-4111-8111-111111111111',
      'userId=11111111-1111-4111-8111-111111111111',
      'period=YEAR',
      'date=05/10/2026',
      'period=DAY&branchId=x',
    ]) {
      await request(server).get(`/api/v1/me/income?${query}`).set({ Cookie: cookie }).expect(400);
    }
    assert.equal(calls.length, 0, 'nothing reached the service');
    const done = await request(server)
      .get('/api/v1/me/income?period=WEEK&date=2026-10-08')
      .set({ Cookie: cookie })
      .expect(200);
    assert.equal(done.headers['cache-control'], 'no-store');
    assert.deepEqual(calls.at(-1), ['get', token, { period: 'WEEK', date: '2026-10-08' }]);
    await request(server).get('/api/v1/me/income').set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1), ['get', token, {}]);
    outcome = new AuthError('FORBIDDEN');
    await request(server).get('/api/v1/me/income').set({ Cookie: cookie }).expect(403);
  } finally {
    await app.close();
  }
});

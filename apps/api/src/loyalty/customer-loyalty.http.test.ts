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
import { CustomerLoyaltyService } from './customer-loyalty.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
const PATHS = ['', '/history', '/combos', '/combo-uses', '/referrals', '/gifts'];

test('customer loyalty HTTP (P5-10): read only, session identity, no browser-chosen customer, stable codes', async () => {
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
    .overrideProvider(CustomerLoyaltyService)
    .useValue({
      summary: answer('summary'),
      history: answer('history'),
      combos: answer('combos'),
      comboUses: answer('comboUses'),
      referrals: answer('referrals'),
      gifts: answer('gifts'),
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
  try {
    // Without a cookie the service receives no token (it answers AUTHENTICATION_REQUIRED itself).
    await request(server).get('/api/v1/me/loyalty/history').expect(200);
    assert.deepEqual(calls.at(-1), ['history', undefined, undefined]);

    // The session token (and the page number) are all the service receives.
    for (const [path, name] of [
      ['', 'summary'],
      ['/history', 'history'],
      ['/combos', 'combos'],
      ['/combo-uses', 'comboUses'],
      ['/referrals', 'referrals'],
      ['/gifts', 'gifts'],
    ] as const) {
      const response = await request(server)
        .get(`/api/v1/me/loyalty${path}`)
        .query(name === 'summary' ? {} : { page: '2' })
        .set({ Cookie: cookie })
        .expect(200);
      assert.equal(response.headers['cache-control'], 'no-store');
      assert.deepEqual(calls.at(-1), name === 'summary' ? [name, token] : [name, token, '2']);
    }

    // A customer, payer, wallet or branch chosen by the browser is rejected, never passed on.
    const before = calls.length;
    for (const extra of [
      { customerId: randomUUID() },
      { userId: randomUUID() },
      { ownerUserId: randomUUID() },
      { wallet: 'SPA' },
      { branchId: randomUUID() },
    ]) {
      await request(server)
        .get('/api/v1/me/loyalty/history')
        .query(extra)
        .set({ Cookie: cookie })
        .expect(400);
    }
    assert.equal(calls.length, before, 'nothing reached the service');

    // Read only: no write verb exists on any route of the page.
    for (const path of PATHS) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        await request(server)
          [method](`/api/v1/me/loyalty${path}`)
          .set(headers)
          .send({})
          .expect(404);
      }
    }
    assert.equal(calls.length, before);

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['VALIDATION_FAILED', 400],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get('/api/v1/me/loyalty/gifts')
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|user_id|SQL/i);
    }
  } finally {
    await app.close();
  }
});

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
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { ComboService } from './combo.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
test('sold combos HTTP (P5-10b): read only, query passed on, unknown parameters rejected, stable codes', async () => {
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
    .overrideProvider(ComboService)
    .useValue({ sold: answer('sold') })
    .overrideProvider(LoyaltyService)
    .useValue({ combos: answer('combos'), gifts: answer('gifts') })
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
  const branchId = randomUUID();
  const userId = randomUUID();
  try {
    // The list passes only its page and status on, with the session token.
    await request(server)
      .get('/api/v1/combos/sold')
      .query({ page: '2', status: 'FROZEN' })
      .set({ Cookie: cookie })
      .expect(200);
    const sold = calls.at(-1)!;
    assert.deepEqual(
      [sold[0], sold[1], { ...(sold[2] as object) }],
      ['sold', token, { page: '2', status: 'FROZEN' }],
    );
    // The profile lists pass the page on.
    const profile = (name: string) =>
      `/api/v1/loyalty/branches/${branchId}/customers/${userId}/${name}`;
    for (const name of ['combos', 'gifts'] as const) {
      await request(server)
        .get(profile(name))
        .query({ page: '3' })
        .set({ Cookie: cookie })
        .expect(200);
      assert.deepEqual(calls.at(-1)?.slice(0, 4), [name, token, branchId, userId]);
    }
    // Nothing else is accepted from the browser.
    const before = calls.length;
    for (const extra of [{ ownerUserId: userId }, { branchId }, { limit: '500' }]) {
      await request(server)
        .get('/api/v1/combos/sold')
        .query(extra)
        .set({ Cookie: cookie })
        .expect(400);
    }
    assert.equal(calls.length, before, 'nothing reached the service');
    // Read only: no write verb exists on these routes.
    for (const path of ['/api/v1/combos/sold', profile('combos'), profile('gifts')]) {
      for (const method of ['put', 'patch', 'delete'] as const) {
        await request(server)[method](path).set(headers).send({}).expect(404);
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
        .get('/api/v1/combos/sold')
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|user_id|SQL/i);
    }
  } finally {
    await app.close();
  }
});

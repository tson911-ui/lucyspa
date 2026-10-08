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
import { RewardService } from './reward.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-18 HTTP surface: a product gift may name the variant whose stock a use takes from (`variantId`, on create and edit), and
 * nothing else new is accepted; the stock-out and the locked link reach the client as stable codes.
 */
test('reward HTTP: the stock link of a gift, exact fields, stable codes', async () => {
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
    .overrideProvider(RewardService)
    .useValue({
      createItem: answer('createItem'),
      editItem: answer('editItem'),
      use: answer('use'),
      restore: answer('restore'),
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
  const variantId = randomUUID();
  const itemId = randomUUID();
  const created = {
    kind: 'PRODUCT_GIFT',
    serviceId: null,
    variantId,
    nameVi: 'Quà',
    nameEn: 'Gift',
    active: true,
    expiryDays: null,
  };
  try {
    await request(server).post('/api/v1/rewards/catalog').set(headers).send(created).expect(200);
    assert.equal((calls.at(-1)![2] as { variantId: string }).variantId, variantId);
    // The link is optional and may be null (no stock moves).
    const without: Record<string, unknown> = { ...created };
    delete without['variantId'];
    await request(server).post('/api/v1/rewards/catalog').set(headers).send(without).expect(200);
    await request(server)
      .post('/api/v1/rewards/catalog')
      .set(headers)
      .send({ ...created, variantId: null })
      .expect(200);
    const before = calls.length;
    for (const patch of [{ variantId: 7 }, { variantId: 'x'.repeat(65) }, { stockQuantity: 5 }]) {
      await request(server)
        .post('/api/v1/rewards/catalog')
        .set(headers)
        .send({ ...created, ...patch })
        .expect(400);
    }
    assert.equal(calls.length, before);

    const edit = `/api/v1/rewards/catalog/${itemId}/edit`;
    const body = {
      expectedRowVersion: 2,
      nameVi: 'Quà',
      nameEn: 'Gift',
      active: true,
      expiryDays: null,
    };
    await request(server)
      .post(edit)
      .set(headers)
      .send({ ...body, variantId })
      .expect(200);
    await request(server)
      .post(edit)
      .set(headers)
      .send({ ...body, variantId: null })
      .expect(200);
    await request(server).post(edit).set(headers).send(body).expect(200);
    assert.equal(
      (calls.at(-1)![3] as { variantId?: unknown }).variantId,
      undefined,
      'absent stays absent',
    );
    await request(server)
      .post(edit)
      .set(headers)
      .send({ ...body, variantId: 3 })
      .expect(400);
    await request(server).post(edit).set({ Cookie: headers.Cookie }).send(body).expect(403);

    // The stock-out and the locked link are stable, safe codes.
    const use = `/api/v1/rewards/branches/${randomUUID()}/entitlements/${randomUUID()}/use`;
    for (const [code, status, path] of [
      ['REWARD_OUT_OF_STOCK', 409, use],
      ['REWARD_GIFT_LINK_LOCKED', 409, edit],
      ['REWARD_VARIANT_INVALID', 409, '/api/v1/rewards/catalog'],
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server)
        .post(path)
        .set(headers)
        .send(path === edit ? body : path === use ? {} : created);
      assert.equal(response.status, status, code);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), /stack|prisma|variant_id/i);
    }
    outcome = null;
  } finally {
    await app.close();
  }
});

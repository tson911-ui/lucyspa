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
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { CustomerReviewService } from './customer-reviews.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 8 P8-16 HTTP surface of the customer's review: the prompt is a GET on the session; giving a review is the one POST, which needs the Origin and
 * the CSRF token, accepts only the contract's fields with the right types, and never takes a customer id from the browser.
 */
test('customer reviews HTTP: GET prompt, one guarded POST, exact fields', async () => {
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
    .overrideProvider(CustomerReviewService)
    .useValue({
      prompt: (...args: unknown[]) => {
        calls.push(['prompt', ...args]);
        return Promise.resolve({ ok: 'prompt' });
      },
      submit: (...args: unknown[]) => {
        calls.push(['submit', ...args]);
        return Promise.resolve({ ok: 'submit' });
      },
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
  const invoice = randomUUID();
  const staff = randomUUID();
  const body = {
    invoiceId: invoice,
    rating: 5,
    comment: 'Rất hài lòng',
    staff: [{ employeeUserId: staff, rating: 4 }],
  };
  try {
    await request(server)
      .get(`/api/v1/me/reviews/invoices/${invoice}`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), ['prompt', token, invoice]);

    // Giving a review: Origin and CSRF are required; nothing reaches the service without them.
    const guarded = calls.length;
    await request(server).post('/api/v1/me/reviews').set({ Cookie: cookie }).send(body).expect(403);
    await request(server)
      .post('/api/v1/me/reviews')
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send(body)
      .expect(403);
    assert.equal(calls.length, guarded);

    await request(server).post('/api/v1/me/reviews').set(headers).send(body).expect(201);
    assert.deepEqual(calls.at(-1), [
      'submit',
      token,
      { ...body, staff: [{ employeeUserId: staff, rating: 4 }] },
    ]);
    // The comment may be missing or null; the staff list may be empty.
    await request(server)
      .post('/api/v1/me/reviews')
      .set(headers)
      .send({ invoiceId: invoice, rating: 3, staff: [] })
      .expect(201);
    assert.equal((calls.at(-1)![2] as { comment: unknown }).comment, null);

    // Only the contract's fields, with the right types and ranges (never a customer id).
    const refused = calls.length;
    for (const bad of [
      { ...body, customerUserId: randomUUID() },
      { ...body, rating: 0 },
      { ...body, rating: 6 },
      { ...body, rating: 4.5 },
      { ...body, rating: '5' },
      { ...body, invoiceId: undefined },
      { ...body, comment: 'x'.repeat(1001) },
      { ...body, staff: undefined },
      { ...body, staff: [{ employeeUserId: staff, rating: 9 }] },
      { ...body, staff: [{ employeeUserId: staff, rating: 4, extra: 1 }] },
      { ...body, staff: Array.from({ length: 21 }, () => ({ employeeUserId: staff, rating: 4 })) },
    ]) {
      await request(server).post('/api/v1/me/reviews').set(headers).send(bad).expect(400);
    }
    assert.equal(calls.length, refused);
    // No other write verb exists on the route.
    for (const verb of ['put', 'patch', 'delete'] as const) {
      await request(server)
        [verb](`/api/v1/me/reviews/invoices/${invoice}`)
        .set(headers)
        .expect(404);
    }
  } finally {
    await app.close();
  }
});

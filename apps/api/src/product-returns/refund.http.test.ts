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
import { ProductRefundService } from './refund.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-13 HTTP surface: the session cookie, Origin and CSRF are required for every write, only the contract's fields are accepted
 * (no amount, time, account number or status can be sent), and domain refusals reach the client as stable codes with safe messages.
 */
test('product refund HTTP: guards, exact fields, stable codes', async () => {
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
    .overrideProvider(ProductRefundService)
    .useValue(
      Object.fromEntries(['summary', 'refund', 'correctReference'].map((n) => [n, answer(n)])),
    )
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
  const refundId = randomUUID();
  const base = `/api/v1/product-returns/cases/${id}/refunds`;
  const body = {
    quantity: 2,
    method: 'BANK_TRANSFER_MANUAL',
    bankReference: 'FT26280123',
    restock: 'SELLABLE',
    reason: 'Khách trả hàng',
    clientRequestId: randomUUID(),
  };
  try {
    // A read carries the session token and the case id as given.
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['summary', token, id]);

    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const guarded = calls.length;
    await request(server).post(base).set({ Cookie: cookie }).send(body).expect(403);
    await request(server)
      .post(`${base}/${refundId}/corrections`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send({ bankReference: 'FT26280124', reason: 'Gõ sai' })
      .expect(403);
    assert.equal(calls.length, guarded);

    // Good bodies reach the service with exactly the fields sent.
    await request(server).post(base).set(headers).send(body).expect(200);
    assert.equal(calls.at(-1)?.[0], 'refund');
    assert.deepEqual({ ...(calls.at(-1)![3] as object) }, body);
    await request(server)
      .post(base)
      .set(headers)
      .send({ ...body, method: 'CASH', bankReference: null })
      .expect(200);
    await request(server)
      .post(`${base}/${refundId}/corrections`)
      .set(headers)
      .send({ bankReference: 'FT26280124', reason: 'Gõ sai' })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(2, 4), [id, refundId]);
    assert.deepEqual(
      { ...(calls.at(-1)![4] as object) },
      { bankReference: 'FT26280124', reason: 'Gõ sai' },
    );

    // Only the contract's fields: an amount, a time, an account number, a status, a wrong type or a missing field is a 400 and the
    // service is never called. PayOS is not a method.
    const refused = calls.length;
    for (const patch of [
      { amountVnd: '1000' },
      { amount: 1000 },
      { refundedAt: '2030-01-01T00:00:00Z' },
      { accountNumber: '0123456789' },
      { status: 'DONE' },
      { method: 'PAYOS' },
      { method: 'CARD' },
      { restock: 'MAYBE' },
      { quantity: '1' },
      { quantity: 0 },
      { reason: 5 },
      { bankReference: 5 },
    ]) {
      await request(server)
        .post(base)
        .set(headers)
        .send({ ...body, ...patch })
        .expect(400);
    }
    for (const missing of ['quantity', 'method', 'restock', 'reason', 'clientRequestId'] as const) {
      const partial: Record<string, unknown> = { ...body };
      delete partial[missing];
      await request(server).post(base).set(headers).send(partial).expect(400);
    }
    await request(server)
      .post(`${base}/${refundId}/corrections`)
      .set(headers)
      .send({ bankReference: 'FT26280124' })
      .expect(400);
    await request(server)
      .post(`${base}/${refundId}/corrections`)
      .set(headers)
      .send({ bankReference: 'FT26280124', reason: 'x', amountVnd: '1' })
      .expect(400);
    assert.equal(calls.length, refused);

    // No verb other than GET and POST exists; a refund is never edited or deleted over HTTP.
    for (const verb of ['put', 'patch', 'delete'] as const) {
      await request(server)[verb](`${base}/${refundId}`).set(headers).send({}).expect(404);
    }
    assert.equal(calls.length, refused);

    // Domain refusals reach the client as stable codes with safe messages.
    for (const [code, status] of [
      ['REAUTHENTICATION_REQUIRED', 403],
      ['REFUND_CASE_NOT_READY', 409],
      ['REFUND_QUANTITY_EXCEEDED', 409],
      ['REFUND_NOTHING_PAID', 409],
      ['REFUND_STOCK_PENDING', 409],
      ['INVOICE_HAS_REFUND', 409],
      ['FORBIDDEN', 403],
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server).post(base).set(headers).send(body);
      assert.equal(response.status, status, code);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), /FT26280123|stack|prisma/i);
    }
    outcome = null;
  } finally {
    await app.close();
  }
});

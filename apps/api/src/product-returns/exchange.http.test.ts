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
import { ProductExchangeService } from './exchange.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-14 HTTP surface: the session cookie, Origin and CSRF are required for every write, only the contract's fields are accepted
 * (no amount, price, credit, account number or status can be sent: the figures sent are only the ones the screen showed), and domain
 * refusals reach the client as stable codes with safe messages.
 */
test('product exchange HTTP: guards, exact fields, stable codes', async () => {
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
    .overrideProvider(ProductExchangeService)
    .useValue(
      Object.fromEntries(
        ['summary', 'options', 'preview', 'exchange', 'complete', 'correctReference'].map((n) => [
          n,
          answer(n),
        ]),
      ),
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
  const exchangeId = randomUUID();
  const variantId = randomUUID();
  const base = `/api/v1/product-returns/cases/${id}/exchanges`;
  const body = {
    variantId,
    expectedPayableVnd: '0',
    expectedRefundVnd: '60000',
    restock: 'SELLABLE',
    refundMethod: 'BANK_TRANSFER_MANUAL',
    bankReference: 'FT26280123',
    sellerUserId: null,
    reason: 'Khách đổi hàng',
    clientRequestId: randomUUID(),
  };
  try {
    // Reads carry the session token, the case id and the query as given.
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['summary', token, id]);
    await request(server).get(`${base}/options?q=kem`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 4), ['options', token, id, { q: 'kem' }]);
    await request(server)
      .get(`${base}/preview?variantId=${variantId}`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 4), ['preview', token, id, variantId]);

    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const guarded = calls.length;
    await request(server).post(base).set({ Cookie: cookie }).send(body).expect(403);
    await request(server)
      .post(`${base}/${exchangeId}/completion`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send({ restock: 'SELLABLE' })
      .expect(403);
    assert.equal(calls.length, guarded);

    // Good bodies reach the service with exactly the fields sent.
    await request(server).post(base).set(headers).send(body).expect(200);
    assert.equal(calls.at(-1)?.[0], 'exchange');
    assert.deepEqual({ ...(calls.at(-1)![3] as object) }, body);
    await request(server)
      .post(base)
      .set(headers)
      .send({ ...body, refundMethod: 'CASH', bankReference: null, sellerUserId: randomUUID() })
      .expect(200);
    await request(server)
      .post(base)
      .set(headers)
      .send({
        ...body,
        restock: null,
        refundMethod: null,
        bankReference: null,
        expectedPayableVnd: '80000',
        expectedRefundVnd: '0',
      })
      .expect(200);
    await request(server)
      .post(`${base}/${exchangeId}/completion`)
      .set(headers)
      .send({ restock: 'NOT_SELLABLE' })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 4), ['complete', token, id, exchangeId]);
    assert.deepEqual({ ...(calls.at(-1)![4] as object) }, { restock: 'NOT_SELLABLE' });
    await request(server)
      .post(`${base}/${exchangeId}/corrections`)
      .set(headers)
      .send({ bankReference: 'FT26280124', reason: 'Gõ sai' })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(2, 4), [id, exchangeId]);

    // Only the contract's fields: a price, a credit, an amount, an account number, a status, a wrong type or a missing field is a 400
    // and the service is never called. PayOS is not a way to hand money back.
    const refused = calls.length;
    for (const patch of [
      { amountVnd: '1000' },
      { unitPriceVnd: '1000' },
      { creditVnd: '1000' },
      { paidVnd: '1000' },
      { accountNumber: '0123456789' },
      { status: 'DONE' },
      { refundMethod: 'PAYOS' },
      { refundMethod: 'CARD' },
      { restock: 'MAYBE' },
      { variantId: 5 },
      { expectedPayableVnd: 5 },
      { expectedRefundVnd: null },
      { reason: 5 },
      { bankReference: 5 },
      { sellerUserId: 5 },
    ]) {
      await request(server)
        .post(base)
        .set(headers)
        .send({ ...body, ...patch })
        .expect(400);
    }
    for (const missing of [
      'variantId',
      'expectedPayableVnd',
      'expectedRefundVnd',
      'restock',
      'refundMethod',
      'bankReference',
      'sellerUserId',
      'reason',
      'clientRequestId',
    ] as const) {
      const partial: Record<string, unknown> = { ...body };
      delete partial[missing];
      await request(server).post(base).set(headers).send(partial).expect(400);
    }
    await request(server)
      .post(`${base}/${exchangeId}/completion`)
      .set(headers)
      .send({})
      .expect(400);
    await request(server)
      .post(`${base}/${exchangeId}/completion`)
      .set(headers)
      .send({ restock: 'SELLABLE', amountVnd: '1' })
      .expect(400);
    await request(server)
      .post(`${base}/${exchangeId}/corrections`)
      .set(headers)
      .send({ bankReference: 'FT26280124' })
      .expect(400);
    assert.equal(calls.length, refused);

    // No verb other than GET and POST exists; an exchange is never edited or deleted over HTTP.
    for (const verb of ['put', 'patch', 'delete'] as const) {
      await request(server)[verb](`${base}/${exchangeId}`).set(headers).send({}).expect(404);
    }
    assert.equal(calls.length, refused);

    // Domain refusals reach the client as stable codes with safe messages.
    for (const [code, status] of [
      ['REAUTHENTICATION_REQUIRED', 403],
      ['EXCHANGE_CASE_NOT_READY', 409],
      ['EXCHANGE_IN_PROGRESS', 409],
      ['EXCHANGE_ALREADY_DONE', 409],
      ['EXCHANGE_NOTHING_PAID', 409],
      ['EXCHANGE_FIGURES_CHANGED', 409],
      ['EXCHANGE_NOT_PAID', 409],
      ['EXCHANGE_STOCK_PENDING', 409],
      ['INVOICE_HAS_EXCHANGE', 409],
      ['PRODUCT_OUT_OF_STOCK', 409],
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

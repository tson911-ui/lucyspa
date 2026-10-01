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
import { AuthError } from '../auth/auth.error.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { InvoiceService } from './invoice.service.js';

// Phase 4 Step 5 transport contract: only the permitted choices, CSRF/Origin, deterministic safe errors.
test('invoice POS HTTP: strict bodies (no total/state/range/limit/branch), CSRF/Origin and safe conflicts', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
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
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  const calls: { action: string; args: unknown[] }[] = [];
  let outcome: AuthError | null = null;
  const result = { id: randomUUID(), status: 'DRAFT' };
  const answer =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve(result);
    };
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, pino({ level: 'silent' }))],
  })
    .overrideProvider(InfrastructureService)
    .useValue({})
    .overrideProvider(SessionService)
    .useValue({
      resolve: (value: string | undefined) =>
        Promise.resolve(
          value === token ? sessionPrincipal(record, new Date(), environment.auth) : null,
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
    .overrideProvider(InvoiceService)
    .useValue({
      board: answer('board'),
      members: answer('members'),
      get: answer('get'),
      open: answer('open'),
      setPrice: answer('setPrice'),
      payer: answer('payer'),
      finalize: answer('finalize'),
      cancel: answer('cancel'),
      recordPayment: answer('recordPayment'),
      reversePayment: answer('reversePayment'),
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
  const id = randomUUID();
  const lineId = randomUUID();
  const visitId = randomUUID();
  const branchId = randomUUID();
  const base = '/api/v1/pos';
  const paymentId = randomUUID();
  const payment = {
    method: 'CASH',
    amountVnd: '100000',
    tenderedVnd: '200000',
    idempotencyKey: randomUUID(),
  };
  try {
    // Every mutation needs CSRF and the exact Origin.
    for (const [path, body] of [
      [`${base}/visits/${visitId}/invoice`, {}],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 1, quantity: 1 }],
      [`${base}/invoices/${id}/payer`, { expectedVersion: 1, payerUserId: null }],
      [`${base}/invoices/${id}/finalize`, { expectedVersion: 1 }],
      [`${base}/invoices/${id}/cancel`, { expectedVersion: 1, reason: 'x' }],
      [`${base}/invoices/${id}/payments`, payment],
      [`${base}/invoices/${id}/payments/${paymentId}/reverse`, { reason: 'x' }],
    ] as const) {
      await request(server)
        .post(path)
        .set({ Cookie: cookie, Origin: headers.Origin })
        .send(body)
        .expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send(body)
        .expect(403);
    }
    // Strict bodies: nothing financial can be supplied by the client.
    const rejected: [string, unknown][] = [
      [`${base}/visits/${visitId}/invoice`, { visitId }],
      [`${base}/visits/${visitId}/invoice`, { totalVnd: '1' }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, {}],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { unitPriceVnd: '1' }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 1, unitPriceVnd: 5000 }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 1, unitPriceVnd: '-1' }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 1, unitPriceVnd: '1.5' }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 1, quantity: '2' }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 1, quantity: 1.5 }],
      [`${base}/invoices/${id}/lines/${lineId}/price`, { expectedVersion: 0, quantity: 1 }],
      [
        `${base}/invoices/${id}/lines/${lineId}/price`,
        { expectedVersion: 1, quantity: 1, grossVnd: '1' },
      ],
      [
        `${base}/invoices/${id}/lines/${lineId}/price`,
        { expectedVersion: 1, quantity: 1, priceMaxVnd: '9' },
      ],
      [
        `${base}/invoices/${id}/lines/${lineId}/price`,
        { expectedVersion: 1, quantity: 1, quantityLimit: 99 },
      ],
      [
        `${base}/invoices/${id}/lines/${lineId}/price`,
        { expectedVersion: 1, quantity: 1, totalVnd: '1' },
      ],
      [`${base}/invoices/${id}/payer`, { expectedVersion: 1 }],
      [`${base}/invoices/${id}/payer`, { expectedVersion: 1, payerUserId: 5 }],
      [
        `${base}/invoices/${id}/payer`,
        { expectedVersion: 1, payerUserId: null, fullName: 'Guest' },
      ],
      [`${base}/invoices/${id}/finalize`, {}],
      [`${base}/invoices/${id}/finalize`, { expectedVersion: 1, totalVnd: '0' }],
      [`${base}/invoices/${id}/finalize`, { expectedVersion: 1, status: 'PAID' }],
      [`${base}/invoices/${id}/finalize`, { expectedVersion: 1, branchId }],
      [`${base}/invoices/${id}/cancel`, { expectedVersion: 1 }],
      [`${base}/invoices/${id}/cancel`, { reason: 'x' }],
      [`${base}/invoices/${id}/cancel`, { expectedVersion: 1, reason: 'x', refund: true }],
      // Payments: only method, credited amount, tendered amount and the idempotency key.
      [`${base}/invoices/${id}/payments`, {}],
      [`${base}/invoices/${id}/payments`, { ...payment, method: undefined }],
      [`${base}/invoices/${id}/payments`, { ...payment, amountVnd: undefined }],
      [`${base}/invoices/${id}/payments`, { ...payment, tenderedVnd: undefined }],
      [`${base}/invoices/${id}/payments`, { ...payment, idempotencyKey: undefined }],
      [`${base}/invoices/${id}/payments`, { ...payment, amountVnd: 100000 }],
      [`${base}/invoices/${id}/payments`, { ...payment, amountVnd: '-1' }],
      [`${base}/invoices/${id}/payments`, { ...payment, amountVnd: '1.5' }],
      [`${base}/invoices/${id}/payments`, { ...payment, tenderedVnd: '1e3' }],
      [`${base}/invoices/${id}/payments`, { ...payment, tenderedVnd: 200000 }],
      [`${base}/invoices/${id}/payments`, { ...payment, method: 5 }],
      [`${base}/invoices/${id}/payments`, { ...payment, collectedAt: '2020-01-01T00:00:00Z' }],
      [`${base}/invoices/${id}/payments`, { ...payment, changeVnd: '0' }],
      [`${base}/invoices/${id}/payments`, { ...payment, status: 'SUCCEEDED' }],
      [`${base}/invoices/${id}/payments`, { ...payment, collectedByUserId: randomUUID() }],
      [`${base}/invoices/${id}/payments`, { ...payment, branchId }],
      [`${base}/invoices/${id}/payments`, { ...payment, invoiceId: id }],
      [`${base}/invoices/${id}/payments`, { ...payment, totalVnd: '1' }],
      [`${base}/invoices/${id}/payments/${paymentId}/reverse`, {}],
      [`${base}/invoices/${id}/payments/${paymentId}/reverse`, { reason: 5 }],
      [`${base}/invoices/${id}/payments/${paymentId}/reverse`, { reason: 'x', refund: true }],
      [`${base}/invoices/${id}/payments/${paymentId}/reverse`, { reason: 'x', amountVnd: '1' }],
    ];
    for (const [path, body] of rejected) {
      await request(server)
        .post(path)
        .set(headers)
        .send(body as object)
        .expect(400);
    }
    for (const body of [[]]) {
      await request(server)
        .post(`${base}/invoices/${id}/finalize`)
        .set(headers)
        .send(body as never)
        .expect(400);
    }
    assert.equal(calls.length, 0, 'no invalid request reaches the service');

    // Valid commands reach the service unchanged (ids from the path, choices from the body only).
    await request(server)
      .post(`${base}/visits/${visitId}/invoice`)
      .set(headers)
      .send({})
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/lines/${lineId}/price`)
      .set(headers)
      .send({ expectedVersion: 2, unitPriceVnd: '120000', quantity: 3 })
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/payer`)
      .set(headers)
      .send({ expectedVersion: 2, payerUserId: null })
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/payer`)
      .set(headers)
      .send({ expectedVersion: 2, payerUserId: randomUUID() })
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/finalize`)
      .set(headers)
      .send({ expectedVersion: 3 })
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/cancel`)
      .set(headers)
      .send({ expectedVersion: 3, reason: 'Khách hủy' })
      .expect(200);
    // Payments: the wire body is exactly the four permitted fields; an unknown METHOD reaches the service,
    // which owns the method rules (CARD is refused there with its own error).
    await request(server)
      .post(`${base}/invoices/${id}/payments`)
      .set(headers)
      .send(payment)
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/payments`)
      .set(headers)
      .send({ ...payment, method: 'CARD' })
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/payments/${paymentId}/reverse`)
      .set(headers)
      .send({ reason: 'Nhập nhầm' })
      .expect(200);
    assert.deepEqual(
      calls.map((call) => call.action),
      [
        'open',
        'setPrice',
        'payer',
        'payer',
        'finalize',
        'cancel',
        'recordPayment',
        'recordPayment',
        'reversePayment',
      ],
    );
    assert.equal(calls[6]!.args[0], id);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[6]!.args[1])), payment);
    assert.equal(calls[8]!.args[0], id);
    assert.equal(calls[8]!.args[1], paymentId);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[8]!.args[2])), { reason: 'Nhập nhầm' });
    const price = calls[1]!.args;
    assert.equal(price[0], id);
    assert.equal(price[1], lineId);
    assert.deepEqual(JSON.parse(JSON.stringify(price[2])), {
      expectedVersion: 2,
      unitPriceVnd: '120000',
      quantity: 3,
    });

    // Reads need only the session cookie; the date is a plain query parameter.
    await request(server)
      .get(`${base}/branches/${branchId}/board?date=2027-03-01`)
      .set({ Cookie: cookie })
      .expect(200);
    await request(server).get(`${base}/invoices/${id}`).set({ Cookie: cookie }).expect(200);
    await request(server)
      .get(`${base}/branches/${branchId}/members?phone=0912345678`)
      .set({ Cookie: cookie })
      .expect(200);

    // Safe, deterministic error mapping without internals.
    for (const [code, status] of [
      ['INVOICE_VISIT_NOT_COMPLETED', 409],
      ['INVOICE_STATE_INVALID', 409],
      ['INVOICE_NOT_READY', 409],
      ['INVOICE_CANCEL_NOT_ALLOWED', 409],
      ['PAYMENT_AMOUNT_INVALID', 409],
      ['PAYMENT_STATE_INVALID', 409],
      ['PAYMENT_METHOD_UNAVAILABLE', 400],
      ['CONFLICT', 409],
      ['REAUTHENTICATION_REQUIRED', 403],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server)
        .post(`${base}/invoices/${id}/cancel`)
        .set(headers)
        .send({ expectedVersion: 1, reason: 'x' })
        .expect(status);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), /prisma|SELECT|constraint|postgres/i);
      // The payment routes map the same public errors.
      const collected = await request(server)
        .post(`${base}/invoices/${id}/payments`)
        .set(headers)
        .send(payment)
        .expect(status);
      assert.equal(collected.body.code, code);
      const reversed = await request(server)
        .post(`${base}/invoices/${id}/payments/${paymentId}/reverse`)
        .set(headers)
        .send({ reason: 'x' })
        .expect(status);
      assert.equal(reversed.body.code, code);
    }
  } finally {
    await app.close();
  }
});

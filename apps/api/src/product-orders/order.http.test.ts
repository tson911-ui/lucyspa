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
import { InvoiceService } from '../pos/invoice.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { ProductOrderService, PublicProductOrderService } from './order.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-16 HTTP surface: the pre-order mode of a line and the contact of the finalization are the only new fields (nothing else is
 * accepted: no price, no status, no order code); the ticket link needs the session, the Origin and the CSRF token like every write;
 * the public ticket needs none of them, is never cached or indexed, and a refusal reaches the client as a stable code.
 */
test('product order HTTP: guards, exact fields, no-store ticket, stable codes', async () => {
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
    (name: string, value: unknown = { ok: name }) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return outcome ? Promise.reject(outcome) : Promise.resolve(value);
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
    .overrideProvider(InvoiceService)
    .useValue({ addProductLine: answer('addProductLine'), finalize: answer('finalize') })
    .overrideProvider(ProductOrderService)
    .useValue({
      createTicketLink: answer('createTicketLink', { token: 'a'.repeat(43), createdAt: 'now' }),
      revokeTicketLink: answer('revokeTicketLink'),
      context: answer('context', { branches: [] }),
      list: answer('list', { rows: [] }),
      toOrder: answer('toOrder', { groups: [] }),
      get: answer('get', { id: 'o' }),
      markOrdered: answer('markOrdered', { ordered: 1 }),
      handOver: answer('handOver'),
      cancelLine: answer('cancelLine'),
      correctReference: answer('correctReference'),
      allocate: answer('allocate', { allocated: 0 }),
    })
    .overrideProvider(PublicProductOrderService)
    .useValue({ ticket: answer('ticket', { code: 'DT000001' }) })
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
  const invoiceId = randomUUID();
  const orderId = randomUUID();
  const variantId = randomUUID();
  try {
    // The mode of a product line: PRE_ORDER and IN_STOCK, nothing else, and nothing is sent that the server decides.
    const line = `/api/v1/pos/invoices/${invoiceId}/product-lines`;
    const lineBody = { expectedVersion: 3, variantId, quantity: 2, fulfilmentMode: 'PRE_ORDER' };
    await request(server).post(line).set(headers).send(lineBody).expect(200);
    assert.equal(calls.at(-1)?.[0], 'addProductLine');
    assert.equal((calls.at(-1)![3] as { fulfilmentMode: string }).fulfilmentMode, 'PRE_ORDER');
    await request(server)
      .post(line)
      .set(headers)
      .send({ expectedVersion: 3, variantId, quantity: 2 })
      .expect(200);
    const afterLines = calls.length;
    for (const patch of [
      { fulfilmentMode: 'ONLINE' },
      { fulfilmentMode: 5 },
      { unitPriceVnd: '1' },
      { status: 'PAID' },
      { orderCode: 'DT000001' },
    ]) {
      await request(server)
        .post(line)
        .set(headers)
        .send({ ...lineBody, ...patch })
        .expect(400);
    }
    assert.equal(calls.length, afterLines);

    // The contact of the finalization: a phone number and an optional name.
    const finalize = `/api/v1/pos/invoices/${invoiceId}/finalize`;
    await request(server)
      .post(finalize)
      .set(headers)
      .send({ expectedVersion: 4, preOrderContact: { phone: '0901 234 567', name: 'Chị Lan' } })
      .expect(200);
    assert.deepEqual(
      { ...(calls.at(-1)![3] as { preOrderContact: object }).preOrderContact },
      {
        phone: '0901 234 567',
        name: 'Chị Lan',
      },
    );
    await request(server).post(finalize).set(headers).send({ expectedVersion: 4 }).expect(200);
    const afterFinalize = calls.length;
    for (const contact of [
      {},
      { phone: 5 },
      { phone: 'x'.repeat(129) },
      { phone: '0901234567', address: '1 Nguyễn Quang Bích' },
      { phone: '0901234567', name: 'x'.repeat(121) },
      { phone: '0901234567', name: 7 },
    ]) {
      await request(server)
        .post(finalize)
        .set(headers)
        .send({ expectedVersion: 4, preOrderContact: contact })
        .expect(400);
    }
    assert.equal(calls.length, afterFinalize);

    // The ticket link is a write: session, Origin and CSRF. The token comes back once and is never cached.
    const link = `/api/v1/product-orders/${orderId}/ticket-link`;
    const guarded = calls.length;
    await request(server).post(link).set({ Cookie: cookie }).send({}).expect(403);
    await request(server).post(link).send({}).expect(403);
    assert.equal(calls.length, guarded);
    const made = await request(server).post(link).set(headers).send({}).expect(200);
    assert.equal(made.headers['cache-control'], 'no-store');
    assert.equal((made.body as { token: string }).token.length, 43);
    await request(server).post(`${link}/revoke`).set(headers).send({}).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['revokeTicketLink', token, orderId]);
    for (const verb of ['get', 'put', 'patch', 'delete'] as const) {
      await request(server)[verb](link).set(headers).send({}).expect(404);
    }

    // P6-17: the queue reads need only the session; every write also needs the Origin and the CSRF token and takes exact fields only.
    const lineId = randomUUID();
    const branchId = randomUUID();
    await request(server).get(`/api/v1/product-orders/context`).set({ Cookie: cookie }).expect(200);
    await request(server)
      .get(`/api/v1/product-orders?branchId=${branchId}&tab=ARRIVED&q=abc&page=2`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['list', token]);
    assert.equal((calls.at(-1)![2] as { page: number }).page, 2, 'the page arrives as a number');
    await request(server)
      .get(`/api/v1/product-orders?tab=ARRIVED`)
      .set({ Cookie: cookie })
      .expect(400);
    await request(server)
      .get(`/api/v1/product-orders?branchId=${branchId}&page=0`)
      .set({ Cookie: cookie })
      .expect(400);
    await request(server)
      .get(`/api/v1/product-orders/to-order?branchId=${branchId}`)
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get(`/api/v1/product-orders/${orderId}`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['get', token, orderId]);
    await request(server).get(`/api/v1/product-orders`).expect(400);

    const writes: [string, object][] = [
      [
        '/api/v1/product-orders/mark-ordered',
        { lines: [{ id: lineId, rowVersion: 2 }], note: 'Đã gọi nhà cung cấp' },
      ],
      [
        `/api/v1/product-orders/lines/${lineId}/hand-over`,
        { expectedVersion: 3, to: 'CUSTOMER', orderCode: 'DT000012', phoneLast4: '4567' },
      ],
      [
        `/api/v1/product-orders/lines/${lineId}/cancel`,
        {
          expectedVersion: 3,
          cause: 'SUPPLIER_CANNOT_DELIVER',
          note: 'Hết hàng',
          method: 'CASH',
          bankReference: null,
          clientRequestId: randomUUID(),
        },
      ],
      [
        `/api/v1/product-orders/lines/${lineId}/reference-correction`,
        { bankReference: 'FT0002', reason: 'Gõ nhầm' },
      ],
      ['/api/v1/product-orders/allocate', { branchId }],
    ];
    for (const [path, body] of writes) {
      const before = calls.length;
      await request(server).post(path).set({ Cookie: cookie }).send(body).expect(403);
      await request(server).post(path).send(body).expect(403);
      assert.equal(calls.length, before, `${path} is guarded`);
      await request(server).post(path).set(headers).send(body).expect(200);
      assert.equal(calls.length, before + 1, `${path} reaches the service`);
      // Only the contract's fields are accepted.
      await request(server)
        .post(path)
        .set(headers)
        .send({ ...body, status: 'COMPLETED' })
        .expect(400);
      assert.equal(calls.length, before + 1, `${path} refuses an unknown field`);
    }
    for (const [path, patch] of [
      ['/api/v1/product-orders/mark-ordered', { lines: [] }],
      ['/api/v1/product-orders/mark-ordered', { lines: [{ id: lineId }] }],
      [`/api/v1/product-orders/lines/${lineId}/hand-over`, { to: 'SOMEONE' }],
      [`/api/v1/product-orders/lines/${lineId}/hand-over`, { expectedVersion: 0 }],
      [`/api/v1/product-orders/lines/${lineId}/cancel`, { cause: 'INVOICE_CANCELLED' }],
      [`/api/v1/product-orders/lines/${lineId}/cancel`, { method: 'CARD' }],
      [`/api/v1/product-orders/lines/${lineId}/cancel`, { bankReference: 7 }],
    ] as const) {
      const base = writes.find(([candidate]) => candidate === path)![1];
      const before = calls.length;
      await request(server)
        .post(path)
        .set(headers)
        .send({ ...base, ...patch })
        .expect(400);
      assert.equal(calls.length, before, `${path} refuses ${JSON.stringify(patch)}`);
    }

    // The public ticket needs no session, no Origin and no CSRF; it is never cached or indexed.
    const ticketToken = 'A'.repeat(43);
    const read = await request(server)
      .get(`/api/v1/public/product-order-tickets/${ticketToken}`)
      .expect(200);
    assert.equal(read.headers['cache-control'], 'no-store');
    assert.equal(read.headers['referrer-policy'], 'no-referrer');
    assert.equal(read.headers['x-robots-tag'], 'noindex');
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['ticket', ticketToken]);
    assert.equal(read.headers['set-cookie'], undefined, 'the ticket sets no cookie');
    // Nothing but a read exists there.
    for (const verb of ['post', 'put', 'patch', 'delete'] as const) {
      const response = await request(server)
        [verb](`/api/v1/public/product-order-tickets/${ticketToken}`)
        .set(headers)
        .send({});
      assert.ok([404, 403].includes(response.status), `${verb} ${response.status}`);
    }

    // Domain refusals reach the client as stable codes with safe messages.
    for (const [code, status] of [
      ['PRODUCT_PRE_ORDER_NOT_ALLOWED', 409],
      ['PRODUCT_PRE_ORDER_NOT_NEEDED', 409],
      ['PRE_ORDER_CONTACT_REQUIRED', 400],
      ['NOT_FOUND', 404],
      ['FORBIDDEN', 403],
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server)
        .post(finalize)
        .set(headers)
        .send({ expectedVersion: 4 });
      assert.equal(response.status, status, code);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), /stack|prisma|DT0000/i);
    }
    outcome = new AuthError('NOT_FOUND');
    const missing = await request(server).get(
      `/api/v1/public/product-order-tickets/${ticketToken}`,
    );
    assert.equal(missing.status, 404);
    assert.equal(missing.body.code, 'NOT_FOUND');
    outcome = null;
  } finally {
    await app.close();
  }
});

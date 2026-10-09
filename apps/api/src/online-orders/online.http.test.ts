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
import { OnlineOrderService } from './online.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 Wave 4 HTTP surface of online ordering: the member routes take the session cookie as the only identity (a customer id, a price,
 * a status or an order code in a body is refused), every write needs the Origin and the CSRF token, the public settings need neither, a
 * body carries exactly the documented fields, and a refusal reaches the client as a stable code. The service is replaced by a recorder: what
 * the business rules do is tested against PostgreSQL elsewhere.
 */
test('online order HTTP: session identity, guards, exact fields, stable codes', async () => {
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
    .overrideProvider(OnlineOrderService)
    .useValue({
      publicSettings: answer('publicSettings', { open: false }),
      cart: answer('cart'),
      addToCart: answer('addToCart'),
      setCartLine: answer('setCartLine'),
      quote: answer('quote'),
      place: answer('place'),
      list: answer('list', { rows: [] }),
      order: answer('order'),
      pay: answer('pay'),
      refresh: answer('refresh'),
      cancel: answer('cancel'),
      received: answer('received'),
      addresses: answer('addresses', { rows: [] }),
      address: answer('address'),
      removeAddress: answer('removeAddress'),
      settings: answer('settings'),
      editSettings: answer('editSettings'),
      fulfilmentContext: answer('fulfilmentContext'),
      queue: answer('queue'),
      staffOrder: answer('staffOrder'),
      ship: answer('ship'),
      correctShipment: answer('correctShipment'),
      delivered: answer('delivered'),
      log: answer('log'),
      returned: answer('returned'),
      cancelLine: answer('cancelLine'),
      settle: answer('settle'),
      returnCost: answer('returnCost'),
      carriers: answer('carriers'),
      createCarrier: answer('createCarrier'),
      editCarrier: answer('editCarrier'),
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const server = app.getHttpServer() as Server;
  const cookie = { Cookie: `${environment.auth.cookieName}=${token}` };
  const headers = {
    Origin: environment.webOrigin,
    ...cookie,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  const orderId = randomUUID();
  const lineId = randomUUID();
  const variantId = randomUUID();
  const caseId = randomUUID();
  const branchId = randomUUID();
  const base = '/api/v1';
  try {
    // The public settings need no session; the cart does not leak a stranger's data (the service decides, the controller only forwards).
    await request(server).get(`${base}/online-sales`).expect(200);
    await request(server).get(`${base}/me/cart`).set(cookie).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['cart', token]);

    // Writes of the member: session, Origin and CSRF; exact fields; the identity is never taken from the body.
    const memberWrites: [string, object][] = [
      [`${base}/me/cart/add`, { variantId, quantity: 2 }],
      [`${base}/me/cart/set`, { variantId, quantity: 0 }],
      [`${base}/me/checkout/quote`, { voucherCode: null }],
      [
        `${base}/me/online-orders`,
        {
          address: {
            recipientName: 'Lan',
            recipientPhone: '0901234567',
            provinceCode: '79',
            ward: 'Phường 1',
            street: '1 Nguyễn Quang Bích',
          },
          saveAddress: true,
          voucherCode: null,
          acceptedPolicyVersion: 1,
          clientRequestId: randomUUID(),
        },
      ],
      [`${base}/me/online-orders/${orderId}/pay`, { locale: 'vi' }],
      [`${base}/me/online-orders/${orderId}/refresh`, {}],
      [`${base}/me/online-orders/${orderId}/cancel`, {}],
      [`${base}/me/online-orders/${orderId}/received`, {}],
      [`${base}/me/addresses/${orderId}/delete`, {}],
    ];
    for (const [path, body] of memberWrites) {
      const before = calls.length;
      await request(server).post(path).set(cookie).send(body).expect(403);
      await request(server).post(path).send(body).expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send(body)
        .expect(403);
      assert.equal(calls.length, before, `${path} is guarded`);
      await request(server).post(path).set(headers).send(body).expect(200);
      assert.equal(calls.at(-1)![1], token, `${path} uses the session only`);
      const after = calls.length;
      for (const patch of [
        { userId: randomUUID() },
        { customerUserId: randomUUID() },
        { status: 'PAID' },
        { totalVnd: '1' },
        { orderCode: 'DT000001' },
      ]) {
        await request(server)
          .post(path)
          .set(headers)
          .send({ ...body, ...patch })
          .expect(400);
      }
      assert.equal(calls.length, after, `${path} takes exact fields`);
    }

    // Values: wrong types and out-of-range numbers never reach the service.
    const before = calls.length;
    for (const [path, body] of [
      [`${base}/me/cart/add`, { variantId, quantity: 0 }],
      [`${base}/me/cart/add`, { variantId, quantity: 1001 }],
      [`${base}/me/cart/add`, { variantId, quantity: '2' }],
      [`${base}/me/cart/add`, { variantId, quantity: 1.5 }],
      [`${base}/me/cart/set`, { variantId, quantity: -1 }],
      [`${base}/me/online-orders/${orderId}/pay`, { locale: 'fr' }],
      [`${base}/me/online-orders/${orderId}/pay`, {}],
      [`${base}/me/online-orders`, { acceptedPolicyVersion: 1 }],
      [
        `${base}/me/online-orders`,
        {
          address: { recipientName: 5 },
          acceptedPolicyVersion: 1,
          clientRequestId: randomUUID(),
        },
      ],
    ] as [string, object][]) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, before);
    await request(server)
      .get(`${base}/me/online-orders?cursor=${'x'.repeat(65)}`)
      .set(cookie)
      .expect(400);

    // A refusal reaches the client as a stable code with the right status.
    for (const [code, status] of [
      ['ONLINE_SALES_CLOSED', 409],
      ['CONFLICT', 409],
      ['NOT_FOUND', 404],
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server)
        .post(`${base}/me/online-orders/${orderId}/cancel`)
        .set(headers)
        .send({});
      assert.equal(response.status, status, code);
      assert.equal((response.body as { code?: string }).code, code);
    }
    outcome = null;

    // The staff side: the queue read needs the session and a branch; every write needs the guards and exact fields.
    await request(server).get(`${base}/online-orders/context`).set(cookie).expect(200);
    await request(server)
      .get(`${base}/online-orders?branchId=${branchId}&tab=TO_SHIP&q=abc&page=2`)
      .set(cookie)
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['queue', token]);
    await request(server).get(`${base}/online-orders?tab=TO_SHIP`).set(cookie).expect(400);
    await request(server).get(`${base}/online-orders/${orderId}`).set(cookie).expect(200);
    await request(server).get(`${base}/shipping-carriers`).set(cookie).expect(200);
    const staffWrites: [string, object][] = [
      [
        `${base}/online-orders/${orderId}/ship`,
        {
          lines: [{ id: lineId, rowVersion: 3 }],
          carrierId: randomUUID(),
          trackingCode: 'VN123',
          carrierFeeVnd: '35000',
        },
      ],
      [
        `${base}/online-orders/${orderId}/shipment`,
        { trackingCode: 'VN124', carrierFeeVnd: '36000', reason: 'Nhập nhầm' },
      ],
      [`${base}/online-orders/${orderId}/delivered`, { deliveredOn: null }],
      [
        `${base}/online-orders/${orderId}/log`,
        { kind: 'DELIVERY_FAILED', reasonCode: 'CUSTOMER_AWAY', note: 'Khách đi vắng' },
      ],
      [`${base}/online-orders/${orderId}/returned`, { note: 'Hàng về còn nguyên' }],
      [
        `${base}/online-orders/${orderId}/address`,
        {
          recipientName: 'Lan',
          recipientPhone: '0901234567',
          provinceCode: '79',
          ward: 'Phường 2',
          street: '2 Nguyễn Quang Bích',
          reason: 'Khách đổi địa chỉ',
        },
      ],
      [
        `${base}/online-orders/lines/${lineId}/cancel`,
        {
          expectedVersion: 3,
          cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
          note: 'Khách hủy',
          method: 'CASH',
          bankReference: null,
          clientRequestId: randomUUID(),
        },
      ],
      [
        `${base}/online-orders/${orderId}/settlement`,
        {
          lines: [{ id: lineId, rowVersion: 4 }],
          carrierFeeBackVnd: '30000',
          reason: 'Khách không nhận',
          restock: 'SELLABLE',
          method: 'CASH',
          bankReference: null,
          clientRequestId: randomUUID(),
        },
      ],
      [`${base}/online-orders/return-cases/${caseId}/cost`, { costVnd: '28000', note: null }],
      [`${base}/shipping-carriers`, { name: 'Hãng thử', trackingUrlTemplate: null }],
      [`${base}/shipping-carriers/${orderId}/edit`, { expectedRowVersion: 1, isActive: false }],
      [`${base}/online-sales-settings/edit`, { expectedVersion: 1, enabled: true }],
    ];
    for (const [path, body] of staffWrites) {
      const guarded = calls.length;
      await request(server).post(path).set(cookie).send(body).expect(403);
      await request(server).post(path).send(body).expect(403);
      assert.equal(calls.length, guarded, `${path} is guarded`);
      await request(server).post(path).set(headers).send(body).expect(200);
      assert.equal(calls.at(-1)![1], token, `${path} uses the session only`);
      const after = calls.length;
      for (const patch of [
        { actorUserId: randomUUID() },
        { refundVnd: '1' },
        { status: 'SHIPPED' },
        { shippingFeeVnd: '1' },
      ]) {
        const response = await request(server)
          .post(path)
          .set(headers)
          .send({ ...body, ...patch });
        // The settings route knows `shippingFeeVnd` (kept but OFF); every other extra field is refused.
        if (path.endsWith('/online-sales-settings/edit') && 'shippingFeeVnd' in patch) continue;
        assert.equal(response.status, 400, `${path} refuses ${Object.keys(patch)[0]}`);
      }
      assert.equal(
        calls.slice(after).filter((call) => call[0] !== 'editSettings').length,
        0,
        `${path} takes exact fields`,
      );
    }

    // The money fields of staff are strings of digits in the contract; numbers and nesting never reach the service.
    const moneyBefore = calls.length;
    for (const [path, body] of [
      [
        `${base}/online-orders/${orderId}/ship`,
        { lines: [], carrierId: randomUUID(), trackingCode: 'x', carrierFeeVnd: '1' },
      ],
      [
        `${base}/online-orders/${orderId}/ship`,
        {
          lines: [{ id: lineId, rowVersion: 0 }],
          carrierId: randomUUID(),
          trackingCode: 'x',
          carrierFeeVnd: '1',
        },
      ],
      [
        `${base}/online-orders/${orderId}/ship`,
        {
          lines: [{ id: lineId, rowVersion: 1 }],
          carrierId: randomUUID(),
          trackingCode: 'x',
          carrierFeeVnd: 35000,
        },
      ],
      [
        `${base}/online-orders/${orderId}/settlement`,
        {
          lines: [{ id: lineId, rowVersion: 1 }],
          carrierFeeBackVnd: 3,
          reason: 'x',
          restock: 'SELLABLE',
          clientRequestId: randomUUID(),
        },
      ],
      [`${base}/online-orders/return-cases/${caseId}/cost`, { costVnd: 28000 }],
    ] as [string, object][]) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, moneyBefore);

    // The verbs that do not exist.
    for (const verb of ['get', 'put', 'patch', 'delete'] as const) {
      await request(server)
        [verb](`${base}/online-orders/${orderId}/settlement`)
        .set(headers)
        .send({})
        .expect(404);
    }

    // The answer of a customer route is never cached by a shared cache.
    const answered = await request(server)
      .get(`${base}/me/online-orders/${orderId}`)
      .set(cookie)
      .expect(200);
    assert.match(String(answered.headers['cache-control'] ?? ''), /no-store|private/);
  } finally {
    await app.close();
  }
});

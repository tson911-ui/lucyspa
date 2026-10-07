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
import { ProductCatalogService } from './product-catalog.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-3 HTTP surface: the session cookie and CSRF are required for every write, only the contract's fields are accepted
 * (an unknown field never reaches the service), the optional price and cost keys are told apart from absent ones, the commands
 * without data accept only an empty object, and domain refusals reach the client as stable codes with safe messages.
 */
test('product catalog HTTP: guards, exact fields, optional money keys, stable codes', async () => {
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
  const names = [
    'brands',
    'createBrand',
    'editBrand',
    'categories',
    'createCategory',
    'editCategory',
    'products',
    'product',
    'createProduct',
    'editProduct',
    'changeStatus',
    'createVariant',
    'editVariant',
    'changePrice',
    'createPromotion',
    'endPromotion',
    'addImage',
    'orderImages',
    'removeImage',
  ] as const;
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
    .overrideProvider(ProductCatalogService)
    .useValue(Object.fromEntries(names.map((name) => [name, answer(name)])))
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
  const productId = randomUUID();
  const variantId = randomUUID();
  const base = '/api/v1';
  const variantBody = {
    sku: 'SKU-1',
    labelVi: null,
    labelEn: null,
    barcode: null,
    lowStockThreshold: null,
  };
  try {
    // Reads carry only the session token to the service.
    await request(server).get(`${base}/products`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1), ['products', token]);
    await request(server).get(`${base}/products/${productId}`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['product', token, productId]);
    for (const path of ['product-brands', 'product-categories']) {
      await request(server).get(`${base}/${path}`).set({ Cookie: cookie }).expect(200);
    }

    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const before = calls.length;
    await request(server).post(`${base}/products`).set({ Cookie: cookie }).send({}).expect(403);
    await request(server)
      .post(`${base}/products/${productId}/variants`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send(variantBody)
      .expect(403);
    assert.equal(calls.length, before);

    // The optional money keys: absent stays absent, present (even null for the cost) is passed on as sent.
    await request(server)
      .post(`${base}/products/${productId}/variants`)
      .set(headers)
      .send(variantBody)
      .expect(200);
    const absent = calls.at(-1)![3] as Record<string, unknown>;
    assert.equal(absent['listPriceVnd'], undefined);
    assert.equal(absent['costPriceVnd'], undefined);
    await request(server)
      .post(`${base}/products/${productId}/variants`)
      .set(headers)
      .send({ ...variantBody, listPriceVnd: '100000', costPriceVnd: null })
      .expect(200);
    const present = calls.at(-1)![3] as Record<string, unknown>;
    assert.equal(present['listPriceVnd'], '100000');
    assert.equal(present['costPriceVnd'], null);
    await request(server)
      .post(`${base}/products/${productId}/variants/${variantId}/edit`)
      .set(headers)
      .send({
        expectedRowVersion: 1,
        labelVi: null,
        labelEn: null,
        barcode: null,
        lowStockThreshold: 2,
        sortOrder: 0,
        isActive: true,
      })
      .expect(200);
    assert.equal(
      (calls.at(-1)![4] as Record<string, unknown>)['costPriceVnd'],
      undefined,
      'an edit without a cost key',
    );

    // Only the contract's fields: an extra, wrongly typed or missing one is a 400 and the service is never called.
    const refused = calls.length;
    for (const [path, body] of [
      [
        'products',
        {
          nameVi: 'a',
          nameEn: 'b',
          descriptionVi: null,
          descriptionEn: null,
          brandId: null,
          categoryId: null,
          featured: false,
          status: 'PUBLISHED',
        },
      ],
      [
        'products',
        {
          nameVi: 'a',
          nameEn: 'b',
          descriptionVi: null,
          descriptionEn: null,
          brandId: null,
          categoryId: null,
        },
      ],
      [`products/${productId}/variants`, { ...variantBody, costPrice: '1' }],
      [`products/${productId}/variants`, { ...variantBody, listPriceVnd: 100000 }],
      [
        `products/${productId}/variants/${variantId}/price`,
        { expectedVersionNo: '1', listPriceVnd: '1', reason: null },
      ],
      [
        `products/${productId}/variants/${variantId}/price`,
        { expectedVersionNo: 1, listPriceVnd: '1', reason: null, rowVersion: 1 },
      ],
      [
        `products/${productId}/variants/${variantId}/promotions`,
        { promoPriceVnd: '1', startsAt: 'x' },
      ],
      [`products/${productId}/status`, { expectedRowVersion: 1, status: 'DRAFT' }],
      [`products/${productId}/images`, { mediaAssetId: 5 }],
      [`products/${productId}/images/order`, { imageIds: 'a' }],
      ['product-brands', { nameVi: 'a', nameEn: 'b', code: 'x' }],
      ['product-categories', { parentId: 'x', nameVi: 'a' }],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, refused, 'nothing reached the service');

    // Commands without data accept only an empty object.
    for (const path of [
      `products/${productId}/promotions/${randomUUID()}/end`,
      `products/${productId}/images/${randomUUID()}/remove`,
    ]) {
      await request(server).post(`${base}/${path}`).set(headers).send({}).expect(200);
      await request(server).post(`${base}/${path}`).set(headers).send({ x: 1 }).expect(400);
    }

    // No write verb other than POST exists, and a cost cannot be fetched on its own.
    for (const method of ['put', 'patch', 'delete'] as const) {
      await request(server)
        [method](`${base}/products/${productId}`)
        .set(headers)
        .send({})
        .expect(404);
    }
    for (const path of [
      `products/${productId}/cost`,
      'product-costs',
      `products/${productId}/margin`,
    ]) {
      await request(server).get(`${base}/${path}`).set({ Cookie: cookie }).expect(404);
    }

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['PRODUCT_PRICE_BELOW_PROMOTION', 409],
      ['PRODUCT_PROMOTION_OVERLAP', 409],
      ['PRODUCT_PUBLISH_INCOMPLETE', 409],
      ['PRODUCT_CATEGORY_DEPTH', 409],
      ['CONFLICT', 409],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get(`${base}/products/${productId}`)
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|SQL|constraint/i);
    }
  } finally {
    await app.close();
  }
});

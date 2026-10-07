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
import { InventoryService } from './inventory.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-4 HTTP surface: the session cookie and CSRF are required for every write, only the contract's fields are accepted (an
 * unknown or mistyped one never reaches the service), query and path ids reach the service as given (the service validates them),
 * no write verb other than POST exists, and domain refusals reach the client as stable codes with safe messages.
 */
test('inventory HTTP: guards, exact fields, stable codes', async () => {
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
    'context',
    'overview',
    'variantDetail',
    'variantOptions',
    'adjust',
    'suppliers',
    'createSupplier',
    'editSupplier',
    'receipts',
    'receipt',
    'createReceipt',
    'editReceipt',
    'confirmReceipt',
    'cancelReceipt',
    'counts',
    'count',
    'createCount',
    'setCountLines',
    'approveCount',
    'cancelCount',
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
    .overrideProvider(InventoryService)
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
  const base = '/api/v1';
  const branch = randomUUID();
  const id = randomUUID();
  const line = { variantId: randomUUID(), quantity: 2, lotCode: null, expiryDate: null };
  const receiptBody = {
    branchId: branch,
    supplierId: null,
    receiptDate: '2027-01-01',
    notes: null,
    lines: [line],
  };
  try {
    // Reads carry the session token and the ids as given.
    for (const [path, name] of [
      ['inventory/context', 'context'],
      [`inventory/overview?branchId=${branch}`, 'overview'],
      [`inventory/branches/${branch}/variants/${id}`, 'variantDetail'],
      ['inventory/variant-options', 'variantOptions'],
      ['suppliers', 'suppliers'],
      [`stock-receipts?branchId=${branch}`, 'receipts'],
      [`stock-receipts/${id}`, 'receipt'],
      [`stock-counts?branchId=${branch}`, 'counts'],
      [`stock-counts/${id}`, 'count'],
    ] as const) {
      await request(server).get(`${base}/${path}`).set({ Cookie: cookie }).expect(200);
      assert.equal(calls.at(-1)?.[0], name);
      assert.equal(calls.at(-1)?.[1], token);
    }
    assert.equal(calls.find((call) => call[0] === 'overview')?.[2], branch);
    assert.deepEqual(calls.find((call) => call[0] === 'variantDetail')?.slice(2, 4), [branch, id]);
    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const guarded = calls.length;
    await request(server)
      .post(`${base}/stock-receipts`)
      .set({ Cookie: cookie })
      .send(receiptBody)
      .expect(403);
    await request(server)
      .post(`${base}/stock-adjustments`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send({})
      .expect(403);
    assert.equal(calls.length, guarded);

    // Good bodies reach the service with exactly the fields sent.
    await request(server).post(`${base}/stock-receipts`).set(headers).send(receiptBody).expect(200);
    assert.deepEqual((calls.at(-1)![2] as typeof receiptBody).lines, [line]);
    const adjustment = {
      requestKey: randomUUID(),
      branchId: branch,
      variantId: randomUUID(),
      lotId: randomUUID(),
      quantity: 1,
      reason: 'LOSS',
      note: null,
    };
    await request(server)
      .post(`${base}/stock-adjustments`)
      .set(headers)
      .send(adjustment)
      .expect(200);
    assert.deepEqual({ ...(calls.at(-1)![2] as object) }, adjustment);
    for (const [path, body, name] of [
      [
        `stock-receipts/${id}/edit`,
        {
          expectedRowVersion: 1,
          supplierId: null,
          receiptDate: '2027-01-01',
          notes: null,
          lines: [line],
        },
        'editReceipt',
      ],
      [`stock-receipts/${id}/confirm`, { expectedRowVersion: 2 }, 'confirmReceipt'],
      [
        `stock-receipts/${id}/cancel`,
        { expectedRowVersion: 2, reason: 'Nhập nhầm' },
        'cancelReceipt',
      ],
      [
        'suppliers',
        { name: 'NCC', contactName: null, phone: null, email: null, address: null, notes: null },
        'createSupplier',
      ],
      [
        `suppliers/${id}/edit`,
        {
          expectedRowVersion: 1,
          isActive: true,
          name: 'NCC',
          contactName: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
        },
        'editSupplier',
      ],
      ['stock-counts', { branchId: branch, notes: null, variantIds: null }, 'createCount'],
      [
        `stock-counts/${id}/lines`,
        {
          expectedRowVersion: 1,
          lines: [{ variantId: id, countedQuantity: 3 }],
          removeVariantIds: [],
        },
        'setCountLines',
      ],
      [`stock-counts/${id}/approve`, { expectedRowVersion: 1 }, 'approveCount'],
      [`stock-counts/${id}/cancel`, { expectedRowVersion: 1 }, 'cancelCount'],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(200);
      assert.equal(calls.at(-1)?.[0], name);
    }

    // Only the contract's fields: an extra, wrongly typed or missing one is a 400 and the service is never called.
    const refused = calls.length;
    for (const [path, body] of [
      ['stock-receipts', { ...receiptBody, status: 'CONFIRMED' }],
      ['stock-receipts', { ...receiptBody, lines: 'x' }],
      ['stock-receipts', { ...receiptBody, receiptDate: 20270101 }],
      ['stock-receipts', { branchId: branch, supplierId: null, notes: null, lines: [] }],
      [
        `stock-receipts/${id}/edit`,
        { supplierId: null, receiptDate: '2027-01-01', notes: null, lines: [] },
      ],
      [`stock-receipts/${id}/confirm`, { expectedRowVersion: '2' }],
      [`stock-receipts/${id}/confirm`, { expectedRowVersion: 2, confirmedAt: 'now' }],
      [`stock-receipts/${id}/cancel`, { expectedRowVersion: 2 }],
      ['stock-adjustments', { ...adjustment, reason: 'COUNT_CORRECTION' }],
      ['stock-adjustments', { ...adjustment, reason: 'GIFT' }],
      ['stock-adjustments', { ...adjustment, quantity: '1' }],
      ['stock-adjustments', { ...adjustment, unitCostVnd: '5' }],
      ['stock-adjustments', { ...adjustment, quantityDelta: -1 }],
      ['suppliers', { name: 'NCC' }],
      [
        'suppliers',
        {
          name: 'NCC',
          contactName: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
          isActive: true,
        },
      ],
      [
        `suppliers/${id}/edit`,
        {
          name: 'NCC',
          contactName: null,
          phone: null,
          email: null,
          address: null,
          notes: null,
          isActive: true,
        },
      ],
      ['stock-counts', { branchId: branch, notes: null }],
      ['stock-counts', { branchId: branch, notes: null, variantIds: 'all' }],
      [`stock-counts/${id}/lines`, { expectedRowVersion: 1, lines: [] }],
      [`stock-counts/${id}/approve`, {}],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, refused, 'nothing reached the service');

    // No write verb other than POST exists; no stock edit, no receipt edit by verb, no stock level write, no cost endpoint.
    for (const method of ['put', 'patch', 'delete'] as const) {
      for (const path of [
        `stock-receipts/${id}`,
        `stock-counts/${id}`,
        `suppliers/${id}`,
        'stock-adjustments',
      ]) {
        await request(server)[method](`${base}/${path}`).set(headers).send({}).expect(404);
      }
    }
    for (const path of [
      'stock-levels',
      'stock-movements',
      `stock-receipts/${id}/cost`,
      'inventory/costs',
    ]) {
      await request(server).get(`${base}/${path}`).set({ Cookie: cookie }).expect(404);
    }

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['NOT_FOUND', 404],
      ['VALIDATION_FAILED', 400],
      ['INVENTORY_INSUFFICIENT_STOCK', 409],
      ['INVENTORY_RECEIPT_NOT_DRAFT', 409],
      ['INVENTORY_COUNT_NOT_OPEN', 409],
      ['INVENTORY_VARIANT_UNAVAILABLE', 409],
      ['CONFLICT', 409],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get(`${base}/inventory/overview?branchId=${branch}`)
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|SQL|constraint|unit_cost/i);
    }
  } finally {
    await app.close();
  }
});

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
import { InvoiceService } from '../pos/invoice.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { DiscountService } from './discount.service.js';

// Phase 4 Step 6 transport contract: only configured programs, strict bodies, CSRF/Origin, safe errors.
test('discount HTTP: strict bodies (no amount typed at the POS, no unknown fields), CSRF/Origin, safe errors', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
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
  const result = { id: randomUUID() };
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
      supplyVoucher: answer('supplyVoucher'),
      removeVoucher: answer('removeVoucher'),
    })
    .overrideProvider(DiscountService)
    .useValue({
      list: answer('list'),
      get: answer('get'),
      create: answer('create'),
      addVersion: answer('addVersion'),
      setActive: answer('setActive'),
      terminate: answer('terminate'),
      createVoucher: answer('createVoucher'),
      setVoucherActive: answer('setVoucherActive'),
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
  const voucherId = randomUUID();
  const invoiceId = randomUUID();
  const entryId = randomUUID();
  const window = {
    validFrom: '2027-01-01T00:00:00.000Z',
    validUntil: '2027-12-31T00:00:00.000Z',
  };
  const version = {
    kind: 'PERCENT',
    percentBp: 1000,
    ...window,
    minSpendVnd: '0',
    scopeMode: 'ALL_SERVICES',
    serviceIds: [],
    categoryIds: [],
    usageLimitTotal: null,
    usageLimitPerCustomer: 1,
  };
  const create = { code: 'TET', nameVi: 'Tết', nameEn: 'Tet', requiresCode: false, version };
  const base = '/api/v1/discounts';
  const pos = '/api/v1/pos';
  try {
    const mutations: [string, object][] = [
      [base, create],
      [`${base}/${id}/versions`, { expectedVersion: 1, version }],
      [`${base}/${id}/active`, { expectedVersion: 1, isActive: false }],
      [`${base}/${id}/terminate`, { expectedVersion: 1, reason: 'x' }],
      [`${base}/${id}/vouchers`, {}],
      [`${base}/${id}/vouchers/${voucherId}/active`, { expectedVersion: 1, isActive: false }],
      [`${pos}/invoices/${invoiceId}/vouchers`, { expectedVersion: 1, code: 'ABC' }],
      [`${pos}/invoices/${invoiceId}/vouchers/${entryId}/remove`, { expectedVersion: 1 }],
    ];
    // Every mutation needs CSRF and the exact Origin.
    for (const [path, body] of mutations) {
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

    const rejected: [string, unknown][] = [
      // Program creation: the configuration only; unknown or misplaced fields are refused.
      [base, { ...create, discountVnd: '5000' }],
      [base, { ...create, code: undefined }],
      [base, { ...create, requiresCode: 'yes' }],
      [base, { ...create, version: { ...version, totalVnd: '1' } }],
      [base, { ...create, version: { ...version, kind: 'AMOUNT' } }],
      [base, { ...create, version: { ...version, scopeMode: 'ALL' } }],
      [base, { ...create, version: { ...version, minSpendVnd: '-1' } }],
      [base, { ...create, version: { ...version, fixedAmountVnd: 5000 } }],
      [base, { ...create, version: { ...version, usageLimitTotal: 'many' } }],
      [base, { ...create, version: { ...version, serviceIds: 'all' } }],
      [base, { ...create, version: 'PERCENT' }],
      [`${base}/${id}/versions`, { version }],
      [`${base}/${id}/versions`, { expectedVersion: 0, version }],
      [`${base}/${id}/versions`, { expectedVersion: 1, version, branchId: randomUUID() }],
      [`${base}/${id}/active`, { expectedVersion: 1 }],
      [`${base}/${id}/active`, { expectedVersion: 1, isActive: 'no' }],
      [`${base}/${id}/terminate`, { expectedVersion: 1 }],
      [`${base}/${id}/terminate`, { reason: 'x' }],
      [`${base}/${id}/terminate`, { expectedVersion: 1, reason: 'x', refund: true }],
      // A voucher code only: a percentage or amount can never be typed for a code, and no program can change.
      [`${base}/${id}/vouchers`, { code: 5 }],
      [`${base}/${id}/vouchers`, { percentBp: 5000 }],
      [`${base}/${id}/vouchers`, { code: 'ABC', discountId: randomUUID() }],
      [`${base}/${id}/vouchers/${voucherId}/active`, { isActive: true }],
      // The POS supplies a code and nothing else.
      [`${pos}/invoices/${invoiceId}/vouchers`, { code: 'ABC' }],
      [`${pos}/invoices/${invoiceId}/vouchers`, { expectedVersion: 1 }],
      [`${pos}/invoices/${invoiceId}/vouchers`, { expectedVersion: 1, code: 5 }],
      [
        `${pos}/invoices/${invoiceId}/vouchers`,
        { expectedVersion: 1, code: 'ABC', amountVnd: '5000' },
      ],
      [
        `${pos}/invoices/${invoiceId}/vouchers`,
        { expectedVersion: 1, code: 'ABC', percentBp: 9000 },
      ],
      [
        `${pos}/invoices/${invoiceId}/vouchers`,
        { expectedVersion: 1, code: 'ABC', discountTotalVnd: '0' },
      ],
      [`${pos}/invoices/${invoiceId}/vouchers/${entryId}/remove`, {}],
      [
        `${pos}/invoices/${invoiceId}/vouchers/${entryId}/remove`,
        { expectedVersion: 1, force: true },
      ],
    ];
    for (const [path, body] of rejected) {
      await request(server)
        .post(path)
        .set(headers)
        .send(body as object)
        .expect(400);
    }
    assert.equal(calls.length, 0, 'no invalid request reaches the service');

    // Valid commands reach the service unchanged.
    await request(server).post(base).set(headers).send(create).expect(200);
    await request(server)
      .post(`${base}/${id}/versions`)
      .set(headers)
      .send({
        expectedVersion: 2,
        nameEn: 'Tet 2',
        version: {
          ...version,
          kind: 'FIXED_AMOUNT',
          percentBp: undefined,
          fixedAmountVnd: '50000',
        },
      })
      .expect(200);
    await request(server)
      .post(`${base}/${id}/active`)
      .set(headers)
      .send({ expectedVersion: 2, isActive: false })
      .expect(200);
    await request(server)
      .post(`${base}/${id}/terminate`)
      .set(headers)
      .send({ expectedVersion: 3, reason: 'Hết hạn' })
      .expect(200);
    await request(server).post(`${base}/${id}/vouchers`).set(headers).send({}).expect(200);
    await request(server)
      .post(`${base}/${id}/vouchers`)
      .set(headers)
      .send({ code: 'SAVE50' })
      .expect(200);
    await request(server)
      .post(`${base}/${id}/vouchers/${voucherId}/active`)
      .set(headers)
      .send({ expectedVersion: 1, isActive: false })
      .expect(200);
    await request(server)
      .post(`${pos}/invoices/${invoiceId}/vouchers`)
      .set(headers)
      .send({ expectedVersion: 4, code: 'save50' })
      .expect(200);
    await request(server)
      .post(`${pos}/invoices/${invoiceId}/vouchers/${entryId}/remove`)
      .set(headers)
      .send({ expectedVersion: 5 })
      .expect(200);
    assert.deepEqual(
      calls.map((call) => call.action),
      [
        'create',
        'addVersion',
        'setActive',
        'terminate',
        'createVoucher',
        'createVoucher',
        'setVoucherActive',
        'supplyVoucher',
        'removeVoucher',
      ],
    );
    assert.equal(calls[7]!.args[0], invoiceId);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[7]!.args[1])), {
      expectedVersion: 4,
      code: 'save50',
    });
    assert.equal(calls[8]!.args[1], entryId);

    // Reads need only the session cookie.
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    await request(server).get(`${base}/${id}`).set({ Cookie: cookie }).expect(200);

    // Safe, deterministic error mapping without internals or a hint which voucher rule failed.
    for (const [code, status] of [
      ['VOUCHER_INVALID', 409],
      ['DISCOUNT_STATE_INVALID', 409],
      ['DISCOUNT_CODE_TAKEN', 409],
      ['INVOICE_STATE_INVALID', 409],
      ['CONFLICT', 409],
      ['FORBIDDEN', 403],
      ['NOT_FOUND', 404],
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server)
        .post(`${pos}/invoices/${invoiceId}/vouchers`)
        .set(headers)
        .send({ expectedVersion: 1, code: 'ABC' })
        .expect(status);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(
        JSON.stringify(response.body),
        /prisma|SELECT|constraint|postgres|expired|inactive/i,
      );
    }
  } finally {
    await app.close();
  }
});

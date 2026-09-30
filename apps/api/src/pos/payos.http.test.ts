import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import { createPayosSimulator, parseApiEnvironment } from '@lucy-spa/server';
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
import { PrismaService } from '../platform/prisma.service.js';
import { PAYMENT_PROVIDER } from '../platform/tokens.js';
import { InvoiceService } from './invoice.service.js';

// Phase 4 Step 8 transport contract: strict PayOS bodies, CSRF/Origin everywhere except the ONE declared
// webhook route, whose only authority is the PayOS signature; safe deterministic errors.
test('PayOS HTTP: strict bodies, CSRF everywhere but the signed webhook, constant refusals', async () => {
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
  const answer =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve({ ok: true });
    };
  const simulator = createPayosSimulator();
  let transactions = 0;
  let sessionReads = 0;
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, pino({ level: 'silent' }))],
  })
    .overrideProvider(InfrastructureService)
    .useValue({})
    .overrideProvider(PrismaService)
    .useValue({
      // The webhook reaches the database only after the signature verified; a duplicate ends there.
      client: {
        $transaction: () => {
          transactions += 1;
          return Promise.resolve({ duplicate: true });
        },
      },
    })
    .overrideProvider(PAYMENT_PROVIDER)
    .useValue(simulator.provider)
    .overrideProvider(SessionService)
    .useValue({
      resolve: (value: string | undefined) => {
        sessionReads += 1;
        return Promise.resolve(
          value === token ? sessionPrincipal(record, new Date(), environment.auth) : null,
        );
      },
      recordActivity: () => {
        sessionReads += 1;
        return Promise.resolve();
      },
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
      createPayos: answer('createPayos'),
      cancelPayos: answer('cancelPayos'),
      refreshPayos: answer('refreshPayos'),
      addNote: answer('addNote'),
      anomalies: answer('anomalies'),
      reviewAnomaly: answer('reviewAnomaly'),
      cancel: answer('cancel'),
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
  const paymentId = randomUUID();
  const anomalyId = randomUUID();
  const branchId = randomUUID();
  const base = '/api/v1/pos';
  const create = { amountVnd: '120000', idempotencyKey: randomUUID() };
  try {
    // Every staff command needs CSRF and the exact Origin.
    for (const [path, body] of [
      [`${base}/invoices/${id}/payments/payos`, create],
      [`${base}/invoices/${id}/payments/${paymentId}/cancel`, {}],
      [`${base}/invoices/${id}/payments/${paymentId}/refresh`, {}],
      [`${base}/invoices/${id}/management-notes`, { note: 'x' }],
      [`${base}/payment-anomalies/${anomalyId}/review`, { note: 'x' }],
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
    // Strict bodies: the client chooses an amount and a key, nothing else about a PayOS request.
    const rejected: [string, unknown][] = [
      [`${base}/invoices/${id}/payments/payos`, {}],
      [`${base}/invoices/${id}/payments/payos`, { ...create, amountVnd: undefined }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, idempotencyKey: undefined }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, amountVnd: 120000 }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, amountVnd: '-1' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, amountVnd: '1.5' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, method: 'PAYOS' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, status: 'SUCCEEDED' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, orderCode: 1 }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, expiresAt: '2099-01-01T00:00:00Z' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, checkoutUrl: 'https://evil.example' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, providerReference: 'TF1' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, tenderedVnd: '1' }],
      [`${base}/invoices/${id}/payments/payos`, { ...create, branchId }],
      [`${base}/invoices/${id}/payments/${paymentId}/cancel`, { reason: 'x' }],
      [`${base}/invoices/${id}/payments/${paymentId}/cancel`, { status: 'CANCELLED' }],
      [`${base}/invoices/${id}/payments/${paymentId}/refresh`, { status: 'PAID' }],
      [`${base}/invoices/${id}/payments/${paymentId}/refresh`, { amountVnd: '1' }],
      [`${base}/invoices/${id}/management-notes`, {}],
      [`${base}/invoices/${id}/management-notes`, { note: 5 }],
      [`${base}/invoices/${id}/management-notes`, { note: 'x', refund: true }],
      [`${base}/payment-anomalies/${anomalyId}/review`, {}],
      [`${base}/payment-anomalies/${anomalyId}/review`, { note: 'x', status: 'OPEN' }],
    ];
    for (const [path, body] of rejected) {
      await request(server)
        .post(path)
        .set(headers)
        .send(body as object)
        .expect(400);
    }
    await request(server)
      .get(`${base}/branches/${branchId}/payment-anomalies?status=BOGUS`)
      .set({ Cookie: cookie })
      .expect(400);
    assert.equal(calls.length, 0, 'no invalid request reaches the service');

    // Valid commands reach the service unchanged (ids from the path, choices from the body only).
    await request(server)
      .post(`${base}/invoices/${id}/payments/payos`)
      .set(headers)
      .send(create)
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/payments/${paymentId}/cancel`)
      .set(headers)
      .send({})
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/payments/${paymentId}/refresh`)
      .set(headers)
      .send({})
      .expect(200);
    await request(server)
      .post(`${base}/invoices/${id}/management-notes`)
      .set(headers)
      .send({ note: 'Sai ưu đãi' })
      .expect(200);
    await request(server)
      .post(`${base}/payment-anomalies/${anomalyId}/review`)
      .set(headers)
      .send({ note: 'Đã xem' })
      .expect(200);
    await request(server)
      .get(`${base}/branches/${branchId}/payment-anomalies?status=OPEN`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(
      calls.map((call) => call.action),
      ['createPayos', 'cancelPayos', 'refreshPayos', 'addNote', 'reviewAnomaly', 'anomalies'],
    );
    assert.equal(calls[0]!.args[0], id);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0]!.args[1])), create);
    assert.equal(calls[1]!.args[1], paymentId);
    assert.equal(calls[4]!.args[0], anomalyId);
    assert.equal(calls[5]!.args[0], branchId);
    assert.equal(calls[5]!.args[1], 'OPEN');

    // Safe, deterministic error mapping without internals.
    for (const [code, status] of [
      ['PAYMENT_PROVIDER_PENDING', 409],
      ['PAYMENT_REQUEST_STATE_INVALID', 409],
      ['PAYMENT_PROVIDER_UNAVAILABLE', 503],
      ['PAYMENT_PROVIDER_REJECTED', 502],
      ['PAYMENT_ANOMALY_REVIEWED', 409],
      ['INVOICE_NOTE_NOT_ALLOWED', 409],
      ['PAYMENT_METHOD_UNAVAILABLE', 400],
      ['PAYMENT_AMOUNT_INVALID', 409],
      ['FORBIDDEN', 403],
    ] as const) {
      outcome = new AuthError(code);
      for (const path of [
        `${base}/invoices/${id}/payments/payos`,
        `${base}/invoices/${id}/payments/${paymentId}/cancel`,
      ]) {
        const response = await request(server)
          .post(path)
          .set(headers)
          .send(path.endsWith('payos') ? create : {})
          .expect(status);
        assert.equal(response.body.code, code);
        assert.doesNotMatch(
          JSON.stringify(response.body),
          /prisma|SELECT|constraint|postgres|payos\.vn/i,
        );
      }
    }
    outcome = null;

    // ---------------------------------------------------------------- the ONE signed webhook route
    const hook = '/api/v1/webhooks/payos';
    const good = simulator.webhook({ orderCode: 777, amount: 50_000, reference: 'TF-H-1' });
    const before = calls.length;
    // No cookie, no Origin, no CSRF token: exempt by the route marker; authenticity is the signature.
    const accepted = await request(server).post(hook).send(good).expect(200);
    assert.deepEqual(accepted.body, { received: true });
    assert.equal(transactions, 1);
    assert.equal(accepted.headers['set-cookie'], undefined, 'no session or cookie is created');
    // A session cookie sent along is neither read nor refreshed.
    const readsBefore = sessionReads;
    await request(server).post(hook).set({ Cookie: cookie }).send(good).expect(200);
    assert.equal(sessionReads, readsBefore, 'the webhook never touches a session');
    // Forged, tampered, malformed and empty bodies are refused with one constant, non-revealing answer.
    const data = good['data'] as Record<string, unknown>;
    const refusals = [
      { ...good, signature: 'a'.repeat(64) },
      { ...good, data: { ...data, amount: 1 } },
      { ...good, signature: undefined },
      { code: '00', success: true },
      {},
      [],
    ];
    const bodies = new Set<string>();
    for (const body of refusals) {
      const response = await request(server)
        .post(hook)
        .send(body as object)
        .expect(401);
      assert.equal(response.body.code, 'AUTHENTICATION_FAILED');
      bodies.add(JSON.stringify({ ...response.body, requestId: undefined }));
    }
    assert.equal(bodies.size, 1, 'the refusal never says why');
    assert.equal(transactions, 2, 'nothing unauthentic reaches the database');
    // Not JSON: the body is never parsed, so nothing can verify.
    await request(server)
      .post(hook)
      .set('Content-Type', 'text/plain')
      .send(JSON.stringify(good))
      .expect(401);
    // Oversized bodies are refused before any work.
    await request(server)
      .post(hook)
      .send({ ...good, padding: 'x'.repeat(20_000) })
      .expect(400);
    assert.equal(transactions, 2);
    // The exemption is not generic: the same request shape on another route is still refused, the webhook
    // has no other verbs or siblings, and it never reached the staff services.
    await request(server)
      .post(`${base}/invoices/${id}/cancel`)
      .send({ expectedVersion: 1, reason: 'x' })
      .expect(403);
    await request(server).get(hook).expect(404);
    await request(server).post('/api/v1/webhooks/other').send(good).expect(404);
    assert.equal(calls.length, before, 'the webhook calls no staff command');
  } finally {
    await app.close();
  }
});

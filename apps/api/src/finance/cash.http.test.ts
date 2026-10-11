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
import { CashService } from './cash.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 7 Wave A HTTP surface: the session cookie and CSRF are required for every write, only the contract's fields are accepted (an
 * unknown or mistyped one never reaches the service), ids and query values reach the service as given, no write verb other than POST
 * exists, and domain refusals reach the client as stable codes with safe messages.
 */
test('cash HTTP: guards, exact fields, stable codes', async () => {
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
    'overview',
    'goLive',
    'entries',
    'record',
    'reverse',
    'transfer',
    'closings',
    'previewClosing',
    'closeDay',
    'reconcile',
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
    .overrideProvider(CashService)
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
  const base = '/api/v1/cash';
  const fund = randomUUID();
  const other = randomUUID();
  const entry = randomUUID();
  const manual = {
    fundId: fund,
    kind: 'MANUAL_EXPENSE',
    amountVnd: '50000',
    reason: 'Mua nước',
    clientRequestId: randomUUID(),
  };
  const transfer = {
    fromFundId: fund,
    toFundId: other,
    amountVnd: '5000',
    reason: 'Nộp ngân hàng',
    clientRequestId: randomUUID(),
  };
  const closeBody = {
    date: '2026-10-11',
    countedVnd: '1000000',
    withdrawalVnd: '0',
    reason: null,
    clientRequestId: randomUUID(),
  };
  const goLive = {
    branches: [{ branchId: randomUUID(), countedVnd: '1000000' }],
    bankVnd: '2000000',
  };
  try {
    // Reads carry the session token, the ids and the query as given.
    await request(server).get(`${base}/overview`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['overview', token]);
    await request(server)
      .get(
        `${base}/funds/${fund}/entries?from=2026-10-01&to=2026-10-31&category=TIP_IN&direction=IN&page=2`,
      )
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), [
      'entries',
      token,
      fund,
      { from: '2026-10-01', to: '2026-10-31', category: 'TIP_IN', direction: 'IN', page: '2' },
    ]);
    await request(server).get(`${base}/overview`).expect(200);
    assert.equal(calls.at(-1)?.[1], undefined);
    await request(server)
      .get(`${base}/funds/${fund}/closings?page=3`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), ['closings', token, fund, { page: '3' }]);
    await request(server)
      .get(`${base}/reconciliation?branchId=${other}&from=2026-10-01&to=2026-10-31`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), [
      'reconcile',
      token,
      { branchId: other, from: '2026-10-01', to: '2026-10-31' },
    ]);

    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const guarded = calls.length;
    for (const [path, body] of [
      ['go-live', goLive],
      ['entries', manual],
      [`entries/${entry}/reverse`, { reason: 'Nhầm', clientRequestId: randomUUID() }],
      ['transfers', transfer],
      [`funds/${fund}/closing-preview`, { date: '2026-10-11' }],
      [`funds/${fund}/close`, closeBody],
    ] as const) {
      await request(server).post(`${base}/${path}`).set({ Cookie: cookie }).send(body).expect(403);
      await request(server)
        .post(`${base}/${path}`)
        .set({ Cookie: cookie, Origin: environment.webOrigin })
        .send(body)
        .expect(403);
    }
    assert.equal(calls.length, guarded);

    // Good bodies reach the service with exactly the fields sent.
    await request(server).post(`${base}/go-live`).set(headers).send(goLive).expect(200);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![2])), goLive);
    await request(server).post(`${base}/entries`).set(headers).send(manual).expect(200);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![2])), manual);
    const reverse = { reason: 'Nhập nhầm', clientRequestId: randomUUID() };
    await request(server)
      .post(`${base}/entries/${entry}/reverse`)
      .set(headers)
      .send(reverse)
      .expect(200);
    assert.deepEqual(calls.at(-1)?.[2], entry);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![3])), reverse);
    await request(server).post(`${base}/transfers`).set(headers).send(transfer).expect(200);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![2])), transfer);
    await request(server)
      .post(`${base}/funds/${fund}/closing-preview`)
      .set(headers)
      .send({ date: '2026-10-11' })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.[2], fund);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![3])), { date: '2026-10-11' });
    await request(server)
      .post(`${base}/funds/${fund}/close`)
      .set(headers)
      .send(closeBody)
      .expect(200);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![3])), closeBody);

    // Only the contract's fields, with the right types: nothing else reaches the service.
    const refused = calls.length;
    for (const [path, body] of [
      ['go-live', { ...goLive, extra: 1 }],
      ['go-live', { ...goLive, bankVnd: 2000000 }],
      ['go-live', { branches: 'all', bankVnd: '1' }],
      ['go-live', { branches: [{ branchId: 'x', countedVnd: '1', extra: true }], bankVnd: '1' }],
      ['entries', { ...manual, extra: 1 }],
      ['entries', { ...manual, kind: 'SALE_CASH' }],
      ['entries', { ...manual, amountVnd: 50000 }],
      ['entries', { ...manual, reason: undefined }],
      ['entries', { ...manual, direction: 'IN' }],
      [`entries/${entry}/reverse`, { reason: 'x' }],
      [`entries/${entry}/reverse`, { ...reverse, amountVnd: '1' }],
      ['transfers', { ...transfer, extra: 1 }],
      ['transfers', { ...transfer, amountVnd: 5000 }],
      [`funds/${fund}/closing-preview`, { date: '2026-10-11', extra: 1 }],
      [`funds/${fund}/closing-preview`, {}],
      [`funds/${fund}/close`, { ...closeBody, extra: 1 }],
      [`funds/${fund}/close`, { ...closeBody, countedVnd: 1000000 }],
      [`funds/${fund}/close`, { ...closeBody, reason: 5 }],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, refused, 'nothing reached the service');

    // No write verb other than POST exists; the book has no edit and no delete.
    for (const method of ['put', 'patch', 'delete'] as const) {
      for (const path of [
        'entries',
        `entries/${entry}`,
        `funds/${fund}/entries`,
        'go-live',
        'transfers',
      ]) {
        await request(server)[method](`${base}/${path}`).set(headers).send({}).expect(404);
      }
    }

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['REAUTHENTICATION_REQUIRED', 403],
      ['NOT_FOUND', 404],
      ['VALIDATION_FAILED', 400],
      ['FINANCE_NOT_LIVE', 409],
      ['FINANCE_ALREADY_LIVE', 409],
      ['CASH_OPENING_INVALID', 422],
      ['CASH_INSUFFICIENT', 409],
      ['CASH_DAY_CLOSED', 409],
      ['CASH_UNPOSTED', 409],
      ['CASH_ENTRY_NOT_REVERSIBLE', 409],
      ['CONFLICT', 409],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get(`${base}/overview`)
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|SQL|constraint|fund_entries/i);
    }
  } finally {
    await app.close();
  }
});

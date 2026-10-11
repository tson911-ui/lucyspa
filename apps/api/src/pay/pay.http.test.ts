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
import { PayService } from '../pay/pay.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 7 Wave B pay configuration HTTP surface: the session cookie and CSRF are required for every write, only the contract's fields
 * are accepted, ids and query values reach the service as given, no write verb other than POST exists, and domain refusals reach the
 * client as stable codes with safe messages.
 */
test('pay HTTP: guards, exact fields, stable codes', async () => {
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
    'tourRules',
    'tourHistory',
    'addTourRule',
    'commissionRules',
    'commissionProducts',
    'addCommissionRule',
    'salaries',
    'salaryHistory',
    'addSalaryVersion',
    'invoiceEarnings',
    'correctSeller',
    'invoiceTips',
    'reverseTip',
    'staffCodes',
    'createStaffCode',
    'resetStaffCode',
    'payRuns',
    'payRun',
    'createPayRun',
    'refreshPayRun',
    'setPayRunPaymentDay',
    'addPayRunItem',
    'voidPayRunItem',
    'advances',
    'requestAdvance',
    'approveAdvance',
    'cancelAdvance',
    'payAdvance',
    'writeOffAdvance',
    'closePayRun',
    'payslips',
    'payslip',
    'payPayslips',
    'reversePayslip',
    'myPayslips',
    'myPayslip',
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
    .overrideProvider(PayService)
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
  const base = '/api/v1/pay';
  const service = randomUUID();
  const employee = randomUUID();
  const tour = {
    serviceId: service,
    amountVnd: '15000',
    effectiveFrom: '2026-10-11',
    reason: null,
  };
  const commission = {
    scope: 'BRAND',
    targetId: randomUUID(),
    employeeUserId: null,
    kind: 'PERCENT',
    value: '500',
    effectiveFrom: '2026-10-11',
    reason: 'Hãng này',
  };
  const salary = {
    employeeUserId: employee,
    amountVnd: '8000000',
    effectiveFrom: '2026-10-11',
    reason: null,
  };
  const json = (value: unknown) => JSON.parse(JSON.stringify(value));
  try {
    for (const [path, name, extra] of [
      ['tour-rules', 'tourRules', []],
      [`tour-rules/${service}/history`, 'tourHistory', [service]],
      ['commission-rules', 'commissionRules', []],
      ['commission-rules/products?q=son', 'commissionProducts', ['son']],
      ['salaries', 'salaries', []],
      [`invoices/${service}/earnings`, 'invoiceEarnings', [service]],
      [`invoices/${service}/tips`, 'invoiceTips', [service]],
      ['referral-codes', 'staffCodes', []],
      ['runs', 'payRuns', []],
      ['advances', 'advances', []],
      [`runs/${service}/payslips`, 'payslips', [service]],
      [`payslips/${service}`, 'payslip', [service]],
      [`runs/${service}`, 'payRun', [service]],
      [`salaries/${employee}/history`, 'salaryHistory', [employee]],
    ] as const) {
      await request(server).get(`${base}/${path}`).set({ Cookie: cookie }).expect(200);
      assert.equal(calls.at(-1)?.[0], name);
      assert.equal(calls.at(-1)?.[1], token);
      assert.deepEqual(calls.at(-1)?.slice(2), extra);
    }
    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const guarded = calls.length;
    for (const [path, body] of [
      ['tour-rules', tour],
      ['commission-rules', commission],
      ['salaries', salary],
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
    for (const [path, body, name] of [
      ['tour-rules', tour, 'addTourRule'],
      ['commission-rules', commission, 'addCommissionRule'],
      ['salaries', salary, 'addSalaryVersion'],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(200);
      assert.equal(calls.at(-1)?.[0], name);
      assert.deepEqual(json(calls.at(-1)![2]), body);
    }
    const seller = { employeeUserId: employee, reason: 'Nhập nhầm người bán' };
    await request(server)
      .post(`${base}/product-lines/${service}/seller`)
      .set({ Cookie: cookie })
      .send(seller)
      .expect(403);
    await request(server)
      .post(`${base}/product-lines/${service}/seller`)
      .set(headers)
      .send(seller)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'correctSeller');
    assert.equal(calls.at(-1)?.[2], service);
    assert.deepEqual(json(calls.at(-1)![3]), seller);
    for (const body of [
      { ...seller, extra: 1 },
      { employeeUserId: employee },
      { ...seller, reason: 5 },
    ]) {
      const before = calls.length;
      await request(server)
        .post(`${base}/product-lines/${service}/seller`)
        .set(headers)
        .send(body)
        .expect(400);
      assert.equal(calls.length, before);
    }
    // P7-17: staff cannot record a tip any more; the route is gone.
    await request(server)
      .post(`${base}/tips`)
      .set(headers)
      .send({ invoiceId: service, employeeUserId: employee, amountVnd: '50000' })
      .expect(404);
    const reverse = { reason: 'Ghi nhầm', clientRequestId: '11111111-1111-4111-8111-111111111111' };
    await request(server)
      .post(`${base}/tips/${service}/reverse`)
      .set(headers)
      .send(reverse)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'reverseTip');
    assert.equal(calls.at(-1)?.[2], service);
    assert.deepEqual(json(calls.at(-1)![3]), reverse);
    for (const [path, body] of [
      [`tips/${service}/reverse`, { ...reverse, extra: 1 }],
      [`tips/${service}/reverse`, { reason: 'x' }],
    ] as const) {
      const before = calls.length;
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
      assert.equal(calls.length, before);
    }
    const codeBody = { employeeUserId: employee };
    await request(server)
      .post(`${base}/referral-codes`)
      .set({ Cookie: cookie })
      .send(codeBody)
      .expect(403);
    await request(server).post(`${base}/referral-codes`).set(headers).send(codeBody).expect(200);
    assert.equal(calls.at(-1)?.[0], 'createStaffCode');
    assert.deepEqual(json(calls.at(-1)![2]), codeBody);
    const resetBody = { reason: 'Lộ mã' };
    await request(server)
      .post(`${base}/referral-codes/${employee}/reset`)
      .set(headers)
      .send(resetBody)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'resetStaffCode');
    assert.equal(calls.at(-1)?.[2], employee);
    assert.deepEqual(json(calls.at(-1)![3]), resetBody);
    for (const [path, body] of [
      ['referral-codes', { ...codeBody, extra: 1 }],
      ['referral-codes', {}],
      [`referral-codes/${employee}/reset`, { ...resetBody, extra: 1 }],
      [`referral-codes/${employee}/reset`, {}],
    ] as const) {
      const before = calls.length;
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
      assert.equal(calls.length, before);
    }
    // Payroll runs: every write needs the Origin and CSRF headers and the exact contract fields.
    const run = { month: '2026-10' };
    await request(server).post(`${base}/runs`).set({ Cookie: cookie }).send(run).expect(403);
    await request(server).post(`${base}/runs`).set(headers).send(run).expect(200);
    assert.equal(calls.at(-1)?.[0], 'createPayRun');
    assert.deepEqual(json(calls.at(-1)![2]), run);
    const refresh = { expectedVersion: 3 };
    await request(server)
      .post(`${base}/runs/${service}/refresh`)
      .set(headers)
      .send(refresh)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'refreshPayRun');
    assert.equal(calls.at(-1)?.[2], service);
    const day = { expectedVersion: 3, paymentDay: '2026-11-05' };
    await request(server)
      .post(`${base}/runs/${service}/payment-day`)
      .set(headers)
      .send(day)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'setPayRunPaymentDay');
    assert.deepEqual(json(calls.at(-1)![3]), day);
    const itemBody = {
      employeeUserId: employee,
      kind: 'BONUS',
      amountVnd: '100000',
      reason: 'Thưởng',
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    };
    await request(server)
      .post(`${base}/runs/${service}/items`)
      .set(headers)
      .send(itemBody)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'addPayRunItem');
    assert.deepEqual(json(calls.at(-1)![3]), itemBody);
    const voidBody = { expectedVersion: 4, reason: 'Nhập nhầm' };
    await request(server)
      .post(`${base}/runs/${service}/items/${employee}/void`)
      .set(headers)
      .send(voidBody)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'voidPayRunItem');
    assert.equal(calls.at(-1)?.[3], employee);
    for (const [path, body] of [
      ['runs', { ...run, extra: 1 }],
      ['runs', {}],
      [`runs/${service}/refresh`, { expectedVersion: '3' }],
      [`runs/${service}/refresh`, { ...refresh, extra: 1 }],
      [`runs/${service}/payment-day`, { expectedVersion: 3 }],
      [`runs/${service}/items`, { ...itemBody, amountVnd: 1000 }],
      [`runs/${service}/items`, { ...itemBody, extra: 1 }],
      [`runs/${service}/items/${employee}/void`, { reason: 'x' }],
    ] as const) {
      const before = calls.length;
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
      assert.equal(calls.length, before);
    }
    // Salary advances: exact fields on every write.
    const advance = {
      employeeUserId: employee,
      amountVnd: '1000000',
      reason: 'Việc gấp',
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    };
    await request(server)
      .post(`${base}/advances`)
      .set({ Cookie: cookie })
      .send(advance)
      .expect(403);
    await request(server).post(`${base}/advances`).set(headers).send(advance).expect(200);
    assert.equal(calls.at(-1)?.[0], 'requestAdvance');
    assert.deepEqual(json(calls.at(-1)![2]), advance);
    await request(server)
      .post(`${base}/advances/${service}/approve`)
      .set(headers)
      .send({ expectedVersion: 1 })
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'approveAdvance');
    assert.equal(calls.at(-1)?.[2], service);
    const cancel = { expectedVersion: 1, reason: 'Hủy' };
    await request(server)
      .post(`${base}/advances/${service}/cancel`)
      .set(headers)
      .send(cancel)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'cancelAdvance');
    const payBody = {
      expectedVersion: 2,
      fundId: service,
      clientRequestId: advance.clientRequestId,
    };
    await request(server)
      .post(`${base}/advances/${service}/pay`)
      .set(headers)
      .send(payBody)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'payAdvance');
    assert.deepEqual(json(calls.at(-1)![3]), payBody);
    const writeOff = { expectedVersion: 3, reason: 'Không thu được' };
    await request(server)
      .post(`${base}/advances/${service}/write-off`)
      .set(headers)
      .send(writeOff)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'writeOffAdvance');
    for (const [path, body] of [
      ['advances', { ...advance, extra: 1 }],
      ['advances', { ...advance, amountVnd: 1000000 }],
      [`advances/${service}/approve`, {}],
      [`advances/${service}/approve`, { expectedVersion: 1, extra: 1 }],
      [`advances/${service}/cancel`, { expectedVersion: 1 }],
      [`advances/${service}/pay`, { expectedVersion: 1, fundId: service }],
      [`advances/${service}/write-off`, { reason: 'x' }],
    ] as const) {
      const before = calls.length;
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
      assert.equal(calls.length, before);
    }
    // Closing, paying and reversing: exact fields on every write.
    await request(server)
      .post(`${base}/runs/${service}/close`)
      .set({ Cookie: cookie })
      .send({ expectedVersion: 4 })
      .expect(403);
    await request(server)
      .post(`${base}/runs/${service}/close`)
      .set(headers)
      .send({ expectedVersion: 4 })
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'closePayRun');
    assert.equal(calls.at(-1)?.[2], service);
    const payRun = {
      expectedVersion: 5,
      fundId: service,
      payslipIds: null,
      clientRequestId: '11111111-1111-4111-8111-111111111111',
    };
    await request(server).post(`${base}/runs/${service}/pay`).set(headers).send(payRun).expect(200);
    assert.equal(calls.at(-1)?.[0], 'payPayslips');
    assert.deepEqual(json(calls.at(-1)![3]), payRun);
    await request(server)
      .post(`${base}/runs/${service}/pay`)
      .set(headers)
      .send({ ...payRun, payslipIds: [service] })
      .expect(200);
    const slipReverse = { expectedVersion: 2, reason: 'Chuyển nhầm' };
    await request(server)
      .post(`${base}/payslips/${service}/reverse`)
      .set(headers)
      .send(slipReverse)
      .expect(200);
    assert.equal(calls.at(-1)?.[0], 'reversePayslip');
    assert.deepEqual(json(calls.at(-1)![3]), slipReverse);
    for (const [path, body] of [
      [`runs/${service}/close`, {}],
      [`runs/${service}/close`, { expectedVersion: 4, extra: 1 }],
      [`runs/${service}/pay`, { ...payRun, payslipIds: 'all' }],
      [
        `runs/${service}/pay`,
        { expectedVersion: 5, fundId: service, clientRequestId: payRun.clientRequestId },
      ],
      [`runs/${service}/pay`, { ...payRun, extra: 1 }],
      [`payslips/${service}/reverse`, { expectedVersion: 2 }],
    ] as const) {
      const before = calls.length;
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
      assert.equal(calls.length, before);
    }
    // An employee's own payslips are read without a pay permission.
    await request(server).get('/api/v1/me/payslips').set({ Cookie: cookie }).expect(200);
    assert.equal(calls.at(-1)?.[0], 'myPayslips');
    await request(server).get(`/api/v1/me/payslips/${service}`).set({ Cookie: cookie }).expect(200);
    assert.equal(calls.at(-1)?.[0], 'myPayslip');
    assert.equal(calls.at(-1)?.[2], service);
    // Only the contract's fields, with the right types.
    const refused = calls.length;
    for (const [path, body] of [
      ['tour-rules', { ...tour, extra: 1 }],
      ['tour-rules', { ...tour, amountVnd: 15000 }],
      ['tour-rules', { ...tour, reason: undefined }],
      ['tour-rules', { serviceId: service }],
      ['commission-rules', { ...commission, extra: true }],
      ['commission-rules', { ...commission, value: 500 }],
      ['commission-rules', { ...commission, targetId: 5 }],
      ['commission-rules', { ...commission, employeeUserId: undefined }],
      ['salaries', { ...salary, extra: 1 }],
      ['salaries', { ...salary, amountVnd: 8000000 }],
      ['salaries', { ...salary, effectiveFrom: 20261011 }],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, refused, 'nothing reached the service');
    // No write verb other than POST exists: rules and salaries are history.
    for (const method of ['put', 'patch', 'delete'] as const) {
      for (const path of [
        'tour-rules',
        `tour-rules/${service}`,
        'commission-rules',
        'salaries',
        `salaries/${employee}`,
      ]) {
        await request(server)[method](`${base}/${path}`).set(headers).send({}).expect(404);
      }
    }
    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['NOT_FOUND', 404],
      ['VALIDATION_FAILED', 400],
      ['PAY_VERSION_EXISTS', 409],
      ['CONFLICT', 409],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get(`${base}/tour-rules`)
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|SQL|constraint|tour_rules/i);
    }
  } finally {
    await app.close();
  }
});

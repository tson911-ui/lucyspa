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

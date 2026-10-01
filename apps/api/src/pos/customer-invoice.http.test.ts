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
import { CustomerInvoiceService } from './customer-invoice.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('customer invoice HTTP: read only, session identity, no browser-chosen customer, stable codes', async () => {
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
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return outcome ? Promise.reject(outcome) : Promise.resolve({ ok: name });
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
    .overrideProvider(CustomerInvoiceService)
    .useValue({ list: answer('list'), detail: answer('detail') })
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
  try {
    // Without a cookie the service receives no token (it answers AUTHENTICATION_REQUIRED itself).
    await request(server).get('/api/v1/me/invoices').expect(200);
    assert.deepEqual(calls.at(-1), ['list', undefined, undefined]);

    // The session token is the only identity handed to the service.
    const listed = await request(server)
      .get('/api/v1/me/invoices')
      .set({ Cookie: cookie })
      .expect(200);
    assert.equal(listed.headers['cache-control'], 'no-store');
    assert.deepEqual(calls.at(-1), ['list', token, undefined]);
    const cursor = randomUUID();
    await request(server)
      .get('/api/v1/me/invoices')
      .query({ cursor })
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), ['list', token, cursor]);
    const id = randomUUID();
    await request(server).get(`/api/v1/me/invoices/${id}`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1), ['detail', token, id]);

    // A customer, payer, branch or status chosen by the browser is rejected, never passed on.
    const before = calls.length;
    for (const extra of [
      { customerId: randomUUID() },
      { payerUserId: randomUUID() },
      { userId: randomUUID() },
      { branchId: randomUUID() },
      { status: 'PAID' },
    ]) {
      await request(server)
        .get('/api/v1/me/invoices')
        .query(extra)
        .set({ Cookie: cookie })
        .expect(400);
    }
    assert.equal(calls.length, before, 'nothing reached the service');

    // Read only: no write verb exists on the customer invoice routes.
    for (const path of ['/api/v1/me/invoices', `/api/v1/me/invoices/${id}`]) {
      for (const method of ['post', 'put', 'patch', 'delete'] as const) {
        await request(server)[method](path).set(headers).send({}).expect(404);
      }
    }
    assert.equal(calls.length, before);

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['NOT_FOUND', 404],
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['VALIDATION_FAILED', 400],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get(`/api/v1/me/invoices/${id}`)
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|payer_user_id|SQL/i);
    }
  } finally {
    await app.close();
  }
});

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
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 8 HTTP surface: every report is a GET that carries the session and the query as given; the one POST (the file) needs the Origin and
 * the CSRF token, accepts only the contract's fields, and answers with a download that is never cached; no other write verb exists.
 */
test('reports HTTP: GET reads, one guarded POST for the file, exact fields, no other write verb', async () => {
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
  const answer =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return Promise.resolve({ ok: name });
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
    .overrideProvider(ReportsService)
    .useValue(
      Object.fromEntries(['registry', 'revenue', 'refunds'].map((name) => [name, answer(name)])),
    )
    .overrideProvider(ReportExportService)
    .useValue({
      export: (...args: unknown[]) => {
        calls.push(['export', ...args]);
        return Promise.resolve({
          filename: 'lucyspa_refunds_2026-10-01_2026-10-12.xlsx',
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          bytes: new Uint8Array([0x50, 0x4b, 3, 4]),
          rows: 7,
        });
      },
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
  const base = '/api/v1/reports';
  const branch = randomUUID();
  const body = {
    report: 'revenue-overview',
    format: 'xlsx',
    from: '2026-10-01',
    to: '2026-10-12',
    branchId: branch,
    bucket: 'week',
    compare: 'previous',
    locale: 'vi',
  };
  try {
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['registry', token]);
    await request(server).get(base).expect(200);
    assert.equal(calls.at(-1)?.[1], undefined);
    await request(server)
      .get(
        `${base}/revenue?from=2026-10-01&to=2026-10-12&branchId=${branch}&bucket=week&compare=previous`,
      )
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), [
      'revenue',
      token,
      {
        from: '2026-10-01',
        to: '2026-10-12',
        branchId: branch,
        bucket: 'week',
        compare: 'previous',
      },
    ]);
    await request(server)
      .get(`${base}/refunds?from=2026-10-01&to=2026-10-12&page=2`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), [
      'refunds',
      token,
      { from: '2026-10-01', to: '2026-10-12', branchId: undefined, page: '2' },
    ]);

    // The file: Origin and CSRF are required; nothing reaches the service without them.
    const guarded = calls.length;
    await request(server).post(`${base}/export`).set({ Cookie: cookie }).send(body).expect(403);
    await request(server)
      .post(`${base}/export`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send(body)
      .expect(403);
    assert.equal(calls.length, guarded);

    const response = await request(server)
      .post(`${base}/export`)
      .set(headers)
      .send(body)
      .expect(200);
    assert.deepEqual(JSON.parse(JSON.stringify(calls.at(-1)![2])), body);
    assert.equal(calls.at(-1)?.[1], token);
    assert.match(response.headers['content-type'] ?? '', /spreadsheetml\.sheet/);
    assert.equal(
      response.headers['content-disposition'],
      'attachment; filename="lucyspa_refunds_2026-10-01_2026-10-12.xlsx"',
    );
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['x-content-type-options'], 'nosniff');
    assert.equal(response.headers['x-report-rows'], '7');

    // Only the contract's fields, with the right types and values.
    const refused = calls.length;
    for (const bad of [
      { ...body, extra: 1 },
      { ...body, format: 'pdf' },
      { ...body, format: undefined },
      { ...body, report: undefined },
      { ...body, report: 5 },
      { ...body, locale: 'fr' },
      { ...body, from: 20261001 },
      { ...body, maxRows: 9_999_999 },
    ]) {
      await request(server).post(`${base}/export`).set(headers).send(bad).expect(400);
    }
    assert.equal(calls.length, refused, 'nothing reached the service');

    // No other write verb exists on the report area.
    for (const method of ['put', 'patch', 'delete'] as const) {
      for (const path of ['', '/revenue', '/refunds', '/export']) {
        await request(server)[method](`${base}${path}`).set(headers).send({}).expect(404);
      }
    }
    await request(server).post(`${base}/revenue`).set(headers).send({}).expect(404);
    await request(server).get(`${base}/export`).set(headers).expect(404);
  } finally {
    await app.close();
  }
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { WEBSITE_PAGE_LIMITS } from '@lucy-spa/contracts';
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
import { PageService } from './page.service.js';
import { PublicWebsiteService } from './popup.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('information pages HTTP: strict JSON, CSRF on every write, the largest save fits, public reads need only a language', async () => {
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
  const calls: { action: string; args: unknown[] }[] = [];
  let outcome: AuthError | null = null;
  const page = { id: randomUUID(), slug: 'chinh-sach-bao-mat' };
  const admin =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve(page);
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
    .overrideProvider(PageService)
    .useValue({
      list: admin('list'),
      get: admin('get'),
      create: admin('create'),
      update: admin('update'),
      setPublished: admin('setPublished'),
    })
    .overrideProvider(PublicWebsiteService)
    .useValue({
      page: (locale: string, slug: string) => {
        calls.push({ action: 'public-page', args: [locale, slug] });
        return outcome ? Promise.reject(outcome) : Promise.resolve({ slug, title: 'Tiêu đề' });
      },
      pageIndex: () => {
        calls.push({ action: 'public-index', args: [] });
        return Promise.resolve({ items: [] });
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
  const id = randomUUID();
  const base = '/api/v1/website/pages';
  const body = {
    slug: 'chinh-sach-bao-mat',
    role: 'PRIVACY',
    titleVi: 'Chính sách bảo mật',
    titleEn: null,
    bodyVi: '## Dữ liệu\n\nChúng tôi giữ dữ liệu của bạn an toàn.',
    bodyEn: null,
    seoTitleVi: null,
    seoTitleEn: null,
    seoDescriptionVi: null,
    seoDescriptionEn: null,
    isPublished: false,
  };
  try {
    // Every write needs Origin, session and CSRF like the rest of the API.
    await request(server)
      .post(base)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send(body)
      .expect(403);
    await request(server)
      .post(base)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    await request(server)
      .post(`${base}/${id}/publish`)
      .set({ Origin: headers.Origin, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .send({ expectedVersion: 1, isPublished: true })
      .expect(403);
    assert.equal(calls.length, 0);

    // A valid save reaches the service with exactly the declared fields.
    await request(server).post(base).set(headers).send(body).expect(200);
    assert.deepEqual({ ...(calls.pop()?.args[0] as object) }, body);
    await request(server)
      .post(`${base}/${id}/update`)
      .set(headers)
      .send({ ...body, expectedVersion: 4 })
      .expect(200);
    assert.deepEqual({ ...(calls.pop()?.args[1] as object) }, { ...body, expectedVersion: 4 });
    await request(server)
      .post(`${base}/${id}/publish`)
      .set(headers)
      .send({ expectedVersion: 4, isPublished: true })
      .expect(200);
    assert.deepEqual(
      { ...(calls.pop()?.args[1] as object) },
      { expectedVersion: 4, isPublished: true },
    );
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    await request(server).get(`${base}/${id}`).set({ Cookie: cookie }).expect(200);
    calls.length = 0;

    // Strict JSON: missing, unknown, mistyped and oversized fields never reach the service. There is no delete.
    const strict: unknown[] = [
      {},
      { ...body, isPublished: 'yes' },
      { ...body, isPublished: undefined },
      { ...body, role: 'ADMIN' },
      { ...body, role: undefined },
      { ...body, titleVi: 5 },
      { ...body, titleVi: undefined },
      { ...body, bodyVi: undefined },
      { ...body, bodyVi: 'a'.repeat(14_001) },
      { ...body, seoDescriptionVi: 'a'.repeat(801) },
      { ...body, slug: 'a'.repeat(121) },
      { ...body, extra: 1 },
      { ...body, createdByUserId: randomUUID() },
    ];
    for (const bad of strict) {
      await request(server)
        .post(base)
        .set(headers)
        .send(bad as object)
        .expect(400);
    }
    for (const bad of [{ ...body, expectedVersion: 0 }, { ...body, expectedVersion: '1' }, body]) {
      await request(server).post(`${base}/${id}/update`).set(headers).send(bad).expect(400);
    }
    await request(server)
      .post(`${base}/${id}/publish`)
      .set(headers)
      .send({ expectedVersion: 1 })
      .expect(400);
    await request(server).post(`${base}/${id}/delete`).set(headers).send({}).expect(404);
    await request(server).delete(`${base}/${id}`).set(headers).send({}).expect(404);
    assert.equal(calls.length, 0);

    // The largest save (a Vietnamese and an English body of the most letters, each letter 3 bytes) is under the API's JSON limit.
    const largest = 'ế'.repeat(WEBSITE_PAGE_LIMITS.body);
    const bytes = JSON.stringify({ ...body, bodyVi: largest, bodyEn: largest }).length;
    assert.ok(
      Buffer.byteLength(JSON.stringify({ ...body, bodyVi: largest, bodyEn: largest })) > 70_000,
    );
    assert.ok(bytes > 0);
    await request(server)
      .post(base)
      .set(headers)
      .send({ ...body, bodyVi: largest, bodyEn: largest })
      .expect(200);
    assert.equal(calls.pop()?.action, 'create');

    // Domain outcomes reach the client as stable codes.
    for (const [code, status, field] of [
      ['FORBIDDEN', 403, undefined],
      ['CONFLICT', 409, 'slug'],
      ['PAGE_ROLE_TAKEN', 409, id],
      ['VALIDATION_FAILED', 400, 'bodyVi'],
      ['NOT_FOUND', 404, undefined],
    ] as const) {
      outcome = new AuthError(code, field);
      const failed = await request(server).post(base).set(headers).send(body).expect(status);
      assert.equal(failed.body.code, code);
      if (field) assert.match(String(failed.body.message), new RegExp(`: ${field}$`));
    }
    outcome = null;
    calls.length = 0;

    // Public reads: anonymous, a language is required, the answer may be kept for a minute.
    const read = await request(server)
      .get('/api/v1/public/pages/gioi-thieu')
      .query({ locale: 'en' })
      .expect(200);
    assert.equal(read.headers['cache-control'], 'public, max-age=60');
    assert.deepEqual(calls.pop()?.args, ['en', 'gioi-thieu']);
    await request(server).get('/api/v1/public/pages/gioi-thieu').expect(400);
    await request(server)
      .get('/api/v1/public/pages/gioi-thieu')
      .query({ locale: 'fr' })
      .expect(400);
    const index = await request(server).get('/api/v1/public/pages').expect(200);
    assert.equal(index.headers['cache-control'], 'public, max-age=60');
    outcome = new AuthError('NOT_FOUND');
    await request(server).get('/api/v1/public/pages/nhap').query({ locale: 'vi' }).expect(404);
    // Nothing writes through the public route.
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      await request(server)
        [method]('/api/v1/public/pages/gioi-thieu')
        .set(headers)
        .send({})
        .expect(404);
    }
  } finally {
    await app.close();
  }
});

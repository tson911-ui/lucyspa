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
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { PublicWebsiteService } from './popup.service.js';
import { ShopInfoService } from './shop-info.service.js';

// UX/UI Part 2 (P2-2) transport contract: strict JSON for the admin shop info route (Origin + CSRF like every mutation)
// and anonymous, cookie-free, cached public reads for the site profile and the service catalogue.
test('shop info HTTP: strict admin body, CSRF/Origin, anonymous cached public site and catalogue', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'https://spa.example',
    MEDIA_STORAGE_DIR: '/var/lib/lucy-spa/media',
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
      return outcome ? Promise.reject(outcome) : Promise.resolve({ rowVersion: 2 });
    };
  const reply =
    (action: string, value: unknown) =>
    (...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve(value);
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
    .overrideProvider(ShopInfoService)
    .useValue({ get: answer('get'), update: answer('update') })
    .overrideProvider(PublicWebsiteService)
    .useValue({
      site: reply('public-site', { tagline: 'Thư Giãn Tận Tâm', hours: [] }),
      services: reply('public-services', { groups: [] }),
      serviceDetail: reply('public-service', { service: { code: 'GOI_THUONG' } }),
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
  const base = '/api/v1/website/shop-info';
  const body = {
    taglineVi: 'Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc',
    taglineEn: 'Heartfelt Relaxation – Elevated Beauty',
    introVi: null,
    introEn: null,
    address: '04 Nguyễn Quang Bích, Đà Nẵng',
    hotline: '0934 936 101',
    mapUrl: null,
    hoursBranchId: null,
    heroMediaId: null,
    factsVisible: true,
    facts: [{ id: 'hours', kind: 'HOURS', visible: true, icon: null, textVi: null, textEn: null }],
    featuredGroups: [{ code: 'NAIL', descriptionVi: 'Móng gọn gàng', descriptionEn: null }],
    whyVisible: false,
    whyTitleVi: null,
    whyTitleEn: null,
    whyCards: [],
    expectedVersion: 1,
  };
  try {
    // The mutation needs Origin, session and CSRF like every other route.
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
    assert.equal(calls.length, 0);

    await request(server).post(base).set(headers).send(body).expect(200);
    assert.deepEqual({ ...(calls.pop()?.args[0] as object) }, body);

    // Strict JSON: missing, unknown, mistyped and oversized fields never reach the service.
    const strict: unknown[] = [
      {},
      { ...body, expectedVersion: 0 },
      { ...body, expectedVersion: 1.5 },
      { ...body, expectedVersion: undefined },
      { ...body, taglineVi: 5 },
      { ...body, taglineVi: undefined },
      { ...body, introVi: 7 },
      { ...body, introEn: undefined },
      { ...body, introVi: 'x'.repeat(1_201) },
      { ...body, hotline: undefined },
      { ...body, mapUrl: 7 },
      { ...body, mapUrl: undefined },
      { ...body, heroMediaId: 'x'.repeat(37) },
      { ...body, factsVisible: undefined },
      { ...body, factsVisible: 'yes' },
      { ...body, facts: undefined },
      { ...body, facts: 'hours' },
      { ...body, facts: Array.from({ length: 33 }, () => ({})) },
      { ...body, featuredGroups: undefined },
      { ...body, featuredGroups: null },
      { ...body, whyVisible: undefined },
      { ...body, whyTitleVi: 5 },
      { ...body, whyTitleEn: undefined },
      { ...body, whyCards: undefined },
      { ...body, whyCards: 'cards' },
      { ...body, extra: 1 },
      { ...body, address: 'a'.repeat(1_201) },
    ];
    for (const bad of strict) {
      await request(server)
        .post(base)
        .set(headers)
        .send(bad as object)
        .expect(400);
    }
    assert.equal(calls.length, 0);

    // Typed domain errors reach the client verbatim.
    outcome = new AuthError('CONFLICT');
    assert.equal(
      (await request(server).post(base).set(headers).send(body).expect(409)).body.code,
      'CONFLICT',
    );
    outcome = new AuthError('MEDIA_ALT_REQUIRED', 'heroMediaId');
    assert.equal(
      (await request(server).post(base).set(headers).send(body).expect(409)).body.code,
      'MEDIA_ALT_REQUIRED',
    );
    outcome = null;
    calls.length = 0;

    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    assert.equal(calls.pop()?.action, 'get');

    // Public reads: no session, a known locale only, cached for 60 seconds, cookie-free.
    for (const path of [
      '/api/v1/public/site',
      '/api/v1/public/services',
      '/api/v1/public/services/GOI_THUONG',
    ]) {
      await request(server).get(path).expect(400);
      await request(server).get(`${path}?locale=fr`).expect(400);
    }
    assert.equal(calls.length, 0);
    const site = await request(server).get('/api/v1/public/site?locale=vi').expect(200);
    assert.equal(site.body.tagline, 'Thư Giãn Tận Tâm');
    assert.equal(site.headers['cache-control'], 'public, max-age=60');
    assert.equal(site.headers.vary?.includes('Accept-Encoding'), true);
    assert.equal(site.headers['set-cookie'], undefined, 'anonymous and cookie-free');
    assert.deepEqual(calls.pop()?.args, ['vi']);
    const services = await request(server).get('/api/v1/public/services?locale=en').expect(200);
    assert.deepEqual(services.body, { groups: [] });
    assert.equal(services.headers['cache-control'], 'public, max-age=60');
    assert.deepEqual(calls.pop()?.args, ['en']);
    const detail = await request(server)
      .get('/api/v1/public/services/GOI_THUONG?locale=vi')
      .expect(200);
    assert.equal(detail.body.service.code, 'GOI_THUONG');
    assert.deepEqual(calls.pop()?.args, ['vi', 'GOI_THUONG']);
    outcome = new AuthError('NOT_FOUND');
    await request(server).get('/api/v1/public/services/NOPE?locale=vi').expect(404);
  } finally {
    await app.close();
  }
});

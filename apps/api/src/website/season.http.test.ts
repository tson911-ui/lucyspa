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
import { PopupService, PublicWebsiteService } from './popup.service.js';
import { SeasonService } from './season.service.js';
import { SlideService } from './slide.service.js';

// UX/UI Step S3 transport contract: strict JSON for the admin season routes (Origin + CSRF as every mutation),
// an anonymous cookie-free public season with the right cache headers, safe typed errors, and the optional
// `seasonId` on the popup and slide bodies.
test('season HTTP: strict admin bodies, CSRF/Origin, anonymous public season, seasonId on popups and slides', async () => {
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
  let live: object | null = null;
  const answer =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve({ id: randomUUID() });
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
    .overrideProvider(SeasonService)
    .useValue({
      list: answer('list'),
      get: answer('get'),
      create: answer('create'),
      update: answer('update'),
      setEnabled: answer('setEnabled'),
      remove: answer('remove'),
    })
    .overrideProvider(PopupService)
    .useValue({ create: answer('popup-create'), update: answer('popup-update') })
    .overrideProvider(SlideService)
    .useValue({ create: answer('slide-create'), update: answer('slide-update') })
    .overrideProvider(PublicWebsiteService)
    .useValue({
      season: (locale: string) => {
        calls.push({ action: 'public-season', args: [locale] });
        return outcome ? Promise.reject(outcome) : Promise.resolve(live);
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
  const base = '/api/v1/website/seasons';
  const body = {
    presetKey: 'tet',
    label: 'Tết 2090',
    startsAt: '2090-01-01T00:00:00.000Z',
    endsAt: '2090-01-08T00:00:00.000Z',
    greetingVi: 'Chúc mừng năm mới',
    greetingEn: null,
    applyCustomer: true,
    applyAdmin: true,
    particlesEnabled: true,
    isEnabled: false,
  };
  try {
    // Mutations need Origin, session and CSRF like every other route.
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
      .post(`${base}/${id}/delete`)
      .set({ Origin: headers.Origin, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .send({})
      .expect(403);
    assert.equal(calls.length, 0);

    // A valid create reaches the service with exactly the declared fields.
    await request(server).post(base).set(headers).send(body).expect(200);
    assert.deepEqual({ ...(calls.pop()?.args[0] as object) }, body);
    await request(server)
      .post(`${base}/${id}/update`)
      .set(headers)
      .send({ ...body, expectedVersion: 3 })
      .expect(200);
    assert.deepEqual({ ...(calls.pop()?.args[1] as object) }, { ...body, expectedVersion: 3 });
    await request(server)
      .post(`${base}/${id}/enabled`)
      .set(headers)
      .send({ expectedVersion: 3, isEnabled: true })
      .expect(200);
    assert.deepEqual(
      { ...(calls.pop()?.args[1] as object) },
      { expectedVersion: 3, isEnabled: true },
    );
    await request(server).post(`${base}/${id}/delete`).set(headers).send({}).expect(204);
    assert.equal(calls.pop()?.action, 'remove');
    calls.length = 0;

    // Strict JSON: missing, unknown, mistyped and oversized fields never reach the service.
    const strict: unknown[] = [
      {},
      { ...body, isEnabled: 'yes' },
      { ...body, applyCustomer: undefined },
      { ...body, applyAdmin: 1 },
      { ...body, particlesEnabled: null },
      { ...body, presetKey: 5 },
      { ...body, presetKey: 'x'.repeat(41) },
      { ...body, label: undefined },
      { ...body, label: 'x'.repeat(401) },
      { ...body, greetingVi: 5 },
      { ...body, greetingVi: undefined },
      { ...body, greetingEn: 'x'.repeat(401) },
      { ...body, startsAt: 'tomorrow' },
      { ...body, endsAt: undefined },
      { ...body, extra: 1 },
    ];
    for (const bad of strict) {
      await request(server)
        .post(base)
        .set(headers)
        .send(bad as object)
        .expect(400);
    }
    for (const bad of [
      { ...body },
      { ...body, expectedVersion: 0 },
      { ...body, expectedVersion: 1.5 },
      { ...body, expectedVersion: 1, extra: 1 },
    ]) {
      await request(server).post(`${base}/${id}/update`).set(headers).send(bad).expect(400);
    }
    for (const bad of [{}, { expectedVersion: 1 }, { expectedVersion: 1, isEnabled: 1 }]) {
      await request(server).post(`${base}/${id}/enabled`).set(headers).send(bad).expect(400);
    }
    assert.equal(calls.length, 0);

    // Typed domain errors reach the client verbatim, naming the conflicting season.
    outcome = new AuthError('SEASON_OVERLAP', id);
    const overlap = await request(server).post(base).set(headers).send(body).expect(409);
    assert.equal(overlap.body.code, 'SEASON_OVERLAP');
    outcome = new AuthError('POPUP_OVERLAP', id);
    const popupOverlap = await request(server)
      .post(`${base}/${id}/enabled`)
      .set(headers)
      .send({ expectedVersion: 1, isEnabled: true })
      .expect(409);
    assert.equal(popupOverlap.body.code, 'POPUP_OVERLAP');
    outcome = null;
    calls.length = 0;

    // Admin reads.
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    await request(server).get(`${base}/${id}`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(
      calls.map((call) => call.action),
      ['list', 'get'],
    );
    calls.length = 0;

    // The public season needs no session: only a known locale, cached for 60 seconds, 204 when none is live.
    await request(server).get('/api/v1/public/website/season').expect(400);
    await request(server).get('/api/v1/public/website/season?locale=fr').expect(400);
    await request(server).get('/api/v1/public/website/season?locale=vi,en').expect(400);
    assert.equal(calls.length, 0);
    const none = await request(server).get('/api/v1/public/website/season?locale=vi').expect(204);
    assert.equal(none.headers['cache-control'], 'public, max-age=60');
    assert.equal(none.headers['set-cookie'], undefined);
    assert.deepEqual(calls.pop()?.args, ['vi']);
    live = {
      presetKey: 'tet',
      greeting: 'Chúc mừng năm mới',
      endsAt: '2090-01-08T00:00:00.000Z',
      particles: true,
      customer: true,
      admin: false,
    };
    const shown = await request(server).get('/api/v1/public/website/season?locale=en').expect(200);
    assert.deepEqual(shown.body, live);
    assert.equal(shown.headers['cache-control'], 'public, max-age=60');
    assert.equal(shown.headers['set-cookie'], undefined, 'anonymous and cookie-free');
    assert.deepEqual(calls.pop()?.args, ['en']);
    outcome = new AuthError('SERVICE_UNAVAILABLE');
    await request(server).get('/api/v1/public/website/season?locale=vi').expect(503);
    outcome = null;
    calls.length = 0;

    // A popup or slide body may carry `seasonId` (a string or null) and may also leave it out.
    const popupBody = {
      mediaId: null,
      titleVi: 'Tết',
      titleEn: null,
      bodyVi: null,
      bodyEn: null,
      ctaLabelVi: null,
      ctaLabelEn: null,
      ctaUrl: null,
      startsAt: '2090-01-01T00:00:00.000Z',
      endsAt: '2090-01-02T00:00:00.000Z',
      isEnabled: false,
    };
    const slideBody = {
      mediaId: randomUUID(),
      mobileMediaId: null,
      titleVi: null,
      titleEn: null,
      subtitleVi: null,
      subtitleEn: null,
      linkUrl: null,
      linkLabelVi: null,
      linkLabelEn: null,
      altVi: null,
      altEn: null,
      startsAt: null,
      endsAt: null,
      isEnabled: false,
    };
    for (const [route, content, action] of [
      ['/api/v1/website/popups', popupBody, 'popup-create'],
      ['/api/v1/website/slides', slideBody, 'slide-create'],
    ] as const) {
      await request(server).post(route).set(headers).send(content).expect(200);
      assert.equal((calls.pop()?.args[0] as { seasonId?: unknown }).seasonId, undefined);
      await request(server)
        .post(route)
        .set(headers)
        .send({ ...content, seasonId: id })
        .expect(200);
      assert.equal(calls.pop()?.action, action);
      await request(server)
        .post(route)
        .set(headers)
        .send({ ...content, seasonId: null })
        .expect(200);
      assert.equal((calls.pop()?.args[0] as { seasonId?: unknown }).seasonId, null);
      for (const seasonId of [5, true, 'x'.repeat(37), {}]) {
        await request(server)
          .post(route)
          .set(headers)
          .send({ ...content, seasonId })
          .expect(400);
      }
    }
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
  }
});

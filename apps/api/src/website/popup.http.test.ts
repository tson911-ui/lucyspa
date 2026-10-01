import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { Readable } from 'node:stream';
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

// UX/UI Step 12 transport contract: strict JSON for the admin popup routes (Origin + CSRF as every mutation),
// anonymous read-only public routes with the right cache headers, safe typed errors.
test('popup HTTP: strict admin bodies, CSRF/Origin, anonymous public popup and public image headers', async () => {
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
  const popup = { id: randomUUID(), status: 'DRAFT' };
  const answer =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve(popup);
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
    .overrideProvider(PopupService)
    .useValue({
      list: answer('list'),
      get: answer('get'),
      create: answer('create'),
      update: answer('update'),
      setEnabled: answer('setEnabled'),
      remove: answer('remove'),
    })
    .overrideProvider(PublicWebsiteService)
    .useValue({
      popup: (locale: string) => {
        calls.push({ action: 'public-popup', args: [locale] });
        return Promise.resolve(live);
      },
      variant: (id: string, kind: string) => {
        calls.push({ action: 'public-variant', args: [id, kind] });
        if (outcome) return Promise.reject(outcome);
        return Promise.resolve({
          stream: Readable.from([Buffer.from('webp!')]),
          bytes: 5,
          etag: '"abc-md"',
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
  const id = randomUUID();
  const base = '/api/v1/website/popups';
  const body = {
    mediaId: null,
    titleVi: 'Tết',
    titleEn: null,
    bodyVi: null,
    bodyEn: null,
    ctaLabelVi: 'Đặt lịch',
    ctaLabelEn: null,
    ctaUrl: '/vi/account/book',
    startsAt: '2090-01-01T00:00:00.000Z',
    endsAt: '2090-01-02T00:00:00.000Z',
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
      { ...body, isEnabled: undefined },
      { ...body, titleVi: 5 },
      { ...body, titleVi: undefined },
      { ...body, startsAt: 'tomorrow' },
      { ...body, startsAt: undefined },
      { ...body, extra: 1 },
      { ...body, bodyVi: 'a'.repeat(1_201) },
      { ...body, mediaId: 'x'.repeat(37) },
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

    // Typed domain errors reach the client verbatim.
    outcome = new AuthError('POPUP_OVERLAP', id);
    const overlap = await request(server).post(base).set(headers).send(body).expect(409);
    assert.equal(overlap.body.code, 'POPUP_OVERLAP');
    outcome = new AuthError('MEDIA_ALT_REQUIRED', 'mediaId');
    const alt = await request(server).post(base).set(headers).send(body).expect(409);
    assert.equal(alt.body.code, 'MEDIA_ALT_REQUIRED');
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

    // The public popup needs no session: only a known locale, cached for 60 seconds, 204 when none is live.
    await request(server).get('/api/v1/public/website/popup').expect(400);
    await request(server).get('/api/v1/public/website/popup?locale=fr').expect(400);
    await request(server).get('/api/v1/public/website/popup?locale=vi,en').expect(400);
    assert.equal(calls.length, 0);
    const none = await request(server).get('/api/v1/public/website/popup?locale=vi').expect(204);
    assert.equal(none.headers['cache-control'], 'public, max-age=60');
    assert.deepEqual(calls.pop()?.args, ['vi']);
    live = {
      id,
      rowVersion: 2,
      title: 'Tết',
      body: null,
      ctaLabel: null,
      ctaUrl: null,
      image: null,
    };
    const shown = await request(server).get('/api/v1/public/website/popup?locale=en').expect(200);
    assert.equal(shown.body.title, 'Tết');
    assert.equal(shown.headers['cache-control'], 'public, max-age=60');
    assert.equal(shown.headers['set-cookie'], undefined, 'anonymous and cookie-free');
    assert.deepEqual(calls.pop()?.args, ['en']);

    // A public image: anonymous, immutable, nosniff, revalidated by ETag; only the three known renditions exist.
    await request(server).get(`/api/v1/public/media/${id}/original`).expect(404);
    await request(server).get(`/api/v1/public/media/${id}/constructor`).expect(404);
    assert.equal(calls.length, 0);
    const image = await request(server).get(`/api/v1/public/media/${id}/md`).expect(200);
    assert.equal(image.headers['content-type'], 'image/webp');
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.equal(image.headers['cache-control'], 'public, max-age=31536000, immutable');
    assert.equal(image.headers.etag, '"abc-md"');
    assert.equal(image.headers['set-cookie'], undefined);
    await request(server)
      .get(`/api/v1/public/media/${id}/md`)
      .set({ 'If-None-Match': '"abc-md"' })
      .expect(304);
    assert.deepEqual(calls.filter((call) => call.action === 'public-variant')[0]?.args, [id, 'MD']);
    outcome = new AuthError('NOT_FOUND');
    await request(server).get(`/api/v1/public/media/${id}/lg`).expect(404);
  } finally {
    await app.close();
  }
});

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
import { SlideService } from './slide.service.js';

// UX/UI Step 13 transport contract: strict JSON for the admin slider routes (Origin + CSRF as every mutation,
// `reorder` is not an id), an anonymous read-only public list with the right cache headers, safe typed errors.
test('slide HTTP: strict admin bodies, CSRF/Origin, reorder route, anonymous public slides', async () => {
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
  const slide = { id: randomUUID(), status: 'HIDDEN' };
  const answer =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve(slide);
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
    .overrideProvider(SlideService)
    .useValue({
      list: answer('list'),
      get: answer('get'),
      create: answer('create'),
      update: answer('update'),
      setEnabled: answer('setEnabled'),
      reorder: answer('reorder'),
      remove: answer('remove'),
    })
    .overrideProvider(PublicWebsiteService)
    .useValue({
      slides: (locale: string) => {
        calls.push({ action: 'public-slides', args: [locale] });
        return Promise.resolve([]);
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
  const base = '/api/v1/website/slides';
  const body = {
    mediaId: randomUUID(),
    mobileMediaId: null,
    titleVi: 'Tết',
    titleEn: null,
    subtitleVi: null,
    subtitleEn: null,
    linkUrl: '/vi/account/book',
    linkLabelVi: 'Đặt lịch',
    linkLabelEn: null,
    altVi: null,
    altEn: null,
    startsAt: null,
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
      .post(`${base}/reorder`)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send({ orderedIds: [] })
      .expect(403);
    await request(server)
      .post(`${base}/${id}/delete`)
      .set({ Origin: headers.Origin, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .send({})
      .expect(403);
    assert.equal(calls.length, 0);

    // A valid create reaches the service with exactly the declared fields.
    await request(server).post(base).set(headers).send(body).expect(200);
    assert.deepEqual({ ...(calls.pop()?.args[0] as object) }, { ...body, seasonId: undefined });
    await request(server)
      .post(`${base}/${id}/update`)
      .set(headers)
      .send({ ...body, expectedVersion: 3 })
      .expect(200);
    assert.deepEqual(
      { ...(calls.pop()?.args[1] as object) },
      { ...body, expectedVersion: 3, seasonId: undefined },
    );
    await request(server)
      .post(`${base}/${id}/enabled`)
      .set(headers)
      .send({ expectedVersion: 3, isEnabled: true })
      .expect(200);
    assert.deepEqual(
      { ...(calls.pop()?.args[1] as object) },
      { expectedVersion: 3, isEnabled: true },
    );
    // `reorder` is its own route, never read as a slide id.
    const orderedIds = [randomUUID(), randomUUID()];
    await request(server).post(`${base}/reorder`).set(headers).send({ orderedIds }).expect(200);
    const reorder = calls.pop();
    assert.equal(reorder?.action, 'reorder');
    assert.deepEqual({ ...(reorder?.args[0] as object) }, { orderedIds });
    await request(server).post(`${base}/${id}/delete`).set(headers).send({}).expect(204);
    assert.equal(calls.pop()?.action, 'remove');
    calls.length = 0;

    // Strict JSON: missing, unknown, mistyped and oversized fields never reach the service.
    const strict: unknown[] = [
      {},
      { ...body, isEnabled: 'yes' },
      { ...body, mediaId: undefined },
      { ...body, mediaId: null },
      { ...body, titleVi: 5 },
      { ...body, titleVi: undefined },
      { ...body, startsAt: 'tomorrow' },
      { ...body, startsAt: undefined },
      { ...body, extra: 1 },
      { ...body, subtitleVi: 'a'.repeat(1_201) },
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
    for (const bad of [
      {},
      { orderedIds: 'a' },
      { orderedIds: [1] },
      { orderedIds: ['x'.repeat(37)] },
      { orderedIds, extra: 1 },
    ]) {
      await request(server).post(`${base}/reorder`).set(headers).send(bad).expect(400);
    }
    assert.equal(calls.length, 0);

    // Typed domain errors reach the client verbatim.
    outcome = new AuthError('SLIDE_LIMIT');
    const limit = await request(server).post(base).set(headers).send(body).expect(409);
    assert.equal(limit.body.code, 'SLIDE_LIMIT');
    outcome = new AuthError('CONFLICT');
    const conflict = await request(server)
      .post(`${base}/reorder`)
      .set(headers)
      .send({ orderedIds })
      .expect(409);
    assert.equal(conflict.body.code, 'CONFLICT');
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

    // The public list needs no session: only a known locale, cached for 60 seconds, an empty list when none.
    await request(server).get('/api/v1/public/website/slides').expect(400);
    await request(server).get('/api/v1/public/website/slides?locale=fr').expect(400);
    await request(server).get('/api/v1/public/website/slides?locale=vi,en').expect(400);
    assert.equal(calls.length, 0);
    const none = await request(server).get('/api/v1/public/website/slides?locale=vi').expect(200);
    assert.deepEqual(none.body, { items: [] });
    assert.equal(none.headers['cache-control'], 'public, max-age=60');
    assert.equal(none.headers['set-cookie'], undefined, 'anonymous and cookie-free');
    assert.deepEqual(calls.pop()?.args, ['vi']);
  } finally {
    await app.close();
  }
});

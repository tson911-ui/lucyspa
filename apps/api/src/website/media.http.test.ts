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
import { MediaService } from './media.service.js';

// UX/UI Step 11 transport contract: multipart only on the declared upload route, still Origin + CSRF,
// bounded body, strict JSON elsewhere, safe typed errors.
test('media HTTP: multipart only on the upload route, CSRF/Origin, bounded body, strict bodies, variants', async () => {
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
  const asset = { id: randomUUID(), usedIn: [] };
  const answer =
    (action: string) =>
    (_token: unknown, ...args: unknown[]) => {
      calls.push({ action, args });
      return outcome ? Promise.reject(outcome) : Promise.resolve(asset);
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
    .overrideProvider(MediaService)
    .useValue({
      list: answer('list'),
      get: answer('get'),
      upload: (
        _token: unknown,
        file: { originalname: string; buffer: Buffer },
        fields: unknown,
      ) => {
        calls.push({ action: 'upload', args: [file.originalname, file.buffer.length, fields] });
        return outcome ? Promise.reject(outcome) : Promise.resolve({ asset, duplicate: false });
      },
      updateAlt: answer('updateAlt'),
      remove: answer('remove'),
      variant: (_token: unknown, id: string, kind: string) => {
        calls.push({ action: 'variant', args: [id, kind] });
        return Promise.resolve({
          stream: Readable.from([Buffer.from('webp!')]),
          bytes: 5,
          etag: '"abc-thumb"',
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
  const base = '/api/v1/website/media';
  const png = Buffer.from('not really an image, the service decides');
  try {
    // The upload needs Origin, session and CSRF like every mutation.
    await request(server)
      .post(base)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .attach('file', png, 'a.png')
      .expect(403);
    await request(server)
      .post(base)
      .set({ ...headers, Origin: 'https://evil.example' })
      .attach('file', png, 'a.png')
      .expect(403);
    await request(server)
      .post(base)
      .set({ Origin: headers.Origin, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .attach('file', png, 'a.png')
      .expect(403);
    assert.equal(calls.length, 0);

    // A JSON body is not an upload; the exemption is for the declared route only.
    await request(server).post(base).set(headers).send({ file: 'x' }).expect(403);
    for (const path of [`${base}/${id}/alt`, `${base}/${id}/delete`]) {
      await request(server)
        .post(path)
        .set({ ...headers, 'Content-Type': 'multipart/form-data; boundary=x' })
        .send('--x--')
        .expect(403);
    }
    assert.equal(calls.length, 0);

    // A valid upload reaches the service with the file bytes and the alt fields only.
    const ok = await request(server)
      .post(base)
      .set(headers)
      .field('altVi', 'Ảnh')
      .field('altEn', 'Photo')
      .attach('file', png, 'a.png')
      .expect(200);
    assert.equal(ok.body.duplicate, false);
    assert.deepEqual(calls.pop(), {
      action: 'upload',
      args: ['a.png', png.length, { altVi: 'Ảnh', altEn: 'Photo' }],
    });

    // Bounded body: unknown fields, a second file, another file field name and an oversize file are refused.
    await request(server)
      .post(base)
      .set(headers)
      .field('title', 'x')
      .attach('file', png, 'a.png')
      .expect(400);
    await request(server)
      .post(base)
      .set(headers)
      .attach('file', png, 'a.png')
      .attach('file', png, 'b.png')
      .expect(400);
    await request(server).post(base).set(headers).attach('document', png, 'a.png').expect(400);
    const tooBig = await request(server)
      .post(base)
      .set(headers)
      .attach('file', Buffer.alloc(10 * 1024 * 1024 + 1024), 'big.png')
      .expect(413);
    assert.equal(tooBig.body.code, 'HTTP_413');
    assert.equal(calls.length, 0);

    // Typed domain errors reach the client verbatim.
    outcome = new AuthError('MEDIA_TYPE_UNSUPPORTED');
    const refused = await request(server)
      .post(base)
      .set(headers)
      .attach('file', png, 'a.svg')
      .expect(415);
    assert.equal(refused.body.code, 'MEDIA_TYPE_UNSUPPORTED');
    outcome = new AuthError('RATE_LIMITED');
    await request(server).post(base).set(headers).attach('file', png, 'a.png').expect(429);
    outcome = new AuthError('MEDIA_IN_USE');
    const inUse = await request(server)
      .post(`${base}/${id}/delete`)
      .set(headers)
      .send({})
      .expect(409);
    assert.equal(inUse.body.code, 'MEDIA_IN_USE');
    outcome = null;
    calls.length = 0;

    // Strict JSON for alt text.
    const strict: unknown[] = [
      {},
      { expectedVersion: 1 },
      { expectedVersion: 0, altVi: 'a', altEn: null },
      { expectedVersion: 1, altVi: 5, altEn: null },
      { expectedVersion: 1, altVi: 'a', altEn: null, filename: 'x' },
      { expectedVersion: 1, altVi: 'a'.repeat(601), altEn: null },
    ];
    for (const body of strict) {
      await request(server)
        .post(`${base}/${id}/alt`)
        .set(headers)
        .send(body as object)
        .expect(400);
    }
    await request(server)
      .post(`${base}/${id}/alt`)
      .set(headers)
      .send({ expectedVersion: 2, altVi: null, altEn: 'Photo' })
      .expect(200);
    // The validated DTO is a class instance; compare its fields.
    assert.deepEqual(
      { ...(calls.pop()?.args[1] as object) },
      {
        expectedVersion: 2,
        altVi: null,
        altEn: 'Photo',
      },
    );
    await request(server).post(`${base}/${id}/delete`).set(headers).send({}).expect(204);
    assert.equal(calls.pop()?.action, 'remove');
    calls.length = 0;

    // Reads: paging input is validated; only known renditions exist; a rendition is a private, cacheable image.
    await request(server).get(`${base}?page=0x`).set({ Cookie: cookie }).expect(400);
    await request(server).get(`${base}?page=2&search=xin`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.pop()?.args, [{ search: 'xin', page: 2 }]);
    await request(server).get(`${base}/${id}/original`).set({ Cookie: cookie }).expect(404);
    await request(server).get(`${base}/${id}/constructor`).set({ Cookie: cookie }).expect(404);
    const image = await request(server)
      .get(`${base}/${id}/thumb`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.equal(image.headers['content-type'], 'image/webp');
    assert.equal(image.headers['x-content-type-options'], 'nosniff');
    assert.equal(image.headers['cache-control'], 'private, max-age=300');
    assert.equal(image.headers.etag, '"abc-thumb"');
    await request(server)
      .get(`${base}/${id}/thumb`)
      .set({ Cookie: cookie, 'If-None-Match': '"abc-thumb"' })
      .expect(304);
    assert.deepEqual(calls.filter((call) => call.action === 'variant')[0]?.args, [id, 'THUMB']);
  } finally {
    await app.close();
  }
});

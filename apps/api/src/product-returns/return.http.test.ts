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
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { ProductReturnService } from './return.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-12 HTTP surface: the session cookie, Origin and CSRF are required for every write, only the contract's fields are
 * accepted, an upload is the only multipart route, evidence is streamed with no caching and never as the original, no write verb other
 * than POST exists, and domain refusals reach the client as stable codes with safe messages.
 */
test('product return HTTP: guards, exact fields, private photo headers, stable codes', async () => {
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
      if (outcome) return Promise.reject(outcome);
      if (name === 'photo') {
        return Promise.resolve({ stream: Readable.from([Buffer.from('RIFFxxxxWEBP')]), bytes: 12 });
      }
      return Promise.resolve({ ok: name });
    };
  const names = [
    'context',
    'lookup',
    'list',
    'get',
    'open',
    'addNote',
    'accept',
    'decline',
    'cancel',
    'uploadPhoto',
    'removePhoto',
    'photo',
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
    .overrideProvider(ProductReturnService)
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
  const base = '/api/v1/product-returns';
  const branch = randomUUID();
  const id = randomUUID();
  const photoId = randomUUID();
  const openBody = {
    branchId: branch,
    invoiceLineId: randomUUID(),
    reason: 'PERSONAL_PREFERENCE',
    requestedOutcome: 'EXCHANGE',
    quantity: 1,
    sealIntact: true,
    notes: null,
    clientRequestId: randomUUID(),
  };
  try {
    // Reads carry the session token and the ids as given.
    for (const [path, name] of [
      ['context', 'context'],
      [`lookup?branchId=${branch}&invoiceCode=HD000001`, 'lookup'],
      [`cases?branchId=${branch}&status=OPEN&reason=SKIN_IRRITATION&q=kem&page=2`, 'list'],
      [`cases/${id}`, 'get'],
    ] as const) {
      await request(server).get(`${base}/${path}`).set({ Cookie: cookie }).expect(200);
      assert.equal(calls.at(-1)?.[0], name);
      assert.equal(calls.at(-1)?.[1], token);
    }
    assert.deepEqual(calls.find((call) => call[0] === 'lookup')?.slice(2), [branch, 'HD000001']);
    assert.deepEqual(calls.find((call) => call[0] === 'list')?.[2], {
      branchId: branch,
      status: 'OPEN',
      reason: 'SKIN_IRRITATION',
      q: 'kem',
      page: 2,
    });
    await request(server)
      .get(`${base}/cases?branchId=${branch}&page=x`)
      .set({ Cookie: cookie })
      .expect(400);
    // A read without the cookie reaches the service with no token, which then refuses it (decided in the service transaction).
    await request(server).get(`${base}/cases/${id}`).expect(200);
    assert.equal(calls.at(-1)?.[1], undefined);

    // Writes need the Origin and the CSRF token; without them nothing reaches the service.
    const guarded = calls.length;
    await request(server).post(`${base}/cases`).set({ Cookie: cookie }).send(openBody).expect(403);
    await request(server)
      .post(`${base}/cases/${id}/accept`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send({})
      .expect(403);
    await request(server)
      .post(`${base}/cases/${id}/photos`)
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .attach('file', Buffer.from('x'), 'a.png')
      .expect(403);
    assert.equal(calls.length, guarded);

    // Good bodies reach the service with exactly the fields sent.
    await request(server).post(`${base}/cases`).set(headers).send(openBody).expect(200);
    assert.deepEqual({ ...(calls.at(-1)![2] as object) }, openBody);
    // The Owner's exception reason (P6-12 follow-up) reaches the service exactly as sent; the service decides who may use it.
    const withException = { ...openBody, windowExceptionReason: 'Chủ đồng ý nhận lại' };
    await request(server).post(`${base}/cases`).set(headers).send(withException).expect(200);
    assert.deepEqual({ ...(calls.at(-1)![2] as object) }, withException);
    for (const [path, body, name] of [
      [`cases/${id}/notes`, { note: 'Đã gọi khách' }, 'addNote'],
      [`cases/${id}/accept`, { expectedRowVersion: 1, outcome: 'REFUND', note: null }, 'accept'],
      [`cases/${id}/decline`, { expectedRowVersion: 1, note: 'Hộp đã mở' }, 'decline'],
      [`cases/${id}/cancel`, { expectedRowVersion: 1, note: 'Mở nhầm' }, 'cancel'],
      [`cases/${id}/photos/${photoId}/remove`, { note: 'Khách yêu cầu' }, 'removePhoto'],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(200);
      assert.equal(calls.at(-1)?.[0], name);
    }
    assert.deepEqual(calls.find((call) => call[0] === 'removePhoto')?.slice(2, 4), [id, photoId]);

    // The upload is multipart with the Origin, the session and the CSRF token still required.
    await request(server)
      .post(`${base}/cases/${id}/photos`)
      .set(headers)
      .attach('file', Buffer.from('not really a picture'), 'anh.png')
      .expect(200);
    const upload = calls.at(-1)!;
    assert.equal(upload[0], 'uploadPhoto');
    assert.equal(upload[2], id);
    assert.ok(Buffer.isBuffer((upload[3] as { buffer: Buffer }).buffer));
    // A JSON body on the upload route and a multipart body elsewhere are refused by the request guard.
    const before = calls.length;
    await request(server)
      .post(`${base}/cases/${id}/photos`)
      .set(headers)
      .send({ file: 'x' })
      .expect(403);
    await request(server)
      .post(`${base}/cases/${id}/notes`)
      .set(headers)
      .attach('file', Buffer.from('x'), 'a.png')
      .expect(403);
    // A second file or an extra text field is not accepted.
    await request(server)
      .post(`${base}/cases/${id}/photos`)
      .set(headers)
      .attach('file', Buffer.from('a'), 'a.png')
      .attach('file', Buffer.from('b'), 'b.png')
      .expect((response) => assert.ok(response.status >= 400));
    await request(server)
      .post(`${base}/cases/${id}/photos`)
      .set(headers)
      .field('caption', 'x')
      .attach('file', Buffer.from('a'), 'a.png')
      .expect((response) => assert.ok(response.status >= 400));
    assert.equal(calls.length, before, 'nothing reached the service');

    // Only the contract's fields: an extra, wrongly typed or missing one is a 400 and the service is never called.
    const refused = calls.length;
    for (const [path, body] of [
      ['cases', { ...openBody, status: 'ACCEPTED' }],
      ['cases', { ...openBody, reason: 'BORED' }],
      ['cases', { ...openBody, requestedOutcome: 'GIFT' }],
      ['cases', { ...openBody, quantity: '1' }],
      ['cases', { ...openBody, quantity: 0 }],
      ['cases', { ...openBody, sealIntact: 'yes' }],
      ['cases', { ...openBody, notes: 5 }],
      ['cases', { ...openBody, windowExceptionReason: 5 }],
      ['cases', { ...openBody, windowEndsAt: '2030-01-01T00:00:00Z' }],
      ['cases', { ...openBody, refundVnd: '1000' }],
      ['cases', { branchId: branch }],
      [`cases/${id}/notes`, {}],
      [`cases/${id}/notes`, { note: 7 }],
      [`cases/${id}/notes`, { note: 'x', kind: 'DECLINED' }],
      [`cases/${id}/accept`, { expectedRowVersion: 1, note: null }],
      [`cases/${id}/accept`, { expectedRowVersion: 1, outcome: 'GIFT', note: null }],
      [`cases/${id}/accept`, { expectedRowVersion: '1', outcome: 'REFUND', note: null }],
      [
        `cases/${id}/accept`,
        { expectedRowVersion: 1, outcome: 'REFUND', note: null, amountVnd: '5' },
      ],
      [`cases/${id}/decline`, { expectedRowVersion: 1 }],
      [`cases/${id}/cancel`, { note: 'x' }],
      [`cases/${id}/photos/${photoId}/remove`, {}],
      [`cases/${id}/photos/${photoId}/remove`, { note: 'x', hard: true }],
    ] as const) {
      await request(server).post(`${base}/${path}`).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, refused, 'nothing reached the service');

    // No write verb other than POST exists: a case is never edited, replaced or deleted by verb.
    for (const method of ['put', 'patch', 'delete'] as const) {
      for (const path of ['cases', `cases/${id}`, `cases/${id}/photos/${photoId}`]) {
        await request(server)[method](`${base}/${path}`).set(headers).send({}).expect(404);
      }
    }

    // Evidence is streamed privately: no cache, no sniffing, only the WebP renditions, never the original.
    for (const variant of ['thumb', 'md', 'lg']) {
      const shown = await request(server)
        .get(`${base}/cases/${id}/photos/${photoId}/${variant}`)
        .set({ Cookie: cookie })
        .expect(200);
      assert.equal(shown.headers['content-type'], 'image/webp');
      assert.equal(shown.headers['cache-control'], 'private, no-store');
      assert.equal(shown.headers['x-content-type-options'], 'nosniff');
      assert.equal(shown.headers['content-disposition'], 'inline');
      assert.equal(shown.headers['etag'], undefined);
      assert.doesNotMatch(String(shown.headers['cache-control']), /public|max-age/);
    }
    const asked = calls.length;
    for (const variant of ['original', 'orig', 'full', 'xl', '..%2f..%2fetc', 'THUMB']) {
      await request(server)
        .get(`${base}/cases/${id}/photos/${photoId}/${variant}`)
        .set({ Cookie: cookie })
        .expect(404);
    }
    assert.equal(calls.length, asked, 'an unknown rendition never reaches the service');
    assert.equal(calls.filter((call) => call[0] === 'photo').at(-1)?.[4], 'LG');

    // Domain outcomes reach the client as stable codes with safe messages only.
    for (const [code, status] of [
      ['FORBIDDEN', 403],
      ['AUTHENTICATION_REQUIRED', 401],
      ['NOT_FOUND', 404],
      ['VALIDATION_FAILED', 400],
      ['RETURN_NOT_ELIGIBLE', 409],
      ['RETURN_WINDOW_EXPIRED', 409],
      ['RETURN_SEAL_REQUIRED', 409],
      ['RETURN_QUANTITY_EXCEEDED', 409],
      ['RETURN_CLOSED', 409],
      ['RETURN_PHOTO_REQUIRED', 409],
      ['RETURN_PHOTO_LIMIT', 409],
      ['RETURN_PHOTO_GONE', 409],
      ['CONFLICT', 409],
    ] as const) {
      outcome = new AuthError(code);
      const failed = await request(server)
        .get(`${base}/cases/${id}`)
        .set({ Cookie: cookie })
        .expect(status);
      assert.equal(failed.body.code, code);
      assert.doesNotMatch(JSON.stringify(failed.body), /prisma|SQL|constraint|storage|returns\//i);
    }
  } finally {
    await app.close();
  }
});

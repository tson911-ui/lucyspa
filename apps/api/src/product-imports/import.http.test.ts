import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import { IMPORT_LIMITS, parseApiEnvironment } from '@lucy-spa/server';
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
import { ProductImportService } from './import.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

/**
 * Phase 6 P6-5 HTTP surface: the session cookie, Origin and CSRF are required for every write (the upload included), multipart is
 * accepted only on the upload route and is bounded (one file, two fields, the size limit), only the contract's fields are accepted
 * (an unknown or mistyped one never reaches the service), ids reach the service as given, the template downloads as an attachment
 * that is never cached, and domain refusals reach the client as stable codes.
 */
test('product import HTTP: guards, bounded multipart, exact fields, stable codes', async () => {
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
  const service = {
    list: answer('list'),
    detail: answer('detail'),
    upload: (...args: unknown[]) => {
      const [, file, fields] = args as [string, { buffer: Buffer; originalname: string }, unknown];
      calls.push(['upload', file.originalname, file.buffer.length, fields]);
      return outcome ? Promise.reject(outcome) : Promise.resolve({ ok: 'upload' });
    },
    template: (...args: unknown[]) => {
      calls.push(['template', ...args]);
      return outcome
        ? Promise.reject(outcome)
        : Promise.resolve({
            bytes: new Uint8Array([1, 2, 3]),
            filename: 'mau-san-pham.xlsx',
            contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          });
    },
    apply: answer('apply'),
    cancel: answer('cancel'),
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
    .overrideProvider(ProductImportService)
    .useValue(service)
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
  const base = '/api/v1/product-imports';
  const id = randomUUID();
  const file = Buffer.from('sku,quantity\nA,1\n');
  try {
    // Reads carry the session token and the id as given; the template route is not an id.
    await request(server).get(base).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1), ['list', token]);
    await request(server).get(`${base}/${id}`).set({ Cookie: cookie }).expect(200);
    assert.deepEqual(calls.at(-1), ['detail', token, id]);
    const template = await request(server)
      .get(`${base}/template?kind=CATALOG&format=xlsx&lang=en`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1), ['template', token, 'CATALOG', 'xlsx', 'en']);
    assert.equal(
      template.headers['content-disposition'],
      'attachment; filename="mau-san-pham.xlsx"',
    );
    assert.equal(template.headers['cache-control'], 'no-store');
    await request(server)
      .get(`${base}/template?kind=CATALOG&format=xlsx`)
      .set({ Cookie: cookie })
      .expect(200);
    assert.equal(calls.at(-1)?.[4], 'vi', 'Vietnamese by default');

    // Every write needs the Origin, the session and the CSRF token.
    const guarded = calls.length;
    await request(server)
      .post(base)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .field('kind', 'CATALOG')
      .attach('file', file, 'a.csv')
      .expect(403);
    await request(server)
      .post(base)
      .set({ ...headers, Origin: 'https://evil.example' })
      .field('kind', 'CATALOG')
      .attach('file', file, 'a.csv')
      .expect(403);
    await request(server).post(base).set(headers).send({ kind: 'CATALOG' }).expect(403);
    for (const path of [`${base}/${id}/apply`, `${base}/${id}/cancel`]) {
      await request(server)
        .post(path)
        .set({ Cookie: cookie, Origin: headers.Origin })
        .send({ expectedRowVersion: 2, skipInvalid: false })
        .expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, 'Content-Type': 'multipart/form-data; boundary=x' })
        .send('--x--')
        .expect(403);
    }
    assert.equal(calls.length, guarded);

    // A valid upload reaches the service with the file and the two fields only.
    const branch = randomUUID();
    await request(server)
      .post(base)
      .set(headers)
      .field('kind', 'OPENING_STOCK')
      .field('branchId', branch)
      .attach('file', file, 'ton dau.csv')
      .expect(200);
    assert.deepEqual(calls.at(-1), [
      'upload',
      'ton dau.csv',
      file.length,
      { kind: 'OPENING_STOCK', branchId: branch },
    ]);

    // Bounded body: an unknown field, a second file, another file field, no kind, an oversize file.
    const bounded = calls.length;
    await request(server)
      .post(base)
      .set(headers)
      .field('kind', 'CATALOG')
      .field('mode', 'force')
      .attach('file', file, 'a.csv')
      .expect(400);
    await request(server)
      .post(base)
      .set(headers)
      .field('kind', 'CATALOG')
      .attach('file', file, 'a.csv')
      .attach('file', file, 'b.csv')
      .expect(400);
    await request(server)
      .post(base)
      .set(headers)
      .field('kind', 'CATALOG')
      .attach('document', file, 'a.csv')
      .expect(400);
    await request(server).post(base).set(headers).attach('file', file, 'a.csv').expect(400);
    const tooBig = await request(server)
      .post(base)
      .set(headers)
      .field('kind', 'CATALOG')
      .attach('file', Buffer.alloc(IMPORT_LIMITS.maxBytes + 1024), 'big.csv')
      .expect(413);
    assert.equal(tooBig.body.code, 'HTTP_413');
    assert.equal(calls.length, bounded);

    // JSON bodies: exactly the contract's fields.
    await request(server)
      .post(`${base}/${id}/apply`)
      .set(headers)
      .send({ expectedRowVersion: 2, skipInvalid: true })
      .expect(200);
    assert.deepEqual(calls.at(-1)!.slice(0, 3), ['apply', token, id]);
    assert.deepEqual(
      { ...(calls.at(-1)![3] as object) },
      { expectedRowVersion: 2, skipInvalid: true },
    );
    await request(server)
      .post(`${base}/${id}/cancel`)
      .set(headers)
      .send({ expectedRowVersion: 3 })
      .expect(200);
    assert.equal(calls.at(-1)![0], 'cancel');
    const refused = calls.length;
    for (const [path, body] of [
      ['apply', { expectedRowVersion: 2 }],
      ['apply', { skipInvalid: true }],
      ['apply', { expectedRowVersion: '2', skipInvalid: true }],
      ['apply', { expectedRowVersion: 2, skipInvalid: 'yes' }],
      ['apply', { expectedRowVersion: 2, skipInvalid: true, force: true }],
      ['cancel', {}],
      ['cancel', { expectedRowVersion: 2, reason: 'x' }],
    ] as const) {
      await request(server).post(`${base}/${id}/${path}`).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, refused);
    // No write verb other than POST.
    await request(server).put(`${base}/${id}`).set(headers).send({}).expect(404);
    await request(server).delete(`${base}/${id}`).set(headers).expect(404);

    // Typed domain errors reach the client verbatim.
    outcome = new AuthError('IMPORT_FILE_INVALID', 'xls');
    const invalid = await request(server)
      .post(base)
      .set(headers)
      .field('kind', 'CATALOG')
      .attach('file', file, 'a.xls')
      .expect(422);
    assert.equal(invalid.body.code, 'IMPORT_FILE_INVALID');
    assert.match(invalid.body.message, /: xls$/);
    outcome = new AuthError('IMPORT_PREVIEW_STALE');
    const stale = await request(server)
      .post(`${base}/${id}/apply`)
      .set(headers)
      .send({ expectedRowVersion: 2, skipInvalid: false })
      .expect(409);
    assert.equal(stale.body.code, 'IMPORT_PREVIEW_STALE');
    outcome = new AuthError('FORBIDDEN');
    await request(server).get(base).set({ Cookie: cookie }).expect(403);
  } finally {
    await app.close();
  }
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
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
import { NotificationService } from './notification.service.js';

// Added, NOT EXECUTED in Step 9.
test('notification HTTP enforces exact payloads, own session, CSRF and safe errors', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
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
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  let writes = 0;
  const listed: { cursor: string | undefined; filters: unknown }[] = [];
  const archived: string[] = [];
  const readAlls: (string | undefined)[] = [];
  const authenticate = (value: string | undefined) => {
    if (value !== token) throw new AuthError('AUTHENTICATION_REQUIRED');
  };
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, pino({ level: 'silent' }))],
  })
    .overrideProvider(InfrastructureService)
    .useValue({})
    .overrideProvider(SessionService)
    .useValue({
      resolve: (value: string) =>
        Promise.resolve(
          value === token ? sessionPrincipal(record, new Date(), environment.auth) : null,
        ),
    })
    .overrideProvider(PasswordService)
    .useValue({})
    .overrideProvider(AuthThrottleService)
    .useValue({})
    .overrideProvider(LoginService)
    .useValue({})
    .overrideProvider(NotificationService)
    .useValue({
      list: (value: string, cursor: string | undefined, filters: unknown) => {
        authenticate(value);
        listed.push({ cursor, filters });
        return {
          items: [],
          unreadCount: 0,
          unreadByCategory: { OPERATIONS: 0, HR: 0, FINANCE: 0 },
          nextCursor: null,
        };
      },
      count: (value: string) => {
        authenticate(value);
        return { unreadCount: 0, unreadByCategory: { OPERATIONS: 0, HR: 0, FINANCE: 0 } };
      },
      read: (value: string, id: string) => {
        authenticate(value);
        writes++;
        return { id, readAt: now.toISOString() };
      },
      archive: (value: string, id: string) => {
        authenticate(value);
        archived.push(id);
        return { id, archivedAt: now.toISOString() };
      },
      readAll: (value: string, category: string | undefined) => {
        authenticate(value);
        readAlls.push(category);
        return {
          updated: 0,
          unreadCount: 0,
          unreadByCategory: { OPERATIONS: 0, HR: 0, FINANCE: 0 },
        };
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const server = app.getHttpServer() as Server;
  const cookie = `${environment.auth.cookieName}=${token}`;
  const headers = {
    Cookie: cookie,
    Origin: environment.webOrigin,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  const url = `/api/v1/notifications/${randomUUID()}/read`;
  try {
    await request(server).get('/api/v1/notifications').expect(401);
    await request(server).get('/api/v1/notifications').set({ Cookie: cookie }).expect(200);
    await request(server)
      .get('/api/v1/notifications')
      .set({ Cookie: cookie })
      .query({ recipientUserId: randomUUID() })
      .expect(400);
    await request(server)
      .get('/api/v1/notifications/unread-count')
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .post(url)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send({})
      .expect(403);
    await request(server)
      .post(url)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send({})
      .expect(403);
    for (const body of [
      { readAt: now.toISOString() },
      { recipientUserId: randomUUID() },
      { branchId: randomUUID() },
      [],
    ]) {
      await request(server).post(url).set(headers).send(body).expect(400);
    }
    assert.equal(writes, 0);
    await request(server).post(url).set(headers).send({}).expect(200);
    assert.equal(writes, 1);

    // Filters: category from the registry, unread, archived; defaults hide archived items.
    listed.length = 0;
    await request(server).get('/api/v1/notifications').set({ Cookie: cookie }).expect(200);
    await request(server)
      .get('/api/v1/notifications')
      .set({ Cookie: cookie })
      .query({ category: 'HR', unread: 'true', archived: 'true' })
      .expect(200);
    assert.deepEqual(listed[0]!.filters, { unread: false, archived: false });
    assert.deepEqual(listed[1]!.filters, { category: 'HR', unread: true, archived: true });
    for (const query of [
      { category: 'BILLING' },
      { unread: 'maybe' },
      { archived: '1' },
      { recipient: 'someone' },
    ]) {
      await request(server)
        .get('/api/v1/notifications')
        .set({ Cookie: cookie })
        .query(query)
        .expect(400);
    }
    assert.equal(listed.length, 2, 'invalid queries never reach the inbox');

    // Archive: same protections as read; own inbox only, no body.
    const archiveUrl = `/api/v1/notifications/${randomUUID()}/archive`;
    await request(server)
      .post(archiveUrl)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send({})
      .expect(403);
    await request(server)
      .post(archiveUrl)
      .set(headers)
      .send({ recipientUserId: randomUUID() })
      .expect(400);
    assert.equal(archived.length, 0);
    await request(server).post(archiveUrl).set(headers).send({}).expect(200);
    assert.equal(archived.length, 1);

    // Mark all matching read: CSRF-protected, optional registry category, nothing else accepted.
    const readAllUrl = '/api/v1/notifications/read-all';
    await request(server)
      .post(readAllUrl)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send({})
      .expect(403);
    for (const body of [{ category: 'BILLING' }, { recipientUserId: randomUUID() }, { ids: [] }]) {
      await request(server).post(readAllUrl).set(headers).send(body).expect(400);
    }
    assert.equal(readAlls.length, 0);
    await request(server).post(readAllUrl).set(headers).send({}).expect(200);
    await request(server).post(readAllUrl).set(headers).send({ category: 'HR' }).expect(200);
    assert.deepEqual(readAlls, [undefined, 'HR']);
  } finally {
    await app.close();
  }
});

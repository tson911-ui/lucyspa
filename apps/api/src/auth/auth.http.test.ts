import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Controller, Delete, Patch, Post, Put } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { AuthError } from './auth.error.js';
import { ContextThrottleService } from './context-throttle.service.js';
import { generateCapability } from './crypto.js';
import { sessionPrincipal, type SessionRecord } from './session.policy.js';
import { SessionService } from './session.service.js';

@Controller('test-auth-mutation')
class MutationFixture {
  @Post() post() {
    return { accepted: true };
  }
  @Put() put() {
    return { accepted: true };
  }
  @Patch() patch() {
    return { accepted: true };
  }
  @Delete() delete() {
    return { accepted: true };
  }
}

test('HTTP authentication context and global CSRF contract', async (t) => {
  const environment = parseApiEnvironment({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'https://spa.example',
    AUTH_CSRF_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: JSON.stringify({ 1: randomBytes(32).toString('base64url') }),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  });
  const records = new Map<string, SessionRecord>();
  let unavailable = false;
  let limited = false;
  let allocations = 0;
  const peers: string[] = [];
  const logs: string[] = [];
  const logger = pino(
    { level: 'info' },
    {
      write: (text: string) => {
        logs.push(text);
      },
    },
  );
  function anonymous() {
    const token = generateCapability();
    const now = new Date(Date.now() - 100);
    const record: SessionRecord = {
      id: randomUUID(),
      kind: 'ANONYMOUS',
      userId: null,
      credentialVersion: null,
      authzVersion: null,
      csrfKeyVersion: 1,
      createdAt: now,
      lastActivityAt: now,
      absoluteExpiresAt: new Date(Date.now() + 900_000),
      revokedAt: null,
      reauthenticatedAt: null,
      user: null,
    };
    records.set(token, record);
    allocations += 1;
    return { token, session: sessionPrincipal(record, new Date(), environment.auth)! };
  }
  const module = await Test.createTestingModule({
    imports: [AppModule.forRoot(environment, logger)],
    controllers: [MutationFixture],
  })
    .overrideProvider(InfrastructureService)
    .useValue({})
    .overrideProvider(SessionService)
    .useValue({
      resolve: (token: string | undefined) => {
        if (unavailable) throw new Error('driver password=never-expose');
        return Promise.resolve(
          sessionPrincipal(records.get(token ?? '') ?? null, new Date(), environment.auth),
        );
      },
      withTransaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
        work({} as Prisma.TransactionClient),
      createAnonymous: () => Promise.resolve(anonymous()),
    })
    .overrideProvider(ContextThrottleService)
    .useValue({
      consume: (_tx: Prisma.TransactionClient, peer: string) => {
        peers.push(peer);
        if (limited) throw new AuthError('RATE_LIMITED');
        return Promise.resolve();
      },
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, logger);
  await app.init();
  const server = app.getHttpServer() as Server;
  const path = '/api/v1/auth/context';
  const cookieFor = (token: string) => `${environment.auth.cookieName}=${token}`;
  try {
    const initial = await request(server).get(path).expect(200);
    const cookie = String(initial.headers['set-cookie']?.[0]).split(';')[0]!;
    const token = cookie.slice(cookie.indexOf('=') + 1);
    const csrf = (initial.body as { csrfToken: string }).csrfToken;
    const headers = { Cookie: cookie, Origin: environment.webOrigin, 'X-CSRF-Token': csrf };

    await t.test(
      'new opaque cookie, private shape, no-store and stable context without polling activity',
      async () => {
        assert.deepEqual(Object.keys(initial.body as object).sort(), [
          'authenticated',
          'csrfToken',
        ]);
        assert.equal((initial.body as { authenticated: boolean }).authenticated, false);
        assert.match(csrf, /^[A-Za-z0-9_-]{43}$/);
        assert.match(
          String(initial.headers['set-cookie']?.[0]),
          /^__Host-lucy_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Secure$/,
        );
        assert.equal(initial.headers['cache-control'], 'no-store');
        const activity = records.get(token)!.lastActivityAt.getTime();
        const count = allocations;
        const repeat = await request(server).get(path).set('Cookie', cookie).expect(200);
        assert.deepEqual(repeat.body, initial.body);
        assert.equal(repeat.headers['set-cookie'], undefined);
        assert.equal(records.get(token)!.lastActivityAt.getTime(), activity);
        assert.equal(allocations, count);
      },
    );

    await t.test(
      'every unsafe HTTP method needs valid JSON, bound token and exact Origin or Referer',
      async () => {
        for (const method of ['post', 'put', 'patch', 'delete'] as const) {
          await request(server)
            [method]('/test-auth-mutation')
            .set(headers)
            .send({})
            .expect(method === 'post' ? 201 : 200);
          const denied = await request(server)[method]('/test-auth-mutation').send({}).expect(403);
          assert.equal((denied.body as { code: string }).code, 'REQUEST_NOT_ALLOWED');
        }
        for (const origin of [
          'null',
          'https://spa.example.evil',
          'https://evil.example',
          'https://spa.example/',
          'http://spa.example',
          'https://spa.example:444',
        ]) {
          await request(server)
            .post('/test-auth-mutation')
            .set(headers)
            .set('Origin', origin)
            .send({})
            .expect(403);
        }
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .unset('Origin')
          .set('Referer', 'https://spa.example/vi')
          .send({})
          .expect(201);
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .set('Origin', 'null')
          .set('Referer', 'https://spa.example/vi')
          .send({})
          .expect(403);
        for (const referer of [
          '',
          'null',
          'https://spa.example.evil/vi',
          'https://user@spa.example/vi',
        ]) {
          await request(server)
            .post('/test-auth-mutation')
            .set(headers)
            .unset('Origin')
            .set('Referer', referer)
            .send({})
            .expect(403);
        }
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .set('Content-Type', 'text/plain')
          .send('{}')
          .expect(403);
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .set('Sec-Fetch-Site', 'cross-site')
          .send({})
          .expect(403);
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .set('X-CSRF-Token', generateCapability())
          .send({})
          .expect(403);
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .unset('X-CSRF-Token')
          .send({})
          .expect(403);
      },
    );

    await t.test(
      'tokens cannot cross sessions; duplicate or malformed cookies fail closed',
      async () => {
        const other = anonymous();
        await request(server)
          .post('/test-auth-mutation')
          .set(headers)
          .set('Cookie', cookieFor(other.token))
          .send({})
          .expect(403);
        for (const badCookie of [
          `${cookie}; ${cookie}`,
          '__Host-lucy_session=invalid',
          'lucy_session_dev=' + token,
        ]) {
          await request(server)
            .post('/test-auth-mutation')
            .set(headers)
            .set('Cookie', badCookie)
            .send({})
            .expect(403);
          const renewed = await request(server).get(path).set('Cookie', badCookie).expect(200);
          assert.ok(renewed.headers['set-cookie']);
          assert.equal((renewed.body as { authenticated: boolean }).authenticated, false);
        }
      },
    );

    await t.test(
      'authenticated context exposes no identity; expiry, revocation, state and version invalidation replace session',
      async () => {
        for (const invalidate of [
          'none',
          'revoked',
          'absolute',
          'idle',
          'status',
          'credential',
          'authz',
          'key',
        ] as const) {
          const issued = anonymous();
          const record = records.get(issued.token)!;
          Object.assign(record, {
            kind: 'AUTHENTICATED',
            userId: randomUUID(),
            credentialVersion: 1,
            authzVersion: 1,
            user: {
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              passwordHash: 'never-expose',
              emailVerifiedAt: null,
              credentialVersion: 1,
              authzVersion: 1,
            },
          });
          if (invalidate === 'revoked') record.revokedAt = new Date();
          if (invalidate === 'absolute') record.absoluteExpiresAt = new Date(Date.now() - 1);
          if (invalidate === 'idle') {
            // Just past the configured idle timeout (default 60 minutes).
            record.lastActivityAt = new Date(
              Date.now() - environment.auth.idleTtlSeconds * 1_000 - 1,
            );
          }
          if (invalidate === 'status') record.user!.status = 'INACTIVE';
          if (invalidate === 'credential') record.user!.credentialVersion += 1;
          if (invalidate === 'authz') record.user!.authzVersion += 1;
          if (invalidate === 'key') record.csrfKeyVersion = 2;
          const response = await request(server)
            .get(path)
            .set('Cookie', cookieFor(issued.token))
            .expect(200);
          assert.equal(
            (response.body as { authenticated: boolean }).authenticated,
            invalidate === 'none',
          );
          assert.deepEqual(Object.keys(response.body as object).sort(), [
            'authenticated',
            'csrfToken',
          ]);
          assert.doesNotMatch(response.text, /never-expose|userId|credentialVersion|authzVersion/);
          if (invalidate !== 'none') assert.ok(response.headers['set-cookie']);
        }
      },
    );

    await t.test(
      'foreign browser context and HEAD cannot allocate sessions; CORS never reflects foreign Origin',
      async () => {
        const count = allocations;
        const foreign = await request(server)
          .get(path)
          .set('Origin', 'https://evil.example')
          .expect(403);
        assert.notEqual(foreign.headers['access-control-allow-origin'], 'https://evil.example');
        assert.notEqual(foreign.headers['access-control-allow-origin'], '*');
        await request(server).get(path).set('Sec-Fetch-Site', 'cross-site').expect(403);
        await request(server).head(path).expect(401);
        await request(server).head(path).set('Cookie', cookie).expect(200);
        assert.equal(allocations, count);
      },
    );

    await t.test(
      'creation is rate limited by direct peer, ignores spoofed forwarding and fails closed on database outage',
      async () => {
        const count = allocations;
        limited = true;
        const denied = await request(server)
          .get(path)
          .set('X-Forwarded-For', '203.0.113.44')
          .expect(429);
        assert.equal((denied.body as { code: string }).code, 'RATE_LIMITED');
        assert.equal(denied.headers['retry-after'], '900');
        assert.equal(allocations, count);
        assert.notEqual(peers.at(-1), '203.0.113.44');
        await request(server).get(path).set('Cookie', cookie).expect(200);
        limited = false;
        unavailable = true;
        const failure = await request(server).get(path).set('Cookie', cookie).expect(503);
        assert.equal((failure.body as { code: string }).code, 'SERVICE_UNAVAILABLE');
        assert.equal(failure.headers['set-cookie'], undefined);
        assert.equal(failure.headers['cache-control'], 'no-store');
        await request(server).post('/test-auth-mutation').set(headers).send({}).expect(503);
        unavailable = false;
        assert.doesNotMatch(logs.join('\n'), /never-expose|__Host-lucy_session|csrfToken/);
        assert.ok(!logs.join('\n').includes(token) && !logs.join('\n').includes(csrf));
      },
    );
  } finally {
    await app.close();
  }
});

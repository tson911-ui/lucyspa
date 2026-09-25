import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import type { Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { LeaveService } from '../leave/leave.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { csrfToken, generateCapability } from './crypto.js';
import { LoginService } from './login.service.js';
import { PasswordService } from './password.service.js';
import { sessionPrincipal, type SessionRecord } from './session.policy.js';
import { SessionService } from './session.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('session activity is recorded only for genuine requests that passed the guards', async () => {
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
  assert.equal(environment.auth.idleTtlSeconds, 3_600, '60-minute idle default');
  assert.equal(environment.auth.absoluteTtlSeconds, 43_200, '12-hour absolute default');
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
  const recorded: string[] = [];
  let recordFailure = false;
  let leaveFailure: Error | null = null;
  const leaveCalls: string[] = [];
  const leave = (name: string) => () => {
    leaveCalls.push(name);
    return (
      leaveFailure ? Promise.reject(leaveFailure) : Promise.resolve({ ok: name })
    ) as Promise<never>;
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
      recordActivity: (supplied: string) => {
        recorded.push(supplied);
        return recordFailure
          ? Promise.reject(new Error('database down'))
          : Promise.resolve('written');
      },
    })
    .overrideProvider(PasswordService)
    .useValue({})
    .overrideProvider(AuthThrottleService)
    .useValue({})
    .overrideProvider(LoginService)
    .useValue({ currentAccount: () => Promise.resolve({ id: record.userId }) })
    .overrideProvider(LeaveService)
    .useValue({ create: leave('create'), listOwn: leave('listOwn') })
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
  const body = { leaveType: 'SICK', startDate: '2027-03-10', endDate: '2027-03-10', reason: 'x' };
  const count = async () => {
    await tick();
    return recorded.length;
  };
  try {
    // A command that passes the CSRF/Origin guard counts as activity.
    await request(server).post('/api/v1/leave-requests').set(headers).send(body).expect(201);
    assert.equal(await count(), 1);
    assert.equal(recorded[0], token);
    // Requests rejected by the guard never reach the activity interceptor.
    await request(server)
      .post('/api/v1/leave-requests')
      .set({ Cookie: cookie, Origin: environment.webOrigin })
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/leave-requests')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    await request(server)
      .post('/api/v1/leave-requests')
      .set({ ...headers, 'X-CSRF-Token': 'forged' })
      .send(body)
      .expect(403);
    assert.equal(await count(), 1, 'CSRF-rejected requests record nothing');
    // Activity never grants access: the service's authorization decision stands.
    leaveFailure = new AuthError('FORBIDDEN');
    await request(server).post('/api/v1/leave-requests').set(headers).send(body).expect(403);
    await request(server)
      .get('/api/v1/leave-requests/me')
      .set({ Cookie: cookie, 'X-Lucy-Activity': 'user' })
      .expect(403);
    leaveFailure = new AuthError('AUTHENTICATION_REQUIRED');
    await request(server)
      .get('/api/v1/leave-requests/me')
      .set({ Cookie: cookie, 'X-Lucy-Activity': 'user' })
      .expect(401);
    leaveFailure = null;
    const afterDenied = await count();
    // Reads count only when the client marks them as user-initiated.
    await request(server).get('/api/v1/leave-requests/me').set({ Cookie: cookie }).expect(200);
    assert.equal(await count(), afterDenied, 'unmarked (background) reads never count');
    await request(server)
      .get('/api/v1/leave-requests/me')
      .set({ Cookie: cookie, 'X-Lucy-Activity': 'user' })
      .expect(200);
    assert.equal(await count(), afterDenied + 1);
    // Session resolution and health checks never count, even if marked.
    await request(server)
      .get('/api/v1/auth/me')
      .set({ Cookie: cookie, 'X-Lucy-Activity': 'user' })
      .expect(200);
    await request(server)
      .get('/api/v1/auth/context')
      .set({ Cookie: cookie, Origin: environment.webOrigin, 'X-Lucy-Activity': 'user' })
      .expect(200);
    await request(server).get('/health/live').set({ Cookie: cookie, 'X-Lucy-Activity': 'user' });
    assert.equal(await count(), afterDenied + 1);
    // No session cookie: nothing to record.
    await request(server)
      .get('/api/v1/leave-requests/me')
      .set({ 'X-Lucy-Activity': 'user' })
      .expect(200);
    assert.equal(await count(), afterDenied + 1);
    // A failure to record activity never fails the user's request.
    recordFailure = true;
    await request(server).post('/api/v1/leave-requests').set(headers).send(body).expect(201);
    assert.equal(await count(), afterDenied + 2);
    assert.ok(leaveCalls.length >= 5);
  } finally {
    await app.close();
  }
});

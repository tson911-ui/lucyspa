import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { MyAccountResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { MyAccountService } from './my-account.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

const account: MyAccountResponse = {
  id: randomUUID(),
  kind: 'EMPLOYEE',
  fullName: 'Nguyễn Anh Thư',
  phone: '+84905123456',
  email: null,
  locale: 'vi',
  status: 'ACTIVE',
  title: 'EMPLOYEE',
  employee: {
    employeeId: 'KTV-07',
    dateOfBirth: '1995-03-08',
    address: '5 Hai Bà Trưng',
    classification: 'OFFICIAL_EMPLOYEE',
    branches: [],
    skills: [],
  },
  version: 3,
};

test('My Account: session-only identity, CSRF on the write, strict allowlisted DTO', async () => {
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
    userId: account.id,
    credentialVersion: 1,
    authzVersion: 1,
    csrfKeyVersion: 1,
    createdAt: now,
    lastActivityAt: now,
    absoluteExpiresAt: new Date(Date.now() + 900_000),
    revokedAt: null,
    reauthenticatedAt: now,
    user: {
      kind: 'EMPLOYEE',
      status: 'ACTIVE',
      passwordHash: '$argon2id$fixture',
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  const calls: unknown[][] = [];
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
    .overrideProvider(MyAccountService)
    .useValue({
      get: (...args: unknown[]) => {
        calls.push(['get', ...args]);
        return Promise.resolve(account);
      },
      updateProfile: (...args: unknown[]) => {
        calls.push(['updateProfile', ...args]);
        return Promise.resolve(account);
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
  const path = '/api/v1/me/account/profile';
  const body = { expectedVersion: 3, fullName: 'Anh Thư', phone: '0905 123 456' };
  const updates = () => calls.filter(([name]) => name === 'updateProfile').length;
  try {
    const read = await request(server)
      .get('/api/v1/me/account')
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(read.body, account);
    // The session cookie is the only identity passed to the service.
    assert.deepEqual(calls.at(-1), ['get', token]);
    // Missing CSRF token, wrong Origin and missing Origin are refused before the service.
    await request(server)
      .post(path)
      .set({ Cookie: cookie, Origin: headers.Origin })
      .send(body)
      .expect(403);
    await request(server)
      .post(path)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    await request(server)
      .post(path)
      .set({ Cookie: cookie, 'X-CSRF-Token': headers['X-CSRF-Token'] })
      .send(body)
      .expect(403);
    assert.equal(updates(), 0);
    // Administrative and security fields are rejected outright (no mass assignment).
    for (const extra of [
      { employeeId: 'X' },
      { classification: 'OFFICIAL_EMPLOYEE' },
      { status: 'ACTIVE' },
      { kind: 'OWNER' },
      { branchIds: [randomUUID()] },
      { skillIds: [randomUUID()] },
      { roleIds: [randomUUID()] },
      { baseSalaryVnd: '1' },
      { email: 'x@example.com' },
      { password: 'a calm lotus evening' },
      { userId: randomUUID() },
      { id: randomUUID() },
      { locale: 'fr' },
      { phone: 905123456 },
    ]) {
      await request(server)
        .post(path)
        .set(headers)
        .send({ ...body, ...extra })
        .expect(400);
    }
    await request(server).post(path).set(headers).send({ fullName: 'No version' }).expect(400);
    assert.equal(updates(), 0);
    const updated = await request(server).post(path).set(headers).send(body).expect(200);
    assert.deepEqual(updated.body, account);
    const [name, session, sent] = calls.at(-1) ?? [];
    assert.deepEqual(
      [name, session, JSON.parse(JSON.stringify(sent))],
      ['updateProfile', token, body],
    );
    // No per-account path exists under /me.
    await request(server)
      .get(`/api/v1/me/account/${randomUUID()}`)
      .set({ Cookie: cookie })
      .expect(404);
  } finally {
    await app.close();
  }
});

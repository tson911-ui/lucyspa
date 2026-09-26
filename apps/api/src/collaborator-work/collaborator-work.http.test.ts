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
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { LoginService } from '../auth/login.service.js';
import { CollaboratorWorkService } from './collaborator-work.service.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('collaborator work: CSRF/Origin on commands, strict DTOs, integer-VND strings only', async () => {
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
  const calls: unknown[][] = [];
  let outcome: Error | null = null;
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
    .overrideProvider(CollaboratorWorkService)
    .useValue(
      Object.fromEntries(
        ['create', 'update', 'cancel', 'list', 'mine', 'options'].map((name) => [
          name,
          (...args: unknown[]) => {
            calls.push([name, ...args]);
            return outcome ? Promise.reject(outcome) : Promise.resolve({ items: [] });
          },
        ]),
      ),
    )
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
  const id = '00000000-0000-4000-8000-000000000001';
  const create = {
    employeeId: '00000000-0000-4000-8000-000000000001',
    branchId: '00000000-0000-4000-8000-000000000001',
    workDate: '2026-10-05',
    mode: 'SHIFT',
    startTime: '13:00',
    endTime: '18:00',
    agreedPayVnd: '80000',
  };
  const routes: [string, object][] = [
    ['/api/v1/collaborator-work', create],
    [`/api/v1/collaborator-work/${id}`, { expectedVersion: 1, agreedPayVnd: '90000' }],
    [`/api/v1/collaborator-work/${id}/cancel`, { expectedVersion: 1, reason: 'Hủy' }],
  ];
  try {
    for (const [path, body] of routes) {
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
    }
    // Pay is an integer-VND string (never a number or a rate); no computed fields accepted.
    for (const extra of [
      { agreedPayVnd: 80000 },
      { agreedPayVnd: '80000.5' },
      { agreedPayVnd: '-1' },
      { hourlyRateVnd: '16000' },
      { hours: 5 },
      { mode: 'HOURLY' },
      { workDate: '05/10/2026' },
      { startTime: '1pm' },
      { status: 'CANCELLED' },
      { createdByUserId: id },
    ]) {
      await request(server)
        .post('/api/v1/collaborator-work')
        .set(headers)
        .send({ ...create, ...extra })
        .expect(400);
    }
    await request(server)
      .post(`/api/v1/collaborator-work/${id}/cancel`)
      .set(headers)
      .send({ expectedVersion: 1 })
      .expect(400);
    await request(server)
      .get('/api/v1/collaborator-work?from=2026-10-01')
      .set({ Cookie: cookie })
      .expect(400);
    assert.equal(calls.length, 0, 'nothing reached the service');
    await request(server).post('/api/v1/collaborator-work').set(headers).send(create).expect(201);
    assert.equal(calls.at(-1)?.[0], 'create');
    assert.equal(calls.at(-1)?.[1], token);
    await request(server)
      .get('/api/v1/collaborator-work?from=2026-10-01&to=2026-10-14')
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get('/api/v1/me/collaborator-work?from=2026-10-01&to=2026-10-14')
      .set({ Cookie: cookie })
      .expect(200);
    assert.deepEqual(calls.at(-1)?.slice(0, 2), ['mine', token]);
    outcome = new AuthError('FORBIDDEN', 'agreedPayVnd');
    const refused = await request(server)
      .post('/api/v1/collaborator-work')
      .set(headers)
      .send(create)
      .expect(403);
    assert.equal(refused.body.code, 'FORBIDDEN');
  } finally {
    await app.close();
  }
});

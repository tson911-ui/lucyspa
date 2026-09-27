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
import { ServiceExecutionService } from './service-execution.service.js';

// Auth/transport coverage for the final gate; not executed during implementation.
test('execution HTTP: empty bodies only, CSRF/Origin, authoritative response and safe errors', async () => {
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
  const calls: string[] = [];
  let outcome: AuthError | null = null;
  const result = {
    lineId: randomUUID(),
    status: 'IN_PROGRESS',
    execution: { startedAt: now.toISOString() },
  };
  const answer = (action: string) => () => {
    calls.push(action);
    return outcome ? Promise.reject(outcome) : Promise.resolve(result);
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
    .overrideProvider(ServiceExecutionService)
    .useValue({
      myWork: answer('list'),
      get: answer('get'),
      start: answer('start'),
      end: answer('end'),
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
  try {
    for (const action of ['start', 'end']) {
      const path = `/api/v1/operations/service-lines/${result.lineId}/${action}`;
      await request(server)
        .post(path)
        .set({ Cookie: cookie, Origin: headers.Origin })
        .send({})
        .expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send({})
        .expect(403);
      for (const body of [
        { startedAt: now.toISOString() },
        { endedAt: now.toISOString() },
        { expectedEndAt: now.toISOString() },
        { employeeUserId: randomUUID() },
        { branchId: randomUUID() },
        { status: 'DONE' },
        { reason: 'resolve' },
        [],
      ])
        await request(server).post(path).set(headers).send(body).expect(400);
      assert.ok(!calls.includes(action));
      const response = await request(server).post(path).set(headers).send({}).expect(200);
      assert.deepEqual(response.body, result);
    }
    await request(server)
      .get(`/api/v1/operations/service-lines/${result.lineId}/execution`)
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get(`/api/v1/operations/branches/${randomUUID()}/my-services`)
      .set({ Cookie: cookie })
      .expect(200);
    for (const code of [
      'SERVICE_SEQUENCE_BLOCKED',
      'SERVICE_KTV_BUSY',
      'SERVICE_EXECUTION_CONFLICT',
    ] as const) {
      outcome = new AuthError(code);
      const response = await request(server)
        .post(`/api/v1/operations/service-lines/${result.lineId}/start`)
        .set(headers)
        .send({})
        .expect(409);
      assert.equal(response.body.code, code);
      assert.doesNotMatch(JSON.stringify(response.body), /prisma|SELECT|constraint|postgres/i);
    }
  } finally {
    await app.close();
  }
});

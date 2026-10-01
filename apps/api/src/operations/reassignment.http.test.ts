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
import { ReassignmentService } from './reassignment.service.js';

// Strict transport coverage prepared for the final gate; NOT EXECUTED in Step 8.
test('reassignment HTTP: session CSRF/Origin, versioned explicit body, no client authority fields', async () => {
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
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
      emailVerifiedAt: null,
      credentialVersion: 1,
      authzVersion: 1,
    },
  };
  let writes = 0;
  let outcome: AuthError | null = null;
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
    .overrideProvider(ReassignmentService)
    .useValue({
      list: () => Promise.resolve({ lines: [] }),
      replacements: () => Promise.resolve({ candidates: [] }),
      reassign: () => {
        writes++;
        return outcome ? Promise.reject(outcome) : Promise.resolve({ lines: [] });
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
  const id = randomUUID();
  const path = `/api/v1/operations/assignment-lines/VISIT/${id}/reassign`;
  const body = {
    scope: 'LINE',
    targets: [{ id, expectedVersion: 2 }],
    employeeUserId: randomUUID(),
    context: 'LEAVE',
    reason: 'Approved leave',
    acknowledgeSpecific: true,
  };
  try {
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
    for (const invalid of [
      {},
      { ...body, reason: undefined },
      { ...body, acknowledgeSpecific: undefined },
      { ...body, targets: [{ id }] },
      { ...body, targets: [] },
      { ...body, scope: 'VISIT' },
      { ...body, occurredAt: now.toISOString() },
      { ...body, employeeUserId: 'bad' },
      { ...body, status: 'PLANNED' },
      { ...body, plannedStartAt: now.toISOString() },
      { ...body, assignmentMode: 'ANY' },
      { ...body, branchId: randomUUID() },
    ])
      await request(server).post(path).set(headers).send(invalid).expect(400);
    assert.equal(writes, 0);
    const response = await request(server).post(path).set(headers).send(body).expect(200);
    assert.deepEqual(response.body, { lines: [] });
    assert.equal(writes, 1);
    await request(server)
      .get(`/api/v1/operations/assignment-lines/VISIT/${id}/replacements`)
      .query({ scope: 'PARTICIPANT' })
      .set({ Cookie: cookie })
      .expect(200);
    await request(server)
      .get(`/api/v1/operations/assignment-lines/VISIT/${id}/replacements`)
      .query({ scope: 'LINE', includePrivateData: 'true' })
      .set({ Cookie: cookie })
      .expect(400);
    await request(server)
      .get(`/api/v1/operations/branches/${id}/reassignment-work`)
      .query({ conflictsOnly: 'true' })
      .set({ Cookie: cookie })
      .expect(200);
    for (const code of [
      'REASSIGNMENT_CONFLICT',
      'REASSIGNMENT_KTV_UNAVAILABLE',
      'REASSIGNMENT_NOT_ALLOWED',
    ] as const) {
      outcome = new AuthError(code);
      const failure = await request(server).post(path).set(headers).send(body).expect(409);
      assert.equal(failure.body.code, code);
      assert.doesNotMatch(JSON.stringify(failure.body), /prisma|SELECT|constraint|postgres/i);
    }
  } finally {
    await app.close();
  }
});

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { ApiErrorResponse } from '@lucy-spa/contracts';
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
import { ServiceCatalogService } from './service-catalog.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('permanent deletion routes enforce CSRF/origin, strict bodies and error mapping', async () => {
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
  let failure: Error | null = null;
  const respond =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return (failure ? Promise.reject(failure) : Promise.resolve({ ok: name })) as Promise<never>;
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
    .overrideProvider(ServiceCatalogService)
    .useValue({
      deleteService: respond('deleteService'),
      deleteCategory: respond('deleteCategory'),
    })
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const server = app.getHttpServer() as Server;
  const headers = {
    Origin: environment.webOrigin,
    Cookie: `${environment.auth.cookieName}=${token}`,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  const id = randomUUID();
  const routes: [string, string][] = [
    ['deleteService', `/api/v1/services/${id}/delete`],
    ['deleteCategory', `/api/v1/service-categories/${id}/delete`],
  ];
  try {
    for (const [, path] of routes) {
      // Destructive commands use the same global CSRF/Origin protection as every POST.
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, Origin: headers.Origin })
        .send({ expectedVersion: 1 })
        .expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send({ expectedVersion: 1 })
        .expect(403);
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, 'X-CSRF-Token': headers['X-CSRF-Token'] })
        .send({ expectedVersion: 1 })
        .expect(403);
      for (const bad of [
        {},
        { expectedVersion: '1' },
        { expectedVersion: 0 },
        { expectedVersion: 1, cascade: true },
        { expectedVersion: 1, force: true },
      ]) {
        await request(server).post(path).set(headers).send(bad).expect(400);
      }
      // No DELETE-method route exists: the command is a CSRF-protected POST.
      await request(server).delete(path.replace('/delete', '')).set(headers).expect(404);
    }
    assert.equal(calls.length, 0, 'nothing reached the service');

    for (const [name, path] of routes) {
      await request(server)
        .post(path)
        .set(headers)
        .send({ expectedVersion: 3, reason: 'Entered by mistake' })
        .expect(200);
      const call = calls.at(-1);
      assert.deepEqual(call?.slice(0, 3), [name, token, id]);
      assert.deepEqual(JSON.parse(JSON.stringify(call?.[3])), {
        expectedVersion: 3,
        reason: 'Entered by mistake',
      });
    }
    for (const [error, status] of [
      [new AuthError('CONFLICT', 'inUse'), 409],
      [new AuthError('CONFLICT', 'services'), 409],
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post(routes[0]![1])
        .set(headers)
        .send({ expectedVersion: 1 })
        .expect(status);
      const payload = response.body as ApiErrorResponse;
      assert.equal(payload.code, error.code);
      if (error.field) assert.match(String(payload.message), new RegExp(`: ${error.field}$`));
    }
  } finally {
    await app.close();
  }
});

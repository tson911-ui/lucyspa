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

test('service catalog commands enforce CSRF/origin, strict DTOs and their contracts', async () => {
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
      listCategories: respond('listCategories'),
      createCategory: respond('createCategory'),
      updateCategory: respond('updateCategory'),
      setCategoryStatus: respond('setCategoryStatus'),
      listServices: respond('listServices'),
      getService: respond('getService'),
      createService: respond('createService'),
      updateService: respond('updateService'),
      setServiceStatus: respond('setServiceStatus'),
      setPrice: respond('setPrice'),
      setAvailability: respond('setAvailability'),
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
  const branchId = randomUUID();
  const service = {
    code: 'FOOT_30',
    categoryId: id,
    nameVi: 'Massage chân',
    nameEn: 'Foot massage',
    priceVnd: '150000',
    priceMaxVnd: '200000',
    pricingUnit: 'PER_SERVICE',
    durationMinutes: 30,
    estimatedMinMinutes: 20,
    estimatedMaxMinutes: 30,
  };
  const commands: [string, object, number][] = [
    ['/api/v1/service-categories', { code: 'HAIR', nameVi: 'Gội', nameEn: 'Hair' }, 201],
    [`/api/v1/service-categories/${id}`, { expectedVersion: 1, nameEn: 'Hair care' }, 200],
    [
      `/api/v1/service-categories/${id}/status`,
      { expectedVersion: 1, isActive: false, reason: 'x' },
      200,
    ],
    ['/api/v1/services', service, 201],
    [
      `/api/v1/services/${id}`,
      {
        expectedVersion: 1,
        durationMinutes: 35,
        estimatedMaxMinutes: 35,
        descriptionVi: null,
      },
      200,
    ],
    [`/api/v1/services/${id}/status`, { expectedVersion: 1, isActive: false, reason: 'x' }, 200],
    [
      `/api/v1/services/${id}/price`,
      {
        expectedVersion: 1,
        priceVnd: '5000',
        priceMaxVnd: '10000',
        pricingUnit: 'PER_NAIL',
        reason: 'Menu',
      },
      200,
    ],
    [`/api/v1/services/${id}/branches/${branchId}`, { expectedVersion: null, isActive: true }, 200],
  ];
  try {
    for (const [path, body] of commands) {
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, Origin: headers.Origin })
        .send(body)
        .expect(403);
      await request(server)
        .post(path)
        .set({ ...headers, Origin: 'https://evil.example' })
        .send(body)
        .expect(403);
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, 'X-CSRF-Token': headers['X-CSRF-Token'] })
        .send(body)
        .expect(403);
    }
    for (const [path, body] of [
      // Price never travels with master data, and codes never change.
      [`/api/v1/services/${id}`, { expectedVersion: 1, priceVnd: '1' }],
      [`/api/v1/services/${id}`, { expectedVersion: 1, code: 'NEW' }],
      [`/api/v1/service-categories/${id}`, { expectedVersion: 1, code: 'NEW' }],
      ['/api/v1/services', { ...service, priceVnd: 150000 }],
      ['/api/v1/services', { ...service, priceVnd: '-1' }],
      ['/api/v1/services', { ...service, priceVnd: '1.5' }],
      ['/api/v1/services', { ...service, durationMinutes: '30' }],
      ['/api/v1/services', { ...service, estimatedMinMinutes: '20' }],
      ['/api/v1/services', { ...service, priceMaxVnd: 200000 }],
      ['/api/v1/services', { ...service, priceMaxVnd: '-1' }],
      ['/api/v1/services', { ...service, pricingUnit: 'PER_HOUR' }],
      ['/api/v1/services', { ...service, pricingUnit: 'per_nail' }],
      [
        `/api/v1/services/${id}/price`,
        { expectedVersion: 1, priceVnd: '1', reason: 'x', pricingUnit: 'PER_TOE' },
      ],
      [
        `/api/v1/services/${id}/price`,
        { expectedVersion: 1, priceVnd: '1', reason: 'x', priceMaxVnd: 2 },
      ],
      [`/api/v1/services/${id}`, { expectedVersion: 1, pricingUnit: 'PER_NAIL' }],
      ['/api/v1/services', { ...service, estimatedMaxMinutes: 30.5 }],
      ['/api/v1/services', { ...service, estimatedDurationText: '30-45 phút' }],
      [`/api/v1/services/${id}`, { expectedVersion: 1, estimatedMinMinutes: '15' }],
      ['/api/v1/services', { ...service, tourAmountVnd: '15000' }],
      ['/api/v1/services', { ...service, durationMinutes: undefined }],
      [`/api/v1/services/${id}/price`, { expectedVersion: 1, priceVnd: '1' }],
      [`/api/v1/services/${id}/status`, { expectedVersion: 1, isActive: false }],
      [`/api/v1/services/${id}/branches/${branchId}`, { isActive: true }],
      [`/api/v1/services/${id}/branches/${branchId}`, { expectedVersion: 0, isActive: true }],
      [
        `/api/v1/service-categories`,
        { code: 'HAIR', nameVi: 'Gội', nameEn: 'Hair', isActive: false },
      ],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, 0);

    for (const [path, body, status] of commands) {
      await request(server).post(path).set(headers).send(body).expect(status);
    }
    await request(server)
      .get('/api/v1/service-categories')
      .set({ Cookie: headers.Cookie })
      .expect(200);
    await request(server)
      .get('/api/v1/services')
      .query({ branchId, categoryId: id })
      .set({ Cookie: headers.Cookie })
      .expect(200);
    await request(server).get(`/api/v1/services/${id}`).set({ Cookie: headers.Cookie }).expect(200);
    await request(server)
      .get('/api/v1/services')
      .query({ unknown: 'x' })
      .set({ Cookie: headers.Cookie })
      .expect(400);
    // The duration estimate reaches the service unchanged (create and update).
    assert.deepEqual(JSON.parse(JSON.stringify(calls[3]?.[2])), service);
    assert.deepEqual(
      (JSON.parse(JSON.stringify(calls[4]?.[3])) as Record<string, unknown>)['estimatedMaxMinutes'],
      35,
    );
    assert.deepEqual(calls[6]?.slice(0, 3), ['setPrice', token, id]);
    // The price range and pricing unit reach the price command unchanged.
    assert.deepEqual(JSON.parse(JSON.stringify(calls[6]?.[3])), {
      expectedVersion: 1,
      priceVnd: '5000',
      priceMaxVnd: '10000',
      pricingUnit: 'PER_NAIL',
      reason: 'Menu',
    });
    assert.deepEqual(calls[7]?.slice(0, 4), ['setAvailability', token, id, branchId]);
    assert.deepEqual(calls.at(-2)?.slice(0, 2), ['listServices', token]);
    assert.deepEqual(calls.at(-2)?.[2], { categoryId: id, branchId });

    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('CONFLICT'), 409],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post(commands[6]![0])
        .set(headers)
        .send(commands[6]![1])
        .expect(status);
      assert.equal((response.body as ApiErrorResponse).code, error.code);
    }
  } finally {
    await app.close();
  }
});

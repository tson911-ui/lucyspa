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
import { ServiceCatalogService } from '../catalog/service-catalog.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { SkillService } from './skill.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

test('skill and eligible-skill commands enforce CSRF/origin, strict DTOs and contracts', async () => {
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
    .overrideProvider(SkillService)
    .useValue({
      listSkills: respond('listSkills'),
      createSkill: respond('createSkill'),
      updateSkill: respond('updateSkill'),
      setSkillStatus: respond('setSkillStatus'),
      employeeSkills: respond('employeeSkills'),
      grantEmployeeSkill: respond('grantEmployeeSkill'),
      revokeEmployeeSkill: respond('revokeEmployeeSkill'),
    })
    .overrideProvider(ServiceCatalogService)
    .useValue({ setEligibleSkills: respond('setEligibleSkills') })
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
  const skillId = randomUUID();
  const commands: [string, object, number][] = [
    ['/api/v1/skills', { code: 'HAIR', nameVi: 'Gội', nameEn: 'Hair' }, 201],
    [`/api/v1/skills/${id}`, { expectedVersion: 1, nameEn: 'Hair care' }, 200],
    [`/api/v1/skills/${id}/status`, { expectedVersion: 1, isActive: false, reason: 'x' }, 200],
    [`/api/v1/services/${id}/skills`, { expectedVersion: 1, skillIds: [skillId] }, 200],
    [`/api/v1/employees/${id}/skills`, { skillId }, 200],
    [`/api/v1/employees/${id}/skills/${skillId}/revoke`, { reason: 'Retrained' }, 200],
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
      ['/api/v1/skills', { code: 'HAIR', nameVi: 'Gội', nameEn: 'Hair', isActive: false }],
      [`/api/v1/skills/${id}`, { expectedVersion: 1, code: 'NEW' }],
      [`/api/v1/skills/${id}/status`, { expectedVersion: 1, isActive: false }],
      [`/api/v1/services/${id}/skills`, { skillIds: [skillId] }],
      [`/api/v1/services/${id}/skills`, { expectedVersion: 1, skillIds: skillId }],
      [`/api/v1/employees/${id}/skills`, { skillId, branchId: randomUUID() }],
      [`/api/v1/employees/${id}/skills`, {}],
      [`/api/v1/employees/${id}/skills/${skillId}/revoke`, { expectedVersion: 1 }],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, 0);

    for (const [path, body, status] of commands) {
      await request(server).post(path).set(headers).send(body).expect(status);
    }
    await request(server).get('/api/v1/skills').set({ Cookie: headers.Cookie }).expect(200);
    await request(server)
      .get(`/api/v1/employees/${id}/skills`)
      .set({ Cookie: headers.Cookie })
      .expect(200);
    assert.deepEqual(calls[3]?.slice(0, 3), ['setEligibleSkills', token, id]);
    assert.deepEqual(calls[4]?.slice(0, 3), ['grantEmployeeSkill', token, id]);
    assert.deepEqual(calls[5]?.slice(0, 4), ['revokeEmployeeSkill', token, id, skillId]);

    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('CONFLICT', 'skillId'), 409],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post(commands[4]![0])
        .set(headers)
        .send(commands[4]![1])
        .expect(status);
      assert.equal((response.body as ApiErrorResponse).code, error.code);
    }
  } finally {
    await app.close();
  }
});

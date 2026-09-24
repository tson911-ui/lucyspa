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
import { AuditReadService } from './audit-read.service.js';
import { RoleAdminService } from './role-admin.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

async function application(roles: Partial<RoleAdminService>, audit: Partial<AuditReadService>) {
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
    .overrideProvider(RoleAdminService)
    .useValue(roles)
    .overrideProvider(AuditReadService)
    .useValue(audit)
    .compile();
  const app = module.createNestApplication({ logger: false });
  configureHttp(app, environment, pino({ level: 'silent' }));
  await app.init();
  const headers = {
    Origin: environment.webOrigin,
    Cookie: `${environment.auth.cookieName}=${token}`,
    'X-CSRF-Token': csrfToken(record.id, token, environment.auth.csrfKeys.get(1)!),
  };
  return { app, server: app.getHttpServer() as Server, headers, token };
}

test('role/override commands enforce CSRF/origin, strict DTOs and scope shape', async () => {
  const calls: unknown[][] = [];
  let failure: Error | null = null;
  const respond =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return (failure ? Promise.reject(failure) : Promise.resolve({ ok: name })) as Promise<never>;
    };
  const { app, server, headers, token } = await application(
    {
      listRoles: respond('listRoles'),
      createRole: respond('createRole'),
      updateRole: respond('updateRole'),
      setRolePermissions: respond('setRolePermissions'),
      employeeAuthorization: respond('employeeAuthorization'),
      assignRole: respond('assignRole'),
      revokeRole: respond('revokeRole'),
      setOverride: respond('setOverride'),
      removeOverride: respond('removeOverride'),
    },
    { list: respond('audit') },
  );
  const id = randomUUID();
  const branchId = randomUUID();
  const commands: [string, object][] = [
    [
      '/api/v1/roles',
      {
        code: 'BRANCH_MANAGER',
        displayNameVi: 'Quản lý',
        displayNameEn: 'Manager',
        permissions: ['VIEW_EMPLOYEES'],
        reason: 'Setup',
      },
    ],
    [`/api/v1/roles/${id}`, { expectedVersion: 1, displayNameEn: 'Lead', reason: 'Rename' }],
    [
      `/api/v1/roles/${id}/permissions`,
      { expectedVersion: 1, permissions: ['VIEW_EMPLOYEES'], reason: 'Edit' },
    ],
    [
      `/api/v1/employees/${id}/roles`,
      { expectedVersion: 1, roleId: id, scope: { kind: 'BRANCH', branchId }, reason: 'Grant' },
    ],
    [
      `/api/v1/employees/${id}/roles/revoke`,
      { expectedVersion: 1, assignmentId: id, reason: 'Revoke' },
    ],
    [
      `/api/v1/employees/${id}/overrides`,
      {
        expectedVersion: 1,
        permission: 'VIEW_EMPLOYEES',
        effect: 'DENY',
        scope: { kind: 'GLOBAL' },
        reason: 'Deny',
      },
    ],
    [
      `/api/v1/employees/${id}/overrides/remove`,
      { expectedVersion: 1, overrideId: id, reason: 'Lift' },
    ],
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
      // Codes outside the catalog, OWNER-like kinds and unknown fields are rejected.
      [
        '/api/v1/roles',
        {
          code: 'X',
          displayNameVi: 'X',
          displayNameEn: 'X',
          permissions: ['GRANT_EVERYTHING'],
          reason: 'x',
        },
      ],
      [
        '/api/v1/roles',
        {
          code: 'X',
          displayNameVi: 'X',
          displayNameEn: 'X',
          permissions: [],
          reason: 'x',
          kind: 'OWNER',
        },
      ],
      [`/api/v1/roles/${id}`, { expectedVersion: 1, code: 'RENAMED', reason: 'x' }],
      [
        `/api/v1/employees/${id}/roles`,
        { expectedVersion: 1, roleId: id, scope: { kind: 'BRANCH' }, reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/roles`,
        { expectedVersion: 1, roleId: id, scope: { kind: 'GLOBAL', branchId }, reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/roles`,
        { expectedVersion: 1, roleId: id, scope: { kind: 'OWNER' }, reason: 'x' },
      ],
      [`/api/v1/employees/${id}/roles`, { expectedVersion: 1, roleId: id, reason: 'x' }],
      [
        `/api/v1/employees/${id}/overrides`,
        {
          expectedVersion: 1,
          permission: 'VIEW_EMPLOYEES',
          effect: 'MAYBE',
          scope: { kind: 'GLOBAL' },
          reason: 'x',
        },
      ],
      [`/api/v1/employees/${id}/overrides/remove`, { overrideId: id, reason: 'no version' }],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    assert.equal(calls.length, 0);

    await request(server).post(commands[0]![0]).set(headers).send(commands[0]![1]).expect(201);
    for (const [path, body] of commands.slice(1)) {
      await request(server).post(path).set(headers).send(body).expect(200);
    }
    assert.deepEqual(calls[0]?.slice(0, 2), ['createRole', token]);
    assert.deepEqual(calls[3]?.slice(0, 3), ['assignRole', token, id]);
    assert.deepEqual((calls[3]?.[3] as { scope: unknown }).scope, { kind: 'BRANCH', branchId });
    assert.deepEqual((calls[5]?.[3] as { scope: unknown }).scope, { kind: 'GLOBAL' });

    // Reads need no CSRF token.
    await request(server).get('/api/v1/roles').set({ Cookie: headers.Cookie }).expect(200);
    await request(server)
      .get(`/api/v1/employees/${id}/authorization`)
      .set({ Cookie: headers.Cookie })
      .expect(200);

    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('CONFLICT'), 409],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post(commands[3]![0])
        .set(headers)
        .send(commands[3]![1])
        .expect(status);
      assert.equal((response.body as ApiErrorResponse).code, error.code);
    }
  } finally {
    await app.close();
  }
});

test('audit read is a strict, session-identified GET', async () => {
  const calls: unknown[][] = [];
  const { app, server, headers, token } = await application(
    {},
    {
      list: (...args: unknown[]) => {
        calls.push(args);
        return Promise.resolve({ items: [], nextCursor: null });
      },
    },
  );
  try {
    const page = await request(server)
      .get('/api/v1/audit-events')
      .query({ limit: '25', action: 'ROLE_ASSIGNED', branchId: randomUUID() })
      .set({ Cookie: headers.Cookie })
      .expect(200);
    assert.deepEqual(page.body, { items: [], nextCursor: null });
    assert.equal(calls[0]?.[0], token);
    assert.equal((calls[0]?.[1] as { limit: number }).limit, 25);
    for (const query of [{ limit: '0' }, { limit: 'many' }, { unknown: 'x' }]) {
      await request(server)
        .get('/api/v1/audit-events')
        .query(query)
        .set({ Cookie: headers.Cookie })
        .expect(400);
    }
    // No write method exists for audit history.
    await request(server).post('/api/v1/audit-events').set(headers).send({}).expect(404);
    assert.equal(calls.length, 1);
  } finally {
    await app.close();
  }
});

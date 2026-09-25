import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { test } from 'node:test';
import type { ApiErrorResponse, EmployeeResponse } from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { Test } from '@nestjs/testing';
import { pino } from 'pino';
import request from 'supertest';
import { AppModule } from '../app.module.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { csrfToken, generateCapability } from '../auth/crypto.js';
import { EmployeeSetupService } from '../auth/employee-setup.service.js';
import { LoginService } from '../auth/login.service.js';
import { RateLimitedError } from '../auth/otp-flow.js';
import { PasswordService } from '../auth/password.service.js';
import { sessionPrincipal, type SessionRecord } from '../auth/session.policy.js';
import { SessionService } from '../auth/session.service.js';
import { configureHttp } from '../platform/configure-http.js';
import { InfrastructureService } from '../platform/infrastructure.service.js';
import { EmployeeService } from './employee.service.js';

const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });

async function application(
  employees: Partial<EmployeeService>,
  setups: Partial<EmployeeSetupService>,
) {
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
    .overrideProvider(EmployeeService)
    .useValue(employees)
    .overrideProvider(EmployeeSetupService)
    .useValue(setups)
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

const employee: EmployeeResponse = {
  id: randomUUID(),
  employeeId: 'KTV-01',
  fullName: 'Nguyễn Thị Linh',
  dateOfBirth: '1996-04-12',
  address: '12 Lê Lợi',
  phone: '+84912345678',
  email: null,
  emailVerified: false,
  locale: 'vi',
  status: 'PENDING_SETUP',
  branchIds: [randomUUID()],
  version: 1,
};

test('employee commands enforce CSRF/origin, strict DTOs and their contracts', async () => {
  const calls: unknown[][] = [];
  let failure: Error | null = null;
  const respond =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, ...args]);
      return failure ? Promise.reject(failure) : Promise.resolve(employee);
    };
  const { app, server, headers, token } = await application(
    {
      create: respond('create'),
      get: respond('get'),
      updateProfile: respond('updateProfile'),
      changeStatus: respond('changeStatus'),
      changeScope: respond('changeScope'),
      setBaseSalary: respond('setBaseSalary'),
      employment: respond('employment') as never,
      changeClassification: respond('changeClassification') as never,
      setCredentials: respond('setCredentials'),
      endEmployment: respond('endEmployment') as never,
      issueSetup: (...args: unknown[]) => {
        calls.push(['issueSetup', ...args]);
        return Promise.resolve({
          setupToken: generateCapability(),
          expiresAt: new Date().toISOString(),
        });
      },
    },
    {},
  );
  const id = employee.id;
  const create = {
    employeeId: 'ktv-01',
    fullName: 'Nguyễn Thị Linh',
    dateOfBirth: '1996-04-12',
    address: '12 Lê Lợi',
    phone: '0912345678',
    locale: 'vi',
    branchIds: employee.branchIds,
    baseSalaryVnd: '8500000',
    classification: 'OFFICIAL_EMPLOYEE',
    employmentStartDate: '2026-10-01',
  };
  const commands: [string, object][] = [
    ['/api/v1/employees', create],
    [`/api/v1/employees/${id}/profile`, { expectedVersion: 1, fullName: 'Linh' }],
    [`/api/v1/employees/${id}/status`, { expectedVersion: 1, status: 'INACTIVE', reason: 'Left' }],
    [`/api/v1/employees/${id}/scope`, { expectedVersion: 1, branchIds: [], reason: 'Move' }],
    [
      `/api/v1/employees/${id}/base-salary`,
      { expectedVersion: 1, baseSalaryVnd: null, reason: 'Unknown' },
    ],
    [`/api/v1/employees/${id}/setup`, { expectedVersion: 1, reason: 'Onboarding' }],
  ];
  try {
    for (const [path, body] of commands) {
      // Missing CSRF token, wrong Origin and missing Origin are all refused before the service.
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
    // Mass assignment of security fields is rejected.
    for (const extra of [
      { status: 'ACTIVE' },
      { kind: 'OWNER' },
      { password: 'a calm lotus evening' },
      { emailVerified: true },
      { roleIds: [randomUUID()] },
      // The initial classification is explicit, never ENDED, with a real start date.
      { classification: 'ENDED' },
      { classification: undefined },
      { classification: 'trainee' },
      { employmentStartDate: undefined },
      { employmentStartDate: '01/10/2026' },
      { employmentStartDate: '2026-10-01T00:00:00Z' },
      { isTrainee: true },
      // The optional initial password is a string, never another type or a username.
      { initialPassword: 123456789012345 },
      { username: 'NV001' },
    ]) {
      await request(server)
        .post('/api/v1/employees')
        .set(headers)
        .send({ ...create, ...extra })
        .expect(400);
    }
    for (const [path, body] of [
      [`/api/v1/employees/${id}/profile`, { expectedVersion: 1, phone: '0912345679' }],
      [`/api/v1/employees/${id}/profile`, { expectedVersion: 1, email: 'x@example.com' }],
      [`/api/v1/employees/${id}/profile`, { expectedVersion: 1, baseSalaryVnd: '1' }],
      [`/api/v1/employees/${id}/profile`, { fullName: 'No version' }],
      [
        `/api/v1/employees/${id}/status`,
        { expectedVersion: 1, status: 'PENDING_SETUP', reason: 'x' },
      ],
      [`/api/v1/employees/${id}/status`, { expectedVersion: 1, status: 'INACTIVE' }],
      [
        `/api/v1/employees/${id}/base-salary`,
        { expectedVersion: 1, baseSalaryVnd: '-1', reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/base-salary`,
        { expectedVersion: 1, baseSalaryVnd: '1.5', reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/base-salary`,
        { expectedVersion: 1, baseSalaryVnd: 100, reason: 'x' },
      ],
      [`/api/v1/employees/${id}/scope`, { expectedVersion: 0, branchIds: [], reason: 'x' }],
      // Classification changes: only OFFICIAL_EMPLOYEE or ENDED, a date, a reason, a version.
      [
        `/api/v1/employees/${id}/employment`,
        { expectedVersion: 1, classification: 'TRAINEE', effectiveDate: '2026-12-15', reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/employment`,
        { expectedVersion: 1, classification: 'OFFICIAL_EMPLOYEE', effectiveDate: '2026-12-15' },
      ],
      [
        `/api/v1/employees/${id}/employment`,
        { classification: 'OFFICIAL_EMPLOYEE', effectiveDate: '2026-12-15', reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/employment`,
        { expectedVersion: 1, classification: 'ENDED', effectiveDate: '15/12/2026', reason: 'x' },
      ],
      [
        `/api/v1/employees/${id}/employment`,
        {
          expectedVersion: 1,
          classification: 'ENDED',
          effectiveDate: '2026-12-15',
          reason: 'x',
          recordedByUserId: randomUUID(),
        },
      ],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    // The classification change is a CSRF-protected command like every other.
    const change = {
      expectedVersion: 1,
      classification: 'OFFICIAL_EMPLOYEE',
      effectiveDate: '2026-12-15',
      reason: 'Training completed',
    };
    await request(server)
      .post(`/api/v1/employees/${id}/employment`)
      .set({ Cookie: headers.Cookie, Origin: headers.Origin })
      .send(change)
      .expect(403);
    await request(server)
      .post(`/api/v1/employees/${id}/employment`)
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(change)
      .expect(403);
    await request(server)
      .get(`/api/v1/employees/${id}/employment?date=15-12-2026`)
      .set({ Cookie: headers.Cookie })
      .expect(400);
    assert.equal(calls.length, 0);
    await request(server)
      .post(`/api/v1/employees/${id}/employment`)
      .set(headers)
      .send(change)
      .expect(200);
    await request(server)
      .get(`/api/v1/employees/${id}/employment?date=2026-11-01`)
      .set({ Cookie: headers.Cookie })
      .expect(200);
    assert.deepEqual(calls[0]?.slice(0, 3), ['changeClassification', token, id]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0]?.[3])), change);
    assert.deepEqual(calls[1], ['employment', token, id, { date: '2026-11-01' }]);
    calls.length = 0;

    // Owner/manager-set credentials and ending employment: strict DTOs, CSRF, no echo.
    const credentials = {
      expectedVersion: 1,
      newPassword: 'hoa sen xanh buổi sáng 2026',
      reason: 'Forgot password',
    };
    const ending = {
      expectedVersion: 1,
      effectiveDate: '2026-12-31',
      reason: 'Left Lucy Spa',
      disableAccess: true,
    };
    for (const [path, body] of [
      [`/api/v1/employees/${id}/credentials`, { ...credentials, newPassword: 123456789012345 }],
      [`/api/v1/employees/${id}/credentials`, { expectedVersion: 1, reason: 'x' }],
      [`/api/v1/employees/${id}/credentials`, { ...credentials, reason: undefined }],
      [`/api/v1/employees/${id}/credentials`, { ...credentials, username: 'nv001' }],
      [`/api/v1/employees/${id}/end-employment`, { ...ending, disableAccess: 'yes' }],
      [`/api/v1/employees/${id}/end-employment`, { ...ending, disableAccess: undefined }],
      [`/api/v1/employees/${id}/end-employment`, { ...ending, effectiveDate: '31/12/2026' }],
      [`/api/v1/employees/${id}/end-employment`, { ...ending, classification: 'ENDED' }],
    ] as const) {
      await request(server).post(path).set(headers).send(body).expect(400);
    }
    for (const [path, body] of [
      [`/api/v1/employees/${id}/credentials`, credentials],
      [`/api/v1/employees/${id}/end-employment`, ending],
    ] as const) {
      await request(server)
        .post(path)
        .set({ Cookie: headers.Cookie, Origin: headers.Origin })
        .send(body)
        .expect(403);
    }
    assert.equal(calls.length, 0);
    const set = await request(server)
      .post(`/api/v1/employees/${id}/credentials`)
      .set(headers)
      .send(credentials)
      .expect(200);
    assert.equal(set.headers['cache-control'], 'no-store');
    assert.equal(JSON.stringify(set.body).includes(credentials.newPassword), false);
    await request(server)
      .post(`/api/v1/employees/${id}/end-employment`)
      .set(headers)
      .send(ending)
      .expect(200);
    assert.deepEqual(calls[0]?.slice(0, 3), ['setCredentials', token, id]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0]?.[3])), credentials);
    assert.deepEqual(calls[1]?.slice(0, 3), ['endEmployment', token, id]);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[1]?.[3])), ending);
    calls.length = 0;

    const created = await request(server)
      .post('/api/v1/employees')
      .set(headers)
      .send(create)
      .expect(201);
    assert.equal((created.body as EmployeeResponse).id, id);
    for (const [path, body] of commands.slice(1, 5)) {
      await request(server).post(path).set(headers).send(body).expect(200);
    }
    const setup = await request(server)
      .post(`/api/v1/employees/${id}/setup`)
      .set(headers)
      .send({ expectedVersion: 1, reason: 'Onboarding' })
      .expect(200);
    assert.equal(setup.headers['cache-control'], 'no-store');
    assert.deepEqual(Object.keys(setup.body as object).sort(), ['expiresAt', 'setupToken']);
    // Reads need no CSRF token but still identify the actor by the session cookie.
    await request(server)
      .get(`/api/v1/employees/${id}`)
      .set({ Cookie: headers.Cookie })
      .expect(200);

    assert.deepEqual(calls[0]?.slice(0, 2), ['create', token]);
    assert.deepEqual(calls[1]?.slice(0, 3), ['updateProfile', token, id]);
    assert.deepEqual(calls.at(-1)?.slice(0, 3), ['get', token, id]);

    for (const [error, status] of [
      [new AuthError('FORBIDDEN'), 403],
      [new AuthError('NOT_FOUND'), 404],
      [new AuthError('CONFLICT'), 409],
      [new AuthError('AUTHENTICATION_REQUIRED'), 401],
      [new AuthError('REAUTHENTICATION_REQUIRED'), 403],
    ] as const) {
      failure = error;
      const response = await request(server)
        .post(`/api/v1/employees/${id}/status`)
        .set(headers)
        .send({ expectedVersion: 1, status: 'INACTIVE', reason: 'Left' })
        .expect(status);
      assert.equal((response.body as ApiErrorResponse).code, error.code);
    }
  } finally {
    await app.close();
  }
});

test('employee setup completion is CSRF-protected, strict and never logs in', async () => {
  const calls: unknown[][] = [];
  let failure: Error | null = null;
  const { app, server, headers } = await application(
    {},
    {
      complete: (...args: unknown[]) => {
        calls.push(args);
        return failure ? Promise.reject(failure) : Promise.resolve();
      },
    },
  );
  const setupToken = generateCapability();
  const body = { setupToken, newPassword: 'a brand new lotus morning 2026' };
  try {
    await request(server).post('/api/v1/auth/employee-setup/complete').send(body).expect(403);
    await request(server)
      .post('/api/v1/auth/employee-setup/complete')
      .set({ ...headers, Origin: 'https://evil.example' })
      .send(body)
      .expect(403);
    for (const invalid of [
      { setupToken },
      { ...body, userId: randomUUID() },
      { ...body, status: 'ACTIVE' },
    ]) {
      await request(server)
        .post('/api/v1/auth/employee-setup/complete')
        .set(headers)
        .send(invalid)
        .expect(400);
    }
    assert.equal(calls.length, 0);
    const done = await request(server)
      .post('/api/v1/auth/employee-setup/complete')
      .set(headers)
      .send(body)
      .expect(204);
    assert.equal(done.headers['set-cookie'], undefined, 'no login cookie');
    assert.deepEqual(calls[0]?.slice(0, 2), [setupToken, body.newPassword]);

    failure = new AuthError('VERIFICATION_FAILED');
    const failed = await request(server)
      .post('/api/v1/auth/employee-setup/complete')
      .set(headers)
      .send(body)
      .expect(400);
    assert.equal((failed.body as ApiErrorResponse).code, 'VERIFICATION_FAILED');
    for (const secret of [setupToken, body.newPassword]) {
      assert.equal(JSON.stringify(failed.body).includes(secret), false);
    }
    failure = new RateLimitedError(900);
    const limited = await request(server)
      .post('/api/v1/auth/employee-setup/complete')
      .set(headers)
      .send(body)
      .expect(429);
    assert.equal(limited.headers['retry-after'], '900');
  } finally {
    await app.close();
  }
});

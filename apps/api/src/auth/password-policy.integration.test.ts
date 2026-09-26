import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EmployeeCreateRequest } from '@lucy-spa/contracts';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { EmployeeService } from '../employees/employee.service.js';
import { businessToday, day } from '../employees/employment.js';
import type { PrismaService } from '../platform/prisma.service.js';
import {
  AuthDeliveryProcessor,
  type AuthEmailMessage,
  type AuthEmailTransport,
} from './auth-delivery.js';
import { AuthThrottleService } from './auth-throttle.service.js';
import { AuthError } from './auth.error.js';
import { capabilityDigest, throttleDigest } from './crypto.js';
import { EmployeeSetupService } from './employee-setup.service.js';
import { LoginService, type LoginPrincipal } from './login.service.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordService } from './password.service.js';
import { RegistrationService } from './registration.service.js';
import { SessionService } from './session.service.js';

const OWNER_PASSWORD = 'a calm lotus evening 2026';
const SEVEN = 'Lotus#7';
const EIGHT = (n: number) => `Lotus#${n}x`; // 8 code points, not a common password
const LONGEST = 'Hoa sen buổi sáng 2026 '.repeat(6).slice(0, 128);
const TOO_LONG = `${LONGEST}x`;
const BY_CODE: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMPLOYEE_ID' };
const BY_EMAIL: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMAIL' };
const CUSTOMER: LoginPrincipal = { realm: 'CUSTOMER', identifierType: 'EMAIL' };

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Global password rule 8–128 in every password-setting flow (follow-up Step 6); all fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (context) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl, 'DATABASE_URL required for explicit auth integration tests.');
    const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
    const environment = parseApiEnvironment({
      NODE_ENV: 'test',
      DATABASE_URL: databaseUrl,
      REDIS_URL: 'redis://localhost:6379',
      WEB_ORIGIN: 'http://localhost:3000',
      AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
      AUTH_CSRF_ACTIVE_VERSION: '1',
      AUTH_CSRF_KEYS: ring(),
      AUTH_THROTTLE_ACTIVE_VERSION: '1',
      AUTH_THROTTLE_KEYS: ring(),
      AUTH_OTP_ACTIVE_VERSION: '1',
      AUTH_OTP_KEYS: ring(),
      AUTH_DELIVERY_ACTIVE_VERSION: '1',
      AUTH_DELIVERY_KEYS: ring(),
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const passwords = new PasswordService();
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toLowerCase();
    const rollback = new Error('Intentional password-policy integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const ownerHash = await passwords.hashForSetting(OWNER_PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            const isolated = async <T>(work: () => Promise<T>): Promise<T> => {
              const name = `command_${++savepoints}`;
              await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
              try {
                const result = await work();
                await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
                return result;
              } catch (error) {
                await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
                throw error;
              }
            };
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const logins = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              {
                ...runner,
                rotateAuthenticated: (token, evidence, options) =>
                  sessions.rotateAuthenticated(token, evidence, options, tx),
                resolve: (token) => sessions.resolve(token, tx),
                continueAfterCredentialChange: (t, previous, requestId, reason) =>
                  sessions.continueAfterCredentialChange(t, previous, requestId, reason),
              },
              passwords,
              throttle,
            );
            await logins.onModuleInit();
            const employees = new EmployeeService(environment, runner, throttle, passwords);
            const resets = new PasswordResetService(environment, runner, passwords, throttle);
            const registrations = new RegistrationService(environment, runner, passwords, throttle);
            const setups = new EmployeeSetupService(runner, passwords, throttle);
            const sent: AuthEmailMessage[] = [];
            const transport: AuthEmailTransport = {
              send: (message) => {
                sent.push(message);
                return Promise.resolve({});
              },
            };
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            await syncPermissionCatalog(tx);
            const A = (
              await tx.branch.create({
                data: { code: `IT-PW-${run.toUpperCase()}`, name: 'Password branch' },
                select: { id: true },
              })
            ).id;
            const today = day(await businessToday(tx, [A]));
            const peer = () => `198.51.100.${randomInt(1, 250)}`;
            const phone = () => `0918${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const signIn = async (identifier: string, password: string, by: LoginPrincipal) =>
              logins.login(
                identifier,
                password,
                (await sessions.createAnonymous(tx)).token,
                peer(),
                undefined,
                by,
              );
            const challengeFor = (flowToken: string) =>
              tx.authChallenge.findUnique({
                where: { flowTokenHash: new Uint8Array(capabilityDigest(flowToken)!) },
                include: { deliveries: { orderBy: { generation: 'asc' } } },
              });
            const codeOf = async (flowToken: string) => {
              const delivery = (await challengeFor(flowToken))?.deliveries.at(-1);
              assert.ok(delivery, 'a code was queued');
              assert.equal(await processor.deliver(delivery.id), 'DELIVERED');
              return sent.at(-1)!.code;
            };
            const expireCooldown = (canonical: string) =>
              tx.authThrottleBucket.deleteMany({
                where: {
                  operationBucket: 'OTP_ISSUE_EMAIL_COOLDOWN',
                  pseudonymousKey: new Uint8Array(
                    throttleDigest(
                      'OTP_ISSUE_EMAIL_COOLDOWN',
                      canonical,
                      environment.auth.throttleKeys.get(1)!,
                    ),
                  ),
                },
              });

            // A fresh Owner session (credential provisioning needs a recent password proof).
            const ownerId =
              existingOwner?.id ??
              (
                await tx.user.create({
                  data: {
                    kind: 'OWNER',
                    status: 'ACTIVE',
                    fullName: 'Owner fixture',
                    preferredLocale: 'vi',
                    emailCanonical: `owner-${run}@example.com`,
                    emailDelivery: `owner-${run}@example.com`,
                    emailVerifiedAt: new Date(),
                    normalizationVersion: 1,
                    passwordHash: ownerHash,
                  },
                  select: { id: true },
                })
              ).id;
            await tx.user.update({ where: { id: ownerId }, data: { passwordHash: ownerHash } });
            const ownerRow = await tx.user.findUniqueOrThrow({
              where: { id: ownerId },
              select: { credentialVersion: true, authzVersion: true },
            });
            const evidence = {
              userId: ownerId,
              passwordHash: ownerHash,
              credentialVersion: ownerRow.credentialVersion,
              authzVersion: ownerRow.authzVersion,
            };
            const signedIn = await sessions.rotateAuthenticated(
              (await sessions.createAnonymous(tx)).token,
              evidence,
              { reauthenticated: false },
              tx,
            );
            const owner = (
              await sessions.rotateAuthenticated(
                signedIn.token,
                evidence,
                { reauthenticated: true },
                tx,
              )
            ).token;
            let sequence = 0;
            const member = (extra: Partial<EmployeeCreateRequest> = {}): EmployeeCreateRequest => {
              sequence += 1;
              return {
                employeeId: `pw-${sequence}-${run}`,
                fullName: `Nhân viên ${sequence}`,
                dateOfBirth: '1996-04-12',
                address: '12 Lê Lợi',
                phone: phone(),
                email: `pw-${sequence}-${run}@example.com`,
                locale: 'vi',
                branchIds: [A],
                classification: 'TRAINEE',
                employmentStartDate: today,
                ...extra,
              };
            };

            await context.test(
              'workforce provisioning: 7 refused, 8 accepted and signs in',
              async () => {
                await fails(
                  employees.create(owner, member({ initialPassword: SEVEN })),
                  'VALIDATION_FAILED',
                  'initialPassword',
                );
                const input = member({ initialPassword: EIGHT(1) });
                const created = await employees.create(owner, input);
                assert.equal(created.status, 'ACTIVE');
                assert.equal(
                  (await signIn(input.employeeId, EIGHT(1), BY_CODE)).account.id,
                  created.id,
                );
              },
            );

            await context.test(
              'management reset: 7 and 129 refused; 8 and 128 accepted',
              async () => {
                const created = await employees.create(
                  owner,
                  member({ initialPassword: EIGHT(2) }),
                );
                for (const bad of [SEVEN, TOO_LONG]) {
                  await fails(
                    employees.setCredentials(owner, created.id, {
                      expectedVersion: created.version,
                      newPassword: bad,
                      reason: 'Reset',
                    }),
                    'VALIDATION_FAILED',
                    'newPassword',
                  );
                }
                const reset = await employees.setCredentials(owner, created.id, {
                  expectedVersion: created.version,
                  newPassword: EIGHT(3),
                  reason: 'Reset',
                });
                const longest = await employees.setCredentials(owner, created.id, {
                  expectedVersion: reset.version,
                  newPassword: LONGEST,
                  reason: 'Reset',
                });
                assert.ok(longest.version > reset.version);
                assert.equal(
                  (await signIn(created.employeeId, LONGEST, BY_CODE)).account.id,
                  created.id,
                );
              },
            );

            await context.test('setup activation: 7 refused, 8 accepted', async () => {
              const created = await employees.create(owner, member());
              assert.equal(created.status, 'PENDING_SETUP');
              const setup = await employees.issueSetup(owner, created.id, {
                expectedVersion: created.version,
                reason: 'Onboarding',
              });
              await assert.rejects(setups.complete(setup.setupToken, SEVEN, peer()));
              assert.equal(
                (await tx.user.findUniqueOrThrow({ where: { id: created.id } })).status,
                'PENDING_SETUP',
              );
              await setups.complete(setup.setupToken, EIGHT(4), peer());
              assert.equal(
                (await signIn(created.employeeId, EIGHT(4), BY_CODE)).account.id,
                created.id,
              );
            });

            await context.test(
              'change password and workforce forgot password follow 8–128',
              async () => {
                const input = member({ initialPassword: EIGHT(5) });
                const created = await employees.create(owner, input);
                const session = (await signIn(input.employeeId, EIGHT(5), BY_CODE)).token;
                await fails(
                  logins.changePassword(session, EIGHT(5), SEVEN, peer()),
                  'VALIDATION_FAILED',
                  'newPassword',
                );
                await fails(
                  logins.changePassword(session, EIGHT(5), '12345678', peer()),
                  'VALIDATION_FAILED',
                  'newPassword',
                );
                await logins.changePassword(session, EIGHT(5), EIGHT(6), peer());
                // Forgot password (verified email) with the new minimum.
                await tx.user.update({
                  where: { id: created.id },
                  data: { emailVerifiedAt: new Date() },
                });
                const flow = await resets.request(input.email!, 'vi', peer(), 'WORKFORCE');
                const code = await codeOf(flow.flowToken);
                await fails(
                  resets.complete(flow.flowToken, code, SEVEN, peer()),
                  'VALIDATION_FAILED',
                  'newPassword',
                );
                await resets.complete(flow.flowToken, code, EIGHT(7), peer());
                assert.equal(
                  (await signIn(input.email!, EIGHT(7), BY_EMAIL)).account.id,
                  created.id,
                );
              },
            );

            await context.test(
              'customer registration and customer reset follow 8–128',
              async () => {
                const email = `customer-${run}@example.com`;
                const registration = {
                  fullName: 'Khách Hàng',
                  dateOfBirth: '1995-05-05',
                  address: '1 Bạch Đằng',
                  email,
                  phone: phone(),
                  locale: 'vi' as const,
                };
                await fails(
                  registrations.register({ ...registration, password: SEVEN }, peer()),
                  'VALIDATION_FAILED',
                  'password',
                );
                const flow = await registrations.register(
                  { ...registration, password: EIGHT(8) },
                  peer(),
                );
                await registrations.verify(flow.flowToken, await codeOf(flow.flowToken), peer());
                assert.equal((await signIn(email, EIGHT(8), CUSTOMER)).account.kind, 'CUSTOMER');
                await expireCooldown(email);
                const reset = await resets.request(email, 'vi', peer(), 'CUSTOMER');
                const code = await codeOf(reset.flowToken);
                await fails(
                  resets.complete(reset.flowToken, code, SEVEN, peer()),
                  'VALIDATION_FAILED',
                  'newPassword',
                );
                await resets.complete(reset.flowToken, code, EIGHT(9), peer());
                assert.equal((await signIn(email, EIGHT(9), CUSTOMER)).account.kind, 'CUSTOMER');
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 300_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
      assert.equal(
        await database.branch.count({ where: { code: { endsWith: run.toUpperCase() } } }),
        0,
      );
    } finally {
      await database.$disconnect();
    }
  },
);

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import {
  AuthDeliveryProcessor,
  type AuthEmailMessage,
  type AuthEmailTransport,
} from '../auth/auth-delivery.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest, throttleDigest } from '../auth/crypto.js';
import { LoginService, type LoginPrincipal } from '../auth/login.service.js';
import { RateLimitedError } from '../auth/otp-flow.js';
import { PasswordResetService } from '../auth/password-reset.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import { EmployeeService } from '../employees/employee.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { EmailChangeService } from './email-change.service.js';
import { MyAccountService } from './my-account.service.js';

const PASSWORD = 'a calm lotus evening 2026';
const NEW_PASSWORD = 'jasmine tea by the quiet river';
const BY_CODE: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMPLOYEE_ID' };
const BY_EMAIL: LoginPrincipal = { realm: 'WORKFORCE', identifierType: 'EMAIL' };

/** Test-only clock: the same database clock, shifted (for code expiry). */
class ShiftedThrottle extends AuthThrottleService {
  shiftMs = 0;
  override async now(transaction: Prisma.TransactionClient): Promise<Date> {
    return new Date((await super.now(transaction)).getTime() + this.shiftMs);
  }
}

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'Verified email change (follow-up Step 5): new address proven first, one email, one surviving session; all fixtures roll back',
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
    const userIds: string[] = [];
    const rollback = new Error('Intentional email-change integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const hash = await passwords.hashForSetting(PASSWORD);
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
            const sessionPort = {
              ...runner,
              rotateAuthenticated: (
                token: string,
                evidence: Parameters<SessionService['rotateAuthenticated']>[1],
                options: Parameters<SessionService['rotateAuthenticated']>[2],
              ) => sessions.rotateAuthenticated(token, evidence, options, tx),
              resolve: (token: string | undefined) => sessions.resolve(token, tx),
              continueAfterCredentialChange: (
                t: Prisma.TransactionClient,
                previous: Parameters<SessionService['continueAfterCredentialChange']>[1],
                requestId?: string,
                reason?: 'PASSWORD_CHANGED' | 'EMAIL_CHANGED',
              ) => sessions.continueAfterCredentialChange(t, previous, requestId, reason),
            };
            const throttle = new ShiftedThrottle(environment);
            const logins = new LoginService(
              { client: tx as unknown as PrismaService['client'] },
              sessionPort,
              passwords,
              throttle,
            );
            await logins.onModuleInit();
            const emails = new EmailChangeService(environment, sessionPort, throttle, logins);
            const accounts = new MyAccountService(runner, throttle);
            const employees = new EmployeeService(environment, runner, throttle, passwords);
            const resets = new PasswordResetService(environment, runner, passwords, throttle);
            const sent: AuthEmailMessage[] = [];
            const transport: AuthEmailTransport = {
              send: (message) => {
                sent.push(message);
                return Promise.resolve({});
              },
            };
            const processor = new AuthDeliveryProcessor(runner, environment.auth, transport);
            const phone = () => `+84919${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            let sequence = 0;
            const address = (label: string) => `${label}-${run}@example.com`;
            const principal = async (kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER', branch?: string) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              const email = address(`em${sequence}`);
              const code = `EM-${sequence}-${run.toUpperCase()}`;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: email,
                  emailDelivery: email,
                  emailVerifiedAt: new Date(),
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: code,
                            dateOfBirth: new Date('1990-01-01'),
                            address: 'Fixture address',
                          },
                        },
                      }
                    : {}),
                  ...(kind === 'CUSTOMER'
                    ? {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                        },
                      }
                    : {}),
                },
                select: { id: true },
              });
              if (kind === 'EMPLOYEE') {
                await tx.$executeRaw`
                  INSERT INTO employment_classification_changes
                    (employee_user_id, classification, effective_date, reason)
                  VALUES (${id}::uuid, 'OFFICIAL_EMPLOYEE'::"EmploymentClassification",
                    CURRENT_DATE - 1, 'fixture')`;
                if (branch) {
                  await tx.employeeBranchAssignment.create({
                    data: { employeeUserId: id, branchId: branch, grantedByUserId: id },
                  });
                }
              }
              return { id, email, code };
            };
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: user.passwordHash!,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const signIn = async (identifier: string, password: string, by: LoginPrincipal) =>
              logins.login(
                identifier,
                password,
                (await sessions.createAnonymous(tx)).token,
                `203.0.113.${randomInt(1, 250)}`,
                undefined,
                by,
              );
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const peer = () => `198.51.100.${randomInt(1, 250)}`;
            const alive = async (token: string) => (await sessions.resolve(token, tx)) !== null;
            const emailOf = (id: string) =>
              tx.user.findUniqueOrThrow({
                where: { id },
                select: { emailCanonical: true, emailDelivery: true, emailVerifiedAt: true },
              });
            const challengeFor = (flowToken: string) =>
              tx.authChallenge.findUnique({
                where: { flowTokenHash: new Uint8Array(capabilityDigest(flowToken)!) },
                include: { deliveries: { orderBy: { generation: 'asc' } } },
              });
            // Delivers the latest queued email of a flow through the real processor.
            const codeOf = async (flowToken: string) => {
              const delivery = (await challengeFor(flowToken))?.deliveries.at(-1);
              assert.ok(delivery);
              assert.equal(await processor.deliver(delivery.id), 'DELIVERED');
              return sent.at(-1)!;
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
            const ask = (token: string, email: string, password = PASSWORD) =>
              emails.request(token, password, email, peer(), randomUUID());
            const confirm = (token: string, flowToken: string, code: string) =>
              emails.verify(token, flowToken, code, peer(), randomUUID());
            const branch = (
              await tx.branch.create({
                data: { code: `IT-EM-${run}`, name: 'Email branch' },
                select: { id: true },
              })
            ).id;

            await syncPermissionCatalog(tx);
            const member = await principal('EMPLOYEE', branch);
            const hr = await principal('EMPLOYEE', branch);
            const hrRole = await tx.role.create({
              data: {
                code: `IT_EM_HR_${run.toUpperCase()}`,
                displayNameVi: 'HR',
                displayNameEn: 'HR',
                permissions: {
                  create: (
                    await tx.permission.findMany({
                      where: { code: { in: ['VIEW_EMPLOYEES', 'UPDATE_EMPLOYEES'] } },
                      select: { id: true },
                    })
                  ).map((row) => ({ permissionId: row.id })),
                },
              },
              select: { id: true },
            });
            await tx.userRoleAssignment.create({
              data: { userId: hr.id, roleId: hrRole.id, scopeKind: 'BRANCH', branchId: branch },
            });
            const hrSession = await login(hr.id);

            await context.test(
              'A–E. the request proves the password and never changes the email',
              async () => {
                const here = await login(member.id);
                const before = await emailOf(member.id);
                // B. wrong password: generic refusal, no flow, nothing sent.
                const sentBefore = sent.length;
                await fails(ask(here, address('new-b'), `${PASSWORD}!`), 'AUTHENTICATION_FAILED');
                assert.equal(
                  await tx.authChallenge.count({
                    where: { userId: member.id, purpose: 'CHANGE_EMAIL' },
                  }),
                  0,
                );
                // C–E. invalid, unchanged, taken (by any account) are refused.
                await fails(ask(here, 'not an email'), 'VALIDATION_FAILED', 'newEmail');
                await fails(
                  ask(here, member.email.toUpperCase()),
                  'VALIDATION_FAILED',
                  'newEmailUnchanged',
                );
                await fails(ask(here, hr.email), 'CONFLICT', 'email');
                const customer = await principal('CUSTOMER');
                await fails(ask(here, customer.email), 'CONFLICT', 'email');
                // A. a flow for the NEW address; the account email is untouched.
                const flow = await ask(here, `  ${address('Member-New')}  `.trim());
                const challenge = await challengeFor(flow.flowToken);
                assert.equal(challenge?.purpose, 'CHANGE_EMAIL');
                assert.equal(challenge?.userId, member.id);
                assert.equal(challenge?.deliveryEmailSnapshot, address('Member-New'));
                assert.deepEqual(
                  await emailOf(member.id),
                  before,
                  'email unchanged until verified',
                );
                const message = await codeOf(flow.flowToken);
                assert.equal(message.to, address('Member-New'), 'sent only to the new address');
                assert.equal(message.purpose, 'CHANGE_EMAIL');
                assert.equal(sent.length, sentBefore + 1);
                // Another account's pending change reserves the address.
                await fails(ask(await login(hr.id), address('member-new')), 'CONFLICT', 'email');
              },
            );

            await context.test(
              'F–J, L, N, R–S. the code: wrong, exhausted, reused, other user; success',
              async () => {
                const here = await login(member.id);
                const laptop = await login(member.id);
                await expireCooldown(address('member-new2'));
                const flow = await ask(here, address('member-new2'));
                const message = await codeOf(flow.flowToken);
                const wrong = message.code === '000000' ? '111111' : '000000';
                // G. a wrong code is refused and nothing changes.
                await fails(confirm(here, flow.flowToken, wrong), 'VERIFICATION_FAILED');
                assert.equal((await emailOf(member.id)).emailCanonical, member.email);
                // L. another signed-in user cannot use this flow (reported as unknown).
                await fails(
                  confirm(hrSession, flow.flowToken, message.code),
                  'VERIFICATION_FAILED',
                );
                assert.equal((await challengeFor(flow.flowToken))?.consumedAt, null);
                // F. the right code: the new address is THE email, verified.
                const token = await confirm(here, flow.flowToken, message.code);
                const after = await emailOf(member.id);
                assert.equal(after.emailCanonical, address('member-new2'));
                assert.equal(after.emailDelivery, address('member-new2'));
                assert.ok(after.emailVerifiedAt);
                // J. a used code cannot be reused.
                await fails(confirm(token, flow.flowToken, message.code), 'VERIFICATION_FAILED');
                // R–S. every other session (and the old token) revoked; this device continues.
                assert.deepEqual([await alive(here), await alive(laptop)], [false, false]);
                assert.ok(await alive(token));
                assert.equal(
                  await tx.session.count({ where: { userId: member.id, revokedAt: null } }),
                  1,
                );
                // N. the employee code / login ID is unchanged and still signs in.
                const profile = await tx.employeeProfile.findUniqueOrThrow({
                  where: { userId: member.id },
                  select: { employeeCodeCanonical: true },
                });
                assert.equal(profile.employeeCodeCanonical, member.code);
                assert.equal((await signIn(member.code, PASSWORD, BY_CODE)).account.id, member.id);
                // Existing email sign-in rule for verified employees follows the new address.
                await fails(signIn(member.email, PASSWORD, BY_EMAIL), 'AUTHENTICATION_FAILED');
                assert.equal(
                  (await signIn(address('member-new2'), PASSWORD, BY_EMAIL)).account.id,
                  member.id,
                );
                // O. My Account and management employee detail show the same email state.
                const mine = await accounts.get(token);
                const managed = await employees.get(hrSession, member.id);
                assert.deepEqual(mine.email, { address: address('member-new2'), verified: true });
                assert.deepEqual(
                  [managed.email, managed.emailVerified],
                  [address('member-new2'), true],
                );
                // The freed address can be used by someone else now.
                await expireCooldown(member.email);
                const hrFlow = await ask(await login(hr.id), member.email);
                assert.ok(hrFlow.flowToken);
              },
            );

            await context.test('H–I, K. attempts, expiry and superseded flows', async () => {
              const person = await principal('EMPLOYEE', branch);
              const here = await login(person.id);
              // H. attempt limit: the fifth wrong code ends the flow; the right one then fails.
              const flow = await ask(here, address('p-new-h'));
              const message = await codeOf(flow.flowToken);
              const wrong = message.code === '000000' ? '111111' : '000000';
              for (let attempt = 0; attempt < 5; attempt += 1) {
                await fails(confirm(here, flow.flowToken, wrong), 'VERIFICATION_FAILED');
              }
              assert.ok((await challengeFor(flow.flowToken))?.invalidatedAt);
              await fails(confirm(here, flow.flowToken, message.code), 'VERIFICATION_FAILED');
              // K. a new request supersedes the old flow; its code no longer works.
              await expireCooldown(address('p-new-k1'));
              const first = await ask(here, address('p-new-k1'));
              const firstCode = (await codeOf(first.flowToken)).code;
              await expireCooldown(address('p-new-k2'));
              const second = await ask(here, address('p-new-k2'));
              assert.ok((await challengeFor(first.flowToken))?.invalidatedAt);
              await fails(confirm(here, first.flowToken, firstCode), 'VERIFICATION_FAILED');
              // Resend: a new generation; the previous code of the same flow stops working.
              const secondCode = (await codeOf(second.flowToken)).code;
              await assert.rejects(emails.resend(here, second.flowToken, peer()), RateLimitedError);
              await expireCooldown(address('p-new-k2'));
              await emails.resend(here, second.flowToken, peer());
              const resent = await codeOf(second.flowToken);
              assert.equal(resent.to, address('p-new-k2'));
              if (resent.code !== secondCode) {
                await fails(confirm(here, second.flowToken, secondCode), 'VERIFICATION_FAILED');
              }
              // I. an expired code is refused (clock moved past the 5-minute code lifetime).
              throttle.shiftMs = 6 * 60 * 1_000;
              try {
                await fails(confirm(here, second.flowToken, resent.code), 'VERIFICATION_FAILED');
              } finally {
                throttle.shiftMs = 0;
              }
              assert.equal((await emailOf(person.id)).emailCanonical, person.email);
            });

            await context.test('M. anonymous and customers cannot use the endpoints', async () => {
              await fails(
                emails.request(undefined, PASSWORD, address('x1'), peer()),
                'AUTHENTICATION_REQUIRED',
              );
              const anonymous = (await sessions.createAnonymous(tx)).token;
              await fails(ask(anonymous, address('x2')), 'AUTHENTICATION_REQUIRED');
              const customer = await principal('CUSTOMER');
              await fails(ask(await login(customer.id), address('x3')), 'FORBIDDEN');
              await fails(confirm(anonymous, 'x'.repeat(43), '123456'), 'AUTHENTICATION_REQUIRED');
              // The database guard: CHANGE_EMAIL only for workforce, never to the stored address.
              const raw = (userId: string, snapshot: string) =>
                isolated(() => {
                  const now = new Date();
                  return tx.authChallenge.create({
                    data: {
                      purpose: 'CHANGE_EMAIL',
                      flowTokenHash: new Uint8Array(randomBytes(32)),
                      identityKey: new Uint8Array(randomBytes(32)),
                      identityKeyVersion: 1,
                      userId,
                      verifierDigest: new Uint8Array(randomBytes(32)),
                      keyVersion: 1,
                      credentialVersion: 1,
                      authzVersion: 1,
                      deliveryEmailSnapshot: snapshot,
                      maxAttempts: 5,
                      createdAt: now,
                      flowExpiresAt: new Date(now.getTime() + 900_000),
                      codeGeneratedAt: now,
                      codeExpiresAt: new Date(now.getTime() + 300_000),
                    },
                    select: { id: true },
                  });
                });
              await assert.rejects(raw(customer.id, address('raw-c')), /delivery target/);
              const staff = await principal('EMPLOYEE');
              await assert.rejects(raw(staff.id, staff.email), /delivery target/);
            });

            await context.test(
              'P–Q, T–U. Owner; forgot password; change password still work',
              async () => {
                const owner = existingOwner
                  ? await (async () => {
                      await tx.user.update({
                        where: { id: existingOwner.id },
                        data: { passwordHash: hash },
                      });
                      const row = await tx.user.findUniqueOrThrow({
                        where: { id: existingOwner.id },
                        select: { emailCanonical: true },
                      });
                      return { id: existingOwner.id, email: row.emailCanonical!, code: '' };
                    })()
                  : await principal('OWNER');
                const here = await login(owner.id);
                await expireCooldown(address('owner-new'));
                const flow = await ask(here, address('owner-new'));
                const message = await codeOf(flow.flowToken);
                assert.equal(message.to, address('owner-new'));
                const token = await confirm(here, flow.flowToken, message.code);
                assert.equal(await tx.employeeProfile.count({ where: { userId: owner.id } }), 0);
                // Q. the old email no longer signs in as the Owner; the new one does.
                await fails(signIn(owner.email, PASSWORD, BY_EMAIL), 'AUTHENTICATION_FAILED');
                assert.equal(
                  (await signIn(address('owner-new'), PASSWORD, BY_EMAIL)).account.kind,
                  'OWNER',
                );
                // T. forgot password goes to the new verified address only.
                await expireCooldown(address('owner-new'));
                const reset = await resets.request(address('owner-new'), 'vi', peer(), 'WORKFORCE');
                const resetMessage = await codeOf(reset.flowToken);
                assert.equal(resetMessage.to, address('owner-new'));
                await expireCooldown(owner.email);
                const stale = await resets.request(owner.email, 'vi', peer(), 'WORKFORCE');
                assert.equal(
                  await challengeFor(stale.flowToken),
                  null,
                  'old address: nothing issued',
                );
                // U. change password still works on the continued session.
                const changed = await logins.changePassword(token, PASSWORD, NEW_PASSWORD, peer());
                assert.ok(await alive(changed));
                assert.equal(
                  (await signIn(address('owner-new'), NEW_PASSWORD, BY_EMAIL)).account.kind,
                  'OWNER',
                );
              },
            );

            await context.test(
              'V. audit and challenge data hold no password, code or address',
              async () => {
                const events = await tx.auditEvent.findMany({
                  where: {
                    subjectUserId: member.id,
                    action: { in: ['EMAIL_CHANGED', 'EMAIL_CHANGE_REQUESTED'] },
                  },
                });
                assert.ok(events.some((row) => row.action === 'EMAIL_CHANGED'));
                const changed = events.find((row) => row.action === 'EMAIL_CHANGED');
                assert.equal(changed?.actorUserId, member.id);
                assert.equal(
                  (changed?.after as { method?: string }).method,
                  'SELF_SERVICE_EMAIL_OTP',
                );
                const all = JSON.stringify(
                  await tx.auditEvent.findMany({ where: { subjectUserId: { in: userIds } } }),
                );
                for (const secret of [PASSWORD, NEW_PASSWORD, '$argon2', `-${run}@example.com`]) {
                  assert.ok(!all.includes(secret), `audit never contains ${secret.slice(0, 8)}…`);
                }
                for (const message of sent) {
                  assert.ok(!all.includes(`"${message.code}"`), 'no code in audit');
                }
                // Challenges hold digests only: never the code in clear.
                const challenges = await tx.authChallenge.findMany({
                  where: { userId: { in: userIds }, purpose: 'CHANGE_EMAIL' },
                });
                assert.ok(challenges.length > 0);
                const stored = JSON.stringify(challenges, (_key, value: unknown) =>
                  value instanceof Uint8Array ? Buffer.from(value).toString('hex') : value,
                );
                for (const message of sent.filter((row) => row.purpose === 'CHANGE_EMAIL')) {
                  assert.ok(!stored.includes(`"${message.code}"`));
                }
              },
            );

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 300_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
    } finally {
      await database.$disconnect();
    }
  },
);

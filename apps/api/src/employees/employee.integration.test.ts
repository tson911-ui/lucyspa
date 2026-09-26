import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { EmployeeCreateRequest, EmployeeResponse } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { takeExclusiveAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { capabilityDigest } from '../auth/crypto.js';
import { EmployeeSetupService } from '../auth/employee-setup.service.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { EmployeeService } from './employee.service.js';

const PASSWORD = 'a calm lotus evening 2026';
const NEW_PASSWORD = 'a brand new lotus morning 2026';
const ALL: PermissionCode[] = [
  'VIEW_EMPLOYEES',
  'CREATE_EMPLOYEES',
  'UPDATE_EMPLOYEES',
  'MANAGE_EMPLOYEE_STATUS',
  'MANAGE_EMPLOYEE_ACCESS',
  'MANAGE_EMPLOYEE_SCOPE',
];

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'employee lifecycle with actual Step 2 constraints and the Step 7 engine; all fixtures roll back',
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
    });
    const database = createDatabaseClient(databaseUrl);
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    const passwords = new PasswordService();
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    const userIds: string[] = [];
    const rollback = new Error('Intentional employee lifecycle integration rollback');
    try {
      await database.$connect();
      const permissionCount = await database.permission.count();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const hash = await passwords.hashForSetting(PASSWORD);
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) => work(tx),
              withExclusiveTransaction: async <T>(
                work: (t: Prisma.TransactionClient) => Promise<T>,
              ) => {
                await takeExclusiveAuthGraphLock(tx);
                return work(tx);
              },
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const throttle = new AuthThrottleService(environment);
            const employees = new EmployeeService(environment, runner, throttle, passwords);
            const setups = new EmployeeSetupService(runner, passwords, throttle);
            await syncPermissionCatalog(tx);
            const permissions = new Map(
              (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                row.code as string,
                row.id,
              ]),
            );
            const branch = async (label: string) =>
              (
                await tx.branch.create({
                  data: { code: `IT-${label}-${run}`, name: `Branch ${label}` },
                  select: { id: true },
                })
              ).id;
            const [A, B, C] = [await branch('A'), await branch('B'), await branch('C')];
            const phone = () => `+84917${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
            let sequence = 0;

            // Direct fixture principals; the API under test never creates these.
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER' | 'OWNER',
              branches: string[] = [],
            ) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'en',
                  emailCanonical: `fixture-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `fixture-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: kind === 'OWNER' ? null : phone(),
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `FIX-${sequence}-${run}`,
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
              for (const branchId of branches) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: id },
                });
              }
              return id;
            };
            const grant = async (userId: string, codes: PermissionCode[], branchId?: string) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `IT_${run}_${sequence}`,
                  displayNameVi: 'Vai trò',
                  displayNameEn: 'Role',
                  permissions: {
                    create: codes.map((code) => ({ permissionId: permissions.get(code)! })),
                  },
                },
                select: { id: true },
              });
              await tx.userRoleAssignment.create({
                data: {
                  userId,
                  roleId: role.id,
                  scopeKind: branchId ? 'BRANCH' : 'GLOBAL',
                  branchId: branchId ?? null,
                },
              });
            };
            const deny = async (userId: string, code: PermissionCode, branchId: string) => {
              await tx.userPermissionOverride.create({
                data: {
                  userId,
                  permissionId: permissions.get(code)!,
                  effect: 'DENY',
                  scopeKind: 'BRANCH',
                  branchId,
                },
              });
            };
            const login = async (userId: string, fresh = false) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true, passwordHash: true },
              });
              const evidence = {
                userId,
                passwordHash: user.passwordHash!,
                credentialVersion: user.credentialVersion,
                authzVersion: user.authzVersion,
              };
              const anonymous = await sessions.createAnonymous(tx);
              const signedIn = await sessions.rotateAuthenticated(
                anonymous.token,
                evidence,
                { reauthenticated: false },
                tx,
              );
              if (!fresh) return signedIn.token;
              return (
                await sessions.rotateAuthenticated(
                  signedIn.token,
                  evidence,
                  { reauthenticated: true },
                  tx,
                )
              ).token;
            };
            const fails = (work: Promise<unknown>, code: string) =>
              assert.rejects(
                work,
                (error: unknown) => error instanceof AuthError && error.code === code,
              );
            const input = (branchIds: string[], extra: Partial<EmployeeCreateRequest> = {}) => {
              sequence += 1;
              return {
                employeeId: ` ktv-${sequence}-${run.toLowerCase()} `,
                fullName: `Nhân viên ${sequence}`,
                dateOfBirth: '1996-04-12',
                address: '12 Lê Lợi, Quận 1',
                phone: phone().replace('+84', '0'),
                email: null,
                locale: 'vi',
                branchIds,
                // Step 1 of employee management: the initial classification is explicit. A
                // future start date keeps these pre-existing fixtures free of backdating rules.
                classification: 'TRAINEE',
                employmentStartDate: '2030-01-01',
                ...extra,
              } satisfies EmployeeCreateRequest;
            };
            const track = (employee: EmployeeResponse) => {
              userIds.push(employee.id);
              return employee;
            };
            const auditOf = (subjectUserId: string, action: string) =>
              tx.auditEvent.findMany({ where: { subjectUserId, action }, orderBy: { id: 'asc' } });

            const ownerId = existingOwner?.id ?? (await principal('OWNER'));
            const ownerSession = existingOwner ? null : await login(ownerId, true);
            // Branch A manager: everything except pay and permission management, in A only.
            const manager = await principal('EMPLOYEE', [A]);
            await grant(manager, ALL, A);
            const managerSession = await login(manager, true);
            const customer = await principal('CUSTOMER');
            const customerSession = await login(customer, true);

            await context.test('creation within scope, PENDING_SETUP, audited', async () => {
              const created = track(await employees.create(managerSession, input([A])));
              assert.equal(created.status, 'PENDING_SETUP');
              assert.deepEqual(created.branchIds, [A]);
              assert.match(created.employeeId, /^KTV-/);
              assert.equal(created.baseSalaryVnd, undefined, 'no VIEW_EMPLOYEE_PAY');
              const stored = await tx.user.findUniqueOrThrow({ where: { id: created.id } });
              assert.equal(stored.kind, 'EMPLOYEE');
              assert.equal(stored.passwordHash, null);
              assert.equal(stored.emailVerifiedAt, null);
              const [event] = await auditOf(created.id, 'EMPLOYEE_CREATED');
              assert.equal(event?.actorUserId, manager);
              assert.equal(event?.branchId, A);

              // Branch isolation and multi-branch all-or-nothing.
              await fails(employees.create(managerSession, input([B])), 'FORBIDDEN');
              await fails(employees.create(managerSession, input([A, B])), 'FORBIDDEN');
              await fails(employees.create(managerSession, input([])), 'FORBIDDEN');
              // Pay needs its own permission.
              await fails(
                employees.create(managerSession, input([A], { baseSalaryVnd: '9000000' })),
                'FORBIDDEN',
              );
              // Unique identifiers conflict without revealing the other account.
              await fails(
                employees.create(managerSession, input([A], { employeeId: created.employeeId })),
                'CONFLICT',
              );
              await fails(
                employees.create(managerSession, input([A], { phone: created.phone })),
                'CONFLICT',
              );
              // Customers and anonymous callers never reach administration.
              await fails(employees.create(customerSession, input([A])), 'FORBIDDEN');
              await fails(employees.create(undefined, input([A])), 'AUTHENTICATION_REQUIRED');
              const anonymous = (await sessions.createAnonymous(tx)).token;
              await fails(employees.create(anonymous, input([A])), 'AUTHENTICATION_REQUIRED');
            });

            await context.test('a branch DENY beats a GLOBAL grant', async () => {
              const creator = await principal('EMPLOYEE', [A, B]);
              await grant(creator, ['CREATE_EMPLOYEES', 'VIEW_EMPLOYEES']);
              await deny(creator, 'CREATE_EMPLOYEES', B);
              const session = await login(creator);
              track(await employees.create(session, input([A])));
              // GLOBAL covers every other branch.
              track(await employees.create(session, input([C])));
              await fails(employees.create(session, input([B])), 'FORBIDDEN');
              await fails(employees.create(session, input([A, B])), 'FORBIDDEN');
            });

            await context.test('reads are object-scoped and pay is gated', async () => {
              const inA = track(await employees.create(managerSession, input([A])));
              // Base salary is for official employment only (follow-up Q16): promote first.
              await tx.employmentClassificationChange.create({
                data: {
                  employeeUserId: inA.id,
                  classification: 'OFFICIAL_EMPLOYEE',
                  effectiveDate: new Date('2030-02-01T00:00:00.000Z'),
                  reason: 'Promoted for the pay test',
                },
              });
              const other = await principal('EMPLOYEE', [B]);
              await grant(other, ['CREATE_EMPLOYEES'], B);
              const inB = track(await employees.create(await login(other), input([B])));
              assert.equal((await employees.get(managerSession, inA.id)).id, inA.id);
              await fails(employees.get(managerSession, inB.id), 'NOT_FOUND');
              await fails(employees.get(managerSession, randomUUID()), 'NOT_FOUND');
              await fails(employees.get(managerSession, 'not-a-uuid'), 'NOT_FOUND');

              const payroll = await principal('EMPLOYEE', [A]);
              await grant(
                payroll,
                ['VIEW_EMPLOYEES', 'VIEW_EMPLOYEE_PAY', 'MANAGE_EMPLOYEE_PAY'],
                A,
              );
              const paySession = await login(payroll);
              await fails(
                employees.setBaseSalary(managerSession, inA.id, {
                  expectedVersion: inA.version,
                  baseSalaryVnd: '8500000',
                  reason: 'Contract',
                }),
                'FORBIDDEN',
              );
              const paid = await employees.setBaseSalary(paySession, inA.id, {
                expectedVersion: inA.version,
                baseSalaryVnd: '8500000',
                reason: 'Contract signed',
              });
              assert.equal(paid.baseSalaryVnd, '8500000');
              assert.equal(paid.version, inA.version + 1);
              assert.equal((await employees.get(managerSession, inA.id)).baseSalaryVnd, undefined);
              assert.equal((await employees.get(paySession, inA.id)).baseSalaryVnd, '8500000');
              const [event] = await auditOf(inA.id, 'BASE_SALARY_CHANGED');
              assert.equal(event?.dataClassification, 'EMPLOYEE_PAY');
              assert.equal(event?.reason, 'Contract signed');
              assert.deepEqual(event?.before, { baseSalaryVnd: null });
              assert.deepEqual(event?.after, { baseSalaryVnd: '8500000' });
              // Other audit rows never carry the amount.
              const standard = await tx.auditEvent.findMany({
                where: { subjectUserId: inA.id, dataClassification: 'STANDARD' },
              });
              assert.equal(JSON.stringify(standard).includes('8500000'), false);
              // Stale version.
              await fails(
                employees.setBaseSalary(paySession, inA.id, {
                  expectedVersion: inA.version,
                  baseSalaryVnd: '1',
                  reason: 'Stale',
                }),
                'CONFLICT',
              );
              // Owner-supplied salary at creation: restricted audit, visible to the Owner.
              if (ownerSession) {
                const withPay = track(
                  await employees.create(
                    ownerSession,
                    input([A, B], { baseSalaryVnd: '0', classification: 'OFFICIAL_EMPLOYEE' }),
                  ),
                );
                assert.equal(withPay.baseSalaryVnd, '0');
                const [created] = await auditOf(withPay.id, 'BASE_SALARY_CHANGED');
                assert.equal(created?.dataClassification, 'EMPLOYEE_PAY');
                assert.equal(created?.branchId, null, 'multi-branch event is global');
                // Pay for a multi-branch employee requires every branch.
                await fails(
                  employees.setBaseSalary(paySession, withPay.id, {
                    expectedVersion: withPay.version,
                    baseSalaryVnd: '1',
                    reason: 'Partial scope',
                  }),
                  'FORBIDDEN',
                );
              }
            });

            await context.test('profile update: allowlisted fields and versions', async () => {
              const target = track(await employees.create(managerSession, input([A])));
              const updated = await employees.updateProfile(managerSession, target.id, {
                expectedVersion: target.version,
                fullName: '  Trần Thị Mai  ',
                address: '5 Nguyễn Huệ',
              });
              assert.equal(updated.fullName, 'Trần Thị Mai');
              assert.equal(updated.phone, target.phone, 'contact identifiers unchanged');
              assert.equal(updated.version, target.version + 1);
              await fails(
                employees.updateProfile(managerSession, target.id, {
                  expectedVersion: target.version,
                  fullName: 'Stale',
                }),
                'CONFLICT',
              );
              await fails(
                employees.updateProfile(managerSession, target.id, {
                  expectedVersion: updated.version,
                }),
                'VALIDATION_FAILED',
              );
              const [event] = await auditOf(target.id, 'PROFILE_UPDATED');
              assert.deepEqual(event?.after, { fields: ['address', 'fullName'] });
            });

            await context.test('Owner and customers are never administration targets', async () => {
              const global = await principal('EMPLOYEE', [A]);
              await grant(global, [
                ...ALL,
                'MANAGE_EMPLOYEE_PAY',
                'VIEW_EMPLOYEE_PAY',
                'MANAGE_PERMISSIONS',
              ]);
              const session = await login(global, true);
              const before = await tx.user.findUniqueOrThrow({ where: { id: ownerId } });
              for (const target of [ownerId, customer]) {
                await fails(employees.get(session, target), 'NOT_FOUND');
                await fails(
                  employees.changeStatus(session, target, {
                    expectedVersion: 1,
                    status: 'INACTIVE',
                    reason: 'Attempt',
                  }),
                  'NOT_FOUND',
                );
                await fails(
                  employees.issueSetup(session, target, { expectedVersion: 1, reason: 'Attempt' }),
                  'NOT_FOUND',
                );
                await fails(
                  employees.changeScope(session, target, {
                    expectedVersion: 1,
                    branchIds: [A],
                    reason: 'Attempt',
                  }),
                  'NOT_FOUND',
                );
                await fails(
                  employees.setBaseSalary(session, target, {
                    expectedVersion: 1,
                    baseSalaryVnd: '1',
                    reason: 'Attempt',
                  }),
                  'NOT_FOUND',
                );
              }
              assert.deepEqual(await tx.user.findUniqueOrThrow({ where: { id: ownerId } }), before);
              // Non-Owners cannot administer their own status, scope, pay or credentials.
              const self = await employees.get(session, global);
              await fails(
                employees.changeStatus(session, global, {
                  expectedVersion: self.version,
                  status: 'INACTIVE',
                  reason: 'Self',
                }),
                'FORBIDDEN',
              );
              await fails(
                employees.issueSetup(session, global, {
                  expectedVersion: self.version,
                  reason: 'Self',
                }),
                'FORBIDDEN',
              );
              await fails(
                employees.changeScope(session, global, {
                  expectedVersion: self.version,
                  branchIds: [A, B],
                  reason: 'Self',
                }),
                'FORBIDDEN',
              );
            });

            await context.test('setup issuance, completion and reissue', async () => {
              const target = track(await employees.create(managerSession, input([A])));
              const staleSession = await login(manager);
              await fails(
                employees.issueSetup(staleSession, target.id, {
                  expectedVersion: target.version,
                  reason: 'Onboarding',
                }),
                'REAUTHENTICATION_REQUIRED',
              );
              const issued = await employees.issueSetup(managerSession, target.id, {
                expectedVersion: target.version,
                reason: 'Onboarding',
              });
              assert.match(issued.setupToken, /^[A-Za-z0-9_-]{43}$/);
              const challenge = await tx.authChallenge.findUniqueOrThrow({
                where: { flowTokenHash: new Uint8Array(capabilityDigest(issued.setupToken)!) },
              });
              assert.equal(challenge.purpose, 'EMPLOYEE_SETUP');
              assert.equal(
                challenge.flowExpiresAt.getTime() - challenge.createdAt.getTime(),
                86_400_000,
              );
              const [issuedAudit] = await auditOf(target.id, 'ACCESS_SETUP_ISSUED');
              assert.equal(JSON.stringify(issuedAudit).includes(issued.setupToken), false);

              // A second issuance supersedes the first capability.
              const second = await employees.issueSetup(managerSession, target.id, {
                expectedVersion: target.version + 1,
                reason: 'Lost handover',
              });
              await fails(
                setups.complete(issued.setupToken, NEW_PASSWORD, 'peer'),
                'VERIFICATION_FAILED',
              );
              await fails(setups.complete(second.setupToken, 'short', 'peer'), 'VALIDATION_FAILED');
              await setups.complete(second.setupToken, NEW_PASSWORD, 'peer', 'req-setup');
              await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
              await tx.$executeRaw`SET CONSTRAINTS ALL DEFERRED`;
              const active = await tx.user.findUniqueOrThrow({ where: { id: target.id } });
              assert.equal(active.status, 'ACTIVE');
              assert.equal(active.credentialVersion, 2);
              assert.equal(
                (await passwords.verify(NEW_PASSWORD, active.passwordHash!)).verified,
                true,
              );
              const [completed] = await auditOf(target.id, 'ACCESS_SETUP_COMPLETED');
              assert.equal(completed?.actorKind, 'SYSTEM');
              assert.equal(completed?.requestId, 'req-setup');
              await fails(
                setups.complete(second.setupToken, NEW_PASSWORD, 'peer'),
                'VERIFICATION_FAILED',
              );

              // Reissue to an ACTIVE employee clears the credential and revokes sessions.
              const employeeSession = await login(target.id);
              const current = await employees.get(managerSession, target.id);
              const reissued = await employees.issueSetup(managerSession, target.id, {
                expectedVersion: current.version,
                reason: 'Forgot password, no email',
              });
              const reset = await tx.user.findUniqueOrThrow({ where: { id: target.id } });
              assert.equal(reset.status, 'PENDING_SETUP');
              assert.equal(reset.passwordHash, null);
              assert.equal(reset.credentialVersion, 3);
              assert.equal(await sessions.resolve(employeeSession, tx), null);
              assert.equal((await auditOf(target.id, 'SESSIONS_REVOKED')).length, 1);

              // A scope change after issuance retires the capability (authzVersion moved).
              if (ownerSession) {
                const beforeScope = await employees.get(ownerSession, target.id);
                await employees.changeScope(ownerSession, target.id, {
                  expectedVersion: beforeScope.version,
                  branchIds: [A, C],
                  reason: 'Second location',
                });
                await fails(
                  setups.complete(reissued.setupToken, NEW_PASSWORD, 'peer'),
                  'VERIFICATION_FAILED',
                );
              }
            });

            await context.test(
              'containment blocks credential control over stronger staff',
              async () => {
                const strong = await principal('EMPLOYEE', [A]);
                await grant(strong, ['MANAGE_PERMISSIONS'], A);
                const current = await employees.get(managerSession, strong);
                await fails(
                  employees.issueSetup(managerSession, strong, {
                    expectedVersion: current.version,
                    reason: 'Takeover attempt',
                  }),
                  'FORBIDDEN',
                );
                // Inactivation needs no containment; reactivation restores powers and does.
                const inactive = await employees.changeStatus(managerSession, strong, {
                  expectedVersion: current.version,
                  status: 'INACTIVE',
                  reason: 'Left the spa',
                });
                await fails(
                  employees.changeStatus(managerSession, strong, {
                    expectedVersion: inactive.version,
                    status: 'ACTIVE',
                    reason: 'Rehired',
                  }),
                  'FORBIDDEN',
                );
              },
            );

            await context.test(
              'inactivation revokes sessions and flows; reactivation',
              async () => {
                const target = await principal('EMPLOYEE', [A]);
                const session = await login(target);
                const pending = track(await employees.create(managerSession, input([A])));
                const setup = await employees.issueSetup(managerSession, pending.id, {
                  expectedVersion: pending.version,
                  reason: 'Onboarding',
                });
                const current = await employees.get(managerSession, target);
                await fails(
                  employees.changeStatus(managerSession, target, {
                    expectedVersion: current.version,
                    status: 'ACTIVE',
                    reason: 'Already active',
                  }),
                  'CONFLICT',
                );
                const inactive = await employees.changeStatus(managerSession, target, {
                  expectedVersion: current.version,
                  status: 'INACTIVE',
                  reason: 'Contract ended',
                });
                assert.equal(inactive.status, 'INACTIVE');
                assert.equal(await sessions.resolve(session, tx), null);
                const stored = await tx.user.findUniqueOrThrow({ where: { id: target } });
                assert.equal(stored.authzVersion, 2);
                assert.equal(stored.passwordHash, hash, 'history and credential retained');
                const [status] = await auditOf(target, 'STATUS_CHANGED');
                assert.equal(status?.reason, 'Contract ended');
                assert.deepEqual(status?.after, { status: 'INACTIVE' });
                const [revoked] = await auditOf(target, 'SESSIONS_REVOKED');
                assert.deepEqual(revoked?.after, {
                  reason: 'EMPLOYEE_INACTIVATED',
                  revokedSessions: 1,
                });
                // Setup issuance is refused while inactive.
                await fails(
                  employees.issueSetup(managerSession, target, {
                    expectedVersion: inactive.version,
                    reason: 'No',
                  }),
                  'CONFLICT',
                );
                // Reactivation keeps the credential: ACTIVE.
                const back = await employees.changeStatus(managerSession, target, {
                  expectedVersion: inactive.version,
                  status: 'ACTIVE',
                  reason: 'Rehired',
                });
                assert.equal(back.status, 'ACTIVE');

                // PENDING_SETUP inactivation retires the setup capability; reactivation
                // without a credential returns to PENDING_SETUP, never ACTIVE.
                const refreshed = await employees.get(managerSession, pending.id);
                const off = await employees.changeStatus(managerSession, pending.id, {
                  expectedVersion: refreshed.version,
                  status: 'INACTIVE',
                  reason: 'Did not start',
                });
                await fails(
                  setups.complete(setup.setupToken, NEW_PASSWORD, 'peer'),
                  'VERIFICATION_FAILED',
                );
                const on = await employees.changeStatus(managerSession, pending.id, {
                  expectedVersion: off.version,
                  status: 'ACTIVE',
                  reason: 'Starting after all',
                });
                assert.equal(on.status, 'PENDING_SETUP');
              },
            );

            await context.test('scope changes check every branch and escalation', async () => {
              const target = track(await employees.create(managerSession, input([A])));
              // The manager cannot add a branch outside its own scope.
              await fails(
                employees.changeScope(managerSession, target.id, {
                  expectedVersion: target.version,
                  branchIds: [A, B],
                  reason: 'Expand',
                }),
                'FORBIDDEN',
              );
              const scoper = await principal('EMPLOYEE', [A]);
              await grant(scoper, ['MANAGE_EMPLOYEE_SCOPE', 'VIEW_EMPLOYEES']);
              const scoperSession = await login(scoper);
              const moved = await employees.changeScope(scoperSession, target.id, {
                expectedVersion: target.version,
                branchIds: [B],
                reason: 'Transfer',
              });
              assert.deepEqual(moved.branchIds, [B]);
              const history = await tx.employeeBranchAssignment.findMany({
                where: { employeeUserId: target.id },
                orderBy: { grantedAt: 'asc' },
              });
              assert.equal(history.length, 2, 'membership history retained');
              assert.ok(history.find((row) => row.branchId === A)?.revokedAt);
              const [event] = await auditOf(target.id, 'BRANCH_SCOPE_CHANGED');
              assert.equal(event?.branchId, null);
              assert.deepEqual(event?.before, { branchIds: [A] });
              assert.deepEqual(event?.after, { branchIds: [B] });
              assert.equal(
                (await tx.user.findUniqueOrThrow({ where: { id: target.id } })).authzVersion,
                2,
              );

              // Activating a dormant branch grant counts as a grant: the scoper lacks it.
              const dormant = await principal('EMPLOYEE', [A]);
              await grant(dormant, ['VIEW_EMPLOYEES'], C);
              const dormantView = await employees.get(scoperSession, dormant);
              await fails(
                employees.changeScope(scoperSession, dormant, {
                  expectedVersion: dormantView.version,
                  branchIds: [A, C],
                  reason: 'Expand',
                }),
                'FORBIDDEN',
              );
              // A branch DENY on scope management blocks that branch.
              await deny(scoper, 'MANAGE_EMPLOYEE_SCOPE', C);
              const fresh = await login(scoper);
              const plain = track(await employees.create(managerSession, input([A])));
              await fails(
                employees.changeScope(fresh, plain.id, {
                  expectedVersion: plain.version,
                  branchIds: [A, C],
                  reason: 'Expand',
                }),
                'FORBIDDEN',
              );
              // Unknown branches are rejected.
              await fails(
                employees.changeScope(fresh, plain.id, {
                  expectedVersion: plain.version,
                  branchIds: [A, randomUUID()],
                  reason: 'Expand',
                }),
                'VALIDATION_FAILED',
              );
            });

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
      assert.equal(
        await database.auditEvent.count({ where: { subjectUserId: { in: userIds } } }),
        0,
      );
      assert.equal(await database.branch.count({ where: { code: { endsWith: run } } }), 0);
      assert.equal(await database.permission.count(), permissionCount);
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

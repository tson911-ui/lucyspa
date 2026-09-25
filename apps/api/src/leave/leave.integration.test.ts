import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { LeaveRequestCreateRequest, LeaveType } from '@lucy-spa/contracts';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { AuthError } from '../auth/auth.error.js';
import { PasswordService } from '../auth/password.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { employeesOnApprovedLeave } from './leave.availability.js';
import { LeaveService, parseLeaveDate } from './leave.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'leave management with actual constraints and containment; all fixtures roll back',
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
    const run = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
    const userIds: string[] = [];
    const rollback = new Error('Intentional leave integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
      const leaveCount = await database.leaveRequest.count();
      const hash = await new PasswordService().hashForSetting('a calm lotus evening 2026');
      await assert.rejects(
        database.$transaction(
          async (tx) => {
            let savepoints = 0;
            // Each command in its own savepoint: a rejected command rolls back exactly as its
            // own transaction would in production.
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
            // Records the order of row locks and leave-table access inside each command.
            const trace: string[] = [];
            const traced = new Proxy(tx, {
              get(target, property, receiver) {
                const value: unknown = Reflect.get(target, property, receiver);
                if (property === '$queryRaw' && typeof value === 'function') {
                  return (strings: TemplateStringsArray, ...values: unknown[]) => {
                    const sql = strings.join('?');
                    if (sql.includes('FOR UPDATE')) {
                      const table = /FROM (\w+)/.exec(sql)?.[1] ?? '?';
                      trace.push(`lock ${table} ${String(values[0])}`);
                    }
                    return (value as (...args: unknown[]) => unknown).call(
                      target,
                      strings,
                      ...values,
                    );
                  };
                }
                if (property === 'leaveRequest' && value && typeof value === 'object') {
                  return new Proxy(value, {
                    get(model, method, modelReceiver) {
                      const member: unknown = Reflect.get(model, method, modelReceiver);
                      if (typeof member !== 'function') return member;
                      return (...args: unknown[]) => {
                        trace.push(`leave ${String(method)}`);
                        return (member as (...a: unknown[]) => unknown).apply(model, args);
                      };
                    },
                  });
                }
                return value;
              },
            });
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(traced)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(traced)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const leave = new LeaveService(runner, new AuthThrottleService(environment));
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
                  data: {
                    code: `LV-${label}-${run}`,
                    name: `Branch ${label}`,
                    timezone: 'Asia/Ho_Chi_Minh',
                  },
                  select: { id: true },
                })
              ).id;
            const A = await branch('A');
            const B = await branch('B');
            let sequence = 0;
            const principal = async (kind: 'EMPLOYEE' | 'CUSTOMER', member: string[] = []) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status: 'ACTIVE',
                  fullName: `Fixture ${sequence}`,
                  preferredLocale: 'vi',
                  emailCanonical: `lv-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `lv-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: `+84914${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `LVE-${sequence}-${run}`,
                            dateOfBirth: new Date('1994-01-01'),
                            address: 'Fixture',
                          },
                        },
                      }
                    : {
                        customerProfile: {
                          create: { dateOfBirth: new Date('1994-01-01'), address: 'Fixture' },
                        },
                      }),
                },
                select: { id: true },
              });
              for (const branchId of member) {
                await tx.employeeBranchAssignment.create({
                  data: { employeeUserId: id, branchId, grantedByUserId: id },
                });
              }
              return id;
            };
            const grantRole = async (
              userId: string,
              codes: PermissionCode[],
              branchId?: string,
            ) => {
              sequence += 1;
              const role = await tx.role.create({
                data: {
                  code: `LV_${run}_${sequence}`,
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
            const login = async (userId: string) => {
              const user = await tx.user.findUniqueOrThrow({
                where: { id: userId },
                select: { credentialVersion: true, authzVersion: true },
              });
              const anonymous = await sessions.createAnonymous(tx);
              return (
                await sessions.rotateAuthenticated(
                  anonymous.token,
                  {
                    userId,
                    passwordHash: hash,
                    credentialVersion: user.credentialVersion,
                    authzVersion: user.authzVersion,
                  },
                  { reauthenticated: false },
                  tx,
                )
              ).token;
            };
            const fails = (work: Promise<unknown>, code: string, field?: string) =>
              assert.rejects(
                work,
                (error: unknown) =>
                  error instanceof AuthError &&
                  error.code === code &&
                  (field === undefined || error.field === field),
              );
            const audit = (entityId: string, action: string) =>
              tx.auditEvent.findMany({ where: { entityId, action } });
            const ask = (
              leaveType: LeaveType,
              startDate: string,
              endDate = startDate,
            ): LeaveRequestCreateRequest => ({
              leaveType,
              startDate,
              endDate,
              reason: `Fixture ${leaveType}`,
            });
            const window = { from: '2027-01-01', to: '2027-12-31' };

            const worker = await principal('EMPLOYEE', [A]);
            const workerSession = await login(worker);
            const multi = await principal('EMPLOYEE', [A, B]);
            const multiSession = await login(multi);
            const branchless = await principal('EMPLOYEE');
            const branchlessSession = await login(branchless);
            const managerA = await principal('EMPLOYEE', [A]);
            await grantRole(managerA, ['APPROVE_LEAVE'], A);
            const managerASession = await login(managerA);
            const managerAB = await principal('EMPLOYEE', [A, B]);
            await grantRole(managerAB, ['APPROVE_LEAVE'], A);
            await grantRole(managerAB, ['APPROVE_LEAVE'], B);
            const managerABSession = await login(managerAB);
            const globalApprover = await principal('EMPLOYEE');
            await grantRole(globalApprover, ['APPROVE_LEAVE']);
            const globalSession = await login(globalApprover);
            const customerSession = await login(await principal('CUSTOMER'));

            let sick = '';
            let annual = '';
            await context.test(
              'create: own PENDING whole-day requests with a controlled type',
              async () => {
                trace.length = 0;
                const single = await leave.create(workerSession, ask('SICK', '2027-03-10'));
                // The employee's User row is locked before the overlap check and the insert.
                const lockAt = trace.indexOf(`lock users ${worker}`);
                assert.ok(lockAt >= 0, 'employee row locked');
                assert.ok(lockAt < trace.indexOf('leave findFirst'), 'lock before overlap check');
                assert.ok(trace.indexOf('leave findFirst') < trace.indexOf('leave create'));
                sick = single.id;
                assert.equal(single.status, 'PENDING');
                assert.equal(single.leaveType, 'SICK');
                assert.equal(single.employeeId, worker);
                assert.deepEqual(
                  [single.startDate, single.endDate, single.days],
                  ['2027-03-10', '2027-03-10', 1],
                );
                assert.equal(single.version, 1);
                const range = await leave.create(
                  workerSession,
                  ask('ANNUAL', '2027-03-12', '2027-03-14'),
                );
                annual = range.id;
                assert.equal(range.days, 3);
                // Date-only storage: the calendar dates are exactly what was requested.
                const [stored] = await tx.$queryRaw<{ start: string; end: string; type: string }[]>`
                SELECT start_date::text AS start, end_date::text AS end, leave_type::text AS type
                FROM leave_requests WHERE id = ${annual}::uuid`;
                assert.deepEqual(stored, {
                  start: '2027-03-12',
                  end: '2027-03-14',
                  type: 'ANNUAL',
                });
                const [event] = await audit(sick, 'LEAVE_REQUESTED');
                assert.equal(event?.subjectUserId, worker);
                assert.deepEqual(event?.after, {
                  leaveType: 'SICK',
                  startDate: '2027-03-10',
                  endDate: '2027-03-10',
                  status: 'PENDING',
                });
                // Validation.
                await fails(
                  leave.create(workerSession, ask('SICK', '2027-03-20', '2027-03-19')),
                  'VALIDATION_FAILED',
                  'endDate',
                );
                await fails(
                  leave.create(workerSession, ask('SICK', '2027-02-30')),
                  'VALIDATION_FAILED',
                  'startDate',
                );
                await fails(
                  leave.create(workerSession, ask('SICK', '2027-03-20T00:00:00Z')),
                  'VALIDATION_FAILED',
                  'startDate',
                );
                await fails(
                  leave.create(workerSession, ask('UNPAID' as LeaveType, '2027-03-20')),
                  'VALIDATION_FAILED',
                  'leaveType',
                );
                await fails(
                  leave.create(workerSession, { ...ask('OTHER', '2027-03-20'), reason: '   ' }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                await fails(
                  leave.create(workerSession, ask('MATERNITY', '2027-01-01', '2028-01-02')),
                  'VALIDATION_FAILED',
                  'endDate',
                );
                // Callers.
                await fails(leave.create(customerSession, ask('SICK', '2027-03-20')), 'FORBIDDEN');
                await fails(
                  leave.create(undefined, ask('SICK', '2027-03-20')),
                  'AUTHENTICATION_REQUIRED',
                );
                // The employee always comes from the session, never from the body.
                const smuggled = await leave.create(workerSession, {
                  ...ask('PERSONAL', '2027-03-25'),
                  employeeId: multi,
                } as LeaveRequestCreateRequest);
                assert.equal(smuggled.employeeId, worker);
                // Overlap with PENDING (either side of the range).
                await fails(
                  leave.create(workerSession, ask('SICK', '2027-03-14', '2027-03-16')),
                  'CONFLICT',
                  'startDate',
                );
                await fails(
                  leave.create(workerSession, ask('SICK', '2027-03-01', '2027-03-12')),
                  'CONFLICT',
                  'startDate',
                );
                // Adjacent dates and other employees' dates don't overlap.
                await leave.create(workerSession, ask('FAMILY_EVENT', '2027-03-15'));
                await leave.create(multiSession, ask('SICK', '2027-03-10'));
              },
            );

            await context.test(
              'approve / reject: APPROVE_LEAVE with multi-branch containment',
              async () => {
                await fails(leave.approve(multiSession, sick, { expectedVersion: 1 }), 'FORBIDDEN');
                await fails(
                  leave.approve(customerSession, sick, { expectedVersion: 1 }),
                  'FORBIDDEN',
                );
                await fails(
                  leave.approve(managerASession, randomUUID(), { expectedVersion: 1 }),
                  'NOT_FOUND',
                );
                await fails(
                  leave.approve(managerASession, sick, { expectedVersion: 7 }),
                  'CONFLICT',
                );
                trace.length = 0;
                const approved = await leave.approve(managerASession, sick, {
                  expectedVersion: 1,
                  reason: 'Get well',
                });
                assert.ok(
                  trace.indexOf(`lock users ${worker}`) <
                    trace.indexOf(`lock leave_requests ${sick}`),
                );
                assert.equal(approved.status, 'APPROVED');
                assert.equal(approved.decidedByUserId, managerA);
                assert.equal(approved.decisionReason, 'Get well');
                assert.equal(approved.version, 2);
                const [event] = await audit(sick, 'LEAVE_APPROVED');
                assert.equal(event?.actorUserId, managerA);
                assert.equal(event?.subjectUserId, worker);
                assert.equal(event?.reason, 'Get well');
                assert.deepEqual(event?.before, {
                  leaveType: 'SICK',
                  startDate: '2027-03-10',
                  endDate: '2027-03-10',
                  status: 'PENDING',
                });
                assert.deepEqual(event?.after, {
                  leaveType: 'SICK',
                  startDate: '2027-03-10',
                  endDate: '2027-03-10',
                  status: 'APPROVED',
                  employeeBranchIds: [A],
                });
                // Second transition and approved-date overlap.
                await fails(
                  leave.reject(managerASession, sick, { expectedVersion: 2, reason: 'No' }),
                  'CONFLICT',
                  'status',
                );
                await fails(
                  leave.approve(managerASession, sick, { expectedVersion: 2 }),
                  'CONFLICT',
                  'status',
                );
                await fails(
                  leave.create(workerSession, ask('OTHER', '2027-03-10')),
                  'CONFLICT',
                  'startDate',
                );

                // A+B employee: a manager of A only is refused; a manager of A and B decides.
                const multiLeave = await leave.create(
                  multiSession,
                  ask('ANNUAL', '2027-06-01', '2027-06-02'),
                );
                await fails(
                  leave.approve(managerASession, multiLeave.id, { expectedVersion: 1 }),
                  'FORBIDDEN',
                );
                assert.equal(
                  (await leave.approve(managerABSession, multiLeave.id, { expectedVersion: 1 }))
                    .status,
                  'APPROVED',
                );
                // Branchless employee: GLOBAL authority only.
                const loose = await leave.create(branchlessSession, ask('PERSONAL', '2027-06-01'));
                await fails(
                  leave.approve(managerABSession, loose.id, { expectedVersion: 1 }),
                  'FORBIDDEN',
                );
                assert.equal(
                  (await leave.approve(globalSession, loose.id, { expectedVersion: 1 })).status,
                  'APPROVED',
                );
                // No self-decision.
                const own = await leave.create(managerASession, ask('SICK', '2027-06-05'));
                await fails(
                  leave.approve(managerASession, own.id, { expectedVersion: 1 }),
                  'FORBIDDEN',
                );

                // Rejection needs a reason; it then frees the dates.
                const toReject = await leave.create(workerSession, ask('PERSONAL', '2027-05-01'));
                await fails(
                  leave.reject(managerASession, toReject.id, { expectedVersion: 1 }),
                  'VALIDATION_FAILED',
                  'reason',
                );
                const rejected = await leave.reject(managerASession, toReject.id, {
                  expectedVersion: 1,
                  reason: 'Short staffed',
                });
                assert.equal(rejected.status, 'REJECTED');
                assert.equal(
                  (await audit(toReject.id, 'LEAVE_REJECTED'))[0]?.reason,
                  'Short staffed',
                );
                const again = await leave.create(workerSession, ask('PERSONAL', '2027-05-01'));
                assert.equal(again.status, 'PENDING');
              },
            );

            await context.test(
              'cancel: own PENDING only; history kept; races resolve cleanly',
              async () => {
                const pending = await leave.create(workerSession, ask('OTHER', '2027-04-01'));
                await fails(
                  leave.cancel(multiSession, pending.id, { expectedVersion: 1 }),
                  'NOT_FOUND',
                );
                await fails(
                  leave.cancel(managerASession, pending.id, { expectedVersion: 1 }),
                  'NOT_FOUND',
                );
                await fails(
                  leave.cancel(customerSession, pending.id, { expectedVersion: 1 }),
                  'FORBIDDEN',
                );
                await fails(
                  leave.cancel(workerSession, pending.id, { expectedVersion: 5 }),
                  'CONFLICT',
                );
                const cancelled = await leave.cancel(workerSession, pending.id, {
                  expectedVersion: 1,
                  reason: 'Plans changed',
                });
                assert.equal(cancelled.status, 'CANCELLED');
                assert.equal(cancelled.cancelledByUserId, worker);
                assert.equal(cancelled.cancellationReason, 'Plans changed');
                assert.equal((await audit(pending.id, 'LEAVE_CANCELLED')).length, 1);
                // Approval racing the cancellation: the loser sees the new state, not a rewrite.
                await fails(
                  leave.approve(managerASession, pending.id, { expectedVersion: 1 }),
                  'CONFLICT',
                );
                await fails(
                  leave.cancel(workerSession, pending.id, { expectedVersion: 2 }),
                  'CONFLICT',
                  'status',
                );
                // Cancelled dates are free again; the cancelled row stays as history.
                await leave.create(workerSession, ask('OTHER', '2027-04-01'));
                const history = await leave.listOwn(workerSession, {
                  ...window,
                  status: 'CANCELLED',
                });
                assert.deepEqual(
                  history.requests.map((row) => row.id),
                  [pending.id],
                );
                // Cancellation racing an approval, and APPROVED is never self-cancelled.
                await fails(leave.cancel(workerSession, sick, { expectedVersion: 1 }), 'CONFLICT');
                await fails(
                  leave.cancel(workerSession, sick, { expectedVersion: 2 }),
                  'CONFLICT',
                  'status',
                );
                assert.equal(
                  (await tx.leaveRequest.findUniqueOrThrow({ where: { id: sick } })).status,
                  'APPROVED',
                );
                assert.equal((await audit(annual, 'LEAVE_REQUESTED')).length, 1);
              },
            );

            await context.test(
              'reads: own only, scoped by containment, customers refused',
              async () => {
                const own = await leave.listOwn(workerSession, window);
                assert.ok(own.requests.length >= 6);
                assert.ok(own.requests.every((row) => row.employeeId === worker));
                await fails(leave.listOwn(customerSession, window), 'FORBIDDEN');
                await fails(
                  leave.listOwn(workerSession, { from: '2027-01-01', to: '2028-12-31' }),
                  'VALIDATION_FAILED',
                  'from',
                );
                const employees = async (session: string) =>
                  new Set(
                    (await leave.listScoped(session, window)).requests.map((row) => row.employeeId),
                  );
                const seenA = await employees(managerASession);
                assert.ok(seenA.has(worker) && seenA.has(managerA));
                assert.ok(
                  !seenA.has(multi) && !seenA.has(branchless),
                  'A-only manager sees A-only staff',
                );
                await fails(
                  leave.listScoped(managerASession, { ...window, employeeId: multi }),
                  'NOT_FOUND',
                );
                const seenAB = await employees(managerABSession);
                assert.ok(seenAB.has(worker) && seenAB.has(multi) && !seenAB.has(branchless));
                const seenGlobal = await employees(globalSession);
                assert.ok(seenGlobal.has(branchless) && seenGlobal.has(multi));
                await fails(leave.listScoped(workerSession, window), 'FORBIDDEN');
                await fails(leave.listScoped(customerSession, window), 'FORBIDDEN');
                await fails(leave.listScoped(undefined, window), 'AUTHENTICATION_REQUIRED');
              },
            );

            // Production regression: the Leave page and dashboard send no from/to. The default
            // window (today - 93 .. today + 306, inclusive = 400 days) must satisfy the read
            // maximum and include requests at both inclusive edges. Dates are relative to the
            // UTC date, and a dedicated employee avoids overlap with other fixtures.
            await context.test('default window: reads without from/to succeed', async () => {
              const utcToday = Date.parse(new Date().toISOString().slice(0, 10));
              const offset = (days: number) =>
                new Date(utcToday + days * 86_400_000).toISOString().slice(0, 10);
              const planner = await principal('EMPLOYEE', [A]);
              const plannerSession = await login(planner);
              const at = async (days: number) =>
                (await leave.create(plannerSession, ask('ANNUAL', offset(days)))).id;
              const oldest = await at(-93);
              const soon = await at(30);
              const furthest = await at(306);
              const tooOld = await at(-94);
              const tooFar = await at(307);
              const own = await leave.listOwn(plannerSession, {});
              const ids = new Set(own.requests.map((row) => row.id));
              for (const id of [oldest, soon, furthest]) assert.ok(ids.has(id), 'inside window');
              for (const id of [tooOld, tooFar]) assert.ok(!ids.has(id), 'outside window');
              assert.equal(
                (await leave.listOwn(plannerSession, { status: 'PENDING' })).requests.length,
                3,
              );
              for (const session of [managerASession, globalSession]) {
                const scoped = await leave.listScoped(session, {});
                assert.ok(scoped.requests.some((row) => row.id === soon));
                await leave.listScoped(session, { status: 'PENDING' });
              }
              // Explicit ranges keep the 400-day maximum.
              await fails(
                leave.listOwn(plannerSession, { from: offset(-93), to: offset(307) }),
                'VALIDATION_FAILED',
                'from',
              );
            });

            await context.test(
              'future booking: approved leave by employee and calendar date',
              async () => {
                const on = (date: string) =>
                  employeesOnApprovedLeave(
                    tx,
                    [worker, multi, branchless, managerA],
                    parseLeaveDate(date, 'date'),
                  );
                assert.deepEqual([...(await on('2027-03-10'))], [worker], 'PENDING never counts');
                const june1 = await on('2027-06-01');
                assert.deepEqual(
                  new Set(june1),
                  new Set([multi, branchless]),
                  'one answer per employee',
                );
                assert.deepEqual([...(await on('2027-06-02'))], [multi], 'end date inclusive');
                assert.equal((await on('2027-06-03')).size, 0);
                // One employee-level row, not one per branch assignment.
                assert.equal(
                  await tx.leaveRequest.count({
                    where: { employeeUserId: multi, status: 'APPROVED' },
                  }),
                  1,
                );
              },
            );

            await context.test('policy: no pay, balance, quota or carry-forward data', async () => {
              const columns = await tx.$queryRaw<{ name: string }[]>`
                SELECT column_name AS name FROM information_schema.columns
                WHERE table_schema = current_schema() AND table_name = 'leave_requests'
                ORDER BY column_name`;
              assert.deepEqual(
                columns.map((row) => row.name),
                [
                  'cancellation_reason',
                  'cancelled_at',
                  'cancelled_by_user_id',
                  'created_at',
                  'decided_at',
                  'decided_by_user_id',
                  'decision_reason',
                  'employee_user_id',
                  'end_date',
                  'id',
                  'leave_type',
                  'reason',
                  'requested_at',
                  'row_version',
                  'start_date',
                  'status',
                  'updated_at',
                ],
              );
              const [types] = await tx.$queryRaw<{ labels: string[] }[]>`
                SELECT enum_range(NULL::"LeaveType")::text[] AS labels`;
              assert.deepEqual(types?.labels, [
                'ANNUAL',
                'SICK',
                'PERSONAL',
                'FAMILY_EVENT',
                'MATERNITY',
                'OTHER',
              ]);
              // A second request in the same month is accepted: no quota is enforced yet.
              const extra = await leave.create(workerSession, ask('ANNUAL', '2027-03-20'));
              assert.equal(extra.status, 'PENDING');
            });

            await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
            throw rollback;
          },
          { timeout: 180_000 },
        ),
        (error: unknown) => error === rollback,
      );
      assert.equal(await database.leaveRequest.count(), leaveCount);
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

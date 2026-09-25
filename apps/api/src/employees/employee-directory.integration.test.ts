import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
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
import { EmployeeDirectoryService } from './employee-directory.service.js';

// Explicit opt-in: ordinary unit/HTTP tests do not connect to PostgreSQL.
test(
  'employee directory: VIEW_EMPLOYEES containment before paging; all fixtures roll back',
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
    const rollback = new Error('Intentional directory integration rollback');
    try {
      await database.$connect();
      const existingOwner = await database.user.findFirst({
        where: { kind: 'OWNER' },
        select: { id: true },
      });
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
            const runner = {
              withTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              withExclusiveTransaction: <T>(work: (t: Prisma.TransactionClient) => Promise<T>) =>
                isolated(() => work(tx)),
              resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            };
            const directory = new EmployeeDirectoryService(
              runner,
              new AuthThrottleService(environment),
            );
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
                    code: `DR-${label}-${run}`,
                    name: `Branch ${label}`,
                    timezone: 'Asia/Ho_Chi_Minh',
                  },
                  select: { id: true },
                })
              ).id;
            const A = await branch('A');
            const B = await branch('B');
            let sequence = 0;
            const principal = async (
              kind: 'EMPLOYEE' | 'CUSTOMER',
              member: string[] = [],
              name = 'Fixture',
              status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
            ) => {
              const id = randomUUID();
              userIds.push(id);
              sequence += 1;
              await tx.user.create({
                data: {
                  id,
                  kind,
                  status,
                  fullName: `${name} ${run}`,
                  preferredLocale: 'vi',
                  emailCanonical: `dr-${sequence}-${run.toLowerCase()}@example.com`,
                  emailDelivery: `dr-${sequence}-${run.toLowerCase()}@example.com`,
                  emailVerifiedAt: kind === 'CUSTOMER' ? new Date() : null,
                  phoneCanonical: `+84914${randomInt(0, 1_000_000).toString().padStart(6, '0')}`,
                  normalizationVersion: 1,
                  passwordHash: hash,
                  ...(kind === 'EMPLOYEE'
                    ? {
                        employeeProfile: {
                          create: {
                            employeeCodeCanonical: `DIR${run}-${String(sequence).padStart(2, '0')}`,
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
                  code: `DR_${run}_${sequence}`,
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
            const worker = await principal('EMPLOYEE', [A], 'Lan Nguyen');
            const multi = await principal('EMPLOYEE', [A, B], 'Minh Tran');
            const branchless = await principal('EMPLOYEE', [], 'Hoa Le');
            const inactiveB = await principal('EMPLOYEE', [B], 'Lan Pham', 'INACTIVE');
            const viewerA = await principal('EMPLOYEE', [A], 'Viewer A');
            await grantRole(viewerA, ['VIEW_EMPLOYEES'], A);
            const viewerAB = await principal('EMPLOYEE', [A, B], 'Viewer AB');
            await grantRole(viewerAB, ['VIEW_EMPLOYEES'], A);
            await grantRole(viewerAB, ['VIEW_EMPLOYEES'], B);
            const viewerGlobal = await principal('EMPLOYEE', [], 'Viewer Global');
            await grantRole(viewerGlobal, ['VIEW_EMPLOYEES']);
            // APPROVE_LEAVE / VIEW_ATTENDANCE / MANAGE_SKILLS never widen the directory.
            const operator = await principal('EMPLOYEE', [A], 'Operator');
            await grantRole(operator, ['APPROVE_LEAVE', 'VIEW_ATTENDANCE', 'MANAGE_SKILLS'], A);
            const sessionA = await login(viewerA);
            const sessionAB = await login(viewerAB);
            const sessionGlobal = await login(viewerGlobal);
            const operatorSession = await login(operator);
            const customerSession = await login(await principal('CUSTOMER'));
            const codeOf = async (id: string) =>
              (await tx.employeeProfile.findUniqueOrThrow({ where: { userId: id } }))
                .employeeCodeCanonical;
            const ids = async (session: string, query: Record<string, string> = {}) =>
              (await directory.list(session, { q: run, ...query })).items.map((row) => row.id);
            const set = (values: string[]) => new Set(values);

            await context.test(
              'callers: anonymous 401, customer and no permission 403',
              async () => {
                await fails(directory.list(undefined, {}), 'AUTHENTICATION_REQUIRED');
                await fails(directory.list(customerSession, {}), 'FORBIDDEN');
                await fails(directory.list(operatorSession, {}), 'FORBIDDEN');
              },
            );

            await context.test(
              'visibility: branch, multi-branch containment and GLOBAL',
              async () => {
                assert.deepEqual(set(await ids(sessionA)), set([worker, viewerA, operator]));
                assert.deepEqual(
                  set(await ids(sessionAB)),
                  set([worker, multi, inactiveB, viewerA, viewerAB, operator]),
                );
                assert.deepEqual(
                  set(await ids(sessionGlobal)),
                  set([
                    worker,
                    multi,
                    branchless,
                    inactiveB,
                    viewerA,
                    viewerAB,
                    viewerGlobal,
                    operator,
                  ]),
                );
                const [entry] = (await directory.list(sessionAB, { q: await codeOf(multi) })).items;
                assert.deepEqual(Object.keys(entry ?? {}).sort(), [
                  'branchIds',
                  'employeeId',
                  'fullName',
                  'id',
                  'status',
                  'version',
                ]);
                assert.deepEqual(entry?.branchIds, [A, B].sort());
                assert.equal(entry?.fullName, `Minh Tran ${run}`);
              },
            );

            await context.test('search, filters and bounds', async () => {
              const code = await codeOf(multi);
              assert.deepEqual(await ids(sessionGlobal, { q: code.toLowerCase() }), [multi]);
              const lan = (await directory.list(sessionGlobal, { q: 'lan ', limit: '100' })).items
                .filter((row) => row.fullName.endsWith(run))
                .map((row) => row.id);
              assert.deepEqual(set(lan), set([worker, inactiveB]), 'full name, case-insensitive');
              assert.deepEqual(
                set(await ids(sessionGlobal, { branchId: B })),
                set([multi, inactiveB, viewerAB]),
              );
              assert.deepEqual(await ids(sessionGlobal, { status: 'INACTIVE' }), [inactiveB]);
              for (const [field, query] of [
                ['limit', { limit: '0' }],
                ['limit', { limit: '101' }],
                ['cursor', { cursor: '***' }],
                ['status', { status: 'DELETED' }],
                ['branchId', { branchId: 'nope' }],
                ['q', { q: '   ' }],
              ] as const) {
                await fails(directory.list(sessionGlobal, query), 'VALIDATION_FAILED', field);
              }
            });

            await context.test('pagination: keyset order, no gaps, no hidden rows', async () => {
              const all = await ids(sessionGlobal);
              const walk = async (session: string, limit: string) => {
                const seen: string[] = [];
                let cursor: string | undefined;
                for (let pages = 0; pages < 20; pages += 1) {
                  const page = await directory.list(session, {
                    q: run,
                    limit,
                    ...(cursor ? { cursor } : {}),
                  });
                  assert.ok(page.items.length <= Number(limit));
                  seen.push(...page.items.map((row) => row.id));
                  if (!page.nextCursor) return seen;
                  cursor = page.nextCursor;
                }
                throw new Error('pagination did not end');
              };
              assert.deepEqual(await walk(sessionGlobal, '2'), all);
              // Hidden employees sort between visible ones yet never appear on any page.
              const scoped = await walk(sessionA, '1');
              assert.deepEqual(set(scoped), set([worker, viewerA, operator]));
              assert.equal(scoped.length, 3);
              // Searching for a hidden employee's exact code reveals nothing.
              assert.deepEqual(await ids(sessionA, { q: await codeOf(multi) }), []);
              assert.deepEqual(await ids(sessionA, { q: await codeOf(branchless) }), []);
              assert.deepEqual(await ids(sessionA, { branchId: B }), []);
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
        (await database.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } }))?.id,
        existingOwner?.id,
        'no Owner created',
      );
    } finally {
      await database.$disconnect();
    }
  },
);

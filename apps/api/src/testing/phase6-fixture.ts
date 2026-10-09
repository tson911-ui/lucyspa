import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  createDatabaseClient,
  syncPermissionCatalog,
  type DatabaseClient,
  type PermissionCode,
  type Prisma,
} from '@lucy-spa/database';
import { parseApiEnvironment, type ApiEnvironment } from '@lucy-spa/server';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { appointForFixture } from './organization-fixture.js';
import { validVnMobile } from './phone.js';

/**
 * Integration-test fixture for Phase 6 (catalog, inventory): one outer transaction that always rolls back, the session service
 * wired to it, logged-in staff with chosen permissions at a chosen scope, and `fails` to assert a precise error. Test fixture only.
 */
export interface Phase6Kit {
  tx: Prisma.TransactionClient;
  database: DatabaseClient;
  environment: ApiEnvironment;
  /** The adapter every service takes in place of `SessionService`, bound to the outer transaction (savepoints). */
  adapter: Pick<
    SessionService,
    'withTransaction' | 'withExclusiveTransaction' | 'resolveForMutation' | 'resolve'
  >;
  throttle: AuthThrottleService;
  /** A short unique token of this run, for codes and names. */
  run: string;
  ownerToken: string;
  /** Creates an active branch. */
  branch: (label: string, timezone?: string) => Promise<{ id: string; code: string }>;
  /**
   * An employee with a role holding `codes`, granted GLOBAL or at `branchId`; `deny` adds explicit DENY overrides (GLOBAL).
   * The employee belongs to every branch in `member` (default: the scope branch).
   */
  staff: (
    codes: readonly PermissionCode[],
    options?: {
      branchId?: string;
      member?: readonly string[];
      deny?: readonly PermissionCode[];
      /** A second role granted GLOBALLY next to the branch-scoped one (the global-only codes). */
      globalCodes?: readonly PermissionCode[];
    },
  ) => Promise<{ id: string; token: string }>;
  fails: (work: () => Promise<unknown>, code: string, field?: string) => Promise<void>;
  /** A signed-in session token for any existing user (a member of the website too); the fixture user has a placeholder password. */
  signIn: (userId: string) => Promise<string>;
}

export async function phase6Fixture(work: (kit: Phase6Kit) => Promise<void>): Promise<void> {
  const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
  if (existsSync(envPath)) loadEnvFile(envPath);
  const databaseUrl = process.env['DATABASE_URL'];
  assert.ok(databaseUrl);
  const ring = () => JSON.stringify({ 1: randomBytes(32).toString('base64url') });
  const environment = parseApiEnvironment({
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    REDIS_URL: 'redis://localhost:6379',
    WEB_ORIGIN: 'http://localhost:3000',
    AUTH_ALLOW_INSECURE_LOCAL_COOKIE: 'true',
    AUTH_CSRF_KEYS: ring(),
    AUTH_CSRF_ACTIVE_VERSION: '1',
    AUTH_THROTTLE_KEYS: ring(),
    AUTH_THROTTLE_ACTIVE_VERSION: '1',
  });
  const database = createDatabaseClient(databaseUrl);
  const sessions = new SessionService({ client: database } as PrismaService, environment);
  const rollback = new Error('Phase 6 fixture rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
  try {
    await assert.rejects(
      database.$transaction(
        async (tx: Prisma.TransactionClient) => {
          let n = 0;
          let savepoint = 0;
          const isolated = async <T>(job: (client: Prisma.TransactionClient) => Promise<T>) => {
            const name = `p6_${++savepoint}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              const result = await job(tx);
              await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
              return result;
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              throw error;
            }
          };
          const adapter = {
            withTransaction: isolated,
            withExclusiveTransaction: isolated,
            resolveForMutation: (token: string) => sessions.resolveForMutation(token, tx),
            resolve: (token: string | undefined) => sessions.resolve(token, tx),
          } as Phase6Kit['adapter'];
          await syncPermissionCatalog(tx);
          const login = async (user: {
            id: string;
            passwordHash: string | null;
            credentialVersion: number;
            authzVersion: number;
          }) => {
            const principal = {
              userId: user.id,
              passwordHash: user.passwordHash!,
              credentialVersion: user.credentialVersion,
              authzVersion: user.authzVersion,
            };
            const first = (
              await sessions.rotateAuthenticated(
                (await sessions.createAnonymous(tx)).token,
                principal,
                { reauthenticated: false },
                tx,
              )
            ).token;
            return (
              await sessions.rotateAuthenticated(first, principal, { reauthenticated: true }, tx)
            ).token;
          };
          const ownerRow =
            (await tx.user.findFirst({ where: { kind: 'OWNER' } })) ??
            (await tx.user.create({
              data: {
                kind: 'OWNER',
                status: 'ACTIVE',
                fullName: 'Chủ spa fixture',
                preferredLocale: 'vi',
                emailCanonical: `p6-owner-${run.toLowerCase()}@example.com`,
                emailDelivery: `p6-owner-${run.toLowerCase()}@example.com`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture',
              },
            }));
          const ownerToken = await login(ownerRow);
          const branch: Phase6Kit['branch'] = async (label, timezone = 'Asia/Ho_Chi_Minh') =>
            tx.branch.create({
              data: {
                code: `P6_${label}_${run}`.slice(0, 40),
                name: `Chi nhánh ${label}`,
                timezone,
              },
              select: { id: true, code: true },
            });
          const staff: Phase6Kit['staff'] = async (codes, options = {}) => {
            n++;
            const role = await tx.role.create({
              data: {
                code: `P6_R${n}_${run}`,
                displayNameVi: `Vai trò ${n}`,
                displayNameEn: `Role ${n}`,
                permissions: {
                  create: await Promise.all(
                    codes.map(async (code) => ({
                      permissionId: (await tx.permission.findUniqueOrThrow({ where: { code } })).id,
                    })),
                  ),
                },
              },
            });
            const user = await tx.user.create({
              data: {
                kind: 'EMPLOYEE',
                status: 'ACTIVE',
                fullName: `Nhân viên ${n}`,
                preferredLocale: 'vi',
                phoneCanonical: validVnMobile(),
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture',
                employeeProfile: {
                  create: {
                    employeeCodeCanonical: `P6_${run}_${n}`,
                    dateOfBirth: new Date('1990-01-01'),
                    address: 'Fixture',
                  },
                },
              },
            });
            await tx.employmentClassificationChange.create({
              data: {
                employeeUserId: user.id,
                classification: 'OFFICIAL_EMPLOYEE',
                effectiveDate: new Date('2020-01-01'),
              },
            });
            const member = options.member ?? (options.branchId ? [options.branchId] : []);
            for (const branchId of member) {
              await tx.employeeBranchAssignment.create({
                data: { employeeUserId: user.id, branchId, grantedByUserId: user.id },
              });
            }
            await tx.userRoleAssignment.create({
              data: options.branchId
                ? {
                    userId: user.id,
                    roleId: role.id,
                    scopeKind: 'BRANCH',
                    branchId: options.branchId,
                  }
                : { userId: user.id, roleId: role.id, scopeKind: 'GLOBAL' },
            });
            if (options.globalCodes?.length) {
              const globalRole = await tx.role.create({
                data: {
                  code: `P6_G${n}_${run}`,
                  displayNameVi: `Vai trò chung ${n}`,
                  displayNameEn: `Global role ${n}`,
                  permissions: {
                    create: await Promise.all(
                      options.globalCodes.map(async (code) => ({
                        permissionId: (await tx.permission.findUniqueOrThrow({ where: { code } }))
                          .id,
                      })),
                    ),
                  },
                },
              });
              await tx.userRoleAssignment.create({
                data: { userId: user.id, roleId: globalRole.id, scopeKind: 'GLOBAL' },
              });
            }
            for (const code of options.deny ?? []) {
              await tx.userPermissionOverride.create({
                data: {
                  userId: user.id,
                  permissionId: (await tx.permission.findUniqueOrThrow({ where: { code } })).id,
                  effect: 'DENY',
                  scopeKind: 'GLOBAL',
                },
              });
            }
            await appointForFixture(tx, user.id, options.branchId ?? null);
            const fresh = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
            return { id: user.id, token: await login(fresh) };
          };
          const fails: Phase6Kit['fails'] = async (job, code, field) => {
            // A command that fails before it returns a promise (a bad id) counts as rejecting too.
            await assert.rejects(
              async () => job(),
              (error: unknown) => {
                assert.equal(Reflect.get(Object(error), 'code'), code);
                if (field !== undefined) assert.equal(Reflect.get(Object(error), 'field'), field);
                return true;
              },
            );
          };
          const signIn: Phase6Kit['signIn'] = async (userId) =>
            login(await tx.user.findUniqueOrThrow({ where: { id: userId } }));
          await work({
            tx,
            database,
            environment,
            adapter,
            throttle: new AuthThrottleService(environment),
            run,
            ownerToken,
            branch,
            staff,
            fails,
            signIn,
          });
          throw rollback;
        },
        { timeout: 600_000, maxWait: 30_000 },
      ),
      (error: unknown) => error === rollback,
    );
  } finally {
    await database.$disconnect();
  }
}

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { ProductImportService } from './import.service.js';

/**
 * Phase 6 P6-5 import races on separate committed PostgreSQL connections with real production service calls: one previewed file
 * applied by two people at once applies once; two opening-stock files for the same branch and variant (both previewed before
 * either applied) let exactly one in, the other is refused as stale; two files creating the same new SKU create it once. Requires an
 * explicitly opted-in local scratch/validation database (replica-role cleanup of append-only history); cleanup is bounded to the
 * exact UUIDs and codes of this invocation.
 */
test(
  'Phase 6 P6-5 import races: a file applies once, opening stock enters once, a new SKU is created once',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const database = createDatabaseClient(databaseUrl);
    if (!/validation|scratch|uxaudit/.test(new URL(databaseUrl).pathname.slice(1))) {
      suite.skip('committed fixtures run only on a throw-away validation database');
      return;
    }
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
    const sessions = new SessionService({ client: database } as PrismaService, environment);
    let meet: (() => Promise<void>) | null = null;
    const withTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
      database.$transaction(
        async (tx) => {
          await takeSharedAuthGraphLock(tx);
          if (meet) await meet();
          return work(tx);
        },
        { timeout: 30_000, maxWait: 10_000 },
      );
    const adapter = {
      withTransaction,
      withExclusiveTransaction: withTransaction,
      resolveForMutation: (token: string, tx: Prisma.TransactionClient) =>
        sessions.resolveForMutation(token, tx),
    };
    const imports = new ProductImportService(
      adapter,
      new AuthThrottleService(environment),
      environment,
    );
    const ids = { branch: randomUUID(), role: randomUUID(), product: randomUUID() };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    const csv = (lines: string[]) => ({
      buffer: Buffer.from(lines.join('\n')),
      originalname: 'race.csv',
    });
    const outcome = (result: PromiseSettledResult<unknown>) => {
      if (result.status === 'fulfilled') return 'OK';
      assert.ok(result.reason instanceof AuthError, String(result.reason));
      return result.reason.code;
    };
    const race = async <A, B>(first: () => Promise<A>, second: () => Promise<B>) => {
      let count = 0;
      let release!: () => void;
      let fail!: (error: Error) => void;
      const gate = new Promise<void>((resolve, reject) => {
        release = resolve;
        fail = reject;
      });
      const timer = setTimeout(
        () => fail(new Error('Both race transactions must reach the latch.')),
        10_000,
      );
      meet = async () => {
        if (++count === 2) release();
        await gate;
      };
      try {
        const results = await Promise.allSettled([first(), second()] as const);
        assert.equal(count, 2, 'two independent transactions competed');
        return results;
      } finally {
        clearTimeout(timer);
        meet = null;
      }
    };
    try {
      await database.$transaction(async (tx) => {
        await tx.branch.create({
          data: {
            id: ids.branch,
            code: `IMR_${run}`,
            name: 'Import race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await syncPermissionCatalog(tx);
        const permission = await tx.permission.findMany({
          where: { code: 'IMPORT_PRODUCT_DATA' },
          select: { id: true },
        });
        await tx.role.create({
          data: {
            id: ids.role,
            code: `IMR_${run}`,
            displayNameVi: 'IMR',
            displayNameEn: 'IMR',
            permissions: { create: permission.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const staff = () =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const user = await tx.user.create({
            data: {
              id,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Import race employee',
              preferredLocale: 'vi',
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: validVnMobile(),
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `IMR_${run}_${++serial}`,
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          await tx.employmentClassificationChange.create({
            data: {
              employeeUserId: id,
              classification: 'OFFICIAL_EMPLOYEE',
              effectiveDate: new Date('2020-01-01'),
            },
          });
          await tx.employeeBranchAssignment.create({
            data: { employeeUserId: id, branchId: ids.branch, grantedByUserId: id },
          });
          await tx.userRoleAssignment.create({
            data: { userId: id, roleId: ids.role, scopeKind: 'GLOBAL' },
          });
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            {
              userId: id,
              passwordHash: user.passwordHash!,
              credentialVersion: user.credentialVersion,
              authzVersion: user.authzVersion,
            },
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          return { id, token: issued.token };
        });
      const one = await staff();
      const two = await staff();
      await database.product.create({
        data: {
          id: ids.product,
          code: `imr-${run.toLowerCase()}`,
          nameVi: 'Race',
          nameEn: 'Race',
          createdByUserId: one.id,
        },
      });
      const sku = (name: string) => `IMR-${run}-${name}`;
      const head = 'sku,name_vi,name_en';
      const catalog = (token: string, lines: string[]) =>
        imports.upload(token, csv([head, ...lines]), { kind: 'CATALOG' });

      await suite.test(
        'one previewed file applied by two people at once applies once',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const code = sku(`ONE${round}`);
            const job = await catalog(one.token, [
              `${code},Tên ${run} ${round},Name ${run} ${round}`,
            ]);
            const results = await race(
              () =>
                imports.apply(one.token, job.id, {
                  expectedRowVersion: job.rowVersion,
                  skipInvalid: false,
                }),
              () =>
                imports.apply(two.token, job.id, {
                  expectedRowVersion: job.rowVersion,
                  skipInvalid: false,
                }),
            );
            assert.deepEqual(results.map(outcome).sort(), ['CONFLICT', 'OK'], `round ${round}`);
            assert.equal(await database.productVariant.count({ where: { sku: code } }), 1);
            assert.equal(
              await database.product.count({ where: { nameEn: `Name ${run} ${round}` } }),
              1,
            );
            assert.equal((await imports.detail(one.token, job.id)).status, 'APPLIED');
          }
        },
      );

      await suite.test(
        'two opening-stock files for one branch and variant: one enters, one is stale',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const variant = await database.productVariant.create({
              data: { productId: ids.product, sku: sku(`OPEN${round}`) },
            });
            const file = (quantity: number) =>
              imports.upload(one.token, csv(['sku,quantity', `${variant.sku},${quantity}`]), {
                kind: 'OPENING_STOCK',
                branchId: ids.branch,
              });
            const first = await file(7);
            const second = await file(9);
            assert.equal(second.status, 'PREVIEWED', 'both were valid when previewed');
            const results = await race(
              () =>
                imports.apply(one.token, first.id, {
                  expectedRowVersion: first.rowVersion,
                  skipInvalid: false,
                }),
              () =>
                imports.apply(two.token, second.id, {
                  expectedRowVersion: second.rowVersion,
                  skipInvalid: false,
                }),
            );
            const outcomes = results.map(outcome).sort();
            assert.deepEqual(outcomes, ['IMPORT_PREVIEW_STALE', 'OK'], `round ${round}`);
            const level = await database.stockLevel.findUnique({
              where: { branchId_variantId: { branchId: ids.branch, variantId: variant.id } },
            });
            assert.ok([7, 9].includes(level?.onHand ?? -1), 'exactly one file entered');
            assert.equal(
              await database.stockMovement.count({ where: { variantId: variant.id } }),
              1,
            );
          }
        },
      );

      await suite.test('two files creating the same new SKU create it once', async () => {
        for (let round = 0; round < 3; round += 1) {
          const code = sku(`NEW${round}`);
          const first = await catalog(one.token, [
            `${code},Mới ${run} ${round},New ${run} ${round}`,
          ]);
          const second = await catalog(two.token, [
            `${code},Mới ${run} ${round},New ${run} ${round}`,
          ]);
          const results = await race(
            () =>
              imports.apply(one.token, first.id, {
                expectedRowVersion: first.rowVersion,
                skipInvalid: false,
              }),
            () =>
              imports.apply(two.token, second.id, {
                expectedRowVersion: second.rowVersion,
                skipInvalid: false,
              }),
          );
          const outcomes = results.map(outcome).sort();
          assert.equal(outcomes[1], 'OK', `round ${round}`);
          assert.ok(['CONFLICT', 'IMPORT_PREVIEW_STALE'].includes(outcomes[0]!), outcomes.join());
          assert.equal(await database.productVariant.count({ where: { sku: code } }), 1);
        }
      });
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const variants = (
              await tx.productVariant.findMany({
                where: { sku: { startsWith: `IMR-${run}-` } },
                select: { id: true, productId: true },
              })
            ).map((row) => row);
            const variantIds = variants.map((row) => row.id);
            const productIds = [...new Set([ids.product, ...variants.map((row) => row.productId)])];
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.stockMovement.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockLevel.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLot.deleteMany({ where: { branchId: ids.branch } });
            await tx.productImportRow.deleteMany({
              where: { job: { createdByUserId: { in: userIds } } },
            });
            await tx.productImportJob.deleteMany({ where: { createdByUserId: { in: userIds } } });
            await tx.productPriceVersion.deleteMany({ where: { variantId: { in: variantIds } } });
            await tx.productVariant.deleteMany({ where: { id: { in: variantIds } } });
            await tx.product.deleteMany({ where: { id: { in: productIds } } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({ where: { roleId: ids.role } });
            await tx.role.deleteMany({ where: { id: ids.role } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 30_000 },
        );
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(
          await database.productImportJob.count({ where: { createdByUserId: { in: userIds } } }),
          0,
        );
      } finally {
        await database.$disconnect();
      }
    }
  },
);

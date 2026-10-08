import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
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
import { createPayosSimulator, parseApiEnvironment } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { RewardService } from './reward.service.js';

/**
 * Phase 6 P6-18 races (the stock of product gifts) on separate committed PostgreSQL connections with real production service calls (the
 * same latch as the other races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken
 * by production code). Whatever the interleaving: the last free unit goes to one use or to one sale, never to both; a use is restored
 * once and gives its unit back once; the stock always equals its movements. Requires an explicitly opted-in local validation database;
 * cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-18 PostgreSQL races keep gift stock, sales and restores consistent',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const envPath = fileURLToPath(new URL('../../../../.env', import.meta.url));
    if (existsSync(envPath)) loadEnvFile(envPath);
    const databaseUrl = process.env['DATABASE_URL'];
    assert.ok(databaseUrl);
    const database = createDatabaseClient(databaseUrl);
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
    const simulator = createPayosSimulator();
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
      resolve: (token: string) => sessions.resolve(token),
    };
    const throttle = new AuthThrottleService(environment);
    const invoices = new InvoiceService(
      adapter as never,
      throttle,
      environment,
      simulator.provider,
    );
    const inventory = new InventoryService(adapter as never, throttle, environment);
    const rewards = new RewardService(adapter as never, throttle, environment);
    const ids = { branch: randomUUID(), branchRole: randomUUID(), globalRole: randomUUID() };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const productIds: string[] = [];
    const itemIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    let createdGoLive = false;
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
        if (count < 2 && ++count === 2) release();
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
            code: `PGR_${run}`,
            name: 'Gift race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await syncPermissionCatalog(tx);
        const role = async (id: string, codes: PermissionCode[]) => {
          const permissions = await tx.permission.findMany({
            where: { code: { in: codes } },
            select: { id: true },
          });
          assert.equal(permissions.length, codes.length);
          await tx.role.create({
            data: {
              id,
              code: `PGR_${id.slice(0, 8).toUpperCase()}_${run}`,
              displayNameVi: 'Race',
              displayNameEn: 'Race',
              permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
            },
          });
        };
        await role(ids.branchRole, [
          'SELL_PRODUCTS',
          'VIEW_INVOICES',
          'MANAGE_INVOICES',
          'COLLECT_PAYMENTS',
          'MANAGE_STOCK_RECEIPTS',
          'VIEW_INVENTORY',
          'ISSUE_REWARDS',
        ]);
        await role(ids.globalRole, ['MANAGE_REWARD_CATALOG']);
      });
      const staff = (global: boolean) =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const user = await tx.user.create({
            data: {
              id,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Race employee',
              preferredLocale: 'vi',
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: validVnMobile(),
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `PGR_${run}_${++serial}`,
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
            data: { userId: id, roleId: ids.branchRole, scopeKind: 'BRANCH', branchId: ids.branch },
          });
          if (global) {
            await tx.userRoleAssignment.create({
              data: { userId: id, roleId: ids.globalRole, scopeKind: 'GLOBAL' },
            });
          }
          const principal = {
            userId: id,
            passwordHash: user.passwordHash!,
            credentialVersion: user.credentialVersion,
            authzVersion: user.authzVersion,
          };
          const anonymous = await sessions.createAnonymous(tx);
          sessionIds.push(anonymous.session.id);
          const issued = await sessions.rotateAuthenticated(
            anonymous.token,
            principal,
            { reauthenticated: false },
            tx,
          );
          sessionIds.push(issued.session.id);
          return { id, token: issued.token };
        });
      const clerk = await staff(false);
      const boss = await staff(true);
      const boss2 = await staff(true);
      const member = await database.$transaction(async (tx) => {
        const id = randomUUID();
        userIds.push(id);
        await tx.user.create({
          data: {
            id,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: 'Khách quà race',
            preferredLocale: 'vi',
            emailCanonical: `pgr-${run.toLowerCase()}@example.com`,
            emailDelivery: `pgr-${run.toLowerCase()}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
            },
          },
        });
        if ((await tx.loyaltyGoLive.count()) === 0) {
          await tx.loyaltyGoLive.create({ data: { activatedByUserId: id } });
          createdGoLive = true;
        }
        return { id };
      });

      const today = async () =>
        (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
      const variant = async (stock: number) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `pgr-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem quà',
              nameEn: 'Gift cream',
              createdByUserId: clerk.id,
              variants: { create: [{ sku: `PGR-${run}-${serial}` }] },
            },
            include: { variants: true },
          });
          productIds.push(product.id);
          const row = product.variants[0]!;
          await tx.productPriceVersion.create({
            data: {
              variantId: row.id,
              versionNo: 1,
              listPriceVnd: 60_000n,
              createdByUserId: clerk.id,
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
          });
          return row.id;
        });
        if (stock > 0) {
          const draft = await inventory.createReceipt(clerk.token, {
            branchId: ids.branch,
            supplierId: null,
            receiptDate: await today(),
            notes: null,
            lines: [
              { variantId: created, quantity: stock, lotCode: `L${serial}`, expiryDate: null },
            ],
          });
          await inventory.confirmReceipt(clerk.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
          });
        }
        return created;
      };
      /** A gift linked to the variant and `count` entitlements of one unit each. */
      const gifts = async (variantId: string, count: number) => {
        const item = await rewards.createItem(boss.token, {
          kind: 'PRODUCT_GIFT',
          serviceId: null,
          variantId,
          nameVi: 'Quà',
          nameEn: 'Gift',
          active: true,
          expiryDays: null,
        });
        itemIds.push(item.id);
        const entitlements: string[] = [];
        for (let index = 0; index < count; index += 1) {
          const given = await rewards.issue(clerk.token, ids.branch, member.id, {
            catalogItemId: item.id,
            quantity: 1,
            reason: 'Quà tri ân',
          });
          entitlements.push(given.id);
        }
        return entitlements;
      };
      const use = (entitlementId: string) =>
        rewards.use(clerk.token, ids.branch, entitlementId, { note: 'Tặng' });
      const levelOf = (variantId: string) =>
        database.stockLevel.findUniqueOrThrow({
          where: { branchId_variantId: { branchId: ids.branch, variantId } },
        });
      const audit = async () => {
        const levels = await database.$queryRaw<
          { variant: string; on_hand: number; reserved: number; moved: bigint; held: bigint }[]
        >`
          SELECT s.variant_id AS variant, s.on_hand, s.reserved,
                 COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m
                           WHERE m.branch_id = s.branch_id AND m.variant_id = s.variant_id), 0)::bigint AS moved,
                 COALESCE((SELECT sum(r.quantity) FROM stock_reservations r
                           WHERE r.branch_id = s.branch_id AND r.variant_id = s.variant_id AND r.status = 'RESERVED'), 0)::bigint AS held
          FROM stock_levels s WHERE s.branch_id = ${ids.branch}::uuid`;
        for (const level of levels) {
          assert.equal(BigInt(level.on_hand), level.moved, `on hand = movements ${level.variant}`);
          assert.equal(
            BigInt(level.reserved),
            level.held,
            `reserved = open reservations ${level.variant}`,
          );
          assert.ok(level.reserved <= level.on_hand, `reserved <= on hand ${level.variant}`);
        }
        const uses = await database.$queryRaw<
          { id: string; out: bigint; back: bigint; restored: boolean }[]
        >`
          SELECT u.id,
                 COALESCE((SELECT -sum(m.quantity_delta) FROM stock_movements m WHERE m.reward_manual_use_id = u.id AND m.kind = 'GIFT_OUT'), 0)::bigint AS out,
                 COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m WHERE m.reward_manual_use_id = u.id AND m.kind = 'GIFT_RETURN'), 0)::bigint AS back,
                 EXISTS (SELECT 1 FROM reward_manual_use_restorations r WHERE r.use_id = u.id) AS restored
          FROM reward_manual_uses u WHERE u.branch_id = ${ids.branch}::uuid`;
        for (const row of uses) {
          assert.equal(row.out, 1n, `use ${row.id} took one unit`);
          assert.equal(
            row.back,
            row.restored ? 1n : 0n,
            `use ${row.id} gave back its unit once if restored`,
          );
        }
      };

      await suite.test(
        'two uses of the last free unit: one gets it, the other is told it is out of stock',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(1);
            const [a, b] = await gifts(v, 2);
            const results = await race(
              () => use(a!),
              () => use(b!),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'REWARD_OUT_OF_STOCK'],
              `round ${round}`,
            );
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [0, 0]);
            assert.equal(
              await database.stockMovement.count({ where: { variantId: v, kind: 'GIFT_OUT' } }),
              1,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'a gift racing a counter sale for the last unit: the unit goes to one of them, never to both',
        async () => {
          for (let round = 0; round < 8; round += 1) {
            const v = await variant(1);
            const [entitlement] = await gifts(v, 1);
            let draft = (
              await invoices.openProductSale(clerk.token, ids.branch, { payerUserId: null })
            ).invoice;
            draft = await invoices.addProductLine(clerk.token, draft.id, {
              expectedVersion: draft.version,
              variantId: v,
              quantity: 1,
            });
            const results = await race(
              () => use(entitlement!),
              () => invoices.finalize(clerk.token, draft.id, { expectedVersion: draft.version }),
            );
            const codes = results.map(outcome);
            assert.equal(
              codes.filter((code) => code === 'OK').length,
              1,
              `round ${round}: ${codes.join()}`,
            );
            const level = await levelOf(v);
            assert.ok(level.reserved <= level.onHand);
          }
          await audit();
        },
      );

      await suite.test(
        'the same use restored twice at once: one restore, one unit back',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(2);
            const [entitlement] = await gifts(v, 1);
            const used = await use(entitlement!);
            const useId = used.uses[0]!.id;
            const results = await race(
              () => rewards.restore(boss.token, useId, { reason: 'Bấm nhầm' }),
              () => rewards.restore(boss2.token, useId, { reason: 'Bấm nhầm lần hai' }),
            );
            const codes = results.map(outcome).sort();
            assert.equal(
              codes.filter((code) => code === 'OK').length,
              1,
              `round ${round}: ${codes.join()}`,
            );
            assert.equal(
              await database.stockMovement.count({ where: { variantId: v, kind: 'GIFT_RETURN' } }),
              1,
            );
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [2, 0]);
          }
          await audit();
        },
      );
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const invoiceRows = (
              await tx.invoice.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((row) => row.id);
            const entitlementRows = (
              await tx.rewardEntitlement.findMany({
                where: { catalogItemId: { in: itemIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const useRows = (
              await tx.rewardManualUse.findMany({
                where: { entitlementId: { in: entitlementRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const variantRows = (
              await tx.productVariant.findMany({
                where: { productId: { in: productIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.notification.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { recipientUserId: { in: userIds } }] },
            });
            await tx.outboxConsumption.deleteMany({
              where: {
                event: {
                  OR: [
                    { branchId: ids.branch },
                    { aggregateId: { in: [...invoiceRows, ...entitlementRows] } },
                  ],
                },
              },
            });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...invoiceRows, ...entitlementRows] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { actorUserId: { in: userIds } },
                  { subjectUserId: { in: userIds } },
                ],
              },
            });
            await tx.stockMovement.deleteMany({ where: { branchId: ids.branch } });
            await tx.rewardManualUseRestoration.deleteMany({ where: { useId: { in: useRows } } });
            await tx.rewardManualUse.deleteMany({ where: { id: { in: useRows } } });
            await tx.rewardEntitlement.deleteMany({ where: { id: { in: entitlementRows } } });
            await tx.rewardCatalogItem.deleteMany({ where: { id: { in: itemIds } } });
            await tx.stockReservation.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineProduct.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.inventoryLot.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLowStockAlert.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockLevel.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockReceiptLine.deleteMany({ where: { receipt: { branchId: ids.branch } } });
            await tx.stockReceipt.deleteMany({ where: { branchId: ids.branch } });
            await tx.productPriceVersion.deleteMany({ where: { variantId: { in: variantRows } } });
            await tx.productVariant.deleteMany({ where: { id: { in: variantRows } } });
            await tx.product.deleteMany({ where: { id: { in: productIds } } });
            if (createdGoLive) await tx.loyaltyGoLive.deleteMany({});
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({
              where: { roleId: { in: [ids.branchRole, ids.globalRole] } },
            });
            await tx.role.deleteMany({ where: { id: { in: [ids.branchRole, ids.globalRole] } } });
            await tx.employeeBranchAssignment.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employmentClassificationChange.deleteMany({
              where: { employeeUserId: { in: userIds } },
            });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.customerProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 60_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(await database.product.count({ where: { id: { in: productIds } } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);

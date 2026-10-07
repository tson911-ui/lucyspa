import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { parseApiEnvironment, processLowStockAlert } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { InventoryService } from './inventory.service.js';

/**
 * Phase 6 P6-4 inventory races on separate committed PostgreSQL connections with real production service calls: one draft
 * receipt confirmed by two people at once, two adjustments taking the last units of one lot, a physical count approved while an
 * adjustment runs, and the low-stock alert raised once and handled once however many workers look at it. Requires an explicitly
 * opted-in local scratch/validation database (replica-role cleanup of append-only stock history); cleanup is bounded to the exact
 * UUIDs of this invocation.
 */
test(
  'Phase 6 P6-4 inventory races: a receipt applies once, the last units go to one buyer, a count and an adjustment never corrupt stock',
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
    const inv = new InventoryService(adapter, new AuthThrottleService(environment), environment);
    const ids = {
      branch: randomUUID(),
      adjustRole: randomUUID(),
      receiptRole: randomUUID(),
      product: randomUUID(),
    };
    const userIds: string[] = [];
    const sessionIds: string[] = [];
    const variantIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
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
            code: `INR_${run}`,
            name: 'Inventory race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await syncPermissionCatalog(tx);
        const role = async (id: string, name: string, codes: string[]) => {
          const permissions = await tx.permission.findMany({
            where: { code: { in: codes as never[] } },
            select: { id: true },
          });
          await tx.role.create({
            data: {
              id,
              code: `INR_${name}_${run}`,
              displayNameVi: name,
              displayNameEn: name,
              permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
            },
          });
        };
        await role(ids.adjustRole, 'ADJ', ['ADJUST_STOCK', 'VIEW_INVENTORY']);
        await role(ids.receiptRole, 'RCP', ['MANAGE_STOCK_RECEIPTS']);
      });
      const staff = (roleId: string) =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          const user = await tx.user.create({
            data: {
              id,
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Inventory race employee',
              preferredLocale: 'vi',
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: validVnMobile(),
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `INR_${run}_${++serial}`,
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
            data: { userId: id, roleId, scopeKind: 'BRANCH', branchId: ids.branch },
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
      const adj1 = await staff(ids.adjustRole);
      const adj2 = await staff(ids.adjustRole);
      const rcp1 = await staff(ids.receiptRole);
      const rcp2 = await staff(ids.receiptRole);
      await database.product.create({
        data: {
          id: ids.product,
          code: `inr-${run.toLowerCase()}`,
          nameVi: 'Race',
          nameEn: 'Race',
          createdByUserId: adj1.id,
        },
      });
      const variant = async (threshold: number | null = null) => {
        const created = await database.productVariant.create({
          data: {
            productId: ids.product,
            sku: `INR-${run}-${++serial}`,
            lowStockThreshold: threshold,
          },
        });
        variantIds.push(created.id);
        return created.id;
      };
      const stock = async (variantId: string) =>
        (
          await database.stockLevel.findUnique({
            where: { branchId_variantId: { branchId: ids.branch, variantId } },
          })
        )?.onHand ?? 0;
      const receive = async (variantId: string, quantity: number) => {
        const draft = await inv.createReceipt(rcp1.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: '2027-01-01',
          notes: null,
          lines: [{ variantId, quantity, lotCode: null, expiryDate: null }],
        });
        return {
          draft,
          confirmed: await inv.confirmReceipt(rcp1.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
          }),
        };
      };

      await suite.test(
        'one draft receipt confirmed by two people at once is applied once',
        async () => {
          const v = await variant();
          for (let round = 0; round < 3; round += 1) {
            const draft = await inv.createReceipt(rcp1.token, {
              branchId: ids.branch,
              supplierId: null,
              receiptDate: '2027-01-01',
              notes: null,
              lines: [{ variantId: v, quantity: 5, lotCode: null, expiryDate: null }],
            });
            const results = await race(
              () =>
                inv.confirmReceipt(rcp1.token, draft.id, { expectedRowVersion: draft.rowVersion }),
              () =>
                inv.confirmReceipt(rcp2.token, draft.id, { expectedRowVersion: draft.rowVersion }),
            );
            const outcomes = results.map(outcome).sort();
            assert.deepEqual(outcomes, ['CONFLICT', 'OK'], `round ${round}`);
            assert.equal(await stock(v), 5 * (round + 1), 'stock entered once per receipt');
            assert.equal(
              await database.stockMovement.count({
                where: { receiptLine: { receiptId: draft.id } },
              }),
              1,
            );
            assert.equal(
              await database.outboxEvent.count({
                where: { eventType: 'STOCK_RECEIPT_CONFIRMED', aggregateId: draft.id },
              }),
              1,
            );
          }
        },
      );

      await suite.test(
        'two adjustments taking the last units of one lot: one wins, the stock never goes below zero',
        async () => {
          const v = await variant();
          for (let round = 0; round < 3; round += 1) {
            await receive(v, 5);
            const lot = await database.inventoryLot.findFirstOrThrow({
              where: { branchId: ids.branch, variantId: v, quantityOnHand: 5 },
            });
            const take = (token: string) => () =>
              inv.adjust(token, {
                requestKey: randomUUID(),
                branchId: ids.branch,
                variantId: v,
                lotId: lot.id,
                quantity: 4,
                reason: 'LOSS',
                note: null,
              });
            const results = await race(take(adj1.token), take(adj2.token));
            assert.deepEqual(
              results.map(outcome).sort(),
              ['INVENTORY_INSUFFICIENT_STOCK', 'OK'],
              `round ${round}`,
            );
            assert.equal(
              (await database.inventoryLot.findUniqueOrThrow({ where: { id: lot.id } }))
                .quantityOnHand,
              1,
            );
          }
          assert.equal(await stock(v), 3, 'one unit left from each of the three lots');
        },
      );

      await suite.test(
        'the same adjustment request sent twice at once is applied once',
        async () => {
          const v = await variant();
          await receive(v, 6);
          const lot = await database.inventoryLot.findFirstOrThrow({
            where: { branchId: ids.branch, variantId: v },
          });
          const request = {
            requestKey: randomUUID(),
            branchId: ids.branch,
            variantId: v,
            lotId: lot.id,
            quantity: 2,
            reason: 'TESTER' as const,
            note: null,
          };
          const results = await race(
            () => inv.adjust(adj1.token, request),
            () => inv.adjust(adj1.token, request),
          );
          const outcomes = results.map(outcome).sort();
          assert.ok(outcomes.includes('OK'));
          assert.deepEqual(outcomes, ['OK', 'OK'], 'both copies get the same answer');
          assert.equal(await stock(v), 4, 'taken once');
          assert.equal(
            await database.stockMovement.count({
              where: { idempotencyKey: `ADJ:${request.requestKey}` },
            }),
            1,
          );
        },
      );

      await suite.test(
        'a count approved while an adjustment runs keeps the stock consistent either way',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const v = await variant();
            await receive(v, 10);
            const lot = await database.inventoryLot.findFirstOrThrow({
              where: { branchId: ids.branch, variantId: v },
            });
            const count = await inv.createCount(adj1.token, {
              branchId: ids.branch,
              notes: null,
              variantIds: [v],
            });
            const counted = await inv.setCountLines(adj1.token, count.id, {
              expectedRowVersion: count.rowVersion,
              lines: [{ variantId: v, countedQuantity: 7 }],
              removeVariantIds: [],
            });
            const results = await race(
              () =>
                inv.approveCount(adj1.token, count.id, { expectedRowVersion: counted.rowVersion }),
              () =>
                inv.adjust(adj2.token, {
                  requestKey: randomUUID(),
                  branchId: ids.branch,
                  variantId: v,
                  lotId: lot.id,
                  quantity: 2,
                  reason: 'INTERNAL_USE',
                  note: null,
                }),
            );
            const outcomes = results.map(outcome);
            assert.equal(outcomes[1], 'OK', 'the adjustment always lands');
            assert.ok(['OK', 'CONFLICT'].includes(outcomes[0]!), outcomes.join());
            const level = await stock(v);
            const line = await database.stockCountLine.findFirstOrThrow({
              where: { sessionId: count.id },
            });
            const sum = await database.stockMovement.aggregate({
              where: { branchId: ids.branch, variantId: v },
              _sum: { quantityDelta: true },
            });
            assert.equal(
              sum._sum.quantityDelta,
              level,
              'on hand is exactly the sum of the movements',
            );
            if (outcomes[0] === 'OK') {
              // Approved first (the system said 10, difference -3, then 2 more left: 5) or after the adjustment (8, difference -1: 7).
              assert.ok([5, 7].includes(level), `level ${level}`);
              assert.equal(
                line.systemQuantity! + line.difference!,
                7,
                'stamped against the quantity at approval',
              );
              assert.equal(
                (
                  await database.stockMovement.aggregate({
                    where: { countLineId: line.id },
                    _sum: { quantityDelta: true },
                  })
                )._sum.quantityDelta,
                line.difference,
              );
            } else {
              assert.equal(level, 8, 'only the adjustment applied');
            }
          }
        },
      );

      await suite.test(
        'a low-stock alert is raised once and handled once, whoever looks',
        async () => {
          const v = await variant(3);
          await receive(v, 10);
          const lots = await database.inventoryLot.findMany({
            where: { branchId: ids.branch, variantId: v },
          });
          const lot = lots[0]!;
          // 10 - 4 - 4 = 2: the second one crosses the threshold of 3; both run together and exactly one alert results.
          const take = (token: string) => () =>
            inv.adjust(token, {
              requestKey: randomUUID(),
              branchId: ids.branch,
              variantId: v,
              lotId: lot.id,
              quantity: 4,
              reason: 'LOSS',
              note: null,
            });
          const results = await race(take(adj1.token), take(adj2.token));
          assert.deepEqual(results.map(outcome), ['OK', 'OK']);
          const alerts = await database.inventoryLowStockAlert.findMany({
            where: { variantId: v },
          });
          assert.equal(alerts.length, 1, 'one crossing, one alert');
          const handle = () =>
            database.$transaction((tx) => processLowStockAlert(tx, alerts[0]!.id), {
              timeout: 30_000,
            });
          const handled = (await Promise.all([handle(), handle()])).sort();
          assert.deepEqual(handled, ['NOT_CLAIMED', 'PUBLISHED']);
          const notices = await database.notification.findMany({
            where: { entityId: v, type: 'LOW_STOCK_REACHED' },
          });
          assert.ok(
            notices.length >= 2,
            'both adjusters (VIEW_INVENTORY holders) are told, once each',
          );
          assert.equal(new Set(notices.map((n) => n.recipientUserId)).size, notices.length);
        },
      );
    } finally {
      meet = null;
      try {
        await database.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            const events = (
              await tx.outboxEvent.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.notification.deleteMany({ where: { sourceEventId: { in: events } } });
            await tx.$executeRaw`DELETE FROM outbox_consumptions WHERE event_id = ANY(${events}::uuid[])`;
            await tx.outboxEvent.deleteMany({ where: { id: { in: events } } });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.inventoryLowStockAlert.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryExpiryScan.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockMovement.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockCountLine.deleteMany({ where: { session: { branchId: ids.branch } } });
            await tx.stockCountSession.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockLevel.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLot.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockReceiptLine.deleteMany({ where: { receipt: { branchId: ids.branch } } });
            await tx.stockReceipt.deleteMany({ where: { branchId: ids.branch } });
            await tx.productVariant.deleteMany({ where: { productId: ids.product } });
            await tx.product.deleteMany({ where: { id: ids.product } });
            await tx.session.deleteMany({
              where: { OR: [{ id: { in: sessionIds } }, { userId: { in: userIds } }] },
            });
            await tx.userRoleAssignment.deleteMany({ where: { userId: { in: userIds } } });
            await tx.rolePermission.deleteMany({
              where: { roleId: { in: [ids.adjustRole, ids.receiptRole] } },
            });
            await tx.role.deleteMany({ where: { id: { in: [ids.adjustRole, ids.receiptRole] } } });
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
        assert.equal(await database.stockReceipt.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
      } finally {
        await database.$disconnect();
      }
    }
  },
);

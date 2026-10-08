import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  INVENTORY_CONSUMER,
  INVENTORY_EVENT_TYPES,
  LocalDiskMediaStorage,
  LOYALTY_CONSUMER,
  LOYALTY_EVENT_TYPES,
  parseApiEnvironment,
  processInventoryEvent,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { pino } from 'pino';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { ProductRefundService } from './refund.service.js';
import { ProductReturnService } from './return.service.js';

/**
 * Phase 6 P6-13 races on separate committed PostgreSQL connections with real production service calls (the latch of the Phase 4 and
 * Phase 6 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by production
 * code). Whatever the interleaving: a line is never refunded more units than were sold or than its case accepted, the amounts add up to
 * the net exactly, the same request is one refund, a refund and the reversal of the payment never both win (T22) and never deadlock, the
 * goods go back into stock once and only after the sale reached stock, and two workers on the points of the refunds of one invoice end
 * at the same total with each event handled once. Requires an explicitly opted-in local validation database (replica-role cleanup of
 * permanent history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-13 PostgreSQL races keep refunds, stock and Beauty points consistent',
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
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-refunds-race-'));
    const storage = new LocalDiskMediaStorage(folder);
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
      resolve: (token: string | undefined, tx: Prisma.TransactionClient) =>
        sessions.resolve(token, tx),
    };
    const throttle = new AuthThrottleService(environment);
    const invoices = new InvoiceService(adapter as never, throttle, environment);
    const inventory = new InventoryService(adapter as never, throttle, environment);
    const returns = new ProductReturnService(
      adapter as never,
      throttle,
      storage,
      pino({ level: 'silent' }),
    );
    const strictRefunds = new ProductRefundService(adapter as never, throttle, environment);
    const personOf = new Map<string, string>();
    /** A person typing their password again: a NEW confirmation (P13-3: one confirmation covers one refund). */
    const confirm = async (token: string) => {
      const userId = personOf.get(token);
      assert.ok(userId, 'a known person');
      await database.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SELECT pg_sleep(0.003)');
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe(
          `UPDATE sessions SET reauthenticated_at = date_trunc('milliseconds', clock_timestamp()) WHERE user_id = '${userId}'`,
        );
      });
    };
    /** The service as the screens use it: the person confirms their password before each refund. */
    const refunds = {
      summary: strictRefunds.summary.bind(strictRefunds),
      refund: async (...args: Parameters<ProductRefundService['refund']>) => {
        await confirm(args[0]!);
        return strictRefunds.refund(...args);
      },
    };
    const ids = { branch: randomUUID(), role: randomUUID() };
    const userIds: string[] = [];
    const customerIds: string[] = [];
    let goLiveCreated = false;
    const sessionIds: string[] = [];
    const productIds: string[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    let createdOwner: string | null = null;
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
      // Only the first two transactions to arrive are latched (a command may open a second one later).
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
            code: `PRF_${run}`,
            name: 'Refund race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await syncPermissionCatalog(tx);
        const permissions = await tx.permission.findMany({
          where: {
            code: {
              in: [
                'SELL_PRODUCTS',
                'VIEW_INVOICES',
                'MANAGE_INVOICES',
                'COLLECT_PAYMENTS',
                'CANCEL_INVOICES',
                'CORRECT_PAYMENTS',
                'MANAGE_STOCK_RECEIPTS',
                'ADJUST_STOCK',
                'VIEW_INVENTORY',
                'MANAGE_PRODUCT_RETURNS',
                'REFUND_PRODUCTS',
              ],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 11);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `PRF_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const login = async (
        tx: Prisma.TransactionClient,
        user: {
          id: string;
          passwordHash: string | null;
          credentialVersion: number;
          authzVersion: number;
        },
        reauthenticated: boolean,
      ) => {
        const principal = {
          userId: user.id,
          passwordHash: user.passwordHash!,
          credentialVersion: user.credentialVersion,
          authzVersion: user.authzVersion,
        };
        const anonymous = await sessions.createAnonymous(tx);
        sessionIds.push(anonymous.session.id);
        let issued = await sessions.rotateAuthenticated(
          anonymous.token,
          principal,
          { reauthenticated: false },
          tx,
        );
        sessionIds.push(issued.session.id);
        if (reauthenticated) {
          issued = await sessions.rotateAuthenticated(
            issued.token,
            principal,
            { reauthenticated: true },
            tx,
          );
          sessionIds.push(issued.session.id);
        }
        return issued.token;
      };
      const staff = (reauthenticated: boolean) =>
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
                  employeeCodeCanonical: `PRR_${run}_${++serial}`,
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
            data: { userId: id, roleId: ids.role, scopeKind: 'BRANCH', branchId: ids.branch },
          });
          const token = await login(tx, user, reauthenticated);
          personOf.set(token, id);
          return { id, token };
        });
      const a = await staff(false);
      const b = await staff(false);
      const boss = await staff(true);
      const r1 = await staff(true);
      const owner = await database.$transaction(async (tx) => {
        let row = await tx.user.findFirst({ where: { kind: 'OWNER' } });
        if (!row) {
          row = await tx.user.create({
            data: {
              kind: 'OWNER',
              status: 'ACTIVE',
              fullName: 'Chủ spa race',
              preferredLocale: 'vi',
              emailCanonical: `prr-owner-${run.toLowerCase()}@example.com`,
              emailDelivery: `prr-owner-${run.toLowerCase()}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
            },
          });
          createdOwner = row.id;
          userIds.push(row.id);
        }
        const token = await login(tx, row, false);
        personOf.set(token, row.id);
        return { id: row.id, token };
      });

      const today = async () =>
        (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
      /** A paid counter sale of `quantity` units of a fresh product. */
      const sale = async (quantity: number, payerUserId: string | null = null) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `prr-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem race',
              nameEn: 'Race cream',
              createdByUserId: a.id,
              variants: { create: [{ sku: `PRR-${run}-${serial}` }] },
            },
            include: { variants: true },
          });
          productIds.push(product.id);
          const variantRow = product.variants[0]!;
          await tx.productPriceVersion.create({
            data: {
              variantId: variantRow.id,
              versionNo: 1,
              listPriceVnd: 90_000n,
              createdByUserId: a.id,
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
          });
          return variantRow.id;
        });
        const draftReceipt = await inventory.createReceipt(a.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: await today(),
          notes: null,
          lines: [{ variantId: created, quantity: quantity + 2, lotCode: null, expiryDate: null }],
        });
        await inventory.confirmReceipt(a.token, draftReceipt.id, {
          expectedRowVersion: draftReceipt.rowVersion,
        });
        let invoice = (await invoices.openProductSale(a.token, ids.branch, { payerUserId }))
          .invoice;
        invoice = await invoices.addProductLine(a.token, invoice.id, {
          expectedVersion: invoice.version,
          variantId: created,
          quantity,
        });
        invoice = await invoices.finalize(a.token, invoice.id, {
          expectedVersion: invoice.version,
        });
        const paid = await invoices.recordPayment(a.token, invoice.id, {
          method: 'CASH',
          amountVnd: String(invoice.totalVnd),
          tenderedVnd: String(invoice.totalVnd),
          idempotencyKey: randomUUID(),
        });
        const view = await invoices.get(a.token, invoice.id);
        return {
          invoiceId: invoice.id,
          lineId: view.productLines[0]!.id,
          paymentId: paid.payment.id,
        };
      };
      const accepted = async (s: { lineId: string }, quantity: number) => {
        const opened = await returns.open(a.token, {
          branchId: ids.branch,
          invoiceLineId: s.lineId,
          reason: 'PERSONAL_PREFERENCE',
          requestedOutcome: 'REFUND',
          quantity,
          sealIntact: true,
          notes: null,
          clientRequestId: randomUUID(),
        } as never);
        return returns.accept(b.token, opened.id, {
          expectedRowVersion: opened.rowVersion,
          outcome: 'REFUND',
          note: null,
        });
      };
      const refundBody = (patch: Record<string, unknown> = {}) =>
        ({
          quantity: 1,
          method: 'CASH',
          bankReference: null,
          restock: 'SELLABLE',
          reason: 'Race',
          clientRequestId: randomUUID(),
          ...patch,
        }) as never;
      const refundsOf = (lineId: string) =>
        database.productRefund.findMany({
          where: { invoiceLineId: lineId },
          orderBy: [{ lineUnitsAfter: 'asc' }],
        });
      const customer = async () => {
        const id = randomUUID();
        customerIds.push(id);
        userIds.push(id);
        await database.user.create({
          data: {
            id,
            kind: 'CUSTOMER',
            status: 'ACTIVE',
            fullName: 'Khách race',
            preferredLocale: 'vi',
            emailCanonical: `prr-${run.toLowerCase()}-${++serial}@example.com`,
            emailDelivery: `prr-${run.toLowerCase()}-${serial}@example.com`,
            emailVerifiedAt: new Date(),
            phoneCanonical: validVnMobile(),
            normalizationVersion: 1,
            passwordHash: '$argon2id$fixture',
            customerProfile: {
              create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
            },
          },
        });
        return id;
      };
      /** The `inventory` consumer for one invoice (the sale reaches stock), on its own transaction. */
      const consumeStock = async (invoiceId: string) => {
        const events = await database.outboxEvent.findMany({
          where: {
            aggregateType: 'Invoice',
            aggregateId: invoiceId,
            eventType: { in: INVENTORY_EVENT_TYPES },
            consumptions: { none: { consumer: INVENTORY_CONSUMER } },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        const outcomes: string[] = [];
        for (const event of events) {
          outcomes.push(
            await database.$transaction((tx) => processInventoryEvent(tx, event.id), {
              timeout: 30_000,
            }),
          );
        }
        return outcomes;
      };
      /** The `loyalty` consumer for the pending events of an aggregate, each on its own transaction. */
      const consumeLoyalty = async (aggregateId: string) => {
        const events = await database.outboxEvent.findMany({
          where: {
            aggregateId,
            OR: [
              { aggregateType: 'Invoice', eventType: { in: LOYALTY_EVENT_TYPES } },
              { aggregateType: 'ProductRefund', eventType: 'PRODUCT_REFUNDED' },
            ],
            consumptions: { none: { consumer: LOYALTY_CONSUMER } },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        const outcomes: string[] = [];
        for (const event of events) {
          outcomes.push(
            await database.$transaction((tx) => processLoyaltyEvent(tx, event.id), {
              timeout: 30_000,
            }),
          );
        }
        return outcomes;
      };
      /** A consumer transaction that meets the other racer at the latch, like the service calls do. */
      const latched = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
        database.$transaction(
          async (tx) => {
            await takeSharedAuthGraphLock(tx);
            if (meet) await meet();
            return work(tx);
          },
          { timeout: 30_000, maxWait: 10_000 },
        );

      /** The invariants of the whole run, after every race: money, units, stock and points reconcile. */
      const audit = async () => {
        const lines = await database.$queryRaw<
          { line: string; units: bigint; amount: bigint; sold: number; net: bigint }[]
        >`
          SELECT r.invoice_line_id AS line, SUM(r.quantity)::bigint AS units, SUM(r.amount_vnd)::bigint AS amount,
                 l.quantity AS sold, a.net_vnd AS net
          FROM product_refunds r
          JOIN invoice_lines l ON l.id = r.invoice_line_id
          JOIN invoice_line_allocations a ON a.invoice_line_id = r.invoice_line_id
          WHERE r.branch_id = ${ids.branch}::uuid
          GROUP BY r.invoice_line_id, l.quantity, a.net_vnd`;
        for (const line of lines) {
          assert.ok(line.units <= BigInt(line.sold), `units refunded of ${line.line}`);
          assert.ok(line.amount <= line.net, `money refunded of ${line.line}`);
          if (line.units === BigInt(line.sold)) assert.equal(line.amount, line.net);
        }
        // The running totals follow the order the refunds were made in.
        const refunds = await database.productRefund.findMany({
          where: { branchId: ids.branch },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
        });
        const byLine = new Map<string, { units: number; amount: bigint }>();
        const byInvoice = new Map<string, bigint>();
        for (const refund of refunds) {
          const line = byLine.get(refund.invoiceLineId) ?? { units: 0, amount: 0n };
          line.units += refund.quantity;
          line.amount += refund.amountVnd;
          byLine.set(refund.invoiceLineId, line);
          assert.equal(refund.lineUnitsAfter, line.units, `units after ${refund.code}`);
          assert.equal(refund.lineAmountAfterVnd, line.amount, `amount after ${refund.code}`);
          const invoice = (byInvoice.get(refund.invoiceId) ?? 0n) + refund.amountVnd;
          byInvoice.set(refund.invoiceId, invoice);
          assert.equal(
            refund.invoiceRefundedAfterVnd,
            invoice,
            `invoice total after ${refund.code}`,
          );
        }
        const levels = await database.$queryRaw<
          { variant: string; level: number; moved: bigint; lots: bigint }[]
        >`
          SELECT s.variant_id AS variant, s.on_hand AS level,
                 COALESCE((SELECT SUM(m.quantity_delta) FROM stock_movements m
                           WHERE m.branch_id = s.branch_id AND m.variant_id = s.variant_id), 0)::bigint AS moved,
                 COALESCE((SELECT SUM(l.quantity_on_hand) FROM inventory_lots l
                           WHERE l.branch_id = s.branch_id AND l.variant_id = s.variant_id), 0)::bigint AS lots
          FROM stock_levels s WHERE s.branch_id = ${ids.branch}::uuid`;
        for (const level of levels) {
          assert.equal(BigInt(level.level), level.moved, `on hand = movements of ${level.variant}`);
          assert.equal(BigInt(level.level), level.lots, `on hand = lots of ${level.variant}`);
        }
        const [stock] = await database.$queryRaw<{ refunded: bigint; returned: bigint }[]>`
          SELECT COALESCE((SELECT SUM(quantity) FROM product_refunds WHERE restock = 'SELLABLE'
                            AND branch_id = ${ids.branch}::uuid), 0)::bigint AS refunded,
                 COALESCE((SELECT SUM(quantity_delta) FROM stock_movements WHERE kind = 'REFUND_RETURN'
                            AND branch_id = ${ids.branch}::uuid), 0)::bigint AS returned`;
        assert.equal(stock!.returned, stock!.refunded, 'units put back = sellable units refunded');
        const wallets = await database.loyaltyWalletAccount.findMany({
          where: { userId: { in: customerIds } },
        });
        for (const wallet of wallets) {
          const sum = await database.loyaltyLedgerEntry.aggregate({
            where: { userId: wallet.userId, wallet: wallet.wallet },
            _sum: { points: true },
          });
          assert.equal(wallet.balancePoints, sum._sum.points ?? 0, 'balance = ledger');
        }
        const earned = await database.loyaltyLedgerEntry.findMany({
          where: { kind: 'EARN', userId: { in: customerIds } },
        });
        for (const entry of earned) {
          const taken = await database.loyaltyLedgerEntry.findMany({
            where: { kind: 'REFUND_REVERSAL', invoiceId: entry.invoiceId, paidSeq: entry.paidSeq },
          });
          const sum = taken.reduce((total, row) => total - row.points + row.shortfallPoints, 0);
          assert.ok(sum <= entry.points, `taken back ${sum} of ${entry.points}`);
        }
      };

      await suite.test(
        'two refunders give back the whole case at once: one refund, the other is told nothing is left',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(3);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 3);
            const results = await race(
              () => refunds.refund(r1.token, c.id, refundBody({ quantity: 3 })),
              () => refunds.refund(boss.token, c.id, refundBody({ quantity: 3 })),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'REFUND_QUANTITY_EXCEEDED'],
              `round ${round}`,
            );
            const rows = await refundsOf(s.lineId);
            assert.equal(rows.length, 1);
            assert.equal(rows[0]!.quantity, 3);
            const lots = await database.inventoryLot.findMany({
              where: { sourceRefundId: rows[0]!.id },
            });
            assert.equal(
              lots.reduce((sum, lot) => sum + lot.quantityOnHand, 0),
              3,
              'put back once',
            );
          }
          await audit();
        },
      );

      await suite.test(
        'the same request sent twice at once is one refund (same actor, same id)',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 2);
            const body = refundBody({ quantity: 2 });
            const results = await race(
              () => refunds.refund(r1.token, c.id, body),
              () => refunds.refund(r1.token, c.id, body),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            assert.equal((await refundsOf(s.lineId)).length, 1);
            const events = await database.outboxEvent.count({
              where: {
                aggregateType: 'ProductRefund',
                aggregateId: (await refundsOf(s.lineId))[0]!.id,
              },
            });
            assert.equal(events, 1, 'one event');
            assert.equal(
              await database.auditEvent.count({
                where: { action: 'PRODUCT_REFUNDED', entityId: (await refundsOf(s.lineId))[0]!.id },
              }),
              1,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'P13-3: two different refunds by one person on ONE password confirmation: one wins, the other must confirm again',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 2);
            await confirm(r1.token);
            const results = await race(
              () => strictRefunds.refund(r1.token, c.id, refundBody()),
              () => strictRefunds.refund(r1.token, c.id, refundBody()),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'REAUTHENTICATION_REQUIRED'],
              `round ${round}`,
            );
            const rows = await refundsOf(s.lineId);
            assert.equal(rows.length, 1, 'one refund');
            assert.equal(
              await database.refundReauthenticationUse.count({
                where: { productRefundId: rows[0]!.id },
              }),
              1,
              'one use of the confirmation',
            );
            // Typing the password again lets the second refund through.
            await refunds.refund(r1.token, c.id, refundBody());
            assert.equal((await refundsOf(s.lineId)).length, 2);
          }
          await audit();
        },
      );

      await suite.test(
        'concurrent partial refunds of one line are serialized: every unit once, the amounts add up to the net exactly',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const s = await sale(4);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 4);
            for (const pair of [0, 1]) {
              const results = await race(
                () => refunds.refund(r1.token, c.id, refundBody()),
                () => refunds.refund(boss.token, c.id, refundBody()),
              );
              assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round} pair ${pair}`);
            }
            await assert.rejects(
              () => refunds.refund(r1.token, c.id, refundBody()),
              (error: unknown) =>
                error instanceof AuthError && error.code === 'REFUND_QUANTITY_EXCEEDED',
            );
            const rows = await refundsOf(s.lineId);
            assert.deepEqual(
              rows.map((row) => row.lineUnitsAfter),
              [1, 2, 3, 4],
            );
            assert.deepEqual(
              rows.map((row) => row.caseOrdinal),
              [1, 2, 3, 4],
            );
            assert.equal(
              rows.reduce((sum, row) => sum + row.amountVnd, 0n),
              360_000n,
              'the whole net',
            );
          }
          // 2 + 3 units against a case of 4: one wins, the other is told what is left.
          const s = await sale(4);
          await consumeStock(s.invoiceId);
          const c = await accepted(s, 4);
          const results = await race(
            () => refunds.refund(r1.token, c.id, refundBody({ quantity: 2 })),
            () => refunds.refund(boss.token, c.id, refundBody({ quantity: 3 })),
          );
          assert.deepEqual(results.map(outcome).sort(), ['OK', 'REFUND_QUANTITY_EXCEEDED']);
          await audit();
        },
      );

      await suite.test(
        'a refund against the reversal of the payment: one wins, never both, never a deadlock',
        async () => {
          const seen = new Set<string>();
          for (let round = 0; round < 8; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 2);
            const results = await race(
              () => refunds.refund(r1.token, c.id, refundBody({ quantity: 2 })),
              () =>
                invoices.reversePayment(boss.token, s.invoiceId, s.paymentId, {
                  reason: 'Nhập sai',
                }),
            );
            const [refund, reversal] = results.map(outcome);
            const invoice = await database.invoice.findUniqueOrThrow({
              where: { id: s.invoiceId },
            });
            const rows = await refundsOf(s.lineId);
            if (refund === 'OK') {
              assert.equal(reversal, 'INVOICE_HAS_REFUND', `round ${round}`);
              assert.equal(invoice.status, 'PAID');
              assert.equal(rows.length, 1);
              assert.equal(
                await database.paymentCorrection.count({ where: { paymentId: s.paymentId } }),
                0,
              );
            } else {
              assert.equal(refund, 'INVOICE_STATE_INVALID', `round ${round}`);
              assert.equal(reversal, 'OK');
              assert.equal(invoice.status, 'PENDING_PAYMENT');
              assert.equal(rows.length, 0);
            }
            seen.add(`${refund}/${reversal}`);
          }
          assert.ok(seen.size >= 1);
          await audit();
        },
      );

      await suite.test(
        'a sellable refund against the stock sale: either the goods go back after the sale, or the refund waits; stock reconciles',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            const c = await accepted(s, 2);
            const [event] = await database.outboxEvent.findMany({
              where: {
                aggregateType: 'Invoice',
                aggregateId: s.invoiceId,
                eventType: 'INVOICE_PAID',
              },
            });
            const results = await race(
              () => refunds.refund(r1.token, c.id, refundBody({ quantity: 2 })),
              () => latched((tx) => processInventoryEvent(tx, event!.id)),
            );
            const [refund, stockSale] = results.map(outcome);
            assert.equal(stockSale, 'OK', `round ${round}: ${refund}/${stockSale}`);
            if (refund !== 'OK') {
              assert.equal(refund, 'REFUND_STOCK_PENDING');
              assert.equal((await refundsOf(s.lineId)).length, 0);
              await refunds.refund(r1.token, c.id, refundBody({ quantity: 2 }));
            }
            assert.equal((await refundsOf(s.lineId)).length, 1);
          }
          await audit();
        },
      );

      await suite.test(
        'two workers on the points of two refunds of one invoice: the same total whatever the order, each event handled once',
        async () => {
          if (!(await database.loyaltyGoLive.findFirst())) {
            await database.loyaltyGoLive.create({ data: { activatedByUserId: owner.id } });
            goLiveCreated = true;
          }
          for (let round = 0; round < 4; round += 1) {
            const payer = await customer();
            const s = await sale(3, payer);
            await consumeStock(s.invoiceId);
            assert.deepEqual(await consumeLoyalty(s.invoiceId), ['APPLIED']);
            const c = await accepted(s, 3);
            await refunds.refund(r1.token, c.id, refundBody());
            await refunds.refund(boss.token, c.id, refundBody());
            const rows = await refundsOf(s.lineId);
            const [first, second] = rows;
            const eventIdOf = async (refundId: string) =>
              (
                await database.outboxEvent.findFirstOrThrow({
                  where: { aggregateType: 'ProductRefund', aggregateId: refundId },
                })
              ).id;
            const [e1, e2] = [await eventIdOf(first!.id), await eventIdOf(second!.id)];
            const results = await race(
              () => latched((tx) => processLoyaltyEvent(tx, e1)),
              () => latched((tx) => processLoyaltyEvent(tx, e2)),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK']);
            assert.deepEqual(await consumeLoyalty(first!.id), [], 'the first event is done');
            assert.deepEqual(await consumeLoyalty(second!.id), [], 'the second event is done');
            // 270,000 earned 270; 180,000 refunded leaves 90: 180 taken back in total, 90 left in the wallet.
            const taken = await database.loyaltyLedgerEntry.findMany({
              where: { kind: 'REFUND_REVERSAL', invoiceId: s.invoiceId },
            });
            assert.equal(
              taken.reduce((sum, row) => sum - row.points + row.shortfallPoints, 0),
              180,
            );
            assert.equal(
              (
                await database.loyaltyWalletAccount.findUniqueOrThrow({
                  where: { userId_wallet: { userId: payer, wallet: 'BEAUTY' } },
                })
              ).balancePoints,
              90,
            );
            // The same event on two workers at once: one handles it, the other finds it claimed.
            const third = await refunds.refund(r1.token, c.id, refundBody());
            const rowThird = third.refunds.at(-1)!;
            const eventThird = (
              await database.outboxEvent.findFirstOrThrow({
                where: { aggregateType: 'ProductRefund', aggregateId: rowThird.id },
              })
            ).id;
            const both = await race(
              () => latched((tx) => processLoyaltyEvent(tx, eventThird)),
              () => latched((tx) => processLoyaltyEvent(tx, eventThird)),
            );
            assert.deepEqual(both.map(outcome), ['OK', 'OK']);
            const done = await database.loyaltyLedgerEntry.count({
              where: { kind: 'REFUND_REVERSAL', productRefundId: rowThird.id },
            });
            assert.equal(done, 1);
            assert.equal(
              (
                await database.loyaltyWalletAccount.findUniqueOrThrow({
                  where: { userId_wallet: { userId: payer, wallet: 'BEAUTY' } },
                })
              ).balancePoints,
              0,
              'the whole sale was refunded: back to the value before it',
            );
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
            const paymentRows = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const variantRows = (
              await tx.productVariant.findMany({
                where: { productId: { in: productIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const cases = (
              await tx.productReturnCase.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.notification.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { recipientUserId: { in: userIds } }] },
            });
            await tx.productRefundCorrection.deleteMany({
              where: { refund: { branchId: ids.branch } },
            });
            await tx.loyaltyLedgerEntry.deleteMany({
              where: { OR: [{ invoiceId: { in: invoiceRows } }, { userId: { in: customerIds } }] },
            });
            await tx.loyaltyWalletAccount.deleteMany({ where: { userId: { in: customerIds } } });
            await tx.invoiceLoyaltySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceBeautySnapshot.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            const refundRows = (
              await tx.productRefund.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.outboxConsumption.deleteMany({
              where: {
                event: {
                  OR: [
                    { branchId: ids.branch },
                    { aggregateId: { in: [...invoiceRows, ...refundRows] } },
                  ],
                },
              },
            });
            await tx.stockMovement.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLot.deleteMany({ where: { branchId: ids.branch } });
            await tx.refundReauthenticationUse.deleteMany({
              where: {
                OR: [{ productRefundId: { in: refundRows } }, { actorUserId: { in: userIds } }],
              },
            });
            await tx.productRefund.deleteMany({ where: { branchId: ids.branch } });
            if (goLiveCreated) await tx.loyaltyGoLive.deleteMany({});
            await tx.productReturnEvent.deleteMany({ where: { caseId: { in: cases } } });
            await tx.productReturnPhoto.deleteMany({ where: { caseId: { in: cases } } });
            await tx.productReturnCase.deleteMany({ where: { id: { in: cases } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  { aggregateId: { in: [...invoiceRows, ...paymentRows, ...cases] } },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.paymentAnomaly.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentCorrection.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentSideAllocation.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.payment.deleteMany({ where: { id: { in: paymentRows } } });
            await tx.stockReservation.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineAllocation.deleteMany({
              where: { invoiceId: { in: invoiceRows } },
            });
            await tx.invoiceLineProduct.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.stockMovement.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLot.deleteMany({ where: { branchId: ids.branch } });
            await tx.inventoryLowStockAlert.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockLevel.deleteMany({ where: { branchId: ids.branch } });
            await tx.stockReceiptLine.deleteMany({ where: { receipt: { branchId: ids.branch } } });
            await tx.stockReceipt.deleteMany({ where: { branchId: ids.branch } });
            await tx.productPriceVersion.deleteMany({ where: { variantId: { in: variantRows } } });
            await tx.productVariant.deleteMany({ where: { id: { in: variantRows } } });
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
            await tx.customerProfile.deleteMany({ where: { userId: { in: customerIds } } });
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 60_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(
          await database.productReturnCase.count({ where: { branchId: ids.branch } }),
          0,
        );
        assert.equal(await database.productRefund.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(
          createdOwner === null ||
            (await database.user.count({ where: { id: createdOwner } })) === 0,
          true,
        );
      } finally {
        await database.$disconnect();
        await rm(folder, { recursive: true, force: true });
      }
    }
  },
);

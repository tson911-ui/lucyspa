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
  parseApiEnvironment,
  processInventoryEvent,
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
import { ProductExchangeService } from './exchange.service.js';
import { ProductRefundService } from './refund.service.js';
import { ProductReturnService } from './return.service.js';

/**
 * Phase 6 P6-14 races on separate committed PostgreSQL connections with real production service calls (the latch of the Phase 4 and
 * Phase 6 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by production
 * code). Whatever the interleaving: a case has one exchange at a time, the same request is one exchange, one password confirmation
 * covers one exchange, the units and the money claimed on a line by refunds and exchanges never exceed the line, an exchange and the
 * reversal of the payment of the original invoice never both win (T22), two exchanges that take each other's item never deadlock, the
 * last unit of the replacement is never sold twice, paying the exchange invoice and cancelling it never both win, the returned goods
 * are taken in once, and a completion and the reversal of the payment of the exchange invoice never both win. Requires an explicitly
 * opted-in local validation database (replica-role cleanup of permanent history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-14 PostgreSQL races keep exchanges, refunds, stock and Beauty points consistent',
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
    const strictExchanges = new ProductExchangeService(adapter as never, throttle, environment);
    /** The service as the screens use it: the person confirms their password before each exchange. */
    const exchanges = {
      complete: strictExchanges.complete.bind(strictExchanges),
      exchange: async (...args: Parameters<ProductExchangeService['exchange']>) => {
        await confirm(args[0]!);
        return strictExchanges.exchange(...args);
      },
    };
    const ids = { branch: randomUUID(), role: randomUUID() };
    const userIds: string[] = [];
    const customerIds: string[] = [];
    const sessionIds: string[] = [];
    const productIds: string[] = [];
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
          variantId: created,
        };
      };
      const accepted = async (
        s: { lineId: string },
        quantity: number,
        outcomeOf: 'REFUND' | 'EXCHANGE' = 'EXCHANGE',
      ) => {
        const opened = await returns.open(a.token, {
          branchId: ids.branch,
          invoiceLineId: s.lineId,
          reason: 'PERSONAL_PREFERENCE',
          requestedOutcome: outcomeOf,
          quantity,
          sealIntact: true,
          notes: null,
          clientRequestId: randomUUID(),
        } as never);
        return returns.accept(b.token, opened.id, {
          expectedRowVersion: opened.rowVersion,
          outcome: outcomeOf,
          note: null,
        });
      };
      /** A fresh published item in stock at a price: the replacement of an exchange. */
      const item = async (price: number, stock: number) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `prr-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem thay thế',
              nameEn: 'Replacement cream',
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
              listPriceVnd: BigInt(price),
              createdByUserId: a.id,
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
          });
          return { variantId: variantRow.id, sku: variantRow.sku };
        });
        const receipt = await inventory.createReceipt(a.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: await today(),
          notes: null,
          lines: [
            { variantId: created.variantId, quantity: stock, lotCode: null, expiryDate: null },
          ],
        });
        await inventory.confirmReceipt(a.token, receipt.id, {
          expectedRowVersion: receipt.rowVersion,
        });
        return created;
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
      /** The invariants of the whole run, after every race: money, units, stock and points reconcile. */
      const audit = async () => {
        // One cumulative sequence per line: refunds and the exchanges that were not cancelled claim the units in order, and the money
        // they claim adds up to the net exactly when every unit is claimed.
        const lines = await database.$queryRaw<
          { line: string; units: bigint; vnd: bigint; sold: number; net: bigint }[]
        >`
          SELECT l.id AS line, c.claimed_units::bigint AS units, c.claimed_vnd AS vnd, l.quantity AS sold, a.net_vnd AS net
          FROM invoice_lines l
          JOIN invoice_line_allocations a ON a.invoice_line_id = l.id
          CROSS JOIN LATERAL lucy_line_claims(l.id) c
          WHERE l.invoice_id IN (SELECT id FROM invoices WHERE branch_id = ${ids.branch}::uuid) AND l.kind = 'PRODUCT'
            AND c.claimed_units > 0`;
        for (const line of lines) {
          assert.ok(line.units <= BigInt(line.sold), `units claimed of ${line.line}`);
          assert.ok(line.vnd <= line.net, `money claimed of ${line.line}`);
          if (line.units === BigInt(line.sold))
            assert.equal(line.vnd, line.net, 'a fully claimed line');
        }
        const refunds = await database.productRefund.findMany({ where: { branchId: ids.branch } });
        const exchangeRows = await database.productExchange.findMany({
          where: { branchId: ids.branch },
          include: {
            exchangeInvoice: { include: { lines: { include: { allocations: true } } } },
            completion: true,
          },
        });
        const claims = new Map<
          string,
          { units: number; vnd: bigint; after: number; amountAfter: bigint }[]
        >();
        for (const refund of refunds) {
          const list = claims.get(refund.invoiceLineId) ?? [];
          list.push({
            units: refund.quantity,
            vnd: refund.amountVnd,
            after: refund.lineUnitsAfter,
            amountAfter: refund.lineAmountAfterVnd,
          });
          claims.set(refund.invoiceLineId, list);
        }
        for (const row of exchangeRows) {
          if (row.exchangeInvoice.status === 'CANCELLED') continue;
          const list = claims.get(row.invoiceLineId) ?? [];
          list.push({
            units: row.quantity,
            vnd: row.creditVnd,
            after: row.lineUnitsAfter,
            amountAfter: row.lineAmountAfterVnd,
          });
          claims.set(row.invoiceLineId, list);
        }
        for (const [lineId, list] of claims) {
          list.sort((x, y) => x.after - y.after);
          let units = 0;
          let vnd = 0n;
          for (const claim of list) {
            units += claim.units;
            vnd += claim.vnd;
            assert.equal(claim.after, units, `units after, line ${lineId}`);
            assert.equal(claim.amountAfter, vnd, `money after, line ${lineId}`);
          }
        }
        for (const row of exchangeRows) {
          const swap = row.exchangeInvoice;
          assert.equal(swap.subtotalVnd, row.replacementGrossVnd, `gross of ${row.code}`);
          assert.equal(swap.discountTotalVnd, row.appliedCreditVnd, `credit of ${row.code}`);
          assert.equal(swap.totalVnd, row.payableVnd, `payable of ${row.code}`);
          assert.equal(
            swap.lines.flatMap((line) => line.allocations).reduce((sum, a) => sum + a.netVnd, 0n),
            row.payableVnd,
            `line nets of ${row.code}`,
          );
          if (swap.status !== 'CANCELLED' && row.payableVnd === 0n) {
            assert.ok(row.completion, `nothing to pay, so completed: ${row.code}`);
          }
        }
        const reservations = await database.$queryRaw<
          { variant: string; reserved: number; held: bigint }[]
        >`
          SELECT s.variant_id AS variant, s.reserved AS reserved,
                 COALESCE((SELECT SUM(r.quantity) FROM stock_reservations r
                           WHERE r.branch_id = s.branch_id AND r.variant_id = s.variant_id AND r.status = 'RESERVED'), 0)::bigint AS held
          FROM stock_levels s WHERE s.branch_id = ${ids.branch}::uuid`;
        for (const level of reservations) {
          assert.equal(
            BigInt(level.reserved),
            level.held,
            `reserved = live reservations of ${level.variant}`,
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
        const [stock] = await database.$queryRaw<{ expected: bigint; returned: bigint }[]>`
          SELECT COALESCE((SELECT SUM(x.quantity) FROM product_exchanges x
                            JOIN product_exchange_completions c ON c.exchange_id = x.id
                            WHERE c.restock = 'SELLABLE' AND x.branch_id = ${ids.branch}::uuid), 0)::bigint AS expected,
                 COALESCE((SELECT SUM(quantity_delta) FROM stock_movements WHERE kind = 'EXCHANGE_RETURN'
                            AND branch_id = ${ids.branch}::uuid), 0)::bigint AS returned`;
        assert.equal(stock!.returned, stock!.expected, 'units put back = sellable units exchanged');
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
      };

      /** The exchange of a case for an item, with the figures of the preview (as the screen sends them). */
      const exchangeBody = async (
        c: { id: string },
        variantId: string,
        patch: Record<string, unknown> = {},
      ) => {
        const preview = await strictExchanges.preview(b.token, c.id, variantId);
        return {
          variantId,
          expectedPayableVnd: preview.payableVnd,
          expectedRefundVnd: preview.refundVnd,
          restock: preview.payableVnd === '0' ? 'SELLABLE' : null,
          refundMethod: preview.refundVnd === '0' ? null : 'CASH',
          bankReference: null,
          sellerUserId: null,
          reason: 'Race',
          clientRequestId: randomUUID(),
          ...patch,
        } as never;
      };
      const exchangesOf = (caseId: string) =>
        database.productExchange.findMany({
          where: { returnCaseId: caseId },
          include: { exchangeInvoice: true, completion: true },
          orderBy: [{ occurredAt: 'asc' }],
        });
      const livesOf = async (caseId: string) =>
        (await exchangesOf(caseId)).filter((row) => row.exchangeInvoice.status !== 'CANCELLED');
      const payExchange = (invoiceId: string, amount: bigint) =>
        invoices.recordPayment(a.token, invoiceId, {
          method: 'CASH',
          amountVnd: String(amount),
          tenderedVnd: String(amount),
          idempotencyKey: randomUUID(),
        });

      await suite.test(
        'two people exchange the same case at once: one exchange, the other is told one is in progress',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 2);
            const swap = await item(120_000, 10);
            const results = await race(
              async () => exchanges.exchange(r1.token, c.id, await exchangeBody(c, swap.variantId)),
              async () =>
                exchanges.exchange(boss.token, c.id, await exchangeBody(c, swap.variantId)),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['EXCHANGE_IN_PROGRESS', 'OK'],
              `round ${round}`,
            );
            const rows = await exchangesOf(c.id);
            assert.equal(rows.length, 1, 'one exchange');
            const invoicesMade = await database.invoice.count({
              where: { lines: { some: { itemCode: swap.sku } } },
            });
            assert.equal(invoicesMade, 1, 'one exchange invoice, no orphan of the loser');
            const level = await database.stockLevel.findUniqueOrThrow({
              where: { branchId_variantId: { branchId: ids.branch, variantId: swap.variantId } },
            });
            assert.equal(level.reserved, 2, 'reserved once');
          }
          await audit();
        },
      );

      await suite.test(
        'the same request sent twice at once is one exchange (same actor, same id)',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const s = await sale(1);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 1);
            const swap = await item(120_000, 10);
            const body = await exchangeBody(c, swap.variantId);
            await confirm(r1.token);
            const results = await race(
              () => strictExchanges.exchange(r1.token, c.id, body),
              () => strictExchanges.exchange(r1.token, c.id, body),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            assert.equal((await exchangesOf(c.id)).length, 1);
            assert.equal(
              await database.auditEvent.count({
                where: {
                  action: 'PRODUCT_EXCHANGE_CREATED',
                  entityId: (await exchangesOf(c.id))[0]!.id,
                },
              }),
              1,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'P13-3 for exchanges: two exchanges by one person on ONE password confirmation: one wins, the other must confirm again',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const s1 = await sale(1);
            const s2 = await sale(1);
            await consumeStock(s1.invoiceId);
            await consumeStock(s2.invoiceId);
            const c1 = await accepted(s1, 1);
            const c2 = await accepted(s2, 1);
            const swap = await item(120_000, 10);
            const b1 = await exchangeBody(c1, swap.variantId);
            const b2 = await exchangeBody(c2, swap.variantId);
            await confirm(r1.token);
            const results = await race(
              () => strictExchanges.exchange(r1.token, c1.id, b1),
              () => strictExchanges.exchange(r1.token, c2.id, b2),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'REAUTHENTICATION_REQUIRED'],
              `round ${round}`,
            );
            const done = (await livesOf(c1.id)).length + (await livesOf(c2.id)).length;
            assert.equal(done, 1, 'one exchange');
            assert.equal(
              (await database.refundReauthenticationUse.count({
                where: { actorUserId: r1.id, productExchangeId: { not: null } },
              })) > 0,
              true,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'an exchange and a refund on one line at once: whichever wins, units and money never exceed the line, and nothing deadlocks',
        async () => {
          const seen = new Set<string>();
          for (let round = 0; round < 8; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const exchangeCase = await accepted(s, 1, 'EXCHANGE');
            const refundCase = await accepted(s, 1, 'REFUND');
            const swap = await item(120_000, 10);
            const results = await race(
              async () =>
                exchanges.exchange(
                  r1.token,
                  exchangeCase.id,
                  await exchangeBody(exchangeCase, swap.variantId),
                ),
              () =>
                refunds.refund(boss.token, refundCase.id, refundBody({ restock: 'NOT_SELLABLE' })),
            );
            const [made, refunded] = results.map(outcome);
            assert.equal(
              made,
              'OK',
              `round ${round}: the exchange always goes through (${refunded})`,
            );
            assert.ok(
              ['OK', 'EXCHANGE_IN_PROGRESS'].includes(refunded!),
              `round ${round}: ${refunded}`,
            );
            seen.add(refunded!);
            const claimed = await database.$queryRaw<
              { units: number }[]
            >`SELECT claimed_units AS units FROM lucy_line_claims(${s.lineId}::uuid)`;
            assert.equal(claimed[0]!.units, refunded === 'OK' ? 2 : 1);
            if (refunded !== 'OK') {
              // The exchange is open: paying and completing it frees the line for the refund.
              const exchange = (await livesOf(exchangeCase.id))[0]!;
              await payExchange(exchange.exchangeInvoiceId, exchange.payableVnd);
              await consumeStock(exchange.exchangeInvoiceId);
              await exchanges.complete(r1.token, exchangeCase.id, exchange.id, {
                restock: 'NOT_SELLABLE',
              });
              await refunds.refund(
                boss.token,
                refundCase.id,
                refundBody({ restock: 'NOT_SELLABLE' }),
              );
              assert.equal((await refundsOf(s.lineId)).length, 1);
            }
          }
          assert.ok(seen.size >= 1);
          await audit();
        },
      );

      await suite.test(
        'an exchange against the reversal of the payment of the original invoice: one wins, never both, never a deadlock',
        async () => {
          for (let round = 0; round < 8; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 1);
            const swap = await item(120_000, 10);
            const body = await exchangeBody(c, swap.variantId);
            const results = await race(
              () => exchanges.exchange(r1.token, c.id, body),
              () =>
                invoices.reversePayment(boss.token, s.invoiceId, s.paymentId, {
                  reason: 'Nhập sai',
                }),
            );
            const [made, reversal] = results.map(outcome);
            const invoice = await database.invoice.findUniqueOrThrow({
              where: { id: s.invoiceId },
            });
            const rows = await livesOf(c.id);
            if (made === 'OK') {
              assert.equal(reversal, 'INVOICE_HAS_EXCHANGE', `round ${round}`);
              assert.equal(invoice.status, 'PAID');
              assert.equal(rows.length, 1);
              assert.equal(
                await database.paymentCorrection.count({ where: { paymentId: s.paymentId } }),
                0,
              );
            } else {
              assert.equal(made, 'INVOICE_STATE_INVALID', `round ${round}`);
              assert.equal(reversal, 'OK');
              assert.equal(invoice.status, 'PENDING_PAYMENT');
              assert.equal(rows.length, 0);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'two exchanges that take each other’s item at once: both go through, no deadlock on the stock rows',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s1 = await sale(1);
            const s2 = await sale(1);
            await consumeStock(s1.invoiceId);
            await consumeStock(s2.invoiceId);
            const c1 = await accepted(s1, 1);
            const c2 = await accepted(s2, 1);
            const b1 = await exchangeBody(c1, s2.variantId);
            const b2 = await exchangeBody(c2, s1.variantId);
            const results = await race(
              () => exchanges.exchange(r1.token, c1.id, b1),
              () => exchanges.exchange(boss.token, c2.id, b2),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            for (const c of [c1, c2]) {
              const rows = await exchangesOf(c.id);
              assert.equal(rows.length, 1);
              assert.ok(rows[0]!.completion, 'equal value: completed in the same step');
            }
          }
          await audit();
        },
      );

      await suite.test(
        'the last unit of the replacement: an exchange and an ordinary sale at once, one is told there is no stock, never oversold',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(1);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 1);
            const scarce = await item(120_000, 1);
            const body = await exchangeBody(c, scarce.variantId);
            let draft = (await invoices.openProductSale(a.token, ids.branch, { payerUserId: null }))
              .invoice;
            draft = await invoices.addProductLine(a.token, draft.id, {
              expectedVersion: draft.version,
              variantId: scarce.variantId,
              quantity: 1,
            });
            const version = draft.version;
            const results = await race(
              () => exchanges.exchange(r1.token, c.id, body),
              () => invoices.finalize(boss.token, draft.id, { expectedVersion: version }),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'PRODUCT_OUT_OF_STOCK'],
              `round ${round}`,
            );
            const level = await database.stockLevel.findUniqueOrThrow({
              where: { branchId_variantId: { branchId: ids.branch, variantId: scarce.variantId } },
            });
            assert.equal(level.onHand, 1);
            assert.equal(level.reserved, 1, 'exactly one unit is held');
          }
          await audit();
        },
      );

      await suite.test(
        'paying the exchange invoice against cancelling it: one wins; a paid exchange completes, a cancelled one releases the line and the stock',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 2);
            const swap = await item(120_000, 10);
            const made = await exchanges.exchange(
              r1.token,
              c.id,
              await exchangeBody(c, swap.variantId),
            );
            const exchange = made.exchanges[0]!;
            const view = await invoices.get(a.token, exchange.invoice.id);
            await confirm(boss.token);
            const results = await race(
              () => payExchange(exchange.invoice.id, BigInt(exchange.invoice.totalVnd)),
              () =>
                invoices.cancel(boss.token, exchange.invoice.id, {
                  expectedVersion: view.version,
                  reason: 'Khách đổi ý',
                }),
            );
            const [paid, cancelled] = results.map(outcome);
            assert.ok(!(paid === 'OK' && cancelled === 'OK'), `round ${round}: never both`);
            const after = await database.invoice.findUniqueOrThrow({
              where: { id: exchange.invoice.id },
            });
            if (paid === 'OK') {
              assert.equal(after.status, 'PAID');
              await consumeStock(exchange.invoice.id);
              const done = await exchanges.complete(r1.token, c.id, exchange.id, {
                restock: 'SELLABLE',
              });
              assert.equal(done.exchanges[0]!.status, 'COMPLETED');
            } else {
              assert.equal(cancelled, 'OK');
              assert.equal(after.status, 'CANCELLED');
              assert.equal((await livesOf(c.id)).length, 0);
              const level = await database.stockLevel.findUniqueOrThrow({
                where: { branchId_variantId: { branchId: ids.branch, variantId: swap.variantId } },
              });
              assert.equal(level.reserved, 0, 'the held stock is released');
              // The units are free again: the case can be exchanged anew.
              const again = await exchanges.exchange(
                r1.token,
                c.id,
                await exchangeBody(c, swap.variantId),
              );
              assert.equal(again.exchanges.filter((row) => row.status !== 'CANCELLED').length, 1);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'completing twice at once: one completion and one set of lots; two different decisions conflict',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const s = await sale(2);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 2);
            const swap = await item(120_000, 10);
            const made = (
              await exchanges.exchange(r1.token, c.id, await exchangeBody(c, swap.variantId))
            ).exchanges[0]!;
            await payExchange(made.invoice.id, BigInt(made.invoice.totalVnd));
            await consumeStock(made.invoice.id);
            const decisions: ('SELLABLE' | 'NOT_SELLABLE')[] =
              round % 2 === 0 ? ['SELLABLE', 'SELLABLE'] : ['SELLABLE', 'NOT_SELLABLE'];
            const results = await race(
              () => exchanges.complete(r1.token, c.id, made.id, { restock: decisions[0]! }),
              () => exchanges.complete(boss.token, c.id, made.id, { restock: decisions[1]! }),
            );
            if (round % 2 === 0) assert.deepEqual(results.map(outcome), ['OK', 'OK']);
            else assert.deepEqual(results.map(outcome).sort(), ['CONFLICT', 'OK']);
            assert.equal(
              await database.productExchangeCompletion.count({ where: { exchangeId: made.id } }),
              1,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'completing against the reversal of the payment of the exchange invoice: one wins, never both',
        async () => {
          for (let round = 0; round < 8; round += 1) {
            const s = await sale(1);
            await consumeStock(s.invoiceId);
            const c = await accepted(s, 1);
            const swap = await item(120_000, 10);
            const made = (
              await exchanges.exchange(r1.token, c.id, await exchangeBody(c, swap.variantId))
            ).exchanges[0]!;
            const payment = await payExchange(made.invoice.id, BigInt(made.invoice.totalVnd));
            await consumeStock(made.invoice.id);
            await confirm(boss.token);
            const results = await race(
              () => exchanges.complete(r1.token, c.id, made.id, { restock: 'NOT_SELLABLE' }),
              () =>
                invoices.reversePayment(boss.token, made.invoice.id, payment.payment.id, {
                  reason: 'Nhập sai',
                }),
            );
            const [completed, reversed] = results.map(outcome);
            if (completed === 'OK') {
              assert.equal(reversed, 'INVOICE_HAS_EXCHANGE', `round ${round}`);
              assert.equal(
                (await database.invoice.findUniqueOrThrow({ where: { id: made.invoice.id } }))
                  .status,
                'PAID',
              );
            } else {
              assert.equal(completed, 'EXCHANGE_NOT_PAID', `round ${round}`);
              assert.equal(reversed, 'OK');
              assert.equal(
                await database.productExchangeCompletion.count({ where: { exchangeId: made.id } }),
                0,
              );
            }
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
            const exchangeRows = (
              await tx.productExchange.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.refundReauthenticationUse.deleteMany({
              where: { productExchangeId: { in: exchangeRows } },
            });
            await tx.productExchangeCorrection.deleteMany({
              where: { exchangeId: { in: exchangeRows } },
            });
            await tx.productExchangeCompletion.deleteMany({
              where: { exchangeId: { in: exchangeRows } },
            });
            await tx.productExchange.deleteMany({ where: { id: { in: exchangeRows } } });
            await tx.productRefund.deleteMany({ where: { branchId: ids.branch } });
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
      } finally {
        await database.$disconnect();
        await rm(folder, { recursive: true, force: true });
      }
    }
  },
);

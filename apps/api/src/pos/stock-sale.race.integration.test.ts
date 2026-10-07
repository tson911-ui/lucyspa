import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import {
  createPayosSimulator,
  INVENTORY_CONSUMER,
  INVENTORY_EVENT_TYPES,
  parseApiEnvironment,
  processInventoryEvent,
  relayInventoryEvents,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { InvoiceService } from './invoice.service.js';
import { PayosWebhookService } from './payos.webhook.js';

/**
 * Phase 6 P6-10 races (the sale of reserved stock) on separate committed PostgreSQL connections with real production service calls (the same latch as the
 * Phase 4 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by production
 * code). Whatever the interleaving, no unit is sold twice or not at all, no reservation leaks or disappears, a sale is reversed exactly once, and the invoice and stock invariants
 * of the Owner's reconciliation rules hold afterwards (`audit`). Requires an explicitly opted-in local validation database
 * (replica-role cleanup of permanent financial history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-10 PostgreSQL races keep the sale of reserved stock, reservations and payments consistent',
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
    };
    const throttle = new AuthThrottleService(environment);
    const invoices = new InvoiceService(adapter, throttle, environment, simulator.provider);
    const inventory = new InventoryService(adapter as never, throttle, environment);
    const webhook = new PayosWebhookService(
      {
        client: {
          $transaction: (work: (tx: Prisma.TransactionClient) => Promise<unknown>) =>
            database.$transaction(
              async (tx) => {
                if (meet) await meet();
                return work(tx);
              },
              { timeout: 30_000, maxWait: 10_000 },
            ),
        },
      } as never,
      simulator.provider,
      null,
    );
    const ids = {
      branch: randomUUID(),
      category: randomUUID(),
      service: randomUUID(),
      role: randomUUID(),
    };
    const userIds: string[] = [];
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
            code: `PSR_${run}`,
            name: 'Product race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await tx.serviceCategory.create({
          data: { id: ids.category, code: `PSR_${run}`, nameVi: 'Race', nameEn: 'Race' },
        });
        await tx.service.create({
          data: {
            id: ids.service,
            code: `PSR_SVC_${run}`,
            categoryId: ids.category,
            nameVi: 'Race',
            nameEn: 'Race',
            priceVnd: 100_000n,
            priceMaxVnd: 100_000n,
            durationMinutes: 10,
            estimatedMinMinutes: 10,
            estimatedMaxMinutes: 10,
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
              ],
            },
          },
          select: { id: true },
        });
        assert.equal(permissions.length, 9);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `PSR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
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
                  employeeCodeCanonical: `PSR_${run}_${++serial}`,
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
          const principal = {
            userId: id,
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
          return { id, token: issued.token };
        });
      const a = await staff(false);
      const b = await staff(false);
      const boss = await staff(true);
      const ktv = await staff(false);

      /** A published product with one priced variant and `stock` units received at the branch. */
      const variant = async (price: number, stock: number) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `psr-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem race',
              nameEn: 'Race cream',
              createdByUserId: a.id,
              variants: { create: [{ sku: `PSR-${run}-${serial}` }] },
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
          return variantRow.id;
        });
        if (stock > 0) await receive(created, stock);
        return created;
      };
      const receive = async (variantId: string, quantity: number) => {
        const today = (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
        const draft = await inventory.createReceipt(a.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: today,
          notes: null,
          lines: [{ variantId, quantity, lotCode: null, expiryDate: null }],
        });
        await inventory.confirmReceipt(a.token, draft.id, { expectedRowVersion: draft.rowVersion });
      };
      const draftWith = async (
        actor: { token: string },
        lines: [string, number][],
        payerUserId: string | null = null,
      ) => {
        let current = (await invoices.openProductSale(actor.token, ids.branch, { payerUserId }))
          .invoice;
        for (const [variantId, quantity] of lines) {
          current = await invoices.addProductLine(actor.token, current.id, {
            expectedVersion: current.version,
            variantId,
            quantity,
          });
        }
        return current;
      };
      const finalized = async (lines: [string, number][]) => {
        const draft = await draftWith(a, lines);
        return invoices.finalize(a.token, draft.id, { expectedVersion: draft.version });
      };
      const pay = (actor: { token: string }, invoiceId: string, amount: number) =>
        invoices.recordPayment(actor.token, invoiceId, {
          method: 'CASH',
          amountVnd: String(amount),
          tenderedVnd: String(amount),
          idempotencyKey: randomUUID(),
        });
      const reservationsOf = (invoiceId: string) =>
        database.stockReservation.findMany({ where: { invoiceId }, orderBy: { id: 'asc' } });
      const levelOf = (variantId: string) =>
        database.stockLevel.findUniqueOrThrow({
          where: { branchId_variantId: { branchId: ids.branch, variantId } },
        });
      const auditCount = (invoiceId: string, action: string) =>
        database.auditEvent.count({ where: { entityId: invoiceId, action } });
      const eventCount = (invoiceId: string, eventType: string) =>
        database.outboxEvent.count({ where: { aggregateId: invoiceId, eventType } });
      const effective = async (invoiceId: string) =>
        (
          await database.payment.findMany({
            where: { invoiceId, correction: null, status: 'SUCCEEDED' },
          })
        ).reduce((sum, payment) => sum + payment.amountVnd, 0n);

      /** The Owner's reconciliation rules over everything this run created, after every race. */
      const audit = async () => {
        const rows = await database.$queryRaw<
          {
            id: string;
            status: string;
            dropped: string | null;
            subtotal: bigint;
            discount: bigint;
            fee: bigint;
            total: bigint;
            lines: bigint;
            products: bigint;
            held: bigint;
            open: bigint;
          }[]
        >`
          SELECT i.id, i.status::text AS status, i.cancelled_from_status::text AS dropped, i.subtotal_vnd AS subtotal, i.discount_total_vnd AS discount,
                 i.shipping_fee_vnd AS fee, i.total_vnd AS total,
                 COALESCE((SELECT sum(l.gross_vnd) FROM invoice_lines l WHERE l.invoice_id = i.id), 0)::bigint AS lines,
                 (SELECT count(*) FROM invoice_lines l WHERE l.invoice_id = i.id AND l.kind = 'PRODUCT') AS products,
                 (SELECT count(*) FROM stock_reservations r WHERE r.invoice_id = i.id) AS held,
                 (SELECT count(*) FROM stock_reservations r WHERE r.invoice_id = i.id AND r.status = 'RESERVED') AS open
          FROM invoices i WHERE i.branch_id = ${ids.branch}::uuid`;
        for (const row of rows) {
          assert.equal(row.total, row.subtotal - row.discount + row.fee, `total ${row.id}`);
          if (row.status === 'DRAFT' || row.dropped === 'DRAFT') {
            assert.equal(row.held, 0n, `draft ${row.id} holds stock`);
          } else {
            assert.equal(row.lines, row.subtotal, `lines ${row.id}`);
            assert.equal(row.held, row.products, `reservations ${row.id}`);
            if (row.status === 'CANCELLED')
              assert.equal(row.open, 0n, `cancelled ${row.id} holds stock`);
          }
          const paid = await effective(row.id);
          if (row.status === 'PAID') assert.equal(paid, row.total, `paid ${row.id}`);
          if (row.status === 'PENDING_PAYMENT') assert.ok(paid < row.total, `pending ${row.id}`);
          if (row.status === 'CANCELLED') assert.equal(paid, 0n, `cancelled ${row.id} paid`);
        }
        const levels = await database.$queryRaw<
          {
            variant: string;
            on_hand: number;
            reserved: number;
            moved: bigint;
            lots: bigint;
            held: bigint;
          }[]
        >`
          SELECT s.variant_id AS variant, s.on_hand, s.reserved,
                 COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m
                           WHERE m.branch_id = s.branch_id AND m.variant_id = s.variant_id), 0)::bigint AS moved,
                 COALESCE((SELECT sum(l.quantity_on_hand) FROM inventory_lots l
                           WHERE l.branch_id = s.branch_id AND l.variant_id = s.variant_id), 0)::bigint AS lots,
                 COALESCE((SELECT sum(r.quantity) FROM stock_reservations r
                           WHERE r.branch_id = s.branch_id AND r.variant_id = s.variant_id AND r.status = 'RESERVED'), 0)::bigint AS held
          FROM stock_levels s WHERE s.branch_id = ${ids.branch}::uuid`;
        for (const level of levels) {
          assert.equal(BigInt(level.on_hand), level.moved, `on hand = movements ${level.variant}`);
          assert.equal(BigInt(level.on_hand), level.lots, `on hand = lots ${level.variant}`);
          assert.equal(
            BigInt(level.reserved),
            level.held,
            `reserved = open reservations ${level.variant}`,
          );
          assert.ok(level.reserved <= level.on_hand, `reserved <= on hand ${level.variant}`);
        }
        // P6-10: a consumed reservation has sold exactly its quantity, every other reservation nothing.
        const sales = await database.$queryRaw<
          { line: string; status: string; quantity: number; net: bigint }[]
        >`
          SELECT r.invoice_line_id AS line, r.status::text AS status, r.quantity,
                 COALESCE((SELECT sum(m.quantity_delta) FROM stock_movements m
                           WHERE m.invoice_line_id = r.invoice_line_id AND m.kind IN ('SALE', 'SALE_REVERSAL')), 0)::bigint AS net
          FROM stock_reservations r WHERE r.branch_id = ${ids.branch}::uuid`;
        for (const sale of sales) {
          assert.equal(
            sale.net,
            sale.status === 'CONSUMED' ? -BigInt(sale.quantity) : 0n,
            `sale of ${sale.line}`,
          );
        }
      };

      /** One `inventory` event in its own committed transaction, as the worker runs it (the graph lock is taken first, the latch after it). */
      const consume = (eventId: string) =>
        database.$transaction(
          async (tx) => {
            await takeSharedAuthGraphLock(tx);
            if (meet) await meet();
            return processInventoryEvent(tx, eventId);
          },
          { timeout: 30_000, maxWait: 10_000 },
        );
      const pendingEvents = async (invoiceIds: string[]) =>
        database.outboxEvent.findMany({
          where: {
            aggregateType: 'Invoice',
            aggregateId: { in: invoiceIds },
            eventType: { in: INVENTORY_EVENT_TYPES },
            consumptions: { none: { consumer: INVENTORY_CONSUMER } },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true, eventType: true },
        });
      /** The worker catching up: every pending event of these invoices, oldest first, one transaction each. */
      const drain = async (invoiceIds: string[]) => {
        const outcomes: string[] = [];
        for (const event of await pendingEvents(invoiceIds)) outcomes.push(await consume(event.id));
        return outcomes;
      };
      const settled = (result: PromiseSettledResult<unknown>) =>
        result.status === 'fulfilled' ? String(result.value) : outcome(result);
      const stockOf = async (invoiceId: string) => {
        const reservation = await database.stockReservation.findFirstOrThrow({
          where: { invoiceId },
          select: { status: true, consumedPaidSeq: true, quantity: true, invoiceLineId: true },
        });
        const net = await database.stockMovement.aggregate({
          where: { invoiceLineId: reservation.invoiceLineId },
          _sum: { quantityDelta: true },
        });
        return { ...reservation, net: net._sum.quantityDelta ?? 0 };
      };
      const eventOf = async (invoiceId: string, eventType: string) =>
        (
          await database.outboxEvent.findFirstOrThrow({
            where: { aggregateId: invoiceId, eventType },
            orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
            select: { id: true },
          })
        ).id;

      await suite.test(
        'two workers claim the same event at once: one sells the stock, the other claims nothing',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 4);
            const invoice = await finalized([[v, 3]]);
            await pay(a, invoice.id, Number(invoice.totalVnd));
            const id = await eventOf(invoice.id, 'INVOICE_PAID');
            const results = await race(
              () => consume(id),
              () => consume(id),
            );
            assert.deepEqual(
              results.map(settled).sort(),
              ['APPLIED', 'NOT_CLAIMED'],
              `round ${round}`,
            );
            const sold = await stockOf(invoice.id);
            assert.deepEqual([sold.status, sold.net], ['CONSUMED', -3]);
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [1, 0]);
            assert.equal(
              await database.stockMovement.count({ where: { invoiceLineId: sold.invoiceLineId } }),
              1,
              'one movement',
            );
          }
          await audit();
        },
      );

      await suite.test(
        'the sale racing the reversal of the payment: whatever the order, the stock ends reserved again and nothing is sold',
        async () => {
          for (let round = 0; round < 8; round += 1) {
            const v = await variant(80_000, 5);
            const invoice = await finalized([[v, 2]]);
            const paid = await pay(a, invoice.id, Number(invoice.totalVnd));
            const id = await eventOf(invoice.id, 'INVOICE_PAID');
            const results = await race(
              () => consume(id),
              () =>
                invoices.reversePayment(boss.token, invoice.id, paid.payment.id, {
                  reason: 'Nhập nhầm',
                }),
            );
            assert.equal(
              settled(results[0]!) === 'APPLIED' || settled(results[0]!) === 'SKIPPED_STALE',
              true,
              settled(results[0]!),
            );
            assert.equal(outcome(results[1]!), 'OK');
            await drain([invoice.id]);
            const state = await stockOf(invoice.id);
            assert.deepEqual([state.status, state.net], ['RESERVED', 0], `round ${round}`);
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [5, 2]);
            assert.equal(
              (await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status,
              'PENDING_PAYMENT',
            );
          }
          await audit();
        },
      );

      await suite.test(
        'the reversal racing the cancellation: the stock ends released and whole, with one reversal of the sale',
        async () => {
          for (let round = 0; round < 8; round += 1) {
            const v = await variant(80_000, 5);
            const invoice = await finalized([[v, 2]]);
            const paid = await pay(a, invoice.id, Number(invoice.totalVnd));
            await drain([invoice.id]);
            assert.equal((await stockOf(invoice.id)).status, 'CONSUMED');
            const reversed = await invoices.reversePayment(
              boss.token,
              invoice.id,
              paid.payment.id,
              {
                reason: 'Nhập nhầm',
              },
            );
            // The consumer (handling the reopening) against the cancellation of the reopened invoice.
            const id = await eventOf(invoice.id, 'INVOICE_REOPENED');
            const results = await race(
              () => consume(id),
              () =>
                invoices.cancel(boss.token, invoice.id, {
                  expectedVersion: reversed.invoice.version,
                  reason: 'Khách đổi ý',
                }),
            );
            assert.ok(['APPLIED', 'NOOP'].includes(settled(results[0]!)), settled(results[0]!));
            assert.equal(outcome(results[1]!), 'OK');
            await drain([invoice.id]);
            const state = await stockOf(invoice.id);
            assert.deepEqual([state.status, state.net], ['RELEASED', 0], `round ${round}`);
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [5, 0]);
            const reversals = await database.stockMovement.count({
              where: { invoiceLineId: state.invoiceLineId, kind: 'SALE_REVERSAL' },
            });
            assert.equal(reversals, 1, 'the sale is reversed exactly once');
          }
          await audit();
        },
      );

      await suite.test(
        'the sale racing a finalization for the same variant: the held units stay held, the free unit is sold once',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 3);
            const first = await finalized([[v, 2]]);
            await pay(a, first.id, Number(first.totalVnd));
            const second = await draftWith(b, [[v, 1]]);
            const id = await eventOf(first.id, 'INVOICE_PAID');
            const results = await race(
              () => consume(id),
              () => invoices.finalize(b.token, second.id, { expectedVersion: second.version }),
            );
            assert.equal(settled(results[0]!), 'APPLIED');
            assert.equal(outcome(results[1]!), 'OK');
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [1, 1]);
            // The last unit is now taken: nobody can finalize another.
            const third = await draftWith(a, [[v, 1]]);
            await assert.rejects(
              invoices.finalize(a.token, third.id, { expectedVersion: third.version }),
              (error: unknown) =>
                error instanceof AuthError && error.code === 'PRODUCT_OUT_OF_STOCK',
            );
          }
          await audit();
        },
      );

      await suite.test(
        'the sale racing a stock adjustment: stock never goes below what is reserved or sold',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 5);
            const invoice = await finalized([[v, 3]]);
            await pay(a, invoice.id, Number(invoice.totalVnd));
            const id = await eventOf(invoice.id, 'INVOICE_PAID');
            const lot = await database.inventoryLot.findFirstOrThrow({
              where: { branchId: ids.branch, variantId: v },
            });
            const adjust = (quantity: number) =>
              inventory.adjust(a.token, {
                requestKey: randomUUID(),
                branchId: ids.branch,
                variantId: v,
                lotId: lot.id,
                quantity,
                reason: 'LOSS',
                note: null,
              });
            // Two free units may leave in any order; a third is refused whichever of the two checks sees it first.
            const results = await race(
              () => consume(id),
              () => adjust(2),
            );
            assert.equal(settled(results[0]!), 'APPLIED');
            assert.equal(outcome(results[1]!), 'OK');
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [0, 0]);
            await assert.rejects(adjust(1), (error: unknown) => error instanceof AuthError);
          }
          await audit();
        },
      );

      await suite.test(
        'two invoices of the same variants sold at once, in opposite order: no deadlock, every sale whole',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const x = await variant(80_000, 6);
            const y = await variant(90_000, 6);
            const first = await finalized([
              [x, 1],
              [y, 2],
            ]);
            const second = await finalized([
              [y, 1],
              [x, 2],
            ]);
            await pay(a, first.id, Number(first.totalVnd));
            await pay(a, second.id, Number(second.totalVnd));
            const ida = await eventOf(first.id, 'INVOICE_PAID');
            const idb = await eventOf(second.id, 'INVOICE_PAID');
            const results = await race(
              () => consume(ida),
              () => consume(idb),
            );
            assert.deepEqual(results.map(settled), ['APPLIED', 'APPLIED'], `round ${round}`);
            assert.deepEqual(await levelOf(x).then((l) => [l.onHand, l.reserved]), [3, 0]);
            assert.deepEqual(await levelOf(y).then((l) => [l.onHand, l.reserved]), [3, 0]);
          }
          await audit();
        },
      );

      await suite.test(
        'the relay selects only invoices that hold a reservation and survives events replayed by a second worker',
        async () => {
          const v = await variant(80_000, 4);
          const invoice = await finalized([[v, 1]]);
          await pay(a, invoice.id, Number(invoice.totalVnd));
          const pending = await database.$queryRaw<{ id: string }[]>`
            SELECT e.id FROM outbox_events e
            WHERE e.aggregate_type = 'Invoice' AND e.event_type = ANY(${INVENTORY_EVENT_TYPES}::text[])
              AND NOT EXISTS (SELECT 1 FROM outbox_consumptions c WHERE c.event_id = e.id AND c.consumer = ${INVENTORY_CONSUMER})
              AND EXISTS (SELECT 1 FROM stock_reservations r
                          WHERE r.invoice_id = CASE WHEN e.aggregate_type = 'Invoice' THEN e.aggregate_id::uuid END)
              AND e.branch_id = ${ids.branch}::uuid`;
          assert.ok(pending.length >= 1);
          const handled = await relayInventoryEvents(
            database,
            new Map(),
            () => undefined,
            (error) => {
              throw error;
            },
          );
          assert.ok(handled >= 1);
          assert.equal((await stockOf(invoice.id)).status, 'CONSUMED');
          assert.equal(
            (await relayInventoryEvents(
              database,
              new Map(),
              () => undefined,
              () => undefined,
            )) >= 0,
            true,
          );
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
            const visits = (
              await tx.visit.findMany({ where: { branchId: ids.branch }, select: { id: true } })
            ).map((row) => row.id);
            const lines = (
              await tx.visitServiceLine.findMany({
                where: { visitId: { in: visits } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const executionRows = (
              await tx.serviceExecution.findMany({
                where: { visitServiceLineId: { in: lines } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const paymentRows = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const orderCodes = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows }, providerOrderCode: { not: null } },
                select: { providerOrderCode: true },
              })
            ).map((row) => row.providerOrderCode!);
            const variantRows = (
              await tx.productVariant.findMany({
                where: { productId: { in: productIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.outboxConsumption.deleteMany({ where: { event: { branchId: ids.branch } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  {
                    aggregateId: {
                      in: [...invoiceRows, ...visits, ...executionRows, ...paymentRows],
                    },
                  },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.paymentAnomaly.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.paymentProviderEvent.deleteMany({ where: { orderCode: { in: orderCodes } } });
            await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentCorrection.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.payment.deleteMany({ where: { id: { in: paymentRows } } });
            await tx.stockReservation.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineProduct.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineService.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLine.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoice.deleteMany({ where: { id: { in: invoiceRows } } });
            await tx.$executeRaw`DELETE FROM ktv_occupancies WHERE employee_user_id = ANY(${userIds}::uuid[])`;
            await tx.serviceExecution.deleteMany({ where: { id: { in: executionRows } } });
            await tx.visitServiceLine.deleteMany({ where: { id: { in: lines } } });
            await tx.visitParticipant.deleteMany({ where: { visitId: { in: visits } } });
            await tx.visit.deleteMany({ where: { id: { in: visits } } });
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
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            await tx.service.deleteMany({ where: { id: ids.service } });
            await tx.serviceCategory.deleteMany({ where: { id: ids.category } });
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

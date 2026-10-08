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
import { createPayosSimulator, parseApiEnvironment, runOrderScan } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { InvoiceService } from '../pos/invoice.service.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { validVnMobile } from '../testing/phone.js';
import { ProductOrderService } from './order.service.js';

/**
 * Phase 6 P6-17 races (working the orders) on separate committed PostgreSQL connections with real production service calls (the same
 * latch as the Phase 4 and P6-10 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is
 * taken by production code, in the order of design 10.2: invoice, order lines, stock). Whatever the interleaving: a line is ordered or
 * its payment is reversed, never both; goods are held for one line only and never more than the stock; a line is cancelled and
 * refunded exactly once; the daily scan writes one row and one notification per holder. Requires an explicitly opted-in local
 * validation database (replica-role cleanup of permanent financial history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-17 PostgreSQL races keep ordering, arrival, cancellation and the daily scan consistent',
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
    const orders = new ProductOrderService(adapter as never, throttle, environment);
    const ids = { branch: randomUUID(), role: randomUUID() };
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
            code: `POR_${run}`,
            name: 'Order race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await syncPermissionCatalog(tx);
        const codes: PermissionCode[] = [
          'SELL_PRODUCTS',
          'VIEW_INVOICES',
          'MANAGE_INVOICES',
          'COLLECT_PAYMENTS',
          'CANCEL_INVOICES',
          'CORRECT_PAYMENTS',
          'MANAGE_STOCK_RECEIPTS',
          'VIEW_INVENTORY',
          'MANAGE_PRODUCT_ORDERS',
          'REFUND_PRODUCTS',
        ];
        const permissions = await tx.permission.findMany({
          where: { code: { in: codes } },
          select: { id: true },
        });
        assert.equal(permissions.length, codes.length);
        await tx.role.create({
          data: {
            id: ids.role,
            code: `POR_${run}`,
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
                  employeeCodeCanonical: `POR_${run}_${++serial}`,
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

      /** A published product with one priced variant, sold on order, and `stock` units received at the branch. */
      const variant = async (price: number, stock: number) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `por-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem race',
              nameEn: 'Race cream',
              createdByUserId: a.id,
              variants: { create: [{ sku: `POR-${run}-${serial}`, sellOnOrder: true }] },
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
        if (stock > 0) await confirm(await receive(created, stock));
        return created;
      };
      const today = async () =>
        (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
      const receive = async (variantId: string, quantity: number) => {
        const draft = await inventory.createReceipt(a.token, {
          branchId: ids.branch,
          supplierId: null,
          receiptDate: await today(),
          notes: null,
          lines: [{ variantId, quantity, lotCode: null, expiryDate: null }],
        });
        return { id: draft.id, rowVersion: draft.rowVersion };
      };
      const confirm = (draft: { id: string; rowVersion: number }) =>
        inventory.confirmReceipt(a.token, draft.id, { expectedRowVersion: draft.rowVersion });
      /** A paid pre-order of `quantity` units (the stock does not cover them). */
      const paidPreOrder = async (variantId: string, quantity: number) => {
        let draft = (await invoices.openProductSale(a.token, ids.branch, { payerUserId: null }))
          .invoice;
        draft = await invoices.addProductLine(a.token, draft.id, {
          expectedVersion: draft.version,
          variantId,
          quantity,
          fulfilmentMode: 'PRE_ORDER',
        });
        const invoice = await invoices.finalize(a.token, draft.id, {
          expectedVersion: draft.version,
          preOrderContact: { phone: validVnMobile(), name: null },
        });
        const paid = await invoices.recordPayment(a.token, invoice.id, {
          method: 'CASH',
          amountVnd: invoice.totalVnd,
          tenderedVnd: invoice.totalVnd,
          idempotencyKey: randomUUID(),
        });
        const line = await database.productOrderLine.findFirstOrThrow({
          where: { invoiceId: invoice.id },
        });
        return { invoiceId: invoice.id, paymentId: paid.payment.id, lineId: line.id };
      };
      const lineOf = (lineId: string) =>
        database.productOrderLine.findUniqueOrThrow({ where: { id: lineId } });
      const levelOf = (variantId: string) =>
        database.stockLevel.findUniqueOrThrow({
          where: { branchId_variantId: { branchId: ids.branch, variantId } },
        });

      /** The Owner's reconciliation of the stock and of the orders over everything this run created, after every race. */
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
        const lines = await database.$queryRaw<
          {
            id: string;
            status: string;
            quantity: number;
            reservation: string | null;
            reservation_quantity: number | null;
            source: string | null;
            invoice_status: string;
            refunds: bigint;
            events: bigint;
            last_event: string | null;
          }[]
        >`
          SELECT o.id, o.status::text AS status, o.quantity, r.status::text AS reservation, r.quantity AS reservation_quantity,
                 r.source::text AS source, i.status::text AS invoice_status,
                 (SELECT count(*) FROM product_refunds f WHERE f.order_line_id = o.id) AS refunds,
                 (SELECT count(*) FROM product_order_events e WHERE e.order_line_id = o.id) AS events,
                 (SELECT e.to_status::text FROM product_order_events e WHERE e.order_line_id = o.id
                  ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event
          FROM product_order_lines o
          JOIN invoices i ON i.id = o.invoice_id
          LEFT JOIN stock_reservations r ON r.invoice_line_id = o.invoice_line_id
          WHERE o.branch_id = ${ids.branch}::uuid`;
        for (const line of lines) {
          assert.equal(line.last_event, line.status, `last event of ${line.id}`);
          switch (line.status) {
            case 'AWAITING_PAYMENT':
            case 'PAID':
            case 'ORDERED':
              assert.ok(
                line.reservation === null || line.source === 'INVOICE_LINE' ? true : false,
                `waiting line ${line.id} holds no order goods`,
              );
              assert.equal(line.refunds, 0n);
              break;
            case 'ARRIVED':
              assert.equal(line.reservation, 'RESERVED', `arrived line ${line.id} holds its goods`);
              assert.equal(line.source, 'ORDER_LINE');
              assert.equal(line.reservation_quantity, line.quantity);
              assert.equal(line.refunds, 0n);
              break;
            case 'CANCELLED':
              assert.ok(line.reservation === null || line.reservation === 'RELEASED');
              assert.ok(line.refunds <= 1n, `line ${line.id} refunded at most once`);
              if (line.invoice_status === 'PAID') {
                assert.equal(line.refunds, 1n, `a cancelled paid line ${line.id} is refunded`);
              }
              break;
            default:
              assert.fail(`unexpected status ${line.status}`);
          }
        }
      };

      await suite.test(
        'ordering the goods racing the reversal of the payment: one wins, never both',
        async () => {
          const boss = await staff(true);
          for (let round = 0; round < 8; round += 1) {
            const v = await variant(90_000, 0);
            const sale = await paidPreOrder(v, 1);
            const line = await lineOf(sale.lineId);
            const results = await race(
              () =>
                orders.markOrdered(a.token, {
                  lines: [{ id: sale.lineId, rowVersion: line.rowVersion }],
                }),
              () =>
                invoices.reversePayment(boss.token, sale.invoiceId, sale.paymentId, {
                  reason: 'Nhập nhầm',
                }),
            );
            const codes = results.map(outcome);
            assert.ok(
              !(codes[0] === 'OK' && codes[1] === 'OK'),
              `round ${round}: ordered AND reversed (${codes.join()})`,
            );
            assert.ok(codes.includes('OK'), `round ${round}: someone wins (${codes.join()})`);
            const after = await lineOf(sale.lineId);
            const invoice = await database.invoice.findUniqueOrThrow({
              where: { id: sale.invoiceId },
            });
            if (codes[0] === 'OK') {
              assert.deepEqual([after.status, invoice.status], ['ORDERED', 'PAID']);
            } else {
              assert.deepEqual(
                [after.status, invoice.status],
                ['AWAITING_PAYMENT', 'PENDING_PAYMENT'],
              );
            }
          }
          await audit();
        },
      );

      await suite.test(
        'a receipt racing a counter sale of the same stock: the units go to one or the other, never to both',
        async () => {
          for (let round = 0; round < 8; round += 1) {
            const v = await variant(70_000, 1);
            const sale = await paidPreOrder(v, 2);
            // An in-stock sale of the one unit on the shelf, ready to be finalized.
            let draft = (await invoices.openProductSale(a.token, ids.branch, { payerUserId: null }))
              .invoice;
            draft = await invoices.addProductLine(a.token, draft.id, {
              expectedVersion: draft.version,
              variantId: v,
              quantity: 1,
            });
            const receipt = await receive(v, 1);
            const results = await race(
              () => confirm(receipt),
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
            );
            assert.equal(outcome(results[0]!), 'OK', `round ${round}: the receipt stands`);
            const line = await lineOf(sale.lineId);
            const level = await levelOf(v);
            assert.equal(level.onHand, 2);
            // Two units in all: either the whole pre-order line holds both, or the counter sale holds one and the line waits.
            if (line.status === 'ARRIVED') {
              assert.equal(
                outcome(results[1]!) !== 'OK',
                true,
                `round ${round}: nothing left for the counter sale`,
              );
              assert.equal(level.reserved, 2);
            } else {
              assert.equal(line.status, 'PAID');
              assert.equal(level.reserved <= 1, true);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'cancelling an arrived line racing a new arrival: the goods are held for one line only',
        async () => {
          const boss = await staff(true);
          for (let round = 0; round < 6; round += 1) {
            const refunder = round === 0 ? boss : await staff(true);
            const v = await variant(60_000, 0);
            const first = await paidPreOrder(v, 2);
            const second = await paidPreOrder(v, 2);
            await confirm(await receive(v, 2));
            assert.equal((await lineOf(first.lineId)).status, 'ARRIVED');
            const more = await receive(v, 2);
            const firstRow = await lineOf(first.lineId);
            const results = await race(
              () =>
                orders.cancelLine(refunder.token, first.lineId, {
                  expectedVersion: firstRow.rowVersion,
                  cause: 'CUSTOMER_CHANGED_MIND',
                  note: 'Khách đổi ý',
                  method: 'CASH',
                  bankReference: null,
                  clientRequestId: randomUUID(),
                }),
              () => confirm(more),
            );
            assert.equal(outcome(results[0]!), 'OK', `round ${round}: cancel`);
            assert.equal(outcome(results[1]!), 'OK', `round ${round}: receipt`);
            const cancelled = await lineOf(first.lineId);
            const next = await lineOf(second.lineId);
            assert.equal(cancelled.status, 'CANCELLED');
            assert.equal(next.status, 'ARRIVED', `round ${round}: the next line got the goods`);
            const level = await levelOf(v);
            assert.deepEqual([level.onHand, level.reserved], [4, 2]);
          }
          await audit();
        },
      );

      await suite.test(
        'the same line cancelled twice at once: one refund, one winner',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const one = await staff(true);
            const two = await staff(true);
            const v = await variant(55_000, 0);
            const sale = await paidPreOrder(v, 1);
            const line = await lineOf(sale.lineId);
            const body = () => ({
              expectedVersion: line.rowVersion,
              cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
              note: 'Khách hủy',
              method: 'CASH',
              bankReference: null,
              clientRequestId: randomUUID(),
            });
            const results = await race(
              () => orders.cancelLine(one.token, sale.lineId, body()),
              () => orders.cancelLine(two.token, sale.lineId, body()),
            );
            const codes = results.map(outcome).sort();
            assert.equal(
              codes.filter((code) => code === 'OK').length,
              1,
              `round ${round}: ${codes.join()}`,
            );
            assert.equal(
              await database.productRefund.count({ where: { orderLineId: sale.lineId } }),
              1,
              'exactly one refund',
            );
            assert.equal((await lineOf(sale.lineId)).status, 'CANCELLED');
          }
          await audit();
        },
      );

      await suite.test('two allocations at once never hold the same goods twice', async () => {
        for (let round = 0; round < 6; round += 1) {
          const v = await variant(45_000, 0);
          const first = await paidPreOrder(v, 2);
          const second = await paidPreOrder(v, 2);
          const draft = await receive(v, 3);
          const results = await race(
            () => confirm(draft),
            () => orders.allocate(a.token, { branchId: ids.branch, variantId: v }),
          );
          assert.equal(outcome(results[0]!), 'OK');
          assert.ok(['OK', 'CONFLICT'].includes(outcome(results[1]!)));
          // Three units: the first (oldest paid) line takes two; one is left and the second line waits.
          assert.deepEqual(
            [(await lineOf(first.lineId)).status, (await lineOf(second.lineId)).status],
            ['ARRIVED', 'PAID'],
            `round ${round}`,
          );
          assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [3, 2]);
        }
        await audit();
      });

      await suite.test(
        'the daily scan: one row per branch and day, one notice per holder, nothing changed, two scanners at once repeat nothing',
        async () => {
          const holder = await staff(false);
          const v = await variant(40_000, 0);
          const late = await paidPreOrder(v, 1);
          const when = await today();
          await database.$transaction(async (tx) => {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(
              `UPDATE product_order_lines SET expected_to = '${when}'::date - 2, expected_from = '${when}'::date - 3 WHERE id = '${late.lineId}'`,
            );
          });
          const noon = new Date(`${when}T05:00:00.000Z`); // 12:00 in Ho Chi Minh City on the branch-local day
          const before = await lineOf(late.lineId);
          await Promise.all([runOrderScan(database, noon), runOrderScan(database, noon)]);
          const scans = await database.productOrderScan.findMany({
            where: { branchId: ids.branch },
          });
          assert.equal(scans.length, 1, 'one row for the branch and the day');
          assert.equal(scans[0]!.outcome, 'PUBLISHED');
          assert.ok(scans[0]!.lateLines >= 1);
          const notices = await database.notification.findMany({
            where: { branchId: ids.branch, type: 'PRODUCT_ORDER_ALERT' },
          });
          // Every holder of the permission at the branch is told once (the role gives it to each member of this run).
          assert.equal(notices.length, userIds.length, 'one notice per holder');
          assert.ok(notices.some((notice) => notice.recipientUserId === holder.id));
          assert.deepEqual(await lineOf(late.lineId), before, 'the scan changes no line');
          // A later scan the same day repeats nothing.
          await runOrderScan(database, new Date(noon.getTime() + 3_600_000));
          assert.equal(
            await database.productOrderScan.count({ where: { branchId: ids.branch } }),
            1,
          );
          assert.equal(
            await database.notification.count({
              where: { branchId: ids.branch, type: 'PRODUCT_ORDER_ALERT' },
            }),
            userIds.length,
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
            const paymentRows = (
              await tx.payment.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const orderRows = (
              await tx.productOrder.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            const orderLineRows = (
              await tx.productOrderLine.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            const refundRows = (
              await tx.productRefund.findMany({
                where: { branchId: ids.branch },
                select: { id: true },
              })
            ).map((row) => row.id);
            const variantRows = (
              await tx.productVariant.findMany({
                where: { productId: { in: productIds } },
                select: { id: true },
              })
            ).map((row) => row.id);
            await tx.notification.deleteMany({ where: { branchId: ids.branch } });
            await tx.outboxConsumption.deleteMany({ where: { event: { branchId: ids.branch } } });
            await tx.outboxEvent.deleteMany({
              where: {
                OR: [
                  { branchId: ids.branch },
                  {
                    aggregateId: {
                      in: [
                        ...invoiceRows,
                        ...paymentRows,
                        ...orderRows,
                        ...orderLineRows,
                        ...refundRows,
                      ],
                    },
                  },
                ],
              },
            });
            await tx.auditEvent.deleteMany({
              where: { OR: [{ branchId: ids.branch }, { actorUserId: { in: userIds } }] },
            });
            await tx.refundReauthenticationUse.deleteMany({
              where: { productRefundId: { in: refundRows } },
            });
            await tx.productRefund.deleteMany({ where: { id: { in: refundRows } } });
            await tx.productOrderEvent.deleteMany({
              where: { orderLineId: { in: orderLineRows } },
            });
            await tx.productOrderTicket.deleteMany({ where: { orderId: { in: orderRows } } });
            await tx.productOrderLine.deleteMany({ where: { id: { in: orderLineRows } } });
            await tx.productOrder.deleteMany({ where: { id: { in: orderRows } } });
            await tx.productOrderScan.deleteMany({ where: { branchId: ids.branch } });
            await tx.paymentAnomaly.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.paymentAttempt.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.paymentCorrection.deleteMany({ where: { paymentId: { in: paymentRows } } });
            await tx.payment.deleteMany({ where: { id: { in: paymentRows } } });
            await tx.stockReservation.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineProduct.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.invoiceLineService.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
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
            await tx.employeeProfile.deleteMany({ where: { userId: { in: userIds } } });
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

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
import {
  cancelOverdueOnlineOrders,
  cancelUnpaidOnlineInvoice,
  createPayosSimulator,
  INVENTORY_EVENT_TYPES,
  parseApiEnvironment,
  processInventoryEvent,
  type OnlineCancelOutcome,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { takeSharedAuthGraphLock } from '../auth/auth-store.js';
import { AuthThrottleService } from '../auth/auth-throttle.service.js';
import { SessionService } from '../auth/session.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PayosWebhookService } from '../pos/payos.webhook.js';
import type { PrismaService } from '../platform/prisma.service.js';
import { ProductOrderService } from '../product-orders/order.service.js';
import { validVnMobile } from '../testing/phone.js';
import { OnlineOrderService } from './online.service.js';

/**
 * Phase 6 Wave 4 (P6-19 to P6-21) races on separate committed PostgreSQL connections with real production service calls (the same latch as
 * the Phase 4 and P6-17 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by
 * production code, in the order of design 10.2: the member's row, the invoice, the order lines, the stock). Whatever the interleaving:
 * a PayOS confirmation delivered twice credits once; a payment and the automatic cancel after the deadline never both win (a payment that
 * arrives after the cancel becomes an anomaly for management, not a second state); two buyers of the last unit never both get it; a staff
 * cancel with a refund and the shipping of the same line never both happen; one account never holds more unpaid orders than the limit and a
 * repeated checkout request returns one order. The Owner's reconciliation of stock, reservations, invoices and online lines runs after every
 * race. Requires an explicitly opted-in local validation database (replica-role cleanup of permanent financial history and the one
 * settings row put back as it was); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 Wave 4 PostgreSQL races keep online payment, the timeout, the last unit, cancellation and shipping consistent',
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
    const inventory = new InventoryService(adapter as never, throttle, environment);
    const counterOrders = new ProductOrderService(adapter as never, throttle, environment);
    const online = new OnlineOrderService(
      adapter as never,
      throttle,
      environment,
      simulator.provider,
      counterOrders,
    );
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
    const ids = { branch: randomUUID(), role: randomUUID(), carrier: randomUUID() };
    const userIds: string[] = [];
    const memberIds: string[] = [];
    const sessionIds: string[] = [];
    const productIds: string[] = [];
    const orderCodes: number[] = [];
    const run = randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase();
    let serial = 0;
    /** The one settings row of the shop as it was before this run (put back at the end). */
    let originalSettings: Awaited<ReturnType<typeof database.onlineSalesSettings.findUnique>> =
      null;

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
      // Only the first two transactions to arrive are latched (a command may open another one later).
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
            code: `ONR_${run}`,
            name: 'Online race',
            timezone: 'Asia/Ho_Chi_Minh',
          },
        });
        await syncPermissionCatalog(tx);
        const codes: PermissionCode[] = [
          'VIEW_INVOICES',
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
            code: `ONR_${run}`,
            displayNameVi: 'Race',
            displayNameEn: 'Race',
            permissions: { create: permissions.map((p) => ({ permissionId: p.id })) },
          },
        });
      });
      const sessionFor = async (
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
                  employeeCodeCanonical: `ONR_${run}_${++serial}`,
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
          return { id, token: await sessionFor(tx, user, reauthenticated) };
        });
      const worker = await staff(false);
      /** A member of the website with a signed-in session. */
      const member = () =>
        database.$transaction(async (tx) => {
          const id = randomUUID();
          userIds.push(id);
          memberIds.push(id);
          const label = `${run.toLowerCase()}-${++serial}`;
          const user = await tx.user.create({
            data: {
              id,
              kind: 'CUSTOMER',
              status: 'ACTIVE',
              fullName: `Khách race ${serial}`,
              preferredLocale: 'vi',
              emailCanonical: `onr-${label}@example.com`,
              emailDelivery: `onr-${label}@example.com`,
              emailVerifiedAt: new Date(),
              phoneCanonical: validVnMobile(),
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              customerProfile: {
                create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
              },
            },
          });
          return { id, token: await sessionFor(tx, user, false) };
        });

      // The shop is open at this branch for the run, and one carrier exists.
      originalSettings = await database.onlineSalesSettings.findUnique({ where: { id: 1 } });
      assert.ok(originalSettings, 'the settings row exists');
      await database.$transaction(async (tx) => {
        await tx.onlineSalesSettings.update({
          where: { id: 1 },
          data: {
            enabled: true,
            fulfilmentBranchId: ids.branch,
            rowVersion: originalSettings!.rowVersion + 1,
          },
        });
        await tx.shippingCarrier.create({
          data: { id: ids.carrier, name: `Hãng race ${run}`, createdByUserId: worker.id },
        });
      });
      const policyVersion = (
        await database.onlineSalesSettings.findUniqueOrThrow({ where: { id: 1 } })
      ).policyVersion;

      const today = async () =>
        (
          await database.$queryRaw<
            { d: string }[]
          >`SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date, 'YYYY-MM-DD') AS d`
        )[0]!.d;
      /** A published product with one priced variant, sold online, and `stock` units received at the branch. */
      const variant = async (price: number, stock: number, sellOnOrder = false) => {
        const created = await database.$transaction(async (tx) => {
          const product = await tx.product.create({
            data: {
              code: `onr-${run.toLowerCase()}-${++serial}`,
              nameVi: 'Kem race online',
              nameEn: 'Race cream online',
              createdByUserId: worker.id,
              variants: {
                create: [{ sku: `ONR-${run}-${serial}`, sellOnline: true, sellOnOrder }],
              },
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
              createdByUserId: worker.id,
            },
          });
          await tx.product.update({
            where: { id: product.id },
            data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
          });
          return variantRow.id;
        });
        if (stock > 0) {
          const stocker = await staff(false);
          const draft = await inventory.createReceipt(stocker.token, {
            branchId: ids.branch,
            supplierId: null,
            receiptDate: await today(),
            notes: null,
            lines: [{ variantId: created, quantity: stock, lotCode: null, expiryDate: null }],
          });
          await inventory.confirmReceipt(stocker.token, draft.id, {
            expectedRowVersion: draft.rowVersion,
          });
        }
        return created;
      };
      const levelOf = (variantId: string) =>
        database.stockLevel.findUniqueOrThrow({
          where: { branchId_variantId: { branchId: ids.branch, variantId } },
        });
      const checkout = (clientRequestId: string = randomUUID()) => ({
        address: {
          recipientName: 'Nguyễn Thị Hoa',
          recipientPhone: validVnMobile(),
          provinceCode: 'HA_NOI',
          ward: 'Phường Cửa Nam',
          street: '12 Phố Huế',
        },
        acceptedPolicyVersion: policyVersion,
        clientRequestId,
      });
      const fill = async (who: { token: string }, variantId: string, quantity = 1) =>
        online.addToCart(who.token, { variantId, quantity });
      /** A cart with one line, then the order (no race). */
      const placed = async (who: { token: string }, variantId: string, quantity = 1) => {
        await fill(who, variantId, quantity);
        return online.place(who.token, checkout());
      };
      const payosOrderCode = async (invoiceId: string) => {
        const payment = await database.payment.findFirstOrThrow({
          where: { invoiceId, method: 'PAYOS' },
          orderBy: { createdAt: 'desc' },
        });
        const code = Number(payment.providerOrderCode);
        if (!orderCodes.includes(code)) orderCodes.push(code);
        return code;
      };
      /** The member asks for the PayOS link of the order (no race); the bank notification body is returned. */
      const withLink = async (who: { token: string }, order: { id: string; invoiceId: string }) => {
        await online.pay(who.token, order.id, 'vi');
        const code = await payosOrderCode(order.invoiceId);
        return { code, body: simulator.pay(code, { reference: `TF-${code}` }) };
      };
      const overdue = (orderId: string) =>
        database.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `UPDATE online_order_details SET deadline_at = clock_timestamp() - interval '5 minutes' WHERE order_id = '${orderId}'::uuid`,
          );
          await tx.$executeRawUnsafe(
            `UPDATE payments SET expires_at = clock_timestamp() - interval '5 minutes' WHERE invoice_id = (SELECT invoice_id FROM product_orders WHERE id = '${orderId}'::uuid) AND status = 'PENDING'`,
          );
        });
      /** The inventory consumer over the invoice events not handled yet (the worker does this in production). */
      const runInventory = async () => {
        const events = await database.outboxEvent.findMany({
          where: {
            aggregateType: 'Invoice',
            eventType: { in: INVENTORY_EVENT_TYPES },
            branchId: ids.branch,
            consumptions: { none: { consumer: 'inventory' } },
          },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        for (const event of events) {
          await database.$transaction((tx) => processInventoryEvent(tx, event.id), {
            timeout: 30_000,
          });
        }
      };
      const auditCount = (invoiceId: string, action: string) =>
        database.auditEvent.count({ where: { entityId: invoiceId, action } });
      const eventCount = (invoiceId: string, eventType: string) =>
        database.outboxEvent.count({ where: { aggregateId: invoiceId, eventType } });
      const linesOf = (orderId: string) =>
        database.productOrderLine.findMany({ where: { orderId }, orderBy: { id: 'asc' } });

      /** The Owner's reconciliation of the stock and of the online orders over everything this run created, after every race. */
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
            mode: string;
            reservation: string | null;
            source: string | null;
            invoice_status: string;
            sold: bigint;
            refunds: bigint;
            last_event: string | null;
          }[]
        >`
          SELECT o.id, o.status::text AS status, o.quantity, d.fulfilment_mode::text AS mode, r.status::text AS reservation, r.source::text AS source,
                 i.status::text AS invoice_status,
                 COALESCE((SELECT -sum(m.quantity_delta) FROM stock_movements m
                           WHERE m.invoice_line_id = o.invoice_line_id AND m.kind = 'SALE'), 0)::bigint AS sold,
                 (SELECT count(*) FROM product_refunds f WHERE f.order_line_id = o.id) AS refunds,
                 (SELECT e.to_status::text FROM product_order_events e WHERE e.order_line_id = o.id
                  ORDER BY e.occurred_at DESC, e.id DESC LIMIT 1) AS last_event
          FROM product_order_lines o
            JOIN product_orders p ON p.id = o.order_id AND p.channel = 'ONLINE'
            JOIN invoices i ON i.id = o.invoice_id
            JOIN invoice_line_products d ON d.invoice_line_id = o.invoice_line_id
            LEFT JOIN stock_reservations r ON r.invoice_line_id = o.invoice_line_id
          WHERE o.branch_id = ${ids.branch}::uuid`;
        for (const line of lines) {
          const where = `online line ${line.id} (${line.status})`;
          assert.equal(line.last_event, line.status, `last event of ${where}`);
          if (line.invoice_status === 'PENDING_PAYMENT') {
            assert.equal(line.status, 'AWAITING_PAYMENT', where);
          }
          if (line.invoice_status === 'CANCELLED') assert.equal(line.status, 'CANCELLED', where);
          switch (line.status) {
            case 'AWAITING_PAYMENT':
            case 'PAID':
              if (line.mode === 'PRE_ORDER') {
                assert.equal(line.reservation, null, `${where}: a pre-order holds nothing`);
                break;
              }
              assert.equal(line.reservation, 'RESERVED', where);
              assert.equal(line.source, 'INVOICE_LINE', where);
              assert.equal(line.sold, 0n, `${where}: nothing is sold before the parcel leaves`);
              assert.equal(line.refunds, 0n, where);
              break;
            case 'SHIPPED':
              assert.ok(['RESERVED', 'CONSUMED'].includes(line.reservation ?? ''), where);
              assert.equal(line.refunds, 0n, where);
              break;
            case 'CANCELLED':
              assert.equal(line.reservation, 'RELEASED', where);
              assert.equal(line.sold, 0n, where);
              assert.ok(line.refunds <= 1n, `${where} is refunded at most once`);
              if (line.invoice_status === 'PAID') {
                assert.equal(line.refunds, 1n, `a cancelled paid line is refunded: ${where}`);
              }
              break;
            default:
              assert.fail(`${where}: unexpected status`);
          }
        }
        // Whatever happened, no invoice of the run has more than one effective credit for the same order code.
        const credits = await database.$queryRaw<{ invoice_id: string; n: bigint }[]>`
          SELECT p.invoice_id, count(*) AS n FROM payments p
          WHERE p.branch_id = ${ids.branch}::uuid AND p.status = 'SUCCEEDED' AND p.method = 'PAYOS'
          GROUP BY p.invoice_id HAVING count(*) > 1`;
        assert.deepEqual(credits, [], 'one PayOS credit per order');
      };

      await suite.test(
        'the same PayOS notification delivered twice at once: one credit, one paid transition, one event, the lines paid once',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const buyer = await member();
            const v = await variant(200_000, 5);
            const order = await placed(buyer, v, 2);
            const { code, body } = await withLink(buyer, order);
            const results = await race(
              () => webhook.receive(body),
              () => webhook.receive(body),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const invoice = await database.invoice.findUniqueOrThrow({
              where: { id: order.invoiceId },
            });
            assert.equal(invoice.status, 'PAID');
            assert.equal(invoice.paidSeq, 1);
            assert.equal(invoice.totalVnd, 400_000n);
            assert.equal(
              await database.payment.count({
                where: { invoiceId: order.invoiceId, status: 'SUCCEEDED' },
              }),
              1,
              'one credit',
            );
            assert.equal(await auditCount(order.invoiceId, 'INVOICE_PAID'), 1);
            assert.equal(await eventCount(order.invoiceId, 'INVOICE_PAID'), 1);
            assert.equal(
              await database.paymentProviderEvent.count({ where: { orderCode: BigInt(code) } }),
              1,
              'one inbox row',
            );
            const lines = await linesOf(order.id);
            assert.deepEqual(
              lines.map((line) => line.status),
              ['PAID'],
            );
            assert.equal(
              await database.productOrderEvent.count({
                where: { orderLineId: lines[0]!.id, toStatus: 'PAID' },
              }),
              1,
              'the line becomes paid once',
            );
            const level = await levelOf(v);
            assert.deepEqual([level.onHand, level.reserved], [5, 2]);
          }
          await audit();
        },
      );

      await suite.test(
        'the payment racing the automatic cancel after the deadline: one wins, a late payment is an anomaly, never both',
        async () => {
          const seen = new Set<string>();
          for (let round = 0; round < 8; round += 1) {
            const buyer = await member();
            const v = await variant(150_000, 3);
            const order = await placed(buyer, v, 1);
            const { body } = await withLink(buyer, order);
            await overdue(order.id);
            let cancelOutcome: OnlineCancelOutcome | undefined;
            const results = await race(
              () => webhook.receive(body),
              () =>
                withTransaction(async (tx) => {
                  cancelOutcome = await cancelUnpaidOnlineInvoice(tx, order.invoiceId, {
                    kind: 'TIMEOUT',
                    graceMs: 0,
                  });
                }),
            );
            assert.equal(outcome(results[1]!), 'OK', `round ${round}`);
            assert.ok(['OK'].includes(outcome(results[0]!)), `round ${round}: the webhook answers`);
            const invoice = await database.invoice.findUniqueOrThrow({
              where: { id: order.invoiceId },
            });
            const lines = await linesOf(order.id);
            const reservation = await database.stockReservation.findFirstOrThrow({
              where: { invoiceId: order.invoiceId },
            });
            const anomalies = await database.paymentAnomaly.findMany({
              where: { invoiceId: order.invoiceId },
            });
            const level = await levelOf(v);
            if (invoice.status === 'PAID') {
              seen.add('PAID');
              assert.notEqual(cancelOutcome, 'CANCELLED', 'a paid order is not cancelled');
              assert.equal(
                await database.payment.count({
                  where: { invoiceId: order.invoiceId, status: 'SUCCEEDED' },
                }),
                1,
              );
              assert.equal(await eventCount(order.invoiceId, 'INVOICE_PAID'), 1);
              assert.deepEqual(
                lines.map((line) => line.status),
                ['PAID'],
              );
              assert.equal(reservation.status, 'RESERVED');
              assert.deepEqual(anomalies, []);
              assert.equal(level.reserved, 1);
              assert.equal(invoice.cancelledAt, null);
            } else {
              seen.add('CANCELLED');
              assert.equal(invoice.status, 'CANCELLED');
              assert.equal(cancelOutcome, 'CANCELLED');
              assert.deepEqual(
                lines.map((line) => line.status),
                ['CANCELLED'],
              );
              assert.equal(reservation.status, 'RELEASED');
              assert.equal(reservation.releaseCause, 'INVOICE_CANCELLED_UNPAID');
              assert.equal(level.reserved, 0, 'a cancelled order holds no stock');
              assert.equal(await eventCount(order.invoiceId, 'INVOICE_PAID'), 0);
              assert.equal(anomalies.length, 1, 'the late payment is flagged for management');
              assert.equal(anomalies[0]!.kind, 'INVOICE_NOT_PAYABLE');
              assert.equal(anomalies[0]!.status, 'OPEN');
            }
          }
          assert.ok(seen.size >= 1);
          await audit();
        },
      );

      await suite.test(
        'the payment racing the worker sweep: the sweep reads the bank first, so an order that was paid is credited once and never cancelled',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const buyer = await member();
            const v = await variant(90_000, 2);
            const order = await placed(buyer, v, 1);
            const { body } = await withLink(buyer, order);
            await overdue(order.id);
            // The sweep of the worker, over a client whose transactions meet at the same latch as the webhook.
            const latched = {
              $queryRaw: database.$queryRaw.bind(database),
              payment: database.payment,
              $transaction: <T>(work: (tx: Prisma.TransactionClient) => Promise<T>) =>
                database.$transaction(
                  async (tx) => {
                    if (meet) await meet();
                    return work(tx);
                  },
                  { timeout: 30_000, maxWait: 10_000 },
                ),
            } as unknown as Parameters<typeof cancelOverdueOnlineOrders>[0];
            const results = await race(
              () => webhook.receive(body),
              () => cancelOverdueOnlineOrders(latched, simulator.provider, { graceMs: 0 }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const invoice = await database.invoice.findUniqueOrThrow({
              where: { id: order.invoiceId },
            });
            assert.equal(invoice.status, 'PAID', 'the bank said it was paid');
            assert.equal(invoice.paidSeq, 1);
            assert.equal(
              await database.payment.count({
                where: { invoiceId: order.invoiceId, status: 'SUCCEEDED' },
              }),
              1,
            );
            assert.equal(await eventCount(order.invoiceId, 'INVOICE_PAID'), 1);
            assert.equal(await eventCount(order.invoiceId, 'INVOICE_CANCELLED'), 0);
            assert.equal(
              await database.paymentAnomaly.count({ where: { invoiceId: order.invoiceId } }),
              0,
            );
            assert.deepEqual(
              (await linesOf(order.id)).map((line) => line.status),
              ['PAID'],
            );
          }
          await audit();
        },
      );

      await suite.test(
        'two buyers of the last unit: exactly one checkout succeeds, one reservation, nothing oversold',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const v = await variant(250_000, 1);
            const first = await member();
            const second = await member();
            await fill(first, v);
            await fill(second, v);
            const results = await race(
              () => online.place(first.token, checkout()),
              () => online.place(second.token, checkout()),
            );
            const codes = results.map(outcome);
            assert.equal(
              codes.filter((code) => code === 'OK').length,
              1,
              `round ${round}: one winner, got ${codes.join(',')}`,
            );
            const loser = codes.find((code) => code !== 'OK')!;
            assert.ok(
              ['PRODUCT_OUT_OF_STOCK', 'CART_NOT_READY'].includes(loser),
              `the loser is told the unit is gone, got ${loser}`,
            );
            const level = await levelOf(v);
            assert.deepEqual([level.onHand, level.reserved], [1, 1], 'reserved <= on hand');
            assert.equal(
              await database.stockReservation.count({
                where: { variantId: v, branchId: ids.branch, status: 'RESERVED' },
              }),
              1,
            );
            assert.equal(
              await database.productOrderLine.count({ where: { variantId: v } }),
              1,
              'one order line for the last unit',
            );
          }
          await audit();
        },
      );

      await suite.test(
        'two buyers of the last unit of a product that also sells on order: one gets the unit, the other a pre-order that holds nothing',
        async () => {
          for (let round = 0; round < 3; round += 1) {
            const v = await variant(250_000, 1, true);
            const first = await member();
            const second = await member();
            await fill(first, v);
            await fill(second, v);
            const results = await race(
              () => online.place(first.token, checkout()),
              () => online.place(second.token, checkout()),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            const modes = (
              await database.invoiceLineProduct.findMany({
                where: { variantId: v },
                select: { fulfilmentMode: true },
              })
            )
              .map((row) => row.fulfilmentMode)
              .sort();
            assert.deepEqual(modes, ['IN_STOCK', 'PRE_ORDER'], 'the unit is sold once');
            const level = await levelOf(v);
            assert.deepEqual([level.onHand, level.reserved], [1, 1]);
            assert.equal(
              await database.stockReservation.count({
                where: { variantId: v, branchId: ids.branch, status: 'RESERVED' },
              }),
              1,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'the staff cancel with a refund racing the shipping of the same line: exactly one wins',
        async () => {
          const seen = new Set<string>();
          for (let round = 0; round < 8; round += 1) {
            const refunder = await staff(true);
            const buyer = await member();
            const v = await variant(200_000, 4);
            const order = await placed(buyer, v, 1);
            const { body } = await withLink(buyer, order);
            await webhook.receive(body);
            const view = await online.staffOrder(worker.token, order.id);
            const line = view.lines[0]!;
            assert.equal(line.status, 'PAID');
            const results = await race(
              () =>
                online.ship(worker.token, order.id, {
                  lines: [{ id: line.id, rowVersion: line.rowVersion }],
                  carrierId: ids.carrier,
                  trackingCode: `VN${run}${round}`,
                  carrierFeeVnd: '35000',
                }),
              () =>
                online.cancelLine(refunder.token, line.id, {
                  expectedVersion: line.rowVersion,
                  cause: 'CUSTOMER_CANCELLED_BEFORE_ORDERING',
                  note: 'Khách liên hệ hủy đơn',
                  method: 'CASH',
                  bankReference: null,
                  clientRequestId: randomUUID(),
                }),
            );
            const codes = results.map(outcome);
            assert.equal(
              codes.filter((code) => code === 'OK').length,
              1,
              `round ${round}: exactly one wins, got ${codes.join(',')}`,
            );
            await runInventory();
            const [stored] = await linesOf(order.id);
            const level = await levelOf(v);
            const refunds = await database.productRefund.count({ where: { orderLineId: line.id } });
            const shipments = await database.onlineShipment.count({ where: { orderId: order.id } });
            const sales = await database.stockMovement.count({
              where: { kind: 'SALE', invoiceLine: { invoiceId: order.invoiceId } },
            });
            if (codes[0] === 'OK') {
              seen.add('SHIPPED');
              assert.equal(stored!.status, 'SHIPPED');
              assert.equal(refunds, 0, 'a shipped line is not refunded');
              assert.equal(shipments, 1);
              assert.equal(sales, 1, 'the sale of stock is written once, when it shipped');
              assert.deepEqual([level.onHand, level.reserved], [3, 0]);
            } else {
              seen.add('CANCELLED');
              assert.equal(stored!.status, 'CANCELLED');
              assert.equal(refunds, 1, 'refunded once');
              assert.equal(shipments, 0, 'nothing shipped');
              assert.equal(sales, 0, 'no sale of stock');
              assert.deepEqual(
                [level.onHand, level.reserved],
                [4, 0],
                'the unit is back on the shelf',
              );
              const reservation = await database.stockReservation.findFirstOrThrow({
                where: { invoiceId: order.invoiceId },
              });
              assert.equal(reservation.status, 'RELEASED');
            }
          }
          assert.ok(seen.size >= 1);
          await audit();
        },
      );

      await suite.test(
        'one account at the limit of unpaid orders: a second checkout at once never passes it; the same request twice is one order',
        async () => {
          const settings = await database.onlineSalesSettings.findUniqueOrThrow({
            where: { id: 1 },
          });
          const limit = settings.maxUnpaidOrders;
          const v = await variant(60_000, 20);
          const buyer = await member();
          for (let n = 0; n < limit - 1; n += 1) await placed(buyer, v, 1);
          const unpaid = () =>
            database.productOrder.count({
              where: { customerUserId: buyer.id, invoice: { status: 'PENDING_PAYMENT' } },
            });
          assert.equal(await unpaid(), limit - 1);
          // Two different requests from the same account at once, each with the same cart.
          await fill(buyer, v);
          const results = await race(
            () => online.place(buyer.token, checkout()),
            () => online.place(buyer.token, checkout()),
          );
          const codes = results.map(outcome);
          assert.equal(codes.filter((code) => code === 'OK').length, 1, `got ${codes.join(',')}`);
          assert.ok(
            ['CART_EMPTY', 'ONLINE_UNPAID_LIMIT', 'CART_NOT_READY'].includes(
              codes.find((code) => code !== 'OK')!,
            ),
          );
          assert.equal(await unpaid(), limit, 'at the limit, never beyond it');
          // At the limit a further checkout is refused whatever the timing.
          await fill(buyer, v);
          await assert.rejects(
            () => online.place(buyer.token, checkout()),
            (error: unknown) => error instanceof AuthError && error.code === 'ONLINE_UNPAID_LIMIT',
          );
          assert.equal(await unpaid(), limit);
          // The same checkout request twice at once (a double click): one order.
          const other = await member();
          await fill(other, v);
          const request = checkout();
          const both = await race(
            () => online.place(other.token, request),
            () => online.place(other.token, request),
          );
          assert.deepEqual(both.map(outcome), ['OK', 'OK']);
          const [a, b] = both as [
            PromiseFulfilledResult<{ id: string }>,
            PromiseFulfilledResult<{ id: string }>,
          ];
          assert.equal(a.value.id, b.value.id, 'the repeated request returns the same order');
          assert.equal(
            await database.productOrder.count({ where: { customerUserId: other.id } }),
            1,
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
            const invoiceLineRows = (
              await tx.invoiceLine.findMany({
                where: { invoiceId: { in: invoiceRows } },
                select: { id: true },
              })
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
            const shipmentRows = (
              await tx.onlineShipment.findMany({
                where: { orderId: { in: orderRows } },
                select: { id: true },
              })
            ).map((row) => row.id);
            const cartRows = (
              await tx.onlineCart.findMany({
                where: { userId: { in: memberIds } },
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
              where: {
                OR: [
                  { branchId: ids.branch },
                  { actorUserId: { in: userIds } },
                  { subjectUserId: { in: userIds } },
                ],
              },
            });
            await tx.refundReauthenticationUse.deleteMany({
              where: { productRefundId: { in: refundRows } },
            });
            await tx.productRefund.deleteMany({ where: { id: { in: refundRows } } });
            await tx.onlineShipmentCorrection.deleteMany({
              where: { shipmentId: { in: shipmentRows } },
            });
            await tx.onlineShipment.deleteMany({ where: { id: { in: shipmentRows } } });
            await tx.onlineAddressCorrection.deleteMany({ where: { orderId: { in: orderRows } } });
            await tx.onlineOrderLog.deleteMany({ where: { orderId: { in: orderRows } } });
            await tx.onlineFailedDeliverySettlement.deleteMany({
              where: { orderId: { in: orderRows } },
            });
            await tx.onlineOrderScan.deleteMany({ where: { branchId: ids.branch } });
            await tx.onlineOrderDetail.deleteMany({ where: { orderId: { in: orderRows } } });
            await tx.onlineCartLine.deleteMany({ where: { cartId: { in: cartRows } } });
            await tx.onlineCart.deleteMany({ where: { id: { in: cartRows } } });
            await tx.customerAddress.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.shippingCarrier.deleteMany({ where: { id: ids.carrier } });
            await tx.productOrderEvent.deleteMany({
              where: { orderLineId: { in: orderLineRows } },
            });
            await tx.productOrderTicket.deleteMany({ where: { orderId: { in: orderRows } } });
            await tx.productOrderLine.deleteMany({ where: { id: { in: orderLineRows } } });
            await tx.productOrder.deleteMany({ where: { id: { in: orderRows } } });
            await tx.paymentAnomaly.deleteMany({ where: { invoiceId: { in: invoiceRows } } });
            await tx.paymentProviderEvent.deleteMany({
              where: { orderCode: { in: orderCodes.map((code) => BigInt(code)) } },
            });
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
            await tx.invoiceLine.deleteMany({ where: { id: { in: invoiceLineRows } } });
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
            await tx.customerProfile.deleteMany({ where: { userId: { in: memberIds } } });
            await tx.user.deleteMany({ where: { id: { in: userIds } } });
            // The one settings row is put back exactly as it was, before the branch it pointed at goes away.
            if (originalSettings) {
              await tx.onlineSalesSettings.update({
                where: { id: 1 },
                data: {
                  enabled: originalSettings.enabled,
                  fulfilmentBranchId: originalSettings.fulfilmentBranchId,
                  rowVersion: originalSettings.rowVersion,
                },
              });
            }
            await tx.branch.deleteMany({ where: { id: ids.branch } });
          },
          { timeout: 60_000 },
        );
        assert.equal(await database.invoice.count({ where: { branchId: ids.branch } }), 0);
        assert.equal(await database.branch.count({ where: { id: ids.branch } }), 0);
        assert.equal(await database.product.count({ where: { id: { in: productIds } } }), 0);
        assert.equal(await database.user.count({ where: { id: { in: userIds } } }), 0);
        const restored = await database.onlineSalesSettings.findUniqueOrThrow({ where: { id: 1 } });
        assert.equal(restored.enabled, originalSettings?.enabled);
        assert.equal(restored.fulfilmentBranchId, originalSettings?.fulfilmentBranchId);
      } finally {
        await database.$disconnect();
      }
    }
  },
);

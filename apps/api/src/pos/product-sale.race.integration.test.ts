import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, syncPermissionCatalog, type Prisma } from '@lucy-spa/database';
import { createPayosSimulator, parseApiEnvironment } from '@lucy-spa/server';
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
 * Phase 6 P6-8 races on separate committed PostgreSQL connections with real production service calls (the same latch as the
 * Phase 4 races: it releases only after both transactions hold the shared auth-graph lock; every other lock is taken by production
 * code). Whatever the interleaving, no unit is sold twice, no reservation leaks or disappears, and the invoice and stock invariants
 * of the Owner's reconciliation rules hold afterwards (`audit`). Requires an explicitly opted-in local validation database
 * (replica-role cleanup of permanent financial history); cleanup is bounded to this invocation's exact UUIDs.
 */
test(
  'Phase 6 P6-8 PostgreSQL races keep stock, reservations and payments consistent',
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
      };

      await suite.test(
        'two cashiers finalize invoices for the last unit at once: one sells it, the other is refused out of stock',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 1);
            const first = await draftWith(a, [[v, 1]]);
            const second = await draftWith(b, [[v, 1]]);
            const results = await race(
              () => invoices.finalize(a.token, first.id, { expectedVersion: first.version }),
              () => invoices.finalize(b.token, second.id, { expectedVersion: second.version }),
            );
            assert.deepEqual(
              results.map(outcome).sort(),
              ['OK', 'PRODUCT_OUT_OF_STOCK'],
              `round ${round}`,
            );
            assert.deepEqual(await levelOf(v).then((l) => [l.onHand, l.reserved]), [1, 1]);
            const winners = await database.stockReservation.count({
              where: { variantId: v, status: 'RESERVED' },
            });
            assert.equal(winners, 1);
            const loser = results[0]!.status === 'fulfilled' ? second.id : first.id;
            assert.equal(
              (await database.invoice.findUniqueOrThrow({ where: { id: loser } })).status,
              'DRAFT',
            );
            assert.equal((await reservationsOf(loser)).length, 0);
          }
          await audit();
        },
      );

      await suite.test(
        'one draft finalized twice at once: one reservation per line, one audit, one event',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const v = await variant(80_000, 5);
            const draft = await draftWith(a, [[v, 2]]);
            const results = await race(
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
            );
            const codes = results.map(outcome);
            assert.ok(codes.includes('OK'), codes.join());
            assert.ok(
              codes.every((code) => ['OK', 'CONFLICT', 'INVOICE_STATE_INVALID'].includes(code)),
              codes.join(),
            );
            assert.equal((await reservationsOf(draft.id)).length, 1);
            assert.equal((await levelOf(v)).reserved, 2);
            assert.equal(await auditCount(draft.id, 'INVOICE_FINALIZED'), 1);
            assert.equal(await eventCount(draft.id, 'INVOICE_FINALIZED'), 1);
          }
          await audit();
        },
      );

      await suite.test(
        'finalize against cancel of the same draft: the invoice ends finalized with its stock held, or cancelled with none',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 3);
            const draft = await draftWith(a, [[v, 2]]);
            const results = await race(
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              () =>
                invoices.cancel(boss.token, draft.id, {
                  expectedVersion: draft.version,
                  reason: 'Khách đổi ý',
                }),
            );
            const [finalize, cancel] = results.map(outcome);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: draft.id } });
            const reservations = await reservationsOf(draft.id);
            if (stored.status === 'CANCELLED') {
              assert.notEqual(finalize, 'OK', `${finalize}/${cancel}`);
              assert.equal(cancel, 'OK');
              assert.ok(reservations.every((reservation) => reservation.status === 'RELEASED'));
              assert.equal((await levelOf(v)).reserved, 0);
            } else {
              assert.equal(finalize, 'OK');
              assert.equal(stored.status, 'PENDING_PAYMENT');
              assert.ok(
                ['CONFLICT', 'INVOICE_STATE_INVALID', 'REAUTHENTICATION_REQUIRED'].includes(
                  cancel!,
                ),
                cancel,
              );
              assert.equal(reservations.length, 1);
              assert.equal(reservations[0]!.status, 'RESERVED');
              assert.equal((await levelOf(v)).reserved, 2);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'finalized and then cancelled while another cashier takes the freed unit at once',
        async () => {
          for (let round = 0; round < 4; round += 1) {
            const v = await variant(80_000, 1);
            const held = await finalized([[v, 1]]);
            const waiting = await draftWith(b, [[v, 1]]);
            const results = await race(
              () =>
                invoices.cancel(boss.token, held.id, {
                  expectedVersion: held.version,
                  reason: 'Khách đổi ý',
                }),
              () => invoices.finalize(b.token, waiting.id, { expectedVersion: waiting.version }),
            );
            const [cancel, take] = results.map(outcome);
            assert.equal(cancel, 'OK');
            // The second cashier either ran before the release (out of stock) or after it (takes the unit); never both holding it.
            assert.ok(['OK', 'PRODUCT_OUT_OF_STOCK'].includes(take!), String(take));
            assert.equal((await levelOf(v)).reserved, take === 'OK' ? 1 : 0);
            assert.equal(
              await database.stockReservation.count({
                where: { variantId: v, status: 'RESERVED' },
              }),
              take === 'OK' ? 1 : 0,
            );
          }
          await audit();
        },
      );

      await suite.test(
        'two cashiers pay the same product invoice in full at once: one payment, one paid episode, stock still held',
        async () => {
          for (let round = 0; round < 5; round += 1) {
            const v = await variant(80_000, 2);
            const invoice = await finalized([[v, 1]]);
            const results = await race(
              () => pay(a, invoice.id, 80_000),
              () => pay(b, invoice.id, 80_000),
            );
            const codes = results.map(outcome).sort();
            assert.equal(codes.filter((code) => code === 'OK').length, 1, codes.join());
            assert.ok(
              codes.every((code) =>
                ['OK', 'PAYMENT_AMOUNT_INVALID', 'CONFLICT', 'INVOICE_STATE_INVALID'].includes(
                  code,
                ),
              ),
              codes.join(),
            );
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            assert.equal(stored.status, 'PAID');
            assert.equal(stored.paidSeq, 1);
            assert.equal(await effective(invoice.id), 80_000n);
            assert.equal(await eventCount(invoice.id, 'INVOICE_PAID'), 1);
            assert.deepEqual(
              (await reservationsOf(invoice.id)).map((reservation) => reservation.status),
              ['RESERVED'],
            );
            assert.equal((await levelOf(v)).reserved, 1);
          }
          await audit();
        },
      );

      await suite.test(
        'payment against cancellation of the same unpaid invoice: either it is paid and stays, or cancelled and released',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 1);
            const invoice = await finalized([[v, 1]]);
            const results = await race(
              () => pay(a, invoice.id, 80_000),
              () =>
                invoices.cancel(boss.token, invoice.id, {
                  expectedVersion: invoice.version,
                  reason: 'Khách đổi ý',
                }),
            );
            const [payment, cancel] = results.map(outcome);
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            if (stored.status === 'CANCELLED') {
              assert.equal(cancel, 'OK');
              assert.notEqual(payment, 'OK');
              assert.equal(await effective(invoice.id), 0n);
              assert.equal((await levelOf(v)).reserved, 0);
            } else {
              assert.equal(payment, 'OK');
              assert.equal(stored.status, 'PAID');
              assert.notEqual(cancel, 'OK');
              assert.equal((await levelOf(v)).reserved, 1);
            }
          }
          await audit();
        },
      );

      let slot = 0;
      /** A COMPLETED visit with one performed service of 100,000 VND, committed (for the mixed invoice). */
      const completedVisit = () =>
        database.$transaction(async (tx) => {
          const start = new Date(Date.parse('2027-03-01T06:00:00+07:00') + 10 * 60_000 * slot++);
          const visit = await tx.visit.create({
            data: {
              code: `PSR-${run}-${++serial}`,
              branchId: ids.branch,
              origin: 'WALK_IN',
              serviceDate: new Date('2027-03-01T00:00:00.000Z'),
              arrivedAt: new Date('2027-03-01T05:30:00+07:00'),
              createdByUserId: a.id,
              idempotencyKey: randomUUID(),
            },
          });
          const participant = await tx.visitParticipant.create({
            data: { visitId: visit.id, kind: 'GUEST', displayName: 'Race guest' },
          });
          const line = await tx.visitServiceLine.create({
            data: {
              visitId: visit.id,
              participantId: participant.id,
              sequence: 1,
              serviceId: ids.service,
              employeeUserId: ktv.id,
              assignmentMode: 'ANY',
              plannedStartAt: start,
              plannedEndAt: new Date(start.getTime() + 10 * 60_000),
              durationMinutes: 10,
              bufferMinutes: 0,
              serviceCode: `PSR_SVC_${run}`,
              serviceNameVi: 'Race',
              serviceNameEn: 'Race',
              catalogPriceMinVnd: 100_000n,
              catalogPriceMaxVnd: 100_000n,
              catalogPricingUnit: 'PER_SERVICE',
            },
          });
          const started = new Date('2027-03-01T06:00:00+07:00');
          await tx.visitServiceLine.update({
            where: { id: line.id },
            data: { status: 'IN_PROGRESS', rowVersion: { increment: 1 } },
          });
          await tx.visit.update({
            where: { id: visit.id },
            data: { status: 'IN_SERVICE', rowVersion: { increment: 1 } },
          });
          const execution = await tx.serviceExecution.create({
            data: {
              visitServiceLineId: line.id,
              employeeUserId: ktv.id,
              startedAt: started,
              expectedEndAt: new Date(started.getTime() + 10 * 60_000),
            },
          });
          await tx.serviceExecution.update({
            where: { id: execution.id },
            data: {
              status: 'ENDED',
              endedAt: new Date(started.getTime() + 10 * 60_000),
              endKind: 'NORMAL',
              endedByUserId: ktv.id,
              rowVersion: { increment: 1 },
            },
          });
          await tx.visitServiceLine.update({
            where: { id: line.id },
            data: { status: 'DONE', rowVersion: { increment: 1 } },
          });
          await tx.visit.update({
            where: { id: visit.id },
            data: {
              status: 'COMPLETED',
              completedAt: new Date('2027-03-01T07:00:00+07:00'),
              rowVersion: { increment: 1 },
            },
          });
          return visit.id;
        });

      const payos = (actor: { token: string }, invoiceId: string, amount: number) =>
        invoices.createPayos(actor.token, invoiceId, {
          amountVnd: String(amount),
          idempotencyKey: randomUUID(),
        });
      const orderOf = async (paymentId: string) =>
        Number(
          (await database.payment.findUniqueOrThrow({ where: { id: paymentId } }))
            .providerOrderCode,
        );

      await suite.test(
        'a PayOS notification against the reversal of the cash payment on a MIXED invoice: the stock hold and the paid episodes stay exact',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(100_000, 2);
            const visitId = await completedVisit();
            const opened = (await invoices.open(a.token, visitId)).invoice;
            const mixedDraft = await invoices.addProductLine(a.token, opened.id, {
              expectedVersion: opened.version,
              variantId: v,
              quantity: 1,
            });
            const invoice = await invoices.finalize(a.token, mixedDraft.id, {
              expectedVersion: mixedDraft.version,
            });
            assert.equal(invoice.status, 'PENDING_PAYMENT');
            assert.equal(invoice.totalVnd, '200000');
            const cash = await pay(a, invoice.id, 80_000);
            const made = await payos(a, invoice.id, 120_000);
            const body = simulator.pay(await orderOf(made.payment.id));
            const results = await race(
              () => webhook.receive(body),
              () =>
                invoices.reversePayment(boss.token, invoice.id, cash.payment.id, {
                  reason: 'Nhập nhầm',
                }),
            );
            const [notification, reversal] = results.map(outcome);
            assert.equal(notification, 'OK');
            assert.equal(reversal, 'OK');
            const stored = await database.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
            // The cash is reversed, the transfer stands: 120,000 of 200,000, so the invoice is waiting for payment again.
            assert.equal(await effective(invoice.id), 120_000n);
            assert.equal(stored.status, 'PENDING_PAYMENT');
            // The paid episode counter, the PAID events and the reopen events agree whichever came first.
            assert.equal(await eventCount(invoice.id, 'INVOICE_PAID'), stored.paidSeq);
            assert.equal(await eventCount(invoice.id, 'INVOICE_REOPENED'), stored.paidSeq);
            assert.ok(stored.paidSeq <= 1);
            assert.deepEqual(
              (await reservationsOf(invoice.id)).map((reservation) => reservation.status),
              ['RESERVED'],
            );
            assert.equal((await levelOf(v)).reserved, 1);
          }
          await audit();
        },
      );

      await suite.test(
        'an adjustment racing a finalization over the same stock: the unit is sold or written off, never both',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const v = await variant(80_000, 2);
            const draft = await draftWith(a, [[v, 2]]);
            const lot = await database.inventoryLot.findFirstOrThrow({
              where: { branchId: ids.branch, variantId: v },
            });
            const results = await race(
              () => invoices.finalize(a.token, draft.id, { expectedVersion: draft.version }),
              () =>
                inventory.adjust(b.token, {
                  requestKey: randomUUID(),
                  branchId: ids.branch,
                  variantId: v,
                  lotId: lot.id,
                  quantity: 1,
                  reason: 'LOSS',
                  note: null,
                }),
            );
            const [finalize, adjust] = results.map(outcome);
            const level = await levelOf(v);
            if (finalize === 'OK') {
              assert.equal(adjust, 'INVENTORY_STOCK_RESERVED', `${finalize}/${adjust}`);
              assert.deepEqual([level.onHand, level.reserved], [2, 2]);
            } else {
              assert.equal(finalize, 'PRODUCT_OUT_OF_STOCK', `${finalize}/${adjust}`);
              assert.equal(adjust, 'OK');
              assert.deepEqual([level.onHand, level.reserved], [1, 0]);
            }
          }
          await audit();
        },
      );

      await suite.test(
        'invoices that take the same two variants in opposite order never deadlock',
        async () => {
          for (let round = 0; round < 6; round += 1) {
            const x = await variant(80_000, 10);
            const y = await variant(90_000, 10);
            const first = await draftWith(a, [
              [x, 1],
              [y, 1],
            ]);
            const second = await draftWith(b, [
              [y, 2],
              [x, 2],
            ]);
            const results = await race(
              () => invoices.finalize(a.token, first.id, { expectedVersion: first.version }),
              () => invoices.finalize(b.token, second.id, { expectedVersion: second.version }),
            );
            assert.deepEqual(results.map(outcome), ['OK', 'OK'], `round ${round}`);
            assert.equal((await levelOf(x)).reserved, 3);
            assert.equal((await levelOf(y)).reserved, 3);
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

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  exchangeAmounts,
  productRefundAmount,
  type DiscountVersionInput,
  type ProductExchangePreviewResponse,
  type ProductExchangeResponse,
  type ProductExchangeSummaryResponse,
} from '@lucy-spa/contracts';
import {
  appendLedgerEntry,
  LocalDiskMediaStorage,
  createPayosSimulator,
  LOYALTY_EVENT_TYPES,
  processFinancialNotificationEvent,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { pino } from 'pino';
import { DiscountService } from '../discounts/discount.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { customerInvoiceDetail } from '../pos/customer-invoice.core.js';
import { InvoiceService } from '../pos/invoice.service.js';
import { PayosWebhookService } from '../pos/payos.webhook.js';
import { ProductExchangeService } from './exchange.service.js';
import { ProductRefundService } from './refund.service.js';
import { ProductReturnService } from './return.service.js';

/**
 * Phase 6 P6-14 against real PostgreSQL (design 8.5; OQ-24, OQ-82, OQ-80, PRD 28.5): exchanges of a returned product line. An exchange
 * follows a return case accepted as an exchange. The customer gives back the units of the case and takes the same number of units of
 * ONE replacement item that is in stock, on a NEW invoice whose only benefit is the exchange credit (what the customer paid for the
 * returned units). More expensive: the difference is an ordinary payment of that invoice. Cheaper: the difference is handed back by
 * cash or manual transfer under the refund rules (REFUND_PRODUCTS, a password confirmation used once, the Owner told in-app). Beauty
 * points: the original points stay, points are earned only on the difference actually paid, nothing is taken back. The returned goods
 * are taken in like a refund (sellable: a new lot keeping the expiry, otherwise no stock moves). Refunds and exchanges share one
 * cumulative sequence on the line, so the money of all of them adds up to the net exactly. Fixtures roll back.
 */
test(
  'Phase 6 P6-14 exchanges: money, stock, Beauty points, shared claims, T22, immutability, reconciliation; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-exchanges-'));
    try {
      await phase6Fixture(async (base) => {
        const k = await productSaleKit(base);
        const { tx, fails } = base;
        const { A, B, invoices, people } = k;
        const returns = new ProductReturnService(
          base.adapter,
          base.throttle,
          new LocalDiskMediaStorage(folder),
          pino({ level: 'silent' }),
        );
        const strictExchanges = new ProductExchangeService(
          base.adapter,
          base.throttle,
          base.environment,
        );
        const refunds = new ProductRefundService(base.adapter, base.throttle, base.environment);
        const programs = new DiscountService(base.adapter, base.throttle);
        const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
        const approver = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
        const elsewhere = await base.staff(['REFUND_PRODUCTS'], { branchId: B.id });
        const owner = people.owner;

        /** Gives a person a NEW password confirmation, as the screen's password dialog does (one confirmation covers one exchange). */
        const confirmAgain = async (token: string) => {
          const principal = await base.adapter.resolve(token);
          assert.ok(principal?.userId, 'a signed-in person');
          await tx.$executeRawUnsafe('SELECT pg_sleep(0.003)');
          await tx.$executeRawUnsafe('SAVEPOINT confirm');
          try {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(
              `UPDATE sessions SET reauthenticated_at = date_trunc('milliseconds', clock_timestamp()) WHERE user_id = '${principal.userId}'`,
            );
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT confirm');
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT confirm');
            throw error;
          }
        };
        const exchanges = {
          summary: strictExchanges.summary.bind(strictExchanges),
          options: strictExchanges.options.bind(strictExchanges),
          preview: strictExchanges.preview.bind(strictExchanges),
          complete: strictExchanges.complete.bind(strictExchanges),
          correctReference: strictExchanges.correctReference.bind(strictExchanges),
          exchange: async (...args: Parameters<ProductExchangeService['exchange']>) => {
            const [token] = args;
            if (token !== undefined) await confirmAgain(token);
            return strictExchanges.exchange(...args);
          },
        };
        const confirmedRefund = async (...args: Parameters<ProductRefundService['refund']>) => {
          await confirmAgain(args[0]!);
          return refunds.refund(...args);
        };

        let customers = 0;
        const member = async (beauty: number) => {
          const created = await k.customer(`ex${++customers}`);
          if (beauty !== 0) {
            await appendLedgerEntry(tx, {
              userId: created.id,
              wallet: 'BEAUTY',
              kind: 'MANUAL_ADJUSTMENT',
              points: beauty,
              idempotencyKey: randomUUID(),
              reason: 'P6-14 fixture',
              actorUserId: owner.id,
            });
          }
          return created;
        };
        const balance = async (userId: string) =>
          (
            await tx.loyaltyWalletAccount.findUnique({
              where: { userId_wallet: { userId, wallet: 'BEAUTY' } },
            })
          )?.balancePoints ?? 0;
        const consumeInvoice = async (invoiceId: string) => {
          const events = await tx.outboxEvent.findMany({
            where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          });
          for (const event of events) {
            await processLoyaltyEvent(tx, event.id);
            await k.settle();
          }
        };
        const notices = (userId: string, caseId?: string) =>
          tx.notification.findMany({
            where: {
              recipientUserId: userId,
              type: 'PRODUCT_REFUND_MADE',
              ...(caseId ? { entityId: caseId } : {}),
            },
          });

        let saleNo = 0;
        /** A paid counter sale of `quantity` units at `price`; the stock sale and the earn entry are recorded. */
        const sale = async (
          options: { quantity?: number; price?: number; payer?: string | null } = {},
        ) => {
          const { quantity = 3, price = 100_000, payer = null } = options;
          saleNo += 1;
          const product = await k.product(`ex${saleNo}`, [price]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, quantity + 5);
          const invoice = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, payer), variant.id, quantity),
          );
          await k.pay(invoice.id, Number(invoice.totalVnd));
          const view = await invoices.get(people.cashier.token, invoice.id);
          await k.runInventory(invoice.id);
          await consumeInvoice(invoice.id);
          return {
            invoiceId: invoice.id,
            code: invoice.code,
            lineId: view.productLines[0]!.id,
            variantId: variant.id,
            sku: variant.sku,
            total: BigInt(invoice.totalVnd),
            quantity,
            payer,
          };
        };
        type Sale = Awaited<ReturnType<typeof sale>>;
        /** A fresh item in stock at a price (the replacement). */
        let itemNo = 0;
        const item = async (price: number, stock = 10) => {
          itemNo += 1;
          const product = await k.product(`it${itemNo}`, [price]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, stock);
          return variant;
        };
        const accepted = async (
          s: Sale,
          options: { quantity?: number; outcome?: 'REFUND' | 'EXCHANGE' } = {},
        ) => {
          const opened = await k.ok(() =>
            returns.open(clerk.token, {
              branchId: A.id,
              invoiceLineId: s.lineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'EXCHANGE',
              quantity: options.quantity ?? s.quantity,
              sealIntact: true,
              notes: null,
              clientRequestId: randomUUID(),
            }),
          );
          return k.ok(() =>
            returns.accept(approver.token, opened.id, {
              expectedRowVersion: opened.rowVersion,
              outcome: options.outcome ?? 'EXCHANGE',
              note: null,
            }),
          );
        };
        const previewOf = (c: { id: string }, variantId: string, actor = approver) =>
          exchanges.preview(actor.token, c.id, variantId);
        const bodyFor = (
          preview: ProductExchangePreviewResponse,
          patch: Record<string, unknown> = {},
        ) => ({
          variantId: preview.option.variantId,
          expectedPayableVnd: preview.payableVnd,
          expectedRefundVnd: preview.refundVnd,
          restock: preview.payableVnd === '0' ? ('SELLABLE' as const) : null,
          refundMethod: preview.refundVnd === '0' ? null : ('CASH' as const),
          bankReference: null,
          sellerUserId: null,
          reason: 'Khách đổi hàng tại quầy',
          clientRequestId: randomUUID(),
          ...patch,
        });
        /** Previews and then makes the exchange, as the screen does. */
        const exchangeNow = async (
          actor: { token: string },
          c: { id: string },
          variantId: string,
          patch: Record<string, unknown> = {},
        ) => {
          const preview = await previewOf(c, variantId);
          return k.ok(() =>
            exchanges.exchange(actor.token, c.id, bodyFor(preview, patch) as never),
          );
        };
        const last = (summary: ProductExchangeSummaryResponse): ProductExchangeResponse =>
          summary.exchanges.at(-1)!;
        const invoiceRow = (id: string) =>
          tx.invoice.findUniqueOrThrow({
            where: { id },
            include: { lines: { include: { allocations: true } }, payments: true },
          });
        const claimed = (lineId: string) =>
          tx.$queryRaw<
            { claimed_units: number; claimed_vnd: bigint }[]
          >`SELECT claimed_units, claimed_vnd FROM lucy_line_claims(${lineId}::uuid)`.then(
            (rows) => rows[0]!,
          );
        const raw = async (sql: string, settle = false) => {
          await tx.$executeRawUnsafe('SAVEPOINT guard');
          try {
            await tx.$executeRawUnsafe(sql);
            if (settle) await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
            return error;
          }
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT guard');
          return null;
        };
        /** The table's own CHECK constraints only: the row guard is switched off (replica role) for the statement. */
        const refusesShape = async (sql: string, why: RegExp) => {
          await tx.$executeRawUnsafe('SAVEPOINT shape');
          let error: unknown = null;
          try {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(sql);
          } catch (caught) {
            error = caught;
          }
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT shape');
          assert.ok(error, `must be refused: ${sql}`);
          assert.match(String((error as Error).message), why);
        };
        const refuses = async (sql: string, why: RegExp, settle = false) => {
          const error = await raw(sql, settle);
          assert.ok(error, `must be refused: ${sql}`);
          assert.match(String((error as Error).message), why);
        };

        /** The Owner's reconciliation rules for exchanges, after every step. */
        const reconcileExchanges = async () => {
          await k.reconcile();
          const rows = await tx.productExchange.findMany({
            where: { branchId: { in: [A.id, B.id] } },
            include: {
              exchangeInvoice: { include: { lines: { include: { allocations: true } } } },
              completion: true,
            },
          });
          for (const row of rows) {
            const swap = row.exchangeInvoice;
            // The invoice of the exchange: the replacement price less the credit, and the customer pays the rest.
            assert.equal(swap.subtotalVnd, row.replacementGrossVnd);
            assert.equal(swap.discountTotalVnd, row.appliedCreditVnd);
            assert.equal(swap.totalVnd, row.payableVnd);
            const nets = swap.lines
              .flatMap((line) => line.allocations)
              .reduce((s, a) => s + a.netVnd, 0n);
            assert.equal(nets, row.payableVnd, 'line nets add up to what the customer pays');
            assert.ok(
              row.refundVnd >= 0n &&
                row.appliedCreditVnd <=
                  row.creditVnd + (row.rule === 'SAME_ITEM' ? row.replacementGrossVnd : 0n),
            );
            if (row.rule === 'PRICE_DIFFERENCE') {
              assert.equal(
                row.appliedCreditVnd + row.refundVnd,
                row.creditVnd,
                'credit = applied + handed back',
              );
            }
            if (row.payableVnd === 0n)
              assert.ok(row.completion, 'nothing to pay: completed in the same step');
          }
          // One sequence per line: refunds and active exchanges never claim more than was sold or paid.
          const lines = await tx.$queryRaw<
            { line: string; units: bigint; vnd: bigint; sold: number; net: bigint }[]
          >`
            SELECT l.id AS line, c.claimed_units::bigint AS units, c.claimed_vnd AS vnd, l.quantity AS sold, a.net_vnd AS net
            FROM invoice_lines l
            JOIN invoice_line_allocations a ON a.invoice_line_id = l.id
            CROSS JOIN LATERAL lucy_line_claims(l.id) c
            WHERE l.invoice_id IN (SELECT invoice_id FROM product_refunds WHERE branch_id IN (${A.id}::uuid, ${B.id}::uuid)
                                   UNION SELECT invoice_id FROM product_exchanges WHERE branch_id IN (${A.id}::uuid, ${B.id}::uuid))`;
          for (const line of lines) {
            assert.ok(line.units <= BigInt(line.sold), `units claimed of ${line.line}`);
            assert.ok(line.vnd <= line.net, `money claimed of ${line.line}`);
            if (line.units === BigInt(line.sold))
              assert.equal(line.vnd, line.net, 'a fully claimed line claimed its net');
          }
          const [stock] = await tx.$queryRaw<{ expected: bigint; returned: bigint }[]>`
            SELECT COALESCE((SELECT SUM(x.quantity) FROM product_exchanges x
                              JOIN product_exchange_completions c ON c.exchange_id = x.id
                              WHERE c.restock = 'SELLABLE' AND x.branch_id IN (${A.id}::uuid, ${B.id}::uuid)), 0)::bigint AS expected,
                   COALESCE((SELECT SUM(quantity_delta) FROM stock_movements WHERE kind = 'EXCHANGE_RETURN'
                              AND branch_id IN (${A.id}::uuid, ${B.id}::uuid)), 0)::bigint AS returned`;
          assert.equal(
            stock!.returned,
            stock!.expected,
            'sellable units exchanged = units put back',
          );
          const wallets = await tx.loyaltyWalletAccount.findMany({
            select: { userId: true, wallet: true, balancePoints: true },
          });
          for (const wallet of wallets) {
            const sum = await tx.loyaltyLedgerEntry.aggregate({
              where: { userId: wallet.userId, wallet: wallet.wallet },
              _sum: { points: true },
            });
            assert.equal(wallet.balancePoints, sum._sum.points ?? 0, `balance of ${wallet.wallet}`);
          }
        };

        // ------------------------------------------------------------------------------ before go-live
        await tx.loyaltyGoLive.create({ data: { activatedByUserId: owner.id } });
        await reconcileExchanges();

        await suite.test('the figures: one rule in one place (OQ-82), integer VND', () => {
          // More expensive: the customer pays the difference; cheaper: it is handed back; equal: nothing.
          assert.deepEqual(
            exchangeAmounts({
              creditVnd: 500_000n,
              replacementGrossVnd: 600_000n,
              sameItem: false,
            }),
            {
              rule: 'PRICE_DIFFERENCE',
              creditVnd: 500_000n,
              replacementGrossVnd: 600_000n,
              appliedCreditVnd: 500_000n,
              payableVnd: 100_000n,
              refundVnd: 0n,
            },
          );
          assert.deepEqual(
            exchangeAmounts({
              creditVnd: 500_000n,
              replacementGrossVnd: 400_000n,
              sameItem: false,
            }),
            {
              rule: 'PRICE_DIFFERENCE',
              creditVnd: 500_000n,
              replacementGrossVnd: 400_000n,
              appliedCreditVnd: 400_000n,
              payableVnd: 0n,
              refundVnd: 100_000n,
            },
          );
          assert.deepEqual(
            exchangeAmounts({ creditVnd: 270_000n, replacementGrossVnd: 270_000n, sameItem: false })
              .payableVnd,
            0n,
          );
          // The worked example of OQ-82: paid 270,000 for the old line, the new item lists at 350,000.
          assert.equal(
            exchangeAmounts({ creditVnd: 270_000n, replacementGrossVnd: 350_000n, sameItem: false })
              .payableVnd,
            80_000n,
          );
          // The same item: no difference, whatever today's price is.
          const same = exchangeAmounts({
            creditVnd: 270_000n,
            replacementGrossVnd: 350_000n,
            sameItem: true,
          });
          assert.equal(same.payableVnd, 0n);
          assert.equal(same.refundVnd, 0n);
          assert.equal(same.appliedCreditVnd, 350_000n);
          assert.throws(() =>
            exchangeAmounts({ creditVnd: -1n, replacementGrossVnd: 1n, sameItem: false }),
          );
        });

        await suite.test(
          'only REFUND_PRODUCTS at the invoice branch exchanges or reads exchanges; the case must be accepted as an exchange',
          async () => {
            const s = await sale();
            const c = await accepted(s, { quantity: 2 });
            const swap = await item(100_000);
            for (const actor of [clerk, elsewhere, people.cashier, people.nobody]) {
              await fails(() => exchanges.summary(actor.token, c.id), 'FORBIDDEN');
              await fails(() => exchanges.options(actor.token, c.id, {}), 'FORBIDDEN');
              await fails(() => exchanges.preview(actor.token, c.id, swap.id), 'FORBIDDEN');
            }
            const preview = await previewOf(c, swap.id);
            for (const actor of [clerk, elsewhere, people.cashier, people.nobody]) {
              await fails(
                () => exchanges.exchange(actor.token, c.id, bodyFor(preview) as never),
                'FORBIDDEN',
              );
            }
            assert.equal(await tx.productExchange.count({ where: { invoiceLineId: s.lineId } }), 0);
            await fails(() => exchanges.summary(approver.token, 'not-a-uuid'), 'NOT_FOUND');
            await fails(() => exchanges.summary(approver.token, randomUUID()), 'NOT_FOUND');
            // A case accepted as a REFUND is not a basis for an exchange; neither is an open one.
            const refundCase = await accepted(await sale(), { outcome: 'REFUND' });
            await fails(
              () => exchanges.preview(approver.token, refundCase.id, swap.id),
              'EXCHANGE_CASE_NOT_READY',
            );
            await fails(
              () => exchangeNow(approver, refundCase, swap.id),
              'EXCHANGE_CASE_NOT_READY',
            );
            const openSale = await sale();
            const openCase = await k.ok(() =>
              returns.open(clerk.token, {
                branchId: A.id,
                invoiceLineId: openSale.lineId,
                reason: 'PERSONAL_PREFERENCE',
                requestedOutcome: 'EXCHANGE',
                quantity: 1,
                sealIntact: true,
                notes: null,
                clientRequestId: randomUUID(),
              }),
            );
            await fails(
              () => exchanges.preview(approver.token, openCase.id, swap.id),
              'EXCHANGE_CASE_NOT_READY',
            );
            const summary = await exchanges.summary(approver.token, c.id);
            assert.equal(summary.exchangeable, true);
            assert.equal(summary.blocked, null);
            assert.equal(summary.creditVnd, '200000');
            assert.deepEqual(summary.can, {
              exchange: true,
              complete: false,
              correctReference: false,
            });
            const refundSummary = await exchanges.summary(approver.token, refundCase.id);
            assert.equal(refundSummary.blocked, 'NOT_ACCEPTED_AS_EXCHANGE');
            await reconcileExchanges();
          },
        );

        await suite.test(
          'the replacement is searched among items in stock with today’s price; the same item and the sellers are marked',
          async () => {
            const s = await sale({ price: 120_000 });
            const c = await accepted(s, { quantity: 1 });
            const other = await item(90_000, 4);
            const all = await exchanges.options(approver.token, c.id, {});
            assert.equal(all.quantity, 1);
            const returned = all.options.find((option) => option.variantId === s.variantId);
            assert.ok(returned && returned.sameItem === true);
            const picked = all.options.find((option) => option.variantId === other.id)!;
            assert.equal(picked.sameItem, false);
            assert.equal(picked.unitPriceVnd, '90000');
            assert.equal(picked.available, 4);
            const found = await exchanges.options(approver.token, c.id, {
              q: other.sku.toLowerCase(),
            });
            assert.deepEqual(
              found.options.map((option) => option.variantId),
              [other.id],
            );
            assert.ok(found.sellers.length >= 1, 'employees of the branch');
            await fails(
              () => exchanges.options(approver.token, c.id, { q: 'x'.repeat(81) }),
              'VALIDATION_FAILED',
            );
            // No cost, no lot, no supplier in a response.
            assert.doesNotMatch(JSON.stringify(all), /unitCost|lotCode|supplier/i);
          },
        );

        await suite.test(
          'a dearer replacement: the customer pays the difference as an ordinary payment, then the goods are taken in',
          async () => {
            const payer = await member(0);
            const s = await sale({ quantity: 3, price: 100_000, payer: payer.id });
            assert.equal(await balance(payer.id), 300, 'the sale earned 300 Beauty points');
            const c = await accepted(s, { quantity: 2 });
            const swap = await item(150_000, 6);
            const preview = await previewOf(c, swap.id);
            assert.equal(preview.rule, 'PRICE_DIFFERENCE');
            assert.equal(preview.creditVnd, '200000');
            assert.equal(preview.replacementGrossVnd, '300000');
            assert.equal(preview.payableVnd, '100000');
            assert.equal(preview.refundVnd, '0');
            assert.equal(preview.inStock, true);
            const made = await exchangeNow(approver, c, swap.id);
            const ex = last(made);
            assert.equal(ex.status, 'AWAITING_PAYMENT');
            assert.equal(ex.payableVnd, '100000');
            assert.equal(ex.invoice.status, 'PENDING_PAYMENT');
            assert.equal(ex.invoice.totalVnd, '100000');
            assert.equal(ex.invoice.balanceVnd, '100000');
            assert.equal(ex.completion, null);
            assert.match(ex.code, /^DH\d{6}$/);
            // The exchange invoice is an ordinary product-sale invoice of the same payer and branch.
            const swapInvoice = await invoiceRow(ex.invoice.id);
            assert.equal(swapInvoice.kind, 'PRODUCT_SALE');
            assert.equal(swapInvoice.channel, 'COUNTER');
            assert.equal(swapInvoice.payerUserId, payer.id);
            assert.equal(swapInvoice.branchId, A.id);
            assert.equal(swapInvoice.subtotalVnd, 300_000n);
            assert.equal(swapInvoice.discountTotalVnd, 200_000n);
            assert.equal(swapInvoice.lines.length, 1);
            assert.equal(swapInvoice.lines[0]!.quantity, 2);
            assert.equal(swapInvoice.lines[0]!.unitPriceVnd, 150_000n);
            assert.equal(swapInvoice.lines[0]!.allocations[0]!.netVnd, 100_000n);
            // The replacement is held for the invoice (reservation rules); nothing has left the shelf yet.
            const level = await k.levelOf(swap.id);
            assert.deepEqual(level, { onHand: 6, reserved: 2 });
            // A claim is open: the line takes no refund until the exchange is completed or cancelled.
            const summary = await exchanges.summary(approver.token, c.id);
            assert.equal(summary.blocked, 'OPEN_EXCHANGE');
            // The customer pays the difference: an ordinary cash payment of the exchange invoice.
            await k.pay(ex.invoice.id, 100_000);
            const paid = last(await exchanges.summary(approver.token, c.id));
            assert.equal(paid.status, 'AWAITING_COMPLETION');
            assert.equal(paid.invoice.status, 'PAID');
            // The stock sale of the replacement follows the payment like any sale.
            assert.deepEqual(await k.runInventory(ex.invoice.id), ['APPLIED']);
            assert.deepEqual(await k.levelOf(swap.id), { onHand: 4, reserved: 0 });
            // Points: the original 300 stay; 100 more on the 100,000 actually paid.
            await consumeInvoice(ex.invoice.id);
            assert.equal(await balance(payer.id), 400);
            const earn = await tx.loyaltyLedgerEntry.findMany({
              where: { userId: payer.id, kind: 'EARN', wallet: 'BEAUTY' },
            });
            assert.deepEqual(earn.map((entry) => entry.points).sort(), [100, 300]);
            assert.equal(
              await tx.loyaltyLedgerEntry.count({
                where: { userId: payer.id, kind: 'REFUND_REVERSAL' },
              }),
              0,
            );
            // The returned goods are taken in once: sellable goods go into a new lot named after the case.
            const done = last(
              await k.ok(() =>
                exchanges.complete(approver.token, c.id, ex.id, { restock: 'SELLABLE' }),
              ),
            );
            assert.equal(done.status, 'COMPLETED');
            assert.equal(done.completion!.restock, 'SELLABLE');
            assert.deepEqual(done.completion!.lotCodes, [`${c.code}-E`]);
            assert.equal(done.beautyPointsEarned, 100);
            const lot = await tx.inventoryLot.findFirstOrThrow({
              where: { lotCode: `${c.code}-E` },
            });
            assert.equal(lot.quantityOnHand, 2);
            assert.equal(lot.variantId, s.variantId);
            // A repeat of the completion with the same decision reads back; another decision is a conflict.
            assert.equal(
              last(await exchanges.complete(approver.token, c.id, ex.id, { restock: 'SELLABLE' }))
                .status,
              'COMPLETED',
            );
            await fails(
              () => exchanges.complete(approver.token, c.id, ex.id, { restock: 'NOT_SELLABLE' }),
              'CONFLICT',
            );
            // The exchange is over: the case cannot be exchanged again.
            assert.equal(
              (await exchanges.summary(approver.token, c.id)).blocked,
              'ALREADY_EXCHANGED',
            );
            await fails(() => exchangeNow(approver, c, swap.id), 'EXCHANGE_ALREADY_DONE');
            await reconcileExchanges();
          },
        );

        await suite.test(
          'a cheaper replacement: the difference is handed back by cash or manual transfer, the Owner is told, points are kept',
          async () => {
            const payer = await member(0);
            const s = await sale({ quantity: 2, price: 250_000, payer: payer.id });
            assert.equal(await balance(payer.id), 500);
            const c = await accepted(s, { quantity: 2 });
            const swap = await item(200_000, 5);
            const preview = await previewOf(c, swap.id);
            assert.equal(preview.payableVnd, '0');
            assert.equal(preview.refundVnd, '100000');
            assert.equal(preview.appliedCreditVnd, '400000');
            const owners = await tx.user.findMany({
              where: { kind: 'OWNER', status: 'ACTIVE' },
              select: { id: true },
            });
            // Money handed back needs its method; a transfer needs its reference; cash has none.
            await fails(
              () =>
                exchanges.exchange(
                  approver.token,
                  c.id,
                  bodyFor(preview, { refundMethod: null }) as never,
                ),
              'VALIDATION_FAILED',
              'refundMethod',
            );
            await fails(
              () =>
                exchanges.exchange(
                  approver.token,
                  c.id,
                  bodyFor(preview, { refundMethod: 'BANK_TRANSFER_MANUAL' }) as never,
                ),
              'VALIDATION_FAILED',
              'bankReference',
            );
            await fails(
              () =>
                exchanges.exchange(
                  approver.token,
                  c.id,
                  bodyFor(preview, { bankReference: 'FT26100801' }) as never,
                ),
              'VALIDATION_FAILED',
              'bankReference',
            );
            await fails(
              () =>
                exchanges.exchange(
                  approver.token,
                  c.id,
                  bodyFor(preview, { restock: null }) as never,
                ),
              'VALIDATION_FAILED',
              'restock',
            );
            const made = await k.ok(() =>
              exchanges.exchange(
                approver.token,
                c.id,
                bodyFor(preview, {
                  refundMethod: 'BANK_TRANSFER_MANUAL',
                  bankReference: 'FT26100801',
                }) as never,
              ),
            );
            const ex = last(made);
            assert.equal(ex.status, 'COMPLETED', 'nothing to pay: completed in the same step');
            assert.equal(ex.refundVnd, '100000');
            assert.equal(ex.refund!.method, 'BANK_TRANSFER_MANUAL');
            assert.equal(ex.refund!.bankReference, 'FT26100801');
            assert.equal(ex.invoice.status, 'PAID');
            assert.equal(ex.invoice.totalVnd, '0');
            assert.equal(ex.completion!.restock, 'SELLABLE');
            // The replacement is sold like any sale once the (zero) invoice is paid.
            assert.deepEqual(await k.runInventory(ex.invoice.id), ['APPLIED']);
            assert.equal((await k.levelOf(swap.id))!.onHand, 3);
            // Points: nothing is taken back and nothing is earned.
            await consumeInvoice(ex.invoice.id);
            assert.equal(await balance(payer.id), 500);
            assert.equal(
              await tx.loyaltyLedgerEntry.count({ where: { invoiceId: ex.invoice.id } }),
              0,
            );
            // The Owner is told, as for a refund, with the exchange as the source; the reference is nowhere in the notice or the audit.
            for (const person of owners) {
              const told = await notices(person.id, c.id);
              assert.equal(told.length, 1);
              const params = told[0]!.params as Record<string, unknown>;
              assert.equal(params['source'], 'EXCHANGE');
              assert.equal(params['amountVnd'], '100000');
              assert.equal(params['method'], 'BANK_TRANSFER_MANUAL');
              assert.equal(params['invoiceCode'], s.code);
              assert.equal(params['sku'], s.sku);
              assert.doesNotMatch(JSON.stringify(told[0]!.params), /FT26100801/);
            }
            const audits = await tx.auditEvent.findMany({
              where: { entityType: 'ProductExchange', entityId: ex.id },
            });
            assert.deepEqual(audits.map((audit) => audit.action).sort(), [
              'PRODUCT_EXCHANGE_COMPLETED',
              'PRODUCT_EXCHANGE_CREATED',
            ]);
            assert.doesNotMatch(JSON.stringify(audits), /FT26100801/);
            // A mistyped reference is corrected by a linked record; the exchange never changes.
            const fixed = last(
              await k.ok(() =>
                exchanges.correctReference(approver.token, c.id, ex.id, {
                  bankReference: 'FT26100802',
                  reason: 'Gõ nhầm',
                }),
              ),
            );
            assert.equal(fixed.refund!.bankReference, 'FT26100802');
            assert.equal(fixed.refund!.firstBankReference, 'FT26100801');
            assert.equal(
              (await tx.productExchange.findUniqueOrThrow({ where: { id: ex.id } }))
                .refundBankReference,
              'FT26100801',
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'equal value and the same item: nothing to pay, nothing handed back, no points; the item can be a free swap',
          async () => {
            const payer = await member(0);
            const s = await sale({ quantity: 2, price: 100_000, payer: payer.id });
            const c = await accepted(s, { quantity: 1 });
            const equal = await item(100_000);
            const made = await exchangeNow(approver, c, equal.id);
            const ex = last(made);
            assert.equal(ex.payableVnd, '0');
            assert.equal(ex.refundVnd, '0');
            assert.equal(ex.refund, null);
            assert.equal(ex.status, 'COMPLETED');
            assert.equal(ex.rule, 'PRICE_DIFFERENCE');
            await k.runInventory(ex.invoice.id);
            await consumeInvoice(ex.invoice.id);
            assert.equal(await balance(payer.id), 200, 'only the original points');
            // No Owner notice: nothing was handed back.
            assert.equal((await notices(owner.id, c.id)).length, 0);
            // The same item (a faulty item swapped for the same item): free, whatever today's price is (OQ-82).
            const s2 = await sale({ quantity: 2, price: 100_000, payer: payer.id });
            await k.reprice(s2.variantId, 130_000);
            const c2 = await accepted(s2, { quantity: 1 });
            const same = await previewOf(c2, s2.variantId);
            assert.equal(same.rule, 'SAME_ITEM');
            assert.equal(same.replacementGrossVnd, '130000');
            assert.equal(same.payableVnd, '0');
            assert.equal(same.refundVnd, '0');
            const swapped = last(
              await k.ok(() => exchanges.exchange(approver.token, c2.id, bodyFor(same) as never)),
            );
            assert.equal(swapped.rule, 'SAME_ITEM');
            assert.equal(swapped.invoice.totalVnd, '0');
            const row = await tx.productExchange.findUniqueOrThrow({ where: { id: swapped.id } });
            assert.equal(row.appliedCreditVnd, 130_000n);
            assert.equal(row.creditVnd, 100_000n, 'what was paid is still on record');
            await reconcileExchanges();
          },
        );

        await suite.test(
          'stock: the replacement must be in stock now (no pre-order); returned goods that are not sellable move no stock',
          async () => {
            const s = await sale({ quantity: 2, price: 100_000 });
            const c = await accepted(s, { quantity: 2 });
            const scarce = await item(100_000, 1);
            const preview = await previewOf(c, scarce.id);
            assert.equal(preview.inStock, false);
            await fails(
              () => exchanges.exchange(approver.token, c.id, bodyFor(preview) as never),
              'PRODUCT_OUT_OF_STOCK',
            );
            assert.equal(
              await tx.productExchange.count({ where: { returnCaseId: c.id } }),
              0,
              'nothing was written',
            );
            assert.equal(
              await tx.invoice.count({
                where: {
                  payerUserId: null,
                  kind: 'PRODUCT_SALE',
                  lines: { some: { itemCode: scarce.sku } },
                },
              }),
              0,
            );
            assert.deepEqual(await k.levelOf(scarce.id), { onHand: 1, reserved: 0 });
            // An item that was never received is out of stock too.
            const never = await k.product('never', [100_000]);
            const noStock = await previewOf(c, never.variants[0]!.id);
            assert.equal(noStock.inStock, false);
            // An unpublished item cannot be the replacement.
            const draft = await k.product('draft', [100_000], { publish: false });
            await fails(
              () => exchanges.preview(approver.token, c.id, draft.variants[0]!.id),
              'PRODUCT_NOT_SELLABLE',
            );
            // Not sellable goods: no lot and no movement (no phantom stock).
            const plenty = await item(100_000, 5);
            const before = await tx.stockMovement.count({ where: { kind: 'EXCHANGE_RETURN' } });
            const lots = await tx.inventoryLot.count({ where: { branchId: A.id } });
            const made = last(
              await exchangeNow(approver, c, plenty.id, { restock: 'NOT_SELLABLE' }),
            );
            assert.equal(made.completion!.restock, 'NOT_SELLABLE');
            assert.deepEqual(made.completion!.lotCodes, []);
            assert.equal(
              await tx.stockMovement.count({ where: { kind: 'EXCHANGE_RETURN' } }),
              before,
            );
            assert.equal(await tx.inventoryLot.count({ where: { branchId: A.id } }), lots);
            await reconcileExchanges();
          },
        );

        await suite.test(
          'sellable goods go back in a new lot that keeps the expiry of the lot they were sold from (several lots, first-expiry first)',
          async () => {
            const product = await k.product('lots', [100_000]);
            const variant = product.variants[0]!;
            const soon = '2030-01-10';
            const later = '2031-06-30';
            // Two lots with different expiry: the sale takes the earliest first.
            const draftReceipt = await k.inventory.createReceipt(people.receiver.token, {
              branchId: A.id,
              supplierId: null,
              receiptDate: await k.day(),
              notes: null,
              lines: [
                { variantId: variant.id, quantity: 1, lotCode: 'LATE', expiryDate: later },
                { variantId: variant.id, quantity: 1, lotCode: 'SOON', expiryDate: soon },
              ],
            });
            await k.ok(() =>
              k.inventory.confirmReceipt(people.receiver.token, draftReceipt.id, {
                expectedRowVersion: draftReceipt.rowVersion,
              }),
            );
            const invoice = await k.finalize(
              await k.addLine(await k.openSale(people.cashier, null), variant.id, 2),
            );
            await k.pay(invoice.id, Number(invoice.totalVnd));
            const view = await invoices.get(people.cashier.token, invoice.id);
            await k.runInventory(invoice.id);
            const s = { lineId: view.productLines[0]!.id, quantity: 2 } as Sale;
            const c = await accepted(s, { quantity: 2 });
            const swap = await item(100_000, 5);
            const made = last(await exchangeNow(approver, c, swap.id));
            assert.deepEqual(made.completion!.lotCodes, [`${c.code}-E/1`, `${c.code}-E/2`]);
            const lotRows = await tx.inventoryLot.findMany({
              where: { sourceExchangeId: made.id },
              orderBy: { lotCode: 'asc' },
            });
            assert.deepEqual(
              lotRows.map((lot) => lot.expiryDate?.toISOString().slice(0, 10)),
              [soon, later],
              'each lot keeps the expiry of the lot its unit was sold from',
            );
            assert.deepEqual(
              lotRows.map((lot) => lot.quantityOnHand),
              [1, 1],
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'what the customer actually paid is the credit (the Owner’s example: paid 270,000, new price 350,000); a voucher is not given back; today’s promotion is the price',
          async () => {
            const created = await programs.create(owner.token, {
              code: `P614${base.run}`.slice(0, 24),
              nameVi: 'Voucher đổi hàng',
              nameEn: 'Exchange voucher',
              requiresCode: true,
              version: {
                kind: 'FIXED_AMOUNT',
                fixedAmountVnd: '30000',
                validFrom: new Date(Date.now() - 86_400_000).toISOString(),
                validUntil: new Date(Date.now() + 30 * 86_400_000).toISOString(),
                minSpendVnd: '0',
                scopeMode: 'ALL_SERVICES',
                serviceIds: [],
                categoryIds: [],
                usageLimitTotal: 1,
                usageLimitPerCustomer: null,
                scope: 'PRODUCTS',
              } as DiscountVersionInput,
            });
            const code = `V614${base.run}`.slice(0, 24);
            await programs.createVoucher(owner.token, created.id, { code });
            const payer = await member(0);
            const product = await k.product('voucher', [300_000]);
            const variant = product.variants[0]!;
            await k.receive(variant.id, 6);
            let draft = await k.openSale(people.cashier, payer.id);
            draft = await k.addLine(draft, variant.id, 1);
            draft = await k.ok(() =>
              invoices.supplyVoucher(people.cashier.token, draft.id, {
                expectedVersion: draft.version,
                code,
              }),
            );
            const invoice = await k.finalize(draft);
            assert.equal(invoice.totalVnd, '270000', 'the voucher took 30,000 off 300,000');
            await k.pay(invoice.id, 270_000);
            const view = await invoices.get(people.cashier.token, invoice.id);
            await k.runInventory(invoice.id);
            await consumeInvoice(invoice.id);
            const redemptions = () =>
              tx.discountRedemption.count({ where: { discountId: created.id } });
            const before = await redemptions();
            const c = await accepted({ lineId: view.productLines[0]!.id, quantity: 1 } as Sale);
            const dearer = await item(350_000, 5);
            await k.promote(dearer.id, 340_000);
            const preview = await previewOf(c, dearer.id);
            assert.equal(
              preview.option.unitPriceVnd,
              '340000',
              'the promotion running today is the price',
            );
            assert.equal(preview.option.onPromotion, true);
            assert.equal(preview.option.listPriceVnd, '350000');
            assert.equal(
              preview.creditVnd,
              '270000',
              'what was actually paid, not the 300,000 list price',
            );
            assert.equal(preview.payableVnd, '70000');
            const made = last(
              await k.ok(() =>
                exchanges.exchange(
                  approver.token,
                  c.id,
                  bodyFor(preview, { restock: null }) as never,
                ),
              ),
            );
            assert.equal(made.creditVnd, '270000');
            assert.equal(made.payableVnd, '70000');
            // The exchange invoice carries no program, voucher, member discount or gift: only the credit.
            const swap = await invoiceRow(made.invoice.id);
            assert.equal(swap.discountTotalVnd, 270_000n);
            assert.equal(
              await tx.invoiceDiscountApplication.count({ where: { invoiceId: swap.id } }),
              0,
            );
            assert.equal(
              await tx.invoiceBeautyApplication.count({ where: { invoiceId: swap.id } }),
              0,
            );
            assert.equal(
              await tx.invoiceBeautySnapshot.count({ where: { invoiceId: swap.id } }),
              0,
            );
            assert.equal(await tx.discountRedemption.count({ where: { invoiceId: swap.id } }), 0);
            assert.equal(
              await redemptions(),
              before,
              'the voucher is not given back (and not used again)',
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'P13-3 for exchanges: one password confirmation covers ONE exchange, from the same pool as the refunds',
          async () => {
            const s = await sale({ quantity: 3 });
            const c1 = await accepted(s, { quantity: 1 });
            const c2 = await accepted(s, { quantity: 1 });
            const swap = await item(100_000, 9);
            const person = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
            const p1 = await previewOf(c1, swap.id, person);
            // The session was confirmed seconds ago (fresh): the first exchange uses that confirmation...
            await k.ok(() => strictExchanges.exchange(person.token, c1.id, bodyFor(p1) as never));
            const uses = await tx.refundReauthenticationUse.findMany({
              where: { actorUserId: person.id },
            });
            assert.equal(uses.length, 1);
            assert.ok(uses[0]!.productExchangeId && uses[0]!.productRefundId === null);
            // ...the second one, seconds later and inside the 300 s window, is refused: nothing is written.
            const p2 = await previewOf(c2, swap.id, person);
            await fails(
              () => strictExchanges.exchange(person.token, c2.id, bodyFor(p2) as never),
              'REAUTHENTICATION_REQUIRED',
            );
            assert.equal(await tx.productExchange.count({ where: { returnCaseId: c2.id } }), 0);
            // Typing the password again lets it through; a refund cannot reuse that confirmation either.
            await confirmAgain(person.token);
            await k.ok(() => strictExchanges.exchange(person.token, c2.id, bodyFor(p2) as never));
            const refundCase = await accepted(await sale({ quantity: 1 }), { outcome: 'REFUND' });
            await fails(
              () =>
                refunds.refund(person.token, refundCase.id, {
                  quantity: 1,
                  method: 'CASH',
                  bankReference: null,
                  restock: 'NOT_SELLABLE',
                  reason: 'x',
                  clientRequestId: randomUUID(),
                }),
              'REAUTHENTICATION_REQUIRED',
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'a dearer exchange can be paid by PayOS: the provider confirms the difference, the invoice is paid, stock and points follow, the exchange completes',
          async () => {
            const simulator = createPayosSimulator();
            const payosInvoices = new InvoiceService(
              base.adapter,
              base.throttle,
              base.environment,
              simulator.provider,
            );
            const webhook = new PayosWebhookService(
              {
                client: { $transaction: (work: never) => base.adapter.withTransaction(work) },
              } as never,
              simulator.provider,
              null,
            );
            const payer = await member(0);
            const s = await sale({ quantity: 2, price: 100_000, payer: payer.id });
            assert.equal(await balance(payer.id), 200);
            const c = await accepted(s, { quantity: 1 });
            const swap = await item(150_000, 6);
            const ex = last(await exchangeNow(approver, c, swap.id));
            assert.equal(ex.payableVnd, '50000');
            const made = await k.ok(() =>
              payosInvoices.createPayos(people.cashier.token, ex.invoice.id, {
                amountVnd: '50000',
                idempotencyKey: randomUUID(),
              }),
            );
            const orderCode = Number(
              (await tx.payment.findUniqueOrThrow({ where: { id: made.payment.id } }))
                .providerOrderCode,
            );
            // Pending until the authentic notification arrives; the exchange still waits for its payment.
            assert.equal(
              last(await exchanges.summary(approver.token, c.id)).status,
              'AWAITING_PAYMENT',
            );
            assert.deepEqual(
              await webhook.receive(simulator.pay(orderCode, { reference: 'TF-EX-1' })),
              {
                received: true,
              },
            );
            await k.settle();
            const paid = await invoiceRow(ex.invoice.id);
            assert.equal(paid.status, 'PAID');
            assert.equal(paid.payments[0]!.method, 'PAYOS');
            assert.equal(paid.payments[0]!.amountVnd, 50_000n);
            assert.equal(
              last(await exchanges.summary(approver.token, c.id)).status,
              'AWAITING_COMPLETION',
            );
            // Stock is sold and the Beauty points follow the difference actually paid (the original 200 stay).
            assert.deepEqual(await k.runInventory(ex.invoice.id), ['APPLIED']);
            await consumeInvoice(ex.invoice.id);
            assert.equal(await balance(payer.id), 250);
            const done = last(
              await k.ok(() =>
                exchanges.complete(approver.token, c.id, ex.id, { restock: 'SELLABLE' }),
              ),
            );
            assert.equal(done.status, 'COMPLETED');
            assert.equal(done.beautyPointsEarned, 50);
            // A confirmed PayOS payment is never reversed (Q6), and the completed exchange keeps it anyway.
            await reconcileExchanges();
          },
        );

        await suite.test(
          'a return case cannot be opened on a line of an exchange invoice: no new eligibility window for the replacement (PRD 28.4)',
          async () => {
            const s = await sale({ quantity: 2, price: 100_000 });
            const c = await accepted(s, { quantity: 1 });
            const swap = await item(150_000, 6);
            const ex = last(await exchangeNow(approver, c, swap.id));
            await k.pay(ex.invoice.id, 50_000);
            const view = await invoices.get(people.cashier.token, ex.invoice.id);
            const swapLine = view.productLines[0]!;
            await fails(
              () =>
                returns.open(clerk.token, {
                  branchId: A.id,
                  invoiceLineId: swapLine.id,
                  reason: 'PERSONAL_PREFERENCE',
                  requestedOutcome: 'REFUND',
                  quantity: 1,
                  sealIntact: true,
                  notes: null,
                  clientRequestId: randomUUID(),
                }),
              'RETURN_NOT_ELIGIBLE',
            );
            await refuses(
              `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity, seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id)
               SELECT 'TH-X${randomUUID().slice(0, 6)}', i.branch_id, l.invoice_id, l.id, 'PERSONAL_PREFERENCE', 'REFUND', 1, true, clock_timestamp(), 1, clock_timestamp() + interval '168 hours', '${clerk.id}', '${randomUUID()}'
               FROM invoice_lines l JOIN invoices i ON i.id = l.invoice_id WHERE l.id = '${swapLine.id}'`,
              /exchange invoice|replacement/,
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'what the member payer sees of the exchange invoice: the credit is named, a free exchange sends no "paid in full 0" notice, a paid difference does',
          async () => {
            const payer = await member(0);
            const s = await sale({ quantity: 2, price: 100_000, payer: payer.id });
            const noticesOf = (invoiceId: string) =>
              tx.notification.findMany({
                where: { recipientUserId: payer.id, type: 'INVOICE_PAID', entityId: invoiceId },
              });
            const announce = async (invoiceId: string) => {
              const events = await tx.outboxEvent.findMany({
                where: { aggregateId: invoiceId, eventType: 'INVOICE_PAID' },
                orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
              });
              for (const event of events) {
                await processFinancialNotificationEvent(tx, event.id);
                await k.settle();
              }
            };
            // A dearer exchange: the invoice shows the replacement, the credit as its one discount row, and the difference to pay.
            const dearerCase = await accepted(s, { quantity: 1 });
            const dearer = last(await exchangeNow(approver, dearerCase, (await item(150_000)).id));
            const shown = await customerInvoiceDetail(tx, payer.id, dearer.invoice.id);
            assert.equal(shown.subtotalVnd, '150000');
            assert.equal(shown.discountTotalVnd, '100000');
            assert.equal(shown.totalVnd, '50000');
            assert.ok(shown.discount, 'the discount row is explained');
            assert.equal(shown.discount!.amountVnd, '100000');
            assert.equal(shown.discount!.voucherCode, null);
            assert.match(shown.discount!.nameVi, /hàng cũ/);
            assert.doesNotMatch(
              JSON.stringify(shown),
              /sku|seller|lotCode|unitCost|returnCase|DH0/i,
            );
            await k.pay(dearer.invoice.id, 50_000);
            await announce(dearer.invoice.id);
            const told = await noticesOf(dearer.invoice.id);
            assert.equal(told.length, 1);
            assert.deepEqual(told[0]!.params, { amountVnd: '50000' });
            // A free exchange (equal value): settled at once, nothing to announce to the customer.
            const s2 = await sale({ quantity: 1, price: 100_000, payer: payer.id });
            const equalCase = await accepted(s2);
            const equal = last(await exchangeNow(approver, equalCase, (await item(100_000)).id));
            const none = await customerInvoiceDetail(tx, payer.id, equal.invoice.id);
            assert.equal(none.totalVnd, '0');
            assert.equal(none.discount!.amountVnd, '100000');
            await announce(equal.invoice.id);
            assert.equal((await noticesOf(equal.invoice.id)).length, 0);
            // The ordinary zero-balance invoices keep their notice (an ordinary free invoice is announced as before).
            await reconcileExchanges();
          },
        );

        await suite.test(
          'the request is validated exactly and the shown figures must still hold',
          async () => {
            const s = await sale({ quantity: 2, price: 100_000 });
            const c = await accepted(s, { quantity: 2 });
            const swap = await item(120_000, 6);
            const preview = await previewOf(c, swap.id);
            const bad = (patch: Record<string, unknown>, field: string) =>
              fails(
                () => exchanges.exchange(approver.token, c.id, bodyFor(preview, patch) as never),
                'VALIDATION_FAILED',
                field,
              );
            await bad({ variantId: 'x' }, 'variantId');
            await bad({ expectedPayableVnd: '-1' }, 'expectedPayableVnd');
            await bad({ expectedPayableVnd: 40_000 }, 'expectedPayableVnd');
            await bad({ expectedRefundVnd: '01' }, 'expectedRefundVnd');
            await bad({ reason: '   ' }, 'reason');
            await bad({ reason: 'x'.repeat(501) }, 'reason');
            await bad({ clientRequestId: 'x' }, 'clientRequestId');
            await bad({ restock: 'SELLABLE' }, 'restock');
            await bad({ refundMethod: 'CASH' }, 'refundMethod');
            await bad({ refundMethod: 'PAYOS' }, 'refundMethod');
            await fails(
              () =>
                exchanges.exchange(approver.token, c.id, {
                  ...bodyFor(preview),
                  extra: 1,
                } as never),
              'VALIDATION_FAILED',
            );
            await fails(
              () =>
                exchanges.exchange(approver.token, c.id, {
                  ...bodyFor(preview),
                  amountVnd: '5',
                } as never),
              'VALIDATION_FAILED',
            );
            // A seller who is not an active employee of the branch is refused.
            await fails(
              () =>
                exchanges.exchange(
                  approver.token,
                  c.id,
                  bodyFor(preview, { sellerUserId: owner.id }) as never,
                ),
              'PRODUCT_SELLER_INVALID',
            );
            // The price moved since the screen showed it: refused, nothing written, the stock untouched.
            await k.reprice(swap.id, 125_000);
            await fails(
              () => exchanges.exchange(approver.token, c.id, bodyFor(preview) as never),
              'EXCHANGE_FIGURES_CHANGED',
            );
            assert.equal(await tx.productExchange.count({ where: { returnCaseId: c.id } }), 0);
            assert.deepEqual(await k.levelOf(swap.id), { onHand: 6, reserved: 0 });
            const fresh = await previewOf(c, swap.id);
            assert.equal(fresh.payableVnd, '50000');
            await k.ok(() => exchanges.exchange(approver.token, c.id, bodyFor(fresh) as never));
            await reconcileExchanges();
          },
        );

        await suite.test(
          'the same request is one exchange: a repeat returns it, the same id with other content is a conflict',
          async () => {
            const s = await sale({ quantity: 1 });
            const c = await accepted(s);
            const swap = await item(100_000);
            const preview = await previewOf(c, swap.id);
            const body = bodyFor(preview);
            const first = await k.ok(() => exchanges.exchange(approver.token, c.id, body as never));
            // The repeat needs no new confirmation.
            const again = await strictExchanges.exchange(approver.token, c.id, body as never);
            assert.equal(again.exchanges.length, 1);
            assert.equal(last(again).id, last(first).id);
            assert.equal(await tx.productExchange.count({ where: { returnCaseId: c.id } }), 1);
            assert.equal(
              await tx.invoice.count({ where: { exchangeFor: { returnCaseId: c.id } } }),
              1,
            );
            await fails(
              () =>
                strictExchanges.exchange(approver.token, c.id, {
                  ...body,
                  reason: 'Lý do khác',
                } as never),
              'CONFLICT',
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'refunds and exchanges share ONE sequence on a line: an open exchange blocks a refund, a cancelled one frees the units, the money adds up',
          async () => {
            const s = await sale({ quantity: 3, price: 100_000 });
            const exchangeCase = await accepted(s, { quantity: 1 });
            const refundCase = await accepted(s, { quantity: 2, outcome: 'REFUND' });
            const swap = await item(150_000, 9);
            const made = last(await exchangeNow(approver, exchangeCase, swap.id));
            assert.equal(made.status, 'AWAITING_PAYMENT');
            // The exchange claims unit 1 of 3; a refund waits for it.
            assert.deepEqual(await claimed(s.lineId), { claimed_units: 1, claimed_vnd: 100_000n });
            await fails(
              () =>
                confirmedRefund(approver.token, refundCase.id, {
                  quantity: 1,
                  method: 'CASH',
                  bankReference: null,
                  restock: 'NOT_SELLABLE',
                  reason: 'x',
                  clientRequestId: randomUUID(),
                }),
              'EXCHANGE_IN_PROGRESS',
            );
            const blocked = await refunds.summary(approver.token, refundCase.id);
            assert.equal(blocked.blocked, 'OPEN_EXCHANGE');
            // Cancel the unpaid exchange invoice (an ordinary cancellation): the claim is released and the stock reservation too.
            const view = await invoices.get(people.boss.token, made.invoice.id);
            await base.adapter.resolve(people.boss.token);
            await confirmAgain(people.boss.token);
            await k.ok(() =>
              invoices.cancel(people.boss.token, made.invoice.id, {
                expectedVersion: view.version,
                reason: 'Khách không đổi nữa',
              }),
            );
            const cancelled = last(await exchanges.summary(approver.token, exchangeCase.id));
            assert.equal(cancelled.status, 'CANCELLED');
            assert.deepEqual(await claimed(s.lineId), { claimed_units: 0, claimed_vnd: 0n });
            assert.deepEqual(await k.levelOf(swap.id), { onHand: 9, reserved: 0 });
            // The case may be exchanged again; the whole line can still be claimed.
            const summary = await exchanges.summary(approver.token, exchangeCase.id);
            assert.equal(summary.blocked, null);
            // Now: a refund of 2 units, then the exchange of the last unit (paid) - the money adds up to the net exactly.
            const refundedTwice = await k.ok(() =>
              confirmedRefund(approver.token, refundCase.id, {
                quantity: 2,
                method: 'CASH',
                bankReference: null,
                restock: 'NOT_SELLABLE',
                reason: 'Trả hàng',
                clientRequestId: randomUUID(),
              }),
            );
            assert.equal(refundedTwice.refunds[0]!.amountVnd, '200000');
            const second = last(await exchangeNow(approver, exchangeCase, swap.id));
            assert.equal(second.creditVnd, '100000');
            assert.deepEqual(await claimed(s.lineId), { claimed_units: 3, claimed_vnd: 300_000n });
            await k.pay(second.invoice.id, 50_000);
            // Paid but not completed yet: still open, so the line still takes no refund.
            await fails(
              () =>
                confirmedRefund(approver.token, refundCase.id, {
                  quantity: 1,
                  method: 'CASH',
                  bankReference: null,
                  restock: 'NOT_SELLABLE',
                  reason: 'x',
                  clientRequestId: randomUUID(),
                }),
              'EXCHANGE_IN_PROGRESS',
            );
            await k.runInventory(second.invoice.id);
            await k.ok(() =>
              exchanges.complete(approver.token, exchangeCase.id, second.id, {
                restock: 'NOT_SELLABLE',
              }),
            );
            await reconcileExchanges();
            // Nothing is left: a further case on the line is refused by the case rules, a refund by the claims.
            await fails(
              () =>
                confirmedRefund(approver.token, refundCase.id, {
                  quantity: 1,
                  method: 'CASH',
                  bankReference: null,
                  restock: 'NOT_SELLABLE',
                  reason: 'x',
                  clientRequestId: randomUUID(),
                }),
              'REFUND_QUANTITY_EXCEEDED',
            );
          },
        );

        await suite.test(
          'T22 extended: an invoice with an exchange keeps its payments and stays paid; so does the invoice of a completed exchange',
          async () => {
            const s = await sale({ quantity: 2, price: 100_000 });
            const paymentOf = async (invoiceId: string) =>
              (await tx.payment.findFirstOrThrow({ where: { invoiceId, status: 'SUCCEEDED' } })).id;
            const c = await accepted(s, { quantity: 1 });
            const swap = await item(150_000);
            const made = last(await exchangeNow(approver, c, swap.id));
            // The original invoice: no reversal, no cancellation while the exchange stands.
            const original = await paymentOf(s.invoiceId);
            await confirmAgain(people.boss.token);
            await fails(
              () =>
                invoices.reversePayment(people.boss.token, s.invoiceId, original, {
                  reason: 'Nhập sai',
                }),
              'INVOICE_HAS_EXCHANGE',
            );
            const view = await invoices.get(people.boss.token, s.invoiceId);
            await confirmAgain(people.boss.token);
            await fails(
              () =>
                invoices.cancel(people.boss.token, s.invoiceId, {
                  expectedVersion: view.version,
                  reason: 'x',
                }),
              'INVOICE_HAS_EXCHANGE',
            );
            await refuses(
              `INSERT INTO payment_corrections (payment_id, kind, reason, actor_user_id) VALUES ('${original}', 'REVERSAL', 'x', '${people.boss.id}')`,
              /invoice with an exchange keeps its payments/,
            );
            // The exchange invoice, before it is completed: its payment may be reversed (nothing else moved); once completed, not.
            await k.pay(made.invoice.id, 50_000);
            const swapPayment = await paymentOf(made.invoice.id);
            await k.runInventory(made.invoice.id);
            await k.ok(() =>
              exchanges.complete(approver.token, c.id, made.id, { restock: 'NOT_SELLABLE' }),
            );
            await confirmAgain(people.boss.token);
            await fails(
              () =>
                invoices.reversePayment(people.boss.token, made.invoice.id, swapPayment, {
                  reason: 'Nhập sai',
                }),
              'INVOICE_HAS_EXCHANGE',
            );
            await refuses(
              `INSERT INTO payment_corrections (payment_id, kind, reason, actor_user_id) VALUES ('${swapPayment}', 'REVERSAL', 'x', '${people.boss.id}')`,
              /completed exchange keeps its payments/,
            );
            await refuses(
              `UPDATE invoices SET status = 'PENDING_PAYMENT', paid_at = NULL, row_version = row_version + 1 WHERE id = '${made.invoice.id}'`,
              /keeps its payments and stays paid/,
            );
            // An exchange that waits for its payment can have that payment reversed.
            const s2 = await sale({ quantity: 1, price: 100_000 });
            const c2 = await accepted(s2);
            const waiting = last(await exchangeNow(approver, c2, swap.id));
            await k.pay(waiting.invoice.id, 50_000);
            const waitingPayment = await paymentOf(waiting.invoice.id);
            await confirmAgain(people.boss.token);
            await k.ok(() =>
              invoices.reversePayment(people.boss.token, waiting.invoice.id, waitingPayment, {
                reason: 'Nhập sai',
              }),
            );
            assert.equal(
              last(await exchanges.summary(approver.token, c2.id)).status,
              'AWAITING_PAYMENT',
            );
            await reconcileExchanges();
          },
        );

        await suite.test(
          'completion needs the exchange invoice to be paid; it is refused after a cancellation and for another branch',
          async () => {
            const s = await sale({ quantity: 1 });
            const c = await accepted(s);
            const swap = await item(130_000);
            const made = last(await exchangeNow(approver, c, swap.id));
            await fails(
              () => exchanges.complete(approver.token, c.id, made.id, { restock: 'SELLABLE' }),
              'EXCHANGE_NOT_PAID',
            );
            await fails(
              () => exchanges.complete(elsewhere.token, c.id, made.id, { restock: 'SELLABLE' }),
              'FORBIDDEN',
            );
            await fails(
              () => exchanges.complete(clerk.token, c.id, made.id, { restock: 'SELLABLE' }),
              'FORBIDDEN',
            );
            await fails(
              () => exchanges.complete(approver.token, c.id, randomUUID(), { restock: 'SELLABLE' }),
              'NOT_FOUND',
            );
            await fails(
              () =>
                exchanges.complete(approver.token, c.id, made.id, { restock: 'MAYBE' } as never),
              'VALIDATION_FAILED',
              'restock',
            );
            await fails(
              () =>
                exchanges.complete(approver.token, c.id, made.id, {
                  restock: 'SELLABLE',
                  extra: 1,
                } as never),
              'VALIDATION_FAILED',
            );
            // A sellable completion waits for the sale of the returned goods to be recorded in stock.
            const pending = await sale({ quantity: 1, price: 100_000 });
            const pendingCase = await accepted(pending);
            // (the stock sale of `pending` was recorded by `sale`; make a sale whose stock was not run)
            const product = await k.product('late', [100_000]);
            await k.receive(product.variants[0]!.id, 4);
            const invoice = await k.finalize(
              await k.addLine(await k.openSale(people.cashier, null), product.variants[0]!.id, 1),
            );
            await k.pay(invoice.id, Number(invoice.totalVnd));
            const view = await invoices.get(people.cashier.token, invoice.id);
            const lateCase = await accepted({
              lineId: view.productLines[0]!.id,
              quantity: 1,
            } as Sale);
            const lateSwap = await item(100_000);
            const lateMade = last(
              await exchangeNow(approver, lateCase, lateSwap.id, { restock: 'NOT_SELLABLE' }),
            );
            assert.equal(lateMade.status, 'COMPLETED');
            assert.ok(pendingCase.id);
            await reconcileExchanges();
          },
        );

        await suite.test(
          'the database is the backstop: immutable exchanges, the credit, the invoice, the case, the stock and the confirmation',
          async () => {
            const s = await sale({ quantity: 2, price: 100_000 });
            const c = await accepted(s, { quantity: 1 });
            const swap = await item(150_000);
            const made = last(await exchangeNow(approver, c, swap.id));
            await k.pay(made.invoice.id, 50_000);
            await k.runInventory(made.invoice.id);
            const done = last(
              await k.ok(() =>
                exchanges.complete(approver.token, c.id, made.id, { restock: 'SELLABLE' }),
              ),
            );
            await refuses(
              `UPDATE product_exchanges SET reason = 'khác' WHERE id = '${made.id}'`,
              /history/,
            );
            await refuses(
              `UPDATE product_exchanges SET refund_vnd = 1 WHERE id = '${made.id}'`,
              /history/,
            );
            await refuses(`DELETE FROM product_exchanges WHERE id = '${made.id}'`, /history/);
            await refuses(`TRUNCATE product_exchanges`, /never truncated|cannot truncate/);
            await refuses(
              `UPDATE product_exchange_completions SET restock = 'NOT_SELLABLE' WHERE exchange_id = '${made.id}'`,
              /history/,
            );
            await refuses(
              `DELETE FROM product_exchange_completions WHERE exchange_id = '${made.id}'`,
              /history/,
            );
            await refuses(
              `TRUNCATE product_exchange_completions`,
              /never truncated|cannot truncate/,
            );
            // A second exchange for the same case while one stands, a wrong credit, a wrong rule, a wrong invoice.
            const row = await tx.productExchange.findUniqueOrThrow({ where: { id: made.id } });
            const other = await sale({ quantity: 1, price: 100_000 });
            const otherCase = await accepted(other);
            const otherSwap = await item(100_000);
            const otherMade = last(await exchangeNow(approver, otherCase, otherSwap.id));
            const insert = (patch: Record<string, string>) => {
              const values: Record<string, string> = {
                code: `'DH-X${randomUUID().slice(0, 6)}'`,
                branch_id: `'${row.branchId}'`,
                invoice_id: `'${row.invoiceId}'`,
                invoice_line_id: `'${row.invoiceLineId}'`,
                return_case_id: `'${row.returnCaseId}'`,
                paid_seq: '1',
                quantity: '1',
                line_units_after: '2',
                line_amount_after_vnd: '200000',
                credit_vnd: '100000',
                rule: `'PRICE_DIFFERENCE'`,
                replacement_variant_id: `'${row.replacementVariantId}'`,
                replacement_unit_price_vnd: '150000',
                replacement_gross_vnd: '150000',
                applied_credit_vnd: '100000',
                payable_vnd: '50000',
                refund_vnd: '0',
                exchange_invoice_id: `'${row.exchangeInvoiceId}'`,
                reason: `'x'`,
                actor_user_id: `'${approver.id}'`,
                reauthenticated_at: 'clock_timestamp()',
                client_request_id: `'${randomUUID()}'`,
                ...patch,
              };
              return `INSERT INTO product_exchanges (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
            };
            await refuses(insert({}), /one exchange at a time/);
            await refuses(
              insert({
                return_case_id: `'${otherCase.id}'`,
                invoice_id: `'${other.invoiceId}'`,
                invoice_line_id: `'${other.lineId}'`,
                exchange_invoice_id: `'${otherMade.invoice.id}'`,
              }),
              /one exchange at a time|keeps? .* units|follows an accepted return case|net share|open exchange/,
            );
            await refuses(
              insert({
                credit_vnd: '99999',
                applied_credit_vnd: '99999',
                payable_vnd: '50001',
                line_amount_after_vnd: '199999',
              }),
              /one exchange at a time|net share/,
            );
            // The table's own CHECKs (the guard above fires first on a row like this one, so it is switched off for these).
            await refusesShape(insert({ rule: `'SAME_ITEM'` }), /product_exchanges_rule/);
            await refusesShape(
              insert({ refund_method: `'CASH'` }),
              /product_exchanges_refund_shape/,
            );
            await refusesShape(insert({ refund_vnd: '5' }), /product_exchanges_rule/);
            await refusesShape(
              insert({ refund_vnd: '5', refund_method: `'CASH'` }),
              /product_exchanges_rule/,
            );
            await refusesShape(
              insert({ credit_vnd: '300000', applied_credit_vnd: '150000', payable_vnd: '0' }),
              /product_exchanges_amounts|product_exchanges_rule/,
            );
            await refusesShape(insert({ reason: `'  '` }), /product_exchanges_reason/);
            await refusesShape(insert({ replacement_gross_vnd: '1' }), /product_exchanges_amounts/);
            await refusesShape(
              insert({
                refund_method: `'BANK_TRANSFER_MANUAL'`,
                refund_bank_reference: `'0123 4567'`,
                credit_vnd: '200000',
                refund_vnd: '50000',
                applied_credit_vnd: '150000',
                payable_vnd: '0',
              }),
              /product_exchanges_refund_shape/,
            );
            // Stock: an exchange return without its completion or for a not sellable exchange is refused; the lot link never changes.
            const lot = await tx.inventoryLot.findFirstOrThrow({
              where: { sourceExchangeId: made.id },
            });
            await refuses(
              `UPDATE inventory_lots SET source_exchange_id = NULL WHERE id = '${lot.id}'`,
              /immutable/,
            );
            await refuses(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, product_exchange_id, idempotency_key, actor_user_id)
               VALUES ('${lot.branchId}', '${lot.variantId}', '${lot.id}', 'EXCHANGE_RETURN', 1, '${made.id}', 'X-${randomUUID()}', '${approver.id}')`,
              /no more units than it took back/,
            );
            await refuses(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, product_exchange_id, idempotency_key, actor_user_id)
               VALUES ('${lot.branchId}', '${lot.variantId}', '${lot.id}', 'ADJUSTMENT', 1, '${made.id}', 'X-${randomUUID()}', '${approver.id}')`,
              /stock_movements_exchange_link|kind_shape/,
            );
            await refuses(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, product_exchange_id, idempotency_key, actor_user_id)
               VALUES ('${lot.branchId}', '${lot.variantId}', '${lot.id}', 'EXCHANGE_RETURN', 1, '${otherMade.id}', 'X-${randomUUID()}', '${approver.id}')`,
              /belongs to a sellable exchange|completed|lot named after/,
            );
            // The commit-time check of the invoice knows the exchange credit: it holds as made, and it fails when the credit and the
            // discount of the invoice disagree (the history guard is switched off to corrupt the row, inside a savepoint).
            await tx.$executeRawUnsafe(
              `SELECT lucy_check_invoice_pricing_v3('${made.invoice.id}')`,
            );
            await tx.$executeRawUnsafe('SAVEPOINT swap');
            let checkError: unknown = null;
            try {
              await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
              await tx.$executeRawUnsafe(
                `UPDATE product_exchanges SET credit_vnd = credit_vnd - 1, applied_credit_vnd = applied_credit_vnd - 1, payable_vnd = payable_vnd + 1 WHERE id = '${made.id}'`,
              );
              await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
              await tx.$queryRawUnsafe(
                `SELECT lucy_check_invoice_pricing_v3('${made.invoice.id}')`,
              );
            } catch (caught) {
              checkError = caught;
            }
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT swap');
            assert.match(
              String((checkError as Error)?.message),
              /discount total must equal the benefits/,
            );
            assert.equal(done.status, 'COMPLETED');
            await reconcileExchanges();
          },
        );

        await suite.test(
          'nothing is granted: the exchange permissions are held by nobody',
          async () => {
            const holders = await tx.rolePermission.count({
              where: {
                permission: { code: { in: ['REFUND_PRODUCTS', 'MANAGE_PRODUCT_RETURNS'] } },
                role: { code: { not: { startsWith: 'P6_' } } },
              },
            });
            assert.equal(holders, 0);
            const calls = ProductExchangeService.prototype;
            assert.ok(calls.exchange);
            assert.ok(productRefundAmount(300_000n, 3, 0, 1) === 100_000n);
          },
        );
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  loyaltyTierFor,
  productRefundAmount,
  type DiscountVersionInput,
  type ProductRefundSummaryResponse,
} from '@lucy-spa/contracts';
import {
  appendLedgerEntry,
  LocalDiskMediaStorage,
  LOYALTY_EVENT_TYPES,
  processLoyaltyEvent,
} from '@lucy-spa/server';
import { pino } from 'pino';
import { DiscountService } from '../discounts/discount.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { ProductRefundService } from './refund.service.js';
import { ProductReturnService } from './return.service.js';

/**
 * Phase 6 P6-13 against real PostgreSQL (design 8.2-8.4; Q3, Q4, Q5, OQ-19 option A, OQ-23, T21, T22, OQ-80, OQ-81, OQ-83; PRD 28.6):
 * refunds per product line. A refund follows a return case accepted as a refund, gives back some units of one product line by cash or a
 * manual transfer (never PayOS, never the customer's account number), and needs REFUND_PRODUCTS at the branch and a recent password
 * confirmation. The amount is the line's net share of the units (cumulative rounding, so all the refunds add up to the net exactly); the
 * line becomes REFUNDED when every unit is; the record is immutable and a typed reference is corrected by a linked record. Sellable
 * goods go back in new lots named after the return and keeping the sold lot's expiry; the rest moves no stock. The loyalty consumer
 * takes Beauty points back by one linked entry per refund (option A), the tier follows the balance, the Spa wallet and the referral
 * points are untouched, and a money refund is never blocked by the points. An invoice with a refund keeps its payments and stays paid
 * (T22). Vouchers and gifts used on the invoice are not given back (OQ-81). After every step the ledgers and the stock reconcile.
 * Fixtures roll back.
 */
test(
  'Phase 6 P6-13 refunds: authority, money, stock, Beauty points, T22, immutability, reconciliation; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-refunds-'));
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
        const strictRefunds = new ProductRefundService(
          base.adapter,
          base.throttle,
          base.environment,
        );
        const programs = new DiscountService(base.adapter, base.throttle);
        const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
        const refunder = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
        const both = await base.staff(['MANAGE_PRODUCT_RETURNS', 'REFUND_PRODUCTS'], {
          branchId: A.id,
        });
        const elsewhere = await base.staff(['REFUND_PRODUCTS'], { branchId: B.id });
        const stale = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
        const owner = people.owner;

        let customers = 0;
        /** A customer with the given Beauty points (a manual ledger entry): Silver 500, Platinum 3000, Diamond 5000. */
        const member = async (beauty: number) => {
          const created = await k.customer(`rf${++customers}`);
          if (beauty !== 0) {
            await appendLedgerEntry(tx, {
              userId: created.id,
              wallet: 'BEAUTY',
              kind: 'MANUAL_ADJUSTMENT',
              points: beauty,
              idempotencyKey: randomUUID(),
              reason: 'P6-13 fixture',
              actorUserId: owner.id,
            });
          }
          return created;
        };
        const balance = async (userId: string, wallet: 'SPA' | 'BEAUTY' = 'BEAUTY') =>
          (
            await tx.loyaltyWalletAccount.findUnique({
              where: { userId_wallet: { userId, wallet } },
            })
          )?.balancePoints ?? 0;
        const consumeInvoice = async (invoiceId: string) => {
          const outcomes: string[] = [];
          const events = await tx.outboxEvent.findMany({
            where: { aggregateId: invoiceId, eventType: { in: LOYALTY_EVENT_TYPES } },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          });
          for (const event of events) {
            const outcome = await processLoyaltyEvent(tx, event.id);
            if (outcome !== 'NOT_CLAIMED') outcomes.push(`${event.eventType}:${outcome}`);
            await k.settle();
          }
          return outcomes;
        };
        const refundEvents = (refundId?: string) =>
          tx.outboxEvent.findMany({
            where: {
              aggregateType: 'ProductRefund',
              eventType: 'PRODUCT_REFUNDED',
              ...(refundId ? { aggregateId: refundId } : {}),
            },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          });
        /** The `loyalty` consumer handling the refund events (all pending, or one refund); the outcomes in order. */
        const consumeRefunds = async (refundId?: string) => {
          const outcomes: string[] = [];
          for (const event of await refundEvents(refundId)) {
            const outcome = await processLoyaltyEvent(tx, event.id);
            if (outcome !== 'NOT_CLAIMED') outcomes.push(outcome);
            await k.settle();
          }
          return outcomes;
        };
        const reversals = (invoiceId: string) =>
          tx.loyaltyLedgerEntry.findMany({
            where: { invoiceId, kind: 'REFUND_REVERSAL' },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          });

        let saleNo = 0;
        /** A paid counter sale of `quantity` units; the stock sale and the earn entry are recorded unless said otherwise. */
        const sale = async (
          options: {
            quantity?: number;
            price?: number;
            payer?: string | null;
            stock?: boolean;
            loyalty?: boolean;
          } = {},
        ) => {
          const { quantity = 3, price = 100_000, payer = null } = options;
          saleNo += 1;
          const product = await k.product(`rf${saleNo}`, [price]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, quantity + 5);
          const invoice = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, payer), variant.id, quantity),
          );
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          const view = await invoices.get(people.cashier.token, invoice.id);
          if (options.stock !== false) await k.runInventory(invoice.id);
          if (options.loyalty !== false) await consumeInvoice(invoice.id);
          return {
            invoiceId: invoice.id,
            code: invoice.code,
            lineId: view.productLines[0]!.id,
            variantId: variant.id,
            paymentId: paid.payment.id,
            total: BigInt(invoice.totalVnd),
            quantity,
          };
        };
        type Sale = Awaited<ReturnType<typeof sale>>;
        /** A return case for `quantity` units of the sale, accepted as `outcome`. */
        const accepted = async (
          s: Sale,
          options: { quantity?: number; outcome?: 'REFUND' | 'EXCHANGE' } = {},
        ) => {
          const opened = await k.ok(() =>
            returns.open(clerk.token, {
              branchId: A.id,
              invoiceLineId: s.lineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'REFUND',
              quantity: options.quantity ?? s.quantity,
              sealIntact: true,
              notes: null,
              clientRequestId: randomUUID(),
            }),
          );
          return k.ok(() =>
            returns.accept(refunder.token, opened.id, {
              expectedRowVersion: opened.rowVersion,
              outcome: options.outcome ?? 'REFUND',
              note: null,
            }),
          );
        };
        /**
         * Gives a person a NEW password confirmation, as a real person re-entering their password would (P13-3: one confirmation covers
         * one refund). The test-only way: the session row is rewritten with the replica role, like `ageSession`.
         */
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
        /** The service as the screens use it: the person confirms their password before each refund (a new confirmation every time). */
        const refunds = {
          summary: strictRefunds.summary.bind(strictRefunds),
          correctReference: strictRefunds.correctReference.bind(strictRefunds),
          refund: async (...args: Parameters<ProductRefundService['refund']>) => {
            const [token] = args;
            if (token !== undefined) await confirmAgain(token);
            return strictRefunds.refund(...args);
          },
        };
        const refundBody = (patch: Record<string, unknown> = {}) => ({
          quantity: 1,
          method: 'CASH' as const,
          bankReference: null,
          restock: 'SELLABLE' as const,
          reason: 'Khách trả hàng, đã hoàn tiền mặt',
          clientRequestId: randomUUID(),
          ...patch,
        });
        const refundNow = (
          actor: { token: string },
          c: { id: string },
          patch: Record<string, unknown> = {},
        ) => k.ok(() => refunds.refund(actor.token, c.id, refundBody(patch) as never));
        const lastRefund = (summary: ProductRefundSummaryResponse) => summary.refunds.at(-1)!;
        const refundRow = (id: string) => tx.productRefund.findUniqueOrThrow({ where: { id } });
        /** Moves a person's sessions ten minutes back (the test-only way to make a password confirmation stale). */
        const ageSession = async (userId: string) => {
          await tx.$executeRawUnsafe('SAVEPOINT age');
          try {
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(
              `UPDATE sessions SET created_at = created_at - interval '10 minutes', reauthenticated_at = reauthenticated_at - interval '10 minutes' WHERE user_id = '${userId}'`,
            );
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT age');
          } catch (error) {
            await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT age');
            throw error;
          }
        };
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
        const refuses = async (sql: string, why: RegExp, settle = false) => {
          const error = await raw(sql, settle);
          assert.ok(error, `must be refused: ${sql}`);
          assert.match(String((error as Error).message), why);
        };
        const dateAfter = async (days: number) =>
          (
            await tx.$queryRawUnsafe<{ d: string }[]>(
              `SELECT to_char((clock_timestamp() AT TIME ZONE 'Asia/Ho_Chi_Minh')::date + ${days}, 'YYYY-MM-DD') AS d`,
            )
          )[0]!.d;
        const receiveLot = async (
          variantId: string,
          quantity: number,
          expiryDate: string | null,
          lotCode: string,
        ) => {
          const draft = await k.inventory.createReceipt(people.receiver.token, {
            branchId: A.id,
            supplierId: null,
            receiptDate: await k.day(),
            notes: null,
            lines: [{ variantId, quantity, lotCode, expiryDate }],
          });
          await k.ok(() =>
            k.inventory.confirmReceipt(people.receiver.token, draft.id, {
              expectedRowVersion: draft.rowVersion,
            }),
          );
        };

        /** A paid invoice with one service line (no product): there is nothing to return or refund on it. */
        const serviceSale = async () => {
          const draft = await k.serviceDraft([k.exact]);
          const done = await k.finalize(draft);
          await k.pay(done.id, Number(done.totalVnd));
          const line = await tx.invoiceLine.findFirstOrThrow({
            where: { invoiceId: done.id, kind: 'SERVICE' },
          });
          return { invoiceId: done.id, lineId: line.id };
        };
        /** The Owner's reconciliation rules for refunds, after every step. */
        const reconcileRefunds = async () => {
          await k.reconcile();
          const lines = await tx.$queryRaw<
            { line: string; units: bigint; amount: bigint; sold: number; net: bigint }[]
          >`
            SELECT r.invoice_line_id AS line, SUM(r.quantity)::bigint AS units, SUM(r.amount_vnd)::bigint AS amount,
                   l.quantity AS sold, a.net_vnd AS net
            FROM product_refunds r
            JOIN invoice_lines l ON l.id = r.invoice_line_id
            JOIN invoice_line_allocations a ON a.invoice_line_id = r.invoice_line_id
            WHERE r.branch_id IN (${A.id}::uuid, ${B.id}::uuid)
            GROUP BY r.invoice_line_id, l.quantity, a.net_vnd`;
          for (const line of lines) {
            assert.ok(line.units <= BigInt(line.sold), `units refunded of ${line.line}`);
            assert.ok(line.amount <= line.net, `money refunded of ${line.line}`);
            if (line.units === BigInt(line.sold)) {
              assert.equal(line.amount, line.net, `a refunded line gave back its net ${line.line}`);
            }
          }
          const [stock] = await tx.$queryRaw<{ refunded: bigint; returned: bigint }[]>`
            SELECT COALESCE((SELECT SUM(quantity) FROM product_refunds WHERE restock = 'SELLABLE'
                              AND branch_id IN (${A.id}::uuid, ${B.id}::uuid)), 0)::bigint AS refunded,
                   COALESCE((SELECT SUM(quantity_delta) FROM stock_movements WHERE kind = 'REFUND_RETURN'
                              AND branch_id IN (${A.id}::uuid, ${B.id}::uuid)), 0)::bigint AS returned`;
          assert.equal(
            stock!.returned,
            stock!.refunded,
            'sellable units refunded = units put back',
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
          const taken = await tx.$queryRaw<{ invoice: string; taken: bigint; earned: bigint }[]>`
            SELECT e.invoice_id AS invoice, e.points::bigint AS earned,
                   COALESCE((SELECT SUM(-x.points + x.shortfall_points) FROM loyalty_ledger_entries x
                              WHERE x.kind = 'REFUND_REVERSAL' AND x.invoice_id = e.invoice_id
                                AND x.paid_seq = e.paid_seq AND x.wallet = 'BEAUTY'), 0)::bigint AS taken
            FROM loyalty_ledger_entries e WHERE e.kind = 'EARN' AND e.wallet = 'BEAUTY'`;
          for (const entry of taken) {
            assert.ok(entry.taken <= entry.earned, `points taken back of ${entry.invoice}`);
          }
        };

        // ------------------------------------------------------------------------------ before go-live
        const old = await sale({ price: 100_000, quantity: 2, payer: (await member(0)).id });
        await k.runInventory();
        const preLive = await tx.outboxEvent.findMany({
          where: { aggregateId: old.invoiceId, eventType: 'INVOICE_PAID' },
        });
        assert.equal(preLive.length, 1);
        await tx.loyaltyGoLive.create({ data: { activatedByUserId: owner.id } });
        await reconcileRefunds();

        await suite.test(
          'only REFUND_PRODUCTS at the invoice branch refunds or reads refunds; the case must be accepted as a refund',
          async () => {
            const s = await sale();
            const c = await accepted(s, { quantity: 2 });
            // Nobody without the permission, nobody at another branch, not even the clerk who opened the case.
            for (const actor of [clerk, elsewhere, people.cashier, people.nobody]) {
              await fails(
                () => refunds.refund(actor.token, c.id, refundBody() as never),
                'FORBIDDEN',
              );
              await fails(() => refunds.summary(actor.token, c.id), 'FORBIDDEN');
            }
            assert.equal((await returns.get(clerk.token, c.id)).can.refunds, false);
            assert.equal((await returns.get(both.token, c.id)).can.refunds, true);
            // A case that is open, declined, cancelled or accepted for an exchange is not a refund.
            const open = await k.ok(() =>
              returns.open(clerk.token, {
                branchId: A.id,
                invoiceLineId: s.lineId,
                reason: 'PERSONAL_PREFERENCE',
                requestedOutcome: 'REFUND',
                quantity: 1,
                sealIntact: true,
                notes: null,
                clientRequestId: randomUUID(),
              }),
            );
            await fails(() => refundNow(refunder, open), 'REFUND_CASE_NOT_READY');
            const declined = await k.ok(() =>
              returns.decline(refunder.token, open.id, {
                expectedRowVersion: open.rowVersion,
                note: 'Hộp đã mở',
              }),
            );
            await fails(() => refundNow(refunder, declined), 'REFUND_CASE_NOT_READY');
            const s2 = await sale();
            const forExchange = await accepted(s2, { outcome: 'EXCHANGE' });
            await fails(() => refundNow(refunder, forExchange), 'REFUND_CASE_NOT_READY');
            assert.equal(await tx.productRefund.count({ where: { invoiceLineId: s.lineId } }), 0);
            await fails(() => refundNow(refunder, { id: randomUUID() }), 'NOT_FOUND');
            await fails(
              () => refunds.refund(refunder.token, 'not-a-uuid', refundBody() as never),
              'NOT_FOUND',
            );
            const summary = await refunds.summary(refunder.token, c.id);
            assert.equal(summary.refundable, true);
            assert.equal(summary.caseRemainingQuantity, 2);
            assert.equal(summary.lineState, 'NOT_REFUNDED');
            assert.deepEqual(summary.can, { refund: true, correctReference: false });
            await reconcileRefunds();
          },
        );

        await suite.test(
          'a stale password confirmation is refused, and a repeat of a request is read back without one',
          async () => {
            const s = await sale();
            const c = await accepted(s);
            // The session of `stale` confirmed its password ten minutes ago: older than the freshness window.
            await ageSession(stale.id);
            await fails(
              () => strictRefunds.refund(stale.token, c.id, refundBody() as never),
              'REAUTHENTICATION_REQUIRED',
            );
            assert.equal(await tx.productRefund.count({ where: { invoiceLineId: s.lineId } }), 0);
            // A fresh session refunds, and the repeat of the same request is read back without a new confirmation.
            const fleeting = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
            const body = refundBody();
            const made = await k.ok(() =>
              strictRefunds.refund(fleeting.token, c.id, body as never),
            );
            assert.equal(made.refunds.length, 1);
            const row = await refundRow(lastRefund(made).id);
            assert.ok(row.reauthenticatedAt, 'the confirmation is kept as evidence');
            await ageSession(fleeting.id);
            const again = await strictRefunds.refund(fleeting.token, c.id, body as never);
            assert.equal(again.refunds.length, 1, 'the repeat created nothing');
            assert.equal(lastRefund(again).id, lastRefund(made).id);
            // ...but a new request now needs a new confirmation.
            await fails(
              () => strictRefunds.refund(fleeting.token, c.id, refundBody() as never),
              'REAUTHENTICATION_REQUIRED',
            );
          },
        );

        await suite.test(
          'P13-3: one password confirmation covers ONE refund, even inside the freshness window',
          async () => {
            const s = await sale({ quantity: 3 });
            const c = await accepted(s);
            const person = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
            // The session was confirmed seconds ago (fresh): the first refund uses that confirmation...
            const first = await k.ok(() =>
              strictRefunds.refund(person.token, c.id, refundBody() as never),
            );
            assert.equal(first.refunds.length, 1);
            const firstRow = await refundRow(lastRefund(first).id);
            const spent = await tx.refundReauthenticationUse.findMany({
              where: { actorUserId: person.id },
            });
            assert.equal(spent.length, 1, 'the confirmation is spent');
            assert.equal(spent[0]!.productRefundId, firstRow.id);
            assert.equal(
              spent[0]!.reauthenticatedAt.getTime(),
              firstRow.reauthenticatedAt.getTime(),
            );
            // ...the second refund, a few seconds later and still inside the 300 s window, is refused: nothing is written.
            const countsBefore = await tx.productRefund.count({
              where: { invoiceLineId: s.lineId },
            });
            await fails(
              () => strictRefunds.refund(person.token, c.id, refundBody() as never),
              'REAUTHENTICATION_REQUIRED',
            );
            assert.equal(
              await tx.productRefund.count({ where: { invoiceLineId: s.lineId } }),
              countsBefore,
            );
            assert.equal(
              await tx.refundReauthenticationUse.count({ where: { actorUserId: person.id } }),
              1,
            );
            // Typing the password again gives a new confirmation, and the refund goes through.
            await confirmAgain(person.token);
            const second = await k.ok(() =>
              strictRefunds.refund(person.token, c.id, refundBody() as never),
            );
            assert.equal(second.refunds.length, 2);
            assert.equal(
              await tx.refundReauthenticationUse.count({ where: { actorUserId: person.id } }),
              2,
            );
            // A refund that fails its own checks spends nothing (the whole transaction is undone).
            await confirmAgain(person.token);
            await fails(
              () => strictRefunds.refund(person.token, c.id, refundBody({ quantity: 9 }) as never),
              'REFUND_QUANTITY_EXCEEDED',
            );
            assert.equal(
              await tx.refundReauthenticationUse.count({ where: { actorUserId: person.id } }),
              2,
            );
            const third = await k.ok(() =>
              strictRefunds.refund(person.token, c.id, refundBody() as never),
            );
            assert.equal(third.refunds.length, 3, 'the unspent confirmation still works');
            await reconcileRefunds();
          },
        );

        await suite.test(
          'P13-3: the use of a confirmation is history, and the database refuses a refund without its own use',
          async () => {
            const s = await sale({ quantity: 2 });
            const c = await accepted(s);
            const person = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
            const made = lastRefund(
              await k.ok(() => strictRefunds.refund(person.token, c.id, refundBody() as never)),
            );
            const use = await tx.refundReauthenticationUse.findFirstOrThrow({
              where: { productRefundId: made.id },
            });
            const key = `actor_user_id = '${use.actorUserId}' AND reauthenticated_at = '${use.reauthenticatedAt.toISOString()}'`;
            await refuses(
              `UPDATE refund_reauthentication_uses SET product_refund_id = NULL WHERE ${key}`,
              /history/,
            );
            await refuses(`DELETE FROM refund_reauthentication_uses WHERE ${key}`, /history/);
            await refuses(
              `TRUNCATE refund_reauthentication_uses`,
              /never truncated|cannot truncate/,
            );
            // The same confirmation cannot be written twice, whatever the application does.
            await refuses(
              `INSERT INTO refund_reauthentication_uses (actor_user_id, reauthenticated_at, product_refund_id) VALUES ('${use.actorUserId}', '${use.reauthenticatedAt.toISOString()}', '${made.id}')`,
              /duplicate key|refund_reauthentication_uses_pkey/,
            );
            // A refund row written without a use of its confirmation is refused at commit.
            const row = await refundRow(made.id);
            await refuses(
              `INSERT INTO product_refunds (code, branch_id, invoice_id, invoice_line_id, return_case_id, paid_seq, case_ordinal, quantity, amount_vnd, line_units_after, line_amount_after_vnd, invoice_refunded_after_vnd, method, reason, restock, actor_user_id, reauthenticated_at, client_request_id) VALUES ('HT-Y${randomUUID().slice(0, 6)}', '${row.branchId}', '${row.invoiceId}', '${row.invoiceLineId}', '${row.returnCaseId}', 1, 2, 1, ${row.amountVnd}, 2, ${row.amountVnd * 2n}, ${row.amountVnd * 2n}, 'CASH', 'x', 'NOT_SELLABLE', '${row.actorUserId}', clock_timestamp(), '${randomUUID()}')`,
              /uses its own password confirmation once/,
              true,
            );
          },
        );

        await suite.test(
          'every product refund tells the Owner in-app: invoice, product, quantity, amount, method and who refunded',
          async () => {
            const s = await sale({ quantity: 3 });
            const sku = (
              await tx.invoiceLineProduct.findUniqueOrThrow({
                where: { invoiceLineId: s.lineId },
                select: { sku: true },
              })
            ).sku;
            const c = await accepted(s);
            const owners = await tx.user.findMany({
              where: { kind: 'OWNER', status: 'ACTIVE' },
              select: { id: true },
            });
            assert.ok(owners.length >= 1, 'the fixture has an Owner');
            const noticesOf = (userId: string) =>
              tx.notification.findMany({
                where: { recipientUserId: userId, type: 'PRODUCT_REFUND_MADE', entityId: c.id },
                orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
              });
            const bystander = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
            const outsider = await base.staff(['REFUND_PRODUCTS'], { branchId: B.id });

            const made = lastRefund(
              await refundNow(refunder, c, {
                quantity: 2,
                method: 'BANK_TRANSFER_MANUAL',
                bankReference: 'FT26100801',
              }),
            );
            for (const owner of owners) {
              const notices = await noticesOf(owner.id);
              assert.equal(notices.length, 1, 'one notice per Owner account');
              const notice = notices[0]!;
              assert.equal(notice.entityType, 'ProductReturnCase');
              assert.equal(notice.branchId, A.id);
              assert.equal(notice.contextCode, c.code);
              const refunderName = (await tx.user.findUniqueOrThrow({ where: { id: refunder.id } }))
                .fullName;
              assert.deepEqual(notice.params, {
                source: 'REFUND',
                invoiceCode: s.code,
                sku,
                quantity: 2,
                amountVnd: made.amountVnd,
                method: 'BANK_TRANSFER_MANUAL',
                refundedBy: refunderName,
              });
              assert.doesNotMatch(
                JSON.stringify(notice.params),
                /FT26100801/,
                'the transfer reference is not copied into the notice',
              );
              const event = await tx.outboxEvent.findUniqueOrThrow({
                where: { id: notice.sourceEventId },
              });
              assert.equal(event.eventType, 'PRODUCT_REFUND_MADE');
              assert.ok(
                event.publishedAt,
                'written in the transaction: nothing is left to a relay',
              );
            }
            // Nobody else is told: not the case clerk, not a holder at another branch, not the refunder.
            for (const other of [bystander, outsider, refunder]) {
              assert.equal(
                await tx.notification.count({
                  where: { recipientUserId: other.id, type: 'PRODUCT_REFUND_MADE' },
                }),
                0,
              );
            }
            // A repeat of the same request writes nothing more; the next refund writes its own notice.
            const body = refundBody({ quantity: 1 });
            await refundNow(refunder, c, body);
            await strictRefunds.refund(refunder.token, c.id, body as never);
            for (const owner of owners) assert.equal((await noticesOf(owner.id)).length, 2);
            // A refund that is refused leaves no notice.
            await fails(() => refundNow(refunder, c, { quantity: 5 }), 'REFUND_QUANTITY_EXCEEDED');
            for (const owner of owners) assert.equal((await noticesOf(owner.id)).length, 2);
            // The Owner who refunds is told too (every refund), and a cash refund names its method.
            const ownerCase = await accepted(await sale({ quantity: 1 }));
            const byOwner = lastRefund(
              await k.ok(() => refunds.refund(owner.token, ownerCase.id, refundBody() as never)),
            );
            const own = await tx.notification.findMany({
              where: {
                recipientUserId: owner.id,
                type: 'PRODUCT_REFUND_MADE',
                entityId: ownerCase.id,
              },
            });
            assert.equal(own.length, 1);
            assert.equal((own[0]!.params as { method?: string }).method, 'CASH');
            assert.equal((own[0]!.params as { amountVnd?: string }).amountVnd, byOwner.amountVnd);
          },
        );

        await suite.test(
          'the request is validated exactly: method, reference, quantity, reason, stray keys',
          async () => {
            const s = await sale({ quantity: 4 });
            const c = await accepted(s, { quantity: 3 });
            const bad = (patch: Record<string, unknown>, field: string) =>
              fails(() => refundNow(both, c, patch), 'VALIDATION_FAILED', field);
            await bad({ quantity: 0 }, 'quantity');
            await bad({ quantity: 1.5 }, 'quantity');
            await bad({ quantity: '1' }, 'quantity');
            await bad({ method: 'PAYOS' }, 'method');
            await bad({ method: 'CARD' }, 'method');
            await bad({ restock: 'MAYBE' }, 'restock');
            await bad({ reason: '   ' }, 'reason');
            await bad({ reason: 'x'.repeat(501) }, 'reason');
            await bad({ clientRequestId: 'x' }, 'clientRequestId');
            // Cash has no reference; a transfer needs exactly the bank's reference and nothing that looks like a sentence or an account.
            await bad({ method: 'CASH', bankReference: 'FT26280123' }, 'bankReference');
            await bad({ method: 'BANK_TRANSFER_MANUAL', bankReference: null }, 'bankReference');
            await bad({ method: 'BANK_TRANSFER_MANUAL', bankReference: '   ' }, 'bankReference');
            await bad({ method: 'BANK_TRANSFER_MANUAL', bankReference: 'abc' }, 'bankReference');
            await bad(
              { method: 'BANK_TRANSFER_MANUAL', bankReference: '0123 4567 8901' },
              'bankReference',
            );
            await bad(
              { method: 'BANK_TRANSFER_MANUAL', bankReference: 'STK Vietcombank 0123456789' },
              'bankReference',
            );
            await bad(
              { method: 'BANK_TRANSFER_MANUAL', bankReference: `FT${'1'.repeat(70)}` },
              'bankReference',
            );
            await fails(
              () =>
                k.ok(() =>
                  refunds.refund(both.token, c.id, { ...refundBody(), vnd: '5' } as never),
                ),
              'VALIDATION_FAILED',
            );
            await fails(
              () =>
                k.ok(() =>
                  refunds.refund(both.token, c.id, { ...refundBody(), amountVnd: '5' } as never),
                ),
              'VALIDATION_FAILED',
            );
            assert.equal(await tx.productRefund.count({ where: { invoiceLineId: s.lineId } }), 0);
            const ok = await refundNow(both, c, {
              method: 'BANK_TRANSFER_MANUAL',
              bankReference: ' FT26280123456 ',
            });
            assert.equal(lastRefund(ok).bankReference, 'FT26280123456');
            assert.equal(lastRefund(ok).method, 'BANK_TRANSFER_MANUAL');
            await reconcileRefunds();
          },
        );

        await suite.test(
          'the amount is the net share of the units with cumulative rounding: the refunds add up to the net exactly, the line becomes REFUNDED',
          async () => {
            // Silver (3%): 3 x 10,010 = 30,030 less 901 = 29,129, which does not divide by 3.
            const payer = await member(500);
            const s = await sale({ quantity: 3, price: 10_010, payer: payer.id });
            assert.equal(s.total, 29_129n);
            const c = await accepted(s);
            const amounts: bigint[] = [];
            for (let unit = 1; unit <= 3; unit += 1) {
              const before = await refunds.summary(refunder.token, c.id);
              assert.equal(
                before.lineState,
                unit === 1 ? 'NOT_REFUNDED' : 'PARTIALLY_REFUNDED',
                `before unit ${unit}`,
              );
              const made = await refundNow(refunder, c);
              amounts.push(BigInt(lastRefund(made).amountVnd));
              assert.equal(made.lineRefundedQuantity, unit);
              assert.equal(made.caseRemainingQuantity, 3 - unit);
            }
            assert.deepEqual(amounts, [9_710n, 9_709n, 9_710n]);
            assert.equal(
              amounts.reduce((sum, amount) => sum + amount, 0n),
              29_129n,
            );
            const done = await refunds.summary(refunder.token, c.id);
            assert.equal(done.lineState, 'REFUNDED');
            assert.equal(done.lineRefundedVnd, '29129');
            assert.equal(done.refundable, false);
            assert.equal(done.blocked, 'NOTHING_LEFT');
            assert.equal(done.can.refund, false);
            await fails(() => refundNow(refunder, c), 'REFUND_QUANTITY_EXCEEDED', 'quantity');
            // The shared rule gives the same numbers as the database stored.
            assert.deepEqual(
              [0, 1, 2].map((before) => productRefundAmount(29_129n, 3, before, 1)),
              amounts,
            );
            assert.equal(productRefundAmount(29_129n, 3, 0, 3), 29_129n);
            assert.equal(productRefundAmount(29_129n, 3, 1, 2), 9_709n + 9_710n);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'the units refunded never exceed the case, nor the line; several cases of one line share it; two units in one refund',
          async () => {
            const s = await sale({ quantity: 5, price: 20_000 });
            const first = await accepted(s, { quantity: 2 });
            await fails(
              () => refundNow(refunder, first, { quantity: 3 }),
              'REFUND_QUANTITY_EXCEEDED',
              'quantity',
            );
            const two = await refundNow(refunder, first, { quantity: 2 });
            assert.equal(lastRefund(two).quantity, 2);
            assert.equal(lastRefund(two).amountVnd, '40000');
            await fails(() => refundNow(refunder, first), 'REFUND_QUANTITY_EXCEEDED');
            // A second case for the rest of the line; the line is REFUNDED only when every unit is.
            const second = await accepted(s, { quantity: 3 });
            const partial = await refunds.summary(refunder.token, second.id);
            assert.equal(partial.lineRefundedQuantity, 2);
            assert.equal(partial.lineState, 'PARTIALLY_REFUNDED');
            assert.equal(partial.caseRemainingQuantity, 3);
            await refundNow(refunder, second, { quantity: 3 });
            const done = await refunds.summary(refunder.token, second.id);
            assert.equal(done.lineState, 'REFUNDED');
            assert.equal(done.lineRefundedVnd, '100000');
            // The refunds of one case are numbered in order.
            assert.deepEqual(
              (await tx.productRefund.findMany({ where: { returnCaseId: first.id } })).map(
                (r) => r.caseOrdinal,
              ),
              [1],
            );
            await reconcileRefunds();
          },
        );

        await suite.test(
          'the same request is one refund: a repeat returns it, the same id with other content is a conflict',
          async () => {
            const s = await sale();
            const c = await accepted(s);
            const body = refundBody({ quantity: 2 });
            const first = await k.ok(() => refunds.refund(refunder.token, c.id, body as never));
            const audits = await tx.auditEvent.count({ where: { action: 'PRODUCT_REFUNDED' } });
            const events = (await refundEvents()).length;
            const movements = await tx.stockMovement.count({ where: { kind: 'REFUND_RETURN' } });
            const again = await k.ok(() => refunds.refund(refunder.token, c.id, body as never));
            assert.equal(again.refunds.length, 1);
            assert.equal(lastRefund(again).id, lastRefund(first).id);
            assert.equal(
              await tx.auditEvent.count({ where: { action: 'PRODUCT_REFUNDED' } }),
              audits,
            );
            assert.equal((await refundEvents()).length, events);
            assert.equal(
              await tx.stockMovement.count({ where: { kind: 'REFUND_RETURN' } }),
              movements,
            );
            for (const changed of [
              { quantity: 1 },
              { method: 'BANK_TRANSFER_MANUAL', bankReference: 'FT0001' },
              { restock: 'NOT_SELLABLE' },
              { reason: 'Lý do khác' },
            ]) {
              await fails(
                () => refunds.refund(refunder.token, c.id, { ...body, ...changed } as never),
                'CONFLICT',
              );
            }
            assert.equal(await tx.productRefund.count({ where: { returnCaseId: c.id } }), 1);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'a refund records who, when, the reason and the method; the audit log keeps the reason and never the reference',
          async () => {
            const s = await sale();
            const c = await accepted(s);
            const made = await refundNow(refunder, c, {
              method: 'BANK_TRANSFER_MANUAL',
              bankReference: 'FT26280999',
              reason: 'Khách chuyển khoản, đã gửi tiền',
              restock: 'NOT_SELLABLE',
            });
            const shown = lastRefund(made);
            assert.match(shown.code, /^HT\d{6}$/);
            assert.equal(
              shown.actorName,
              (await tx.user.findUniqueOrThrow({ where: { id: refunder.id } })).fullName,
            );
            assert.equal(shown.reason, 'Khách chuyển khoản, đã gửi tiền');
            assert.equal(shown.amountVnd, '100000');
            const audit = await tx.auditEvent.findMany({
              where: { entityId: shown.id, action: 'PRODUCT_REFUNDED' },
            });
            assert.equal(audit.length, 1);
            assert.equal(audit[0]!.dataClassification, 'FINANCIAL');
            assert.equal(audit[0]!.actorUserId, refunder.id);
            assert.equal(audit[0]!.reason, 'Khách chuyển khoản, đã gửi tiền');
            assert.doesNotMatch(JSON.stringify(audit[0]!.after), /FT26280999/);
            assert.equal(
              (audit[0]!.after as { bankReferenceRecorded: boolean }).bankReferenceRecorded,
              true,
            );
            // No payment, attempt or provider event exists for a refund: nothing in the payment tables changed (Q4: no PayOS call).
            assert.equal(await tx.payment.count({ where: { invoiceId: s.invoiceId } }), 1);
            assert.equal(
              await tx.paymentAttempt.count({ where: { payment: { invoiceId: s.invoiceId } } }),
              0,
            );
            assert.equal(
              (await tx.invoice.findUniqueOrThrow({ where: { id: s.invoiceId } })).status,
              'PAID',
            );
            const outbox = await refundEvents(shown.id);
            assert.equal(outbox.length, 1);
            assert.deepEqual(Object.keys(outbox[0]!.payload as object).sort(), [
              'branchId',
              'invoiceId',
              'refundId',
            ]);
            await reconcileRefunds();
          },
        );

        // --------------------------------------------------------------------------------------- stock
        await suite.test(
          'sellable goods go back in a new lot named after the return and keeping the expiry; not sellable moves no stock',
          async () => {
            const product = await k.product('lots', [100_000]);
            const variant = product.variants[0]!;
            const soon = await dateAfter(10);
            const late = await dateAfter(30);
            await receiveLot(variant.id, 2, soon, 'SOON');
            await receiveLot(variant.id, 5, late, 'LATE');
            const invoice = await k.finalize(
              await k.addLine(await k.openSale(people.cashier, null), variant.id, 4),
            );
            await k.pay(invoice.id, Number(invoice.totalVnd));
            const view = await invoices.get(people.cashier.token, invoice.id);
            await k.runInventory(invoice.id);
            const s: Sale = {
              invoiceId: invoice.id,
              code: invoice.code,
              lineId: view.productLines[0]!.id,
              variantId: variant.id,
              paymentId: '',
              total: BigInt(invoice.totalVnd),
              quantity: 4,
            };
            // The sale took 2 from SOON and 2 from LATE (first expiry first).
            const levelBefore = await k.levelOf(variant.id);
            const c = await accepted(s, { quantity: 3 });
            // Three units: two came from SOON, one from LATE; one refund, two lots, each with its own expiry.
            const made = await refundNow(refunder, c, { quantity: 3 });
            const one = lastRefund(made);
            assert.equal(one.restock, 'SELLABLE');
            assert.deepEqual(one.lotCodes, [`${c.code}-1/1`, `${c.code}-1/2`]);
            const lots = await tx.inventoryLot.findMany({
              where: { sourceRefundId: one.id },
              orderBy: [{ lotCode: 'asc' }],
            });
            assert.deepEqual(
              lots.map((lot) => [
                lot.lotCode,
                lot.quantityOnHand,
                lot.expiryDate?.toISOString().slice(0, 10),
              ]),
              [
                [`${c.code}-1/1`, 2, soon],
                [`${c.code}-1/2`, 1, late],
              ],
            );
            assert.ok(
              lots.every((lot) => lot.sourceReceiptLineId === null && lot.branchId === A.id),
            );
            const level = await k.levelOf(variant.id);
            assert.equal(level!.onHand, levelBefore!.onHand + 3);
            assert.equal(level!.reserved, levelBefore!.reserved);
            const movements = await tx.stockMovement.findMany({
              where: { productRefundId: one.id },
            });
            assert.equal(movements.length, 2);
            assert.ok(movements.every((m) => m.kind === 'REFUND_RETURN' && m.quantityDelta > 0));
            assert.ok(
              movements.every((m) => m.invoiceLineId === null && m.actorUserId === refunder.id),
            );
            // The response carries lot codes only: no cost, no quantity on hand.
            assert.doesNotMatch(JSON.stringify(made), /unitCost|quantityOnHand|onHand/);
            // The fourth unit is not sellable (the box was opened): nothing moves.
            const second = await accepted(s, { quantity: 1 });
            const movementsBefore = await tx.stockMovement.count();
            const lotsBefore = await tx.inventoryLot.count();
            const bad = await refundNow(refunder, second, { restock: 'NOT_SELLABLE' });
            assert.equal(lastRefund(bad).restock, 'NOT_SELLABLE');
            assert.deepEqual(lastRefund(bad).lotCodes, []);
            assert.equal(await tx.stockMovement.count(), movementsBefore);
            assert.equal(await tx.inventoryLot.count(), lotsBefore);
            assert.equal((await k.levelOf(variant.id))!.onHand, level!.onHand);
            // The returned goods can be sold again: they are available.
            assert.equal(await k.availableOf(variant.id), level!.onHand - level!.reserved);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'a refund of units sold later in the line starts where the earlier refunds ended; every returned lot keeps the expiry of its source',
          async () => {
            const product = await k.product('lots2', [50_000]);
            const variant = product.variants[0]!;
            const soon = await dateAfter(5);
            const late = await dateAfter(25);
            await receiveLot(variant.id, 2, soon, 'S2');
            await receiveLot(variant.id, 5, late, 'L2');
            const invoice = await k.finalize(
              await k.addLine(await k.openSale(people.cashier, null), variant.id, 4),
            );
            await k.pay(invoice.id, Number(invoice.totalVnd));
            const view = await invoices.get(people.cashier.token, invoice.id);
            await k.runInventory(invoice.id);
            const s: Sale = {
              invoiceId: invoice.id,
              code: invoice.code,
              lineId: view.productLines[0]!.id,
              variantId: variant.id,
              paymentId: '',
              total: BigInt(invoice.totalVnd),
              quantity: 4,
            };
            const c = await accepted(s);
            const expiries: (string | undefined)[] = [];
            for (let unit = 0; unit < 4; unit += 1) {
              const made = await refundNow(refunder, c);
              const lot = await tx.inventoryLot.findFirstOrThrow({
                where: { sourceRefundId: lastRefund(made).id },
              });
              expiries.push(lot.expiryDate?.toISOString().slice(0, 10));
              assert.equal(lot.lotCode, `${c.code}-${unit + 1}`);
            }
            assert.deepEqual(expiries, [soon, soon, late, late]);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'sellable goods need the sale to be recorded in stock; a money refund of not sellable goods never waits for it',
          async () => {
            const s = await sale({ stock: false });
            const c = await accepted(s, { quantity: 2 });
            await fails(() => refundNow(refunder, c), 'REFUND_STOCK_PENDING');
            assert.equal(await tx.productRefund.count({ where: { invoiceLineId: s.lineId } }), 0);
            // Not sellable: the money goes back now; the sale reaches stock later, exactly as if no refund had happened.
            const money = await refundNow(refunder, c, { restock: 'NOT_SELLABLE' });
            assert.equal(lastRefund(money).restock, 'NOT_SELLABLE');
            assert.deepEqual(await k.runInventory(s.invoiceId), ['APPLIED']);
            // Now the sale is recorded, the other unit can be put back.
            const ok = await refundNow(refunder, c);
            assert.equal(lastRefund(ok).lotCodes.length, 1);
            await reconcileRefunds();
          },
        );

        // ---------------------------------------------------------------------------------------- points
        await suite.test(
          'option A: a partial refund reverses what the rest no longer earns; the last refund returns the wallet to its value before the sale',
          async () => {
            // 2 x 1,500 = 3,000 earns 3 points. Refunding one unit leaves 1,500 = 1 point, so 2 are taken back; the second takes the last.
            const payer = await member(0);
            const s = await sale({ quantity: 2, price: 1_500, payer: payer.id });
            assert.equal(await balance(payer.id), 3);
            const c = await accepted(s);
            const first = await refundNow(refunder, c);
            assert.deepEqual(await consumeRefunds(lastRefund(first).id), ['APPLIED']);
            assert.equal(await balance(payer.id), 1);
            const [entry] = await reversals(s.invoiceId);
            assert.equal(entry!.kind, 'REFUND_REVERSAL');
            assert.equal(entry!.points, -2);
            assert.equal(entry!.wallet, 'BEAUTY');
            assert.equal(entry!.productRefundId, lastRefund(first).id);
            assert.equal(entry!.idempotencyKey, `BEAUTY_REFUND:${lastRefund(first).id}`);
            assert.equal(entry!.actorUserId, refunder.id);
            assert.equal(entry!.paidSeq, 1);
            const second = await refundNow(refunder, c);
            assert.deepEqual(await consumeRefunds(lastRefund(second).id), ['APPLIED']);
            assert.equal(await balance(payer.id), 0, 'back to the value before the sale');
            assert.deepEqual(
              (await reversals(s.invoiceId)).map((r) => r.points),
              [-2, -1],
            );
            // The earn entry is kept, and a replay of an event writes nothing.
            const earn = await tx.loyaltyLedgerEntry.findMany({
              where: { invoiceId: s.invoiceId, kind: 'EARN' },
            });
            assert.deepEqual(
              earn.map((e) => e.points),
              [3],
            );
            // A replay of an event already handled writes nothing.
            const [handled] = await refundEvents(lastRefund(first).id);
            assert.equal(await processLoyaltyEvent(tx, handled!.id), 'NOT_CLAIMED');
            await reconcileRefunds();
          },
        );

        await suite.test(
          'PRD 28.6: 5,160 points (Diamond) become 4,400 (Platinum) after a full refund; the tier follows the balance and the Spa wallet is not touched',
          async () => {
            const payer = await member(4_400);
            assert.equal(loyaltyTierFor(4_400).tier, 'PLATINUM');
            const s = await sale({ quantity: 1, price: 800_000, payer: payer.id });
            assert.equal(s.total, 760_000n, 'Platinum pays 5% less');
            assert.equal(await balance(payer.id), 5_160);
            assert.equal(loyaltyTierFor(await balance(payer.id)).tier, 'DIAMOND');
            const c = await accepted(s);
            const made = await refundNow(refunder, c);
            assert.equal(lastRefund(made).amountVnd, '760000');
            assert.deepEqual(await consumeRefunds(lastRefund(made).id), ['APPLIED']);
            assert.equal(await balance(payer.id), 4_400);
            assert.equal(loyaltyTierFor(await balance(payer.id)).tier, 'PLATINUM');
            assert.equal(
              lastRefund(await refunds.summary(refunder.token, c.id)).beautyPointsTakenBack,
              760,
            );
            assert.equal(await balance(payer.id, 'SPA'), 0);
            assert.equal(
              await tx.loyaltyLedgerEntry.count({ where: { userId: payer.id, wallet: 'SPA' } }),
              0,
            );
            await reconcileRefunds();
          },
        );

        await suite.test(
          'a balance too small to absorb the reversal records a shortfall; the money refund is never blocked by the points',
          async () => {
            const payer = await member(0);
            const s = await sale({ quantity: 2, price: 100_000, payer: payer.id });
            assert.equal(await balance(payer.id), 200);
            // The customer spent 150 points elsewhere.
            await appendLedgerEntry(tx, {
              userId: payer.id,
              wallet: 'BEAUTY',
              kind: 'MANUAL_ADJUSTMENT',
              points: -150,
              idempotencyKey: randomUUID(),
              reason: 'P6-13 fixture: spent',
              actorUserId: owner.id,
            });
            assert.equal(await balance(payer.id), 50);
            const c = await accepted(s);
            const made = await refundNow(refunder, c, { quantity: 2 });
            assert.equal(lastRefund(made).amountVnd, '200000', 'the money refund went through');
            assert.deepEqual(await consumeRefunds(lastRefund(made).id), ['APPLIED']);
            const [entry] = await reversals(s.invoiceId);
            assert.equal(entry!.points, -50, 'only what the balance holds is applied');
            assert.equal(entry!.shortfallPoints, 150);
            assert.equal(await balance(payer.id), 0);
            assert.equal(
              await tx.auditEvent.count({
                where: { action: 'LOYALTY_SHORTFALL_FLAGGED', entityId: entry!.id },
              }),
              1,
              'listed in the Exceptions',
            );
            const shown = lastRefund(await refunds.summary(refunder.token, c.id));
            assert.equal(shown.beautyPointsTakenBack, 50);
            assert.equal(shown.beautyPointsShortfall, 150);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'a guest, a sale before go-live and a sale that earned nothing take no points back; the referral points are never revoked',
          async () => {
            const guest = await sale({ quantity: 2, price: 100_000, payer: null });
            const guestCase = await accepted(guest);
            const g = await refundNow(refunder, guestCase);
            assert.deepEqual(await consumeRefunds(lastRefund(g).id), ['SKIPPED_GUEST']);
            assert.equal((await reversals(guest.invoiceId)).length, 0);
            // The sale paid before go-live (P5-Q1: no backfill) earned nothing, so there is nothing to take back.
            const c = await accepted(old, { quantity: 2 });
            const made = await refundNow(refunder, c, { quantity: 2 });
            assert.equal(lastRefund(made).amountVnd, '200000');
            assert.deepEqual(await consumeRefunds(lastRefund(made).id), ['NOOP']);
            assert.equal((await reversals(old.invoiceId)).length, 0);
            // Referral points of anyone are not touched by a refund.
            const payer = await member(0);
            const referrer = await member(0);
            const s = await sale({ quantity: 1, price: 100_000, payer: payer.id });
            const referral = await tx.referral.create({
              data: {
                referredUserId: payer.id,
                referrerUserId: referrer.id,
                boundVia: 'COUNTER',
                boundByUserId: owner.id,
              },
            });
            for (const wallet of ['SPA', 'BEAUTY'] as const) {
              await appendLedgerEntry(tx, {
                userId: referrer.id,
                wallet,
                kind: 'REFERRAL_AWARD',
                points: 10,
                idempotencyKey: `REFERRAL_AWARD:${referral.id}:${wallet}`,
                referralId: referral.id,
              });
            }
            await tx.referral.update({
              where: { id: referral.id },
              data: { awardedAt: new Date(), awardedInvoiceId: s.invoiceId, awardedPaidSeq: 1 },
            });
            const awards = async () =>
              JSON.stringify(
                await tx.loyaltyLedgerEntry.findMany({
                  where: { referralId: referral.id },
                  orderBy: { wallet: 'asc' },
                  select: { id: true, wallet: true, points: true },
                }),
              );
            const awardsBefore = await awards();
            const rc = await accepted(s);
            const done = await refundNow(refunder, rc);
            assert.deepEqual(await consumeRefunds(lastRefund(done).id), ['APPLIED']);
            assert.equal(await awards(), awardsBefore, 'the referral award is never taken back');
            assert.equal(await balance(referrer.id), 10);
            assert.equal(await balance(referrer.id, 'SPA'), 10);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'refunds handled out of order still take back the same total; a refund waits for the earn entry instead of dropping the reversal',
          async () => {
            const payer = await member(0);
            const s = await sale({ quantity: 3, price: 10_000, payer: payer.id });
            assert.equal(await balance(payer.id), 30);
            const c = await accepted(s);
            const r1 = lastRefund(await refundNow(refunder, c));
            const r2 = lastRefund(await refundNow(refunder, c));
            // The second event first: it takes back everything due so far (20); the first then finds nothing left to take.
            assert.deepEqual(await consumeRefunds(r2.id), ['APPLIED']);
            assert.deepEqual(await consumeRefunds(r1.id), ['NOOP']);
            assert.equal(await balance(payer.id), 10);
            const r3 = lastRefund(await refundNow(refunder, c));
            assert.deepEqual(await consumeRefunds(r3.id), ['APPLIED']);
            assert.equal(await balance(payer.id), 0);
            assert.deepEqual(
              (await reversals(s.invoiceId)).map((r) => r.points),
              [-20, -10],
            );
            // The earn entry of a paid episode that the worker has not handled yet: the refund event waits (it throws and is retried).
            const late = await member(0);
            const l = await sale({ quantity: 1, price: 10_000, payer: late.id, loyalty: false });
            const lc = await accepted(l);
            const lr = lastRefund(await refundNow(refunder, lc));
            const [event] = await refundEvents(lr.id);
            await assert.rejects(() => processLoyaltyEvent(tx, event!.id), /not recorded yet/);
            assert.equal(
              await tx.outboxConsumption.count({ where: { eventId: event!.id } }),
              0,
              'still pending',
            );
            assert.deepEqual(await consumeInvoice(l.invoiceId), ['INVOICE_PAID:APPLIED']);
            assert.deepEqual(await consumeRefunds(lr.id), ['APPLIED']);
            assert.equal(await balance(late.id), 0);
            await reconcileRefunds();
          },
        );

        // ------------------------------------------------------------------------------------- vouchers
        await suite.test(
          'a voucher used on the invoice is not given back automatically (OQ-81)',
          async () => {
            const created = await programs.create(owner.token, {
              code: `P613${base.run}`.slice(0, 24),
              nameVi: 'Voucher hoàn tiền',
              nameEn: 'Refund voucher',
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
            const code = `V613${base.run}`.slice(0, 24);
            await programs.createVoucher(owner.token, created.id, { code });
            const payer = await member(0);
            const product = await k.product('voucher', [100_000]);
            const variant = product.variants[0]!;
            await k.receive(variant.id, 20);
            let draft = await k.openSale(people.cashier, payer.id);
            draft = await k.addLine(draft, variant.id, 2);
            draft = await k.ok(() =>
              invoices.supplyVoucher(people.cashier.token, draft.id, {
                expectedVersion: draft.version,
                code,
              }),
            );
            const invoice = await k.finalize(draft);
            assert.equal(invoice.totalVnd, '170000', 'the voucher took 30,000 off 200,000');
            await k.pay(invoice.id, 170_000);
            const view = await invoices.get(people.cashier.token, invoice.id);
            await k.runInventory(invoice.id);
            await consumeInvoice(invoice.id);
            const state = async () => ({
              redemptions: JSON.stringify(
                await tx.discountRedemption.findMany({
                  where: { invoiceId: invoice.id },
                  include: { release: true },
                }),
                (_key, value) => (typeof value === 'bigint' ? value.toString() : value),
              ),
              vouchers: JSON.stringify(
                await tx.voucher.findMany({ where: { discountId: created.id } }),
              ),
              birthday: await tx.birthdayRedemption.count(),
              entries: await tx.invoiceVoucherEntry.count({ where: { invoiceId: invoice.id } }),
            });
            const before = await state();
            assert.match(before.redemptions, /"voucherId"/);
            const s: Sale = {
              invoiceId: invoice.id,
              code: invoice.code,
              lineId: view.productLines[0]!.id,
              variantId: variant.id,
              paymentId: '',
              total: 170_000n,
              quantity: 2,
            };
            const c = await accepted(s);
            const made = await refundNow(refunder, c, { quantity: 2 });
            // Refunded what was actually paid for the units: 170,000, not 200,000.
            assert.equal(lastRefund(made).amountVnd, '170000');
            await consumeRefunds(lastRefund(made).id);
            assert.deepEqual(
              await state(),
              before,
              'redemptions, vouchers and gifts are exactly as they were',
            );
            assert.equal(
              await tx.discountRedemptionRelease.count({
                where: { redemption: { invoiceId: invoice.id } },
              }),
              0,
            );
            await reconcileRefunds();
          },
        );

        // ----------------------------------------------------------------------------------- T22
        await suite.test(
          'an invoice with a refund keeps its payments and stays paid: no payment reversal, no cancellation, in the API and in the database',
          async () => {
            const s = await sale({ quantity: 2, price: 100_000 });
            const view = await invoices.get(people.cashier.token, s.invoiceId);
            // Before any refund the correction paths are as they were (checked by the Phase 4 suites); after one they are closed.
            const c = await accepted(s);
            await refundNow(refunder, c);
            await fails(
              () =>
                invoices.reversePayment(people.boss.token, s.invoiceId, s.paymentId, {
                  reason: 'Nhập sai',
                }),
              'INVOICE_HAS_REFUND',
            );
            await fails(
              () =>
                invoices.cancel(people.boss.token, s.invoiceId, {
                  expectedVersion: view.version,
                  reason: 'Hủy',
                }),
              'INVOICE_HAS_REFUND',
            );
            await refuses(
              `INSERT INTO payment_corrections (payment_id, reason, actor_user_id) VALUES ('${s.paymentId}', 'x', '${people.boss.id}')`,
              /An invoice with a refund keeps its payments and stays paid/,
            );
            await refuses(
              `UPDATE invoices SET status = 'PENDING_PAYMENT', paid_at = NULL, row_version = row_version + 1 WHERE id = '${s.invoiceId}'`,
              /An invoice with a refund keeps its payments and stays paid/,
            );
            await refuses(
              `UPDATE invoices SET status = 'CANCELLED' WHERE id = '${s.invoiceId}'`,
              /./,
            );
            const after = await tx.invoice.findUniqueOrThrow({ where: { id: s.invoiceId } });
            assert.equal(after.status, 'PAID');
            assert.equal(
              await tx.paymentCorrection.count({ where: { payment: { invoiceId: s.invoiceId } } }),
              0,
            );
            // An invoice without a refund can still be corrected (the guard is about refunds only).
            const clean = await sale({ quantity: 1 });
            const reversed = await k.ok(() =>
              invoices.reversePayment(people.boss.token, clean.invoiceId, clean.paymentId, {
                reason: 'Nhập sai',
              }),
            );
            assert.equal(reversed.invoice.status, 'PENDING_PAYMENT');
            await reconcileRefunds();
          },
        );

        // ---------------------------------------------------------------------------- corrections
        await suite.test(
          'a typed transfer reference is corrected by a new linked record; the refund never changes; cash has nothing to correct',
          async () => {
            const s = await sale({ quantity: 2 });
            const c = await accepted(s);
            const cash = lastRefund(await refundNow(refunder, c));
            const transfer = lastRefund(
              await refundNow(refunder, c, {
                method: 'BANK_TRANSFER_MANUAL',
                bankReference: 'FT0001',
              }),
            );
            await fails(
              () =>
                refunds.correctReference(refunder.token, c.id, cash.id, {
                  bankReference: 'FT0002',
                  reason: 'Gõ sai',
                }),
              'VALIDATION_FAILED',
              'bankReference',
            );
            for (const actor of [clerk, elsewhere, people.cashier]) {
              await fails(
                () =>
                  refunds.correctReference(actor.token, c.id, transfer.id, {
                    bankReference: 'FT0002',
                    reason: 'Gõ sai',
                  }),
                'FORBIDDEN',
              );
            }
            await fails(
              () =>
                refunds.correctReference(refunder.token, c.id, transfer.id, {
                  bankReference: '0123 456',
                  reason: 'Gõ sai',
                }),
              'VALIDATION_FAILED',
              'bankReference',
            );
            await fails(
              () =>
                refunds.correctReference(refunder.token, c.id, transfer.id, {
                  bankReference: 'FT0002',
                  reason: '  ',
                }),
              'VALIDATION_FAILED',
              'reason',
            );
            await fails(
              () =>
                refunds.correctReference(refunder.token, c.id, randomUUID(), {
                  bankReference: 'FT0002',
                  reason: 'Gõ sai',
                }),
              'NOT_FOUND',
            );
            const before = await refundRow(transfer.id);
            const corrected = await k.ok(() =>
              refunds.correctReference(refunder.token, c.id, transfer.id, {
                bankReference: 'FT0002',
                reason: 'Gõ sai số cuối',
              }),
            );
            const shown = corrected.refunds.find((entry) => entry.id === transfer.id)!;
            assert.equal(shown.bankReference, 'FT0002');
            assert.equal(shown.firstBankReference, 'FT0001');
            assert.equal(shown.corrections.length, 1);
            assert.equal(shown.corrections[0]!.reason, 'Gõ sai số cuối');
            assert.deepEqual(await refundRow(transfer.id), before, 'the refund row never changed');
            assert.equal(
              await tx.auditEvent.count({
                where: { entityId: transfer.id, action: 'PRODUCT_REFUND_REFERENCE_CORRECTED' },
              }),
              1,
            );
            await reconcileRefunds();
          },
        );

        // ----------------------------------------------------------------------------- database guards
        await suite.test(
          'the database is the backstop: immutable refunds, the amount, the case, services and combos, the stock and the points',
          async () => {
            const s = await sale({ quantity: 3, price: 100_000, payer: (await member(0)).id });
            const c = await accepted(s, { quantity: 2 });
            const made = lastRefund(await refundNow(refunder, c));
            const row = await refundRow(made.id);
            await consumeRefunds(made.id);
            // History: never updated, deleted or truncated.
            await refuses(
              `UPDATE product_refunds SET reason = 'khác' WHERE id = '${made.id}'`,
              /history/,
            );
            await refuses(
              `UPDATE product_refunds SET amount_vnd = 1 WHERE id = '${made.id}'`,
              /history/,
            );
            await refuses(`DELETE FROM product_refunds WHERE id = '${made.id}'`, /history/);
            await refuses(`TRUNCATE product_refunds`, /never truncated|cannot truncate/);
            const insert = (patch: Record<string, string>) => {
              const values: Record<string, string> = {
                code: `'HT-X${randomUUID().slice(0, 6)}'`,
                branch_id: `'${row.branchId}'`,
                invoice_id: `'${row.invoiceId}'`,
                invoice_line_id: `'${row.invoiceLineId}'`,
                return_case_id: `'${row.returnCaseId}'`,
                paid_seq: '1',
                case_ordinal: '2',
                quantity: '1',
                amount_vnd: '100000',
                line_units_after: '2',
                line_amount_after_vnd: '200000',
                invoice_refunded_after_vnd: '200000',
                method: `'CASH'`,
                bank_reference: 'NULL',
                reason: `'x'`,
                restock: `'NOT_SELLABLE'`,
                actor_user_id: `'${refunder.id}'`,
                reauthenticated_at: 'clock_timestamp()',
                client_request_id: `'${randomUUID()}'`,
                ...patch,
              };
              return `INSERT INTO product_refunds (${Object.keys(values).join(', ')}) VALUES (${Object.values(values).join(', ')})`;
            };
            // A valid second refund is accepted by the database, so each refusal below is about the rule, not the shape.
            // (With the use of its own password confirmation, which the database requires of every new refund at commit.)
            const withUse = (statement: string) =>
              `WITH r AS (${statement} RETURNING id, actor_user_id, reauthenticated_at) INSERT INTO refund_reauthentication_uses (actor_user_id, reauthenticated_at, product_refund_id) SELECT actor_user_id, reauthenticated_at, id FROM r`;
            const valid = await raw(withUse(insert({})), true);
            assert.equal(valid, null, `a valid refund passes: ${String(valid)}`);
            await refuses(
              insert({
                amount_vnd: '99999',
                line_amount_after_vnd: '199999',
                invoice_refunded_after_vnd: '199999',
              }),
              /net share of the units refunded/,
            );
            await refuses(
              insert({
                quantity: '2',
                line_units_after: '3',
                amount_vnd: '200000',
                line_amount_after_vnd: '300000',
                invoice_refunded_after_vnd: '300000',
              }),
              /more units than it accepted/,
            );
            await refuses(insert({ case_ordinal: '3' }), /numbered in order/);
            await refuses(insert({ line_units_after: '5' }), /running totals/);
            await refuses(
              insert({ invoice_refunded_after_vnd: '999' }),
              /running total of an invoice/,
            );
            await refuses(insert({ paid_seq: '2' }), /current paid episode/);
            await refuses(insert({ branch_id: `'${B.id}'` }), /branch of its invoice/);
            await refuses(
              insert({ method: `'BANK_TRANSFER_MANUAL'` }),
              /product_refunds_reference/,
            );
            await refuses(
              insert({ method: `'CASH'`, bank_reference: `'FT0001'` }),
              /product_refunds_reference/,
            );
            await refuses(
              insert({ method: `'BANK_TRANSFER_MANUAL'`, bank_reference: `'0123 4567'` }),
              /product_refunds_reference/,
            );
            await refuses(insert({ reason: `'  '` }), /product_refunds_reason/);
            await refuses(
              insert({
                amount_vnd: '0',
                line_amount_after_vnd: '100000',
                invoice_refunded_after_vnd: '100000',
              }),
              /net share of the units refunded/,
            );
            // A case that is not accepted as a refund, or belongs to another line, is not a basis for a refund.
            const other = await sale({ quantity: 1 });
            const otherCase = await accepted(other, { outcome: 'EXCHANGE' });
            await refuses(
              insert({
                invoice_id: `'${other.invoiceId}'`,
                invoice_line_id: `'${other.lineId}'`,
                return_case_id: `'${otherCase.id}'`,
                case_ordinal: '1',
                line_units_after: '1',
                amount_vnd: '100000',
                line_amount_after_vnd: '100000',
                invoice_refunded_after_vnd: '100000',
              }),
              /accepted return case that was decided as a refund/,
            );
            await refuses(
              insert({ return_case_id: `'${otherCase.id}'` }),
              /accepted return case that was decided as a refund/,
            );
            // A service line has no product detail row, so no refund can name it (PRD 29).
            const service = await serviceSale();
            await refuses(
              insert({
                invoice_id: `'${service.invoiceId}'`,
                invoice_line_id: `'${service.lineId}'`,
                return_case_id: `'${row.returnCaseId}'`,
              }),
              /product_refunds_product_line_fkey|follows an accepted return case|paid invoice/,
            );
            // Stock: a sellable refund without its movement is refused at commit; a movement for a not-sellable refund is refused.
            await refuses(
              withUse(insert({ restock: `'SELLABLE'` })),
              /puts back exactly its units/,
              true,
            );
            await refuses(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, product_refund_id, idempotency_key, actor_user_id)
               SELECT branch_id, variant_id, id, 'REFUND_RETURN', 1, '${made.id}', 'X-${randomUUID()}', '${refunder.id}' FROM inventory_lots WHERE branch_id = '${A.id}' LIMIT 1`,
              /belongs to a sellable refund/,
            );
            // Points: a reversal larger than the earn entry is refused, a Spa one too.
            const reversal = (await reversals(s.invoiceId))[0]!;
            const payer = reversal.userId;
            await refuses(
              `INSERT INTO loyalty_ledger_entries (user_id, wallet, kind, points, idempotency_key, invoice_id, paid_seq, product_refund_id, actor_user_id)
               VALUES ('${payer}', 'SPA', 'REFUND_REVERSAL', -1, 'X-${randomUUID()}', '${s.invoiceId}', 1, '${made.id}', '${refunder.id}')`,
              /Beauty points only|product_refund_id|duplicate|unique/i,
            );
            await refuses(
              `INSERT INTO loyalty_ledger_entries (user_id, wallet, kind, points, idempotency_key, invoice_id, paid_seq, product_refund_id, actor_user_id)
               VALUES ('${payer}', 'BEAUTY', 'REFUND_REVERSAL', -1000, 'X-${randomUUID()}', '${s.invoiceId}', 1, '${made.id}', '${refunder.id}')`,
              /more points than the invoice earned|duplicate|unique|loyalty_ledger_entries_refund_key/i,
            );
            await refuses(
              `INSERT INTO loyalty_ledger_entries (user_id, wallet, kind, points, idempotency_key, invoice_id, paid_seq, actor_user_id)
               VALUES ('${payer}', 'BEAUTY', 'REFUND_REVERSAL', -1, 'X-${randomUUID()}', '${s.invoiceId}', 1, '${refunder.id}')`,
              /kind_shape|belongs to the invoice, paid episode and person of its refund/,
            );
            await refuses(`UPDATE product_refund_corrections SET reason = 'x'`, /./);
            await reconcileRefunds();
          },
        );

        await suite.test(
          'services and combos have no refund path: the case, the refund and the screens only know product lines',
          async () => {
            const service = await serviceSale();
            const view = await invoices.get(people.cashier.token, service.invoiceId);
            assert.equal(view.productLines.length, 0);
            // No return case can name a service line, so no refund can either.
            await fails(
              () =>
                returns.open(clerk.token, {
                  branchId: A.id,
                  invoiceLineId: service.lineId,
                  reason: 'PERSONAL_PREFERENCE',
                  requestedOutcome: 'REFUND',
                  quantity: 1,
                  sealIntact: true,
                  notes: null,
                  clientRequestId: randomUUID(),
                }),
              'RETURN_NOT_ELIGIBLE',
            );
            assert.equal(
              await tx.productRefund.count({
                where: { invoice: { kind: { not: 'PRODUCT_SALE' } } },
              }),
              0,
            );
            await reconcileRefunds();
          },
        );

        await suite.test(
          'nothing is granted: the refund permissions are held by nobody',
          async () => {
            const holders = await tx.rolePermission.count({
              where: {
                permission: { code: { in: ['REFUND_PRODUCTS', 'MANAGE_PRODUCT_RETURNS'] } },
                role: { code: { not: { startsWith: 'P6_R' } } },
              },
            });
            assert.equal(holders, 0);
            await reconcileRefunds();
          },
        );
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

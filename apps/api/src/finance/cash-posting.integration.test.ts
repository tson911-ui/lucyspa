import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { countUnposted, LocalDiskMediaStorage, postCashSources } from '@lucy-spa/server';
import { pino } from 'pino';
import { ProductExchangeService } from '../product-returns/exchange.service.js';
import { ProductRefundService } from '../product-returns/refund.service.js';
import { ProductReturnService } from '../product-returns/return.service.js';
import { confirmAgain } from '../testing/confirm-again.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { productSaleKit } from '../testing/product-sale-kit.js';
import { CashService } from './cash.service.js';

/**
 * Phase 7 P7-3 against real PostgreSQL (design PHASE7_PAYROLL_FUNDS.md 7.2-7.3, P7-T8): the poster writes each money source into the
 * book once. Nothing before go-live, nothing while go-live is empty, a cash payment and a PayOS payment go to different funds, a cash
 * reversal and a refund go out, a repeated or windowed pass changes nothing, a branch added later gets a fund, and the book always
 * equals the sources. Fixtures roll back.
 */
test(
  'Phase 7 P7-3 cash posting: sources to the book, go-live gate, idempotency, funds, reconciliation; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    const folder = await mkdtemp(path.join(tmpdir(), 'lucy-cash-posting-'));
    try {
      await phase6Fixture(async (base) => {
        const k = await productSaleKit(base);
        const { tx, fails } = base;
        const { A, B, invoices, people } = k;
        const cash = new CashService(base.adapter, base.throttle, base.environment);
        const returns = new ProductReturnService(
          base.adapter,
          base.throttle,
          new LocalDiskMediaStorage(folder),
          pino({ level: 'silent' }),
        );
        const refunds = new ProductRefundService(base.adapter, base.throttle, base.environment);
        const exchanges = new ProductExchangeService(base.adapter, base.throttle, base.environment);
        const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
        const refunder = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });

        let n = 0;
        /** A paid cash counter sale at branch A. */
        const cashSale = async (price = 100_000, quantity = 2) => {
          n += 1;
          const product = await k.product(`cp${n}`, [price]);
          const variant = product.variants[0]!;
          await k.receive(variant.id, quantity + 5);
          const invoice = await k.finalize(
            await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity),
          );
          const paid = await k.pay(invoice.id, Number(invoice.totalVnd));
          const view = await invoices.get(people.cashier.token, invoice.id);
          await k.runInventory(invoice.id);
          return {
            invoiceId: invoice.id,
            lineId: view.productLines[0]!.id,
            paymentId: paid.payment.id,
            total: BigInt(invoice.totalVnd),
            quantity,
          };
        };
        const post = (since: Date | null = null) => k.ok(() => postCashSources(tx, { since }));
        const entries = (where: Record<string, unknown> = {}) =>
          tx.fundEntry.findMany({ where, orderBy: { seq: 'asc' } });
        const fundOf = (branchId: string | null, kind: 'CASH' | 'BANK' = 'CASH') =>
          tx.cashFund.findFirstOrThrow({
            where: kind === 'BANK' ? { kind } : { kind, branchId },
          });
        const balance = async (fundId: string) => {
          const fund = await tx.cashFund.findUniqueOrThrow({ where: { id: fundId } });
          const sums = await tx.fundEntry.groupBy({
            by: ['direction'],
            where: { fundId },
            _sum: { amountVnd: true },
          });
          const sum = (d: 'IN' | 'OUT') =>
            sums.find((row) => row.direction === d)?._sum.amountVnd ?? 0n;
          return fund.openingBalanceVnd + sum('IN') - sum('OUT');
        };
        const today = () => new Date().toISOString().slice(0, 10);
        const unposted = (branchId = A.id, scope: 'CASH' | 'ALL' = 'ALL') =>
          countUnposted(tx, { branchId, upToDate: '2099-12-31', scope });

        // -------------------------------------------------------------------------- before go-live
        const old = await cashSale();
        await suite.test('while go-live is empty nothing is posted', async () => {
          const result = await post();
          assert.equal(result.live, false);
          assert.equal(await tx.fundEntry.count(), 0);
          assert.equal(await tx.cashFund.count(), 0);
          assert.equal((await unposted()).total, 0);
        });

        await suite.test('go-live: payments recorded before it are never posted', async () => {
          const active = await tx.branch.findMany({
            where: { isActive: true },
            select: { id: true },
          });
          const result = await cash.goLive(base.ownerToken, {
            branches: active.map((branch) => ({ branchId: branch.id, countedVnd: '1000000' })),
            bankVnd: '2000000',
          });
          assert.ok(result.goLive);
          const first = await post();
          assert.equal(first.live, true);
          assert.equal(await tx.fundEntry.count(), 0);
          assert.equal(
            (await unposted()).total,
            0,
            `the old payment ${old.paymentId} is before go-live`,
          );
        });

        let sale = await cashSale(150_000, 2);
        await suite.test(
          'a cash payment becomes one IN entry in the branch cash fund, once',
          async () => {
            assert.equal((await unposted(A.id, 'CASH')).items.PAYMENT, 1);
            const result = await post();
            assert.equal(result.posted.PAYMENT, 1);
            const rows = await entries({ sourceType: 'PAYMENT', sourceId: sale.paymentId });
            assert.equal(rows.length, 1);
            const fund = await fundOf(A.id);
            const row = rows[0]!;
            assert.equal(row.fundId, fund.id);
            assert.equal(row.branchId, A.id);
            assert.equal(row.direction, 'IN');
            assert.equal(row.category, 'SALE_CASH');
            assert.equal(row.amountVnd, sale.total);
            const payment = await tx.payment.findUniqueOrThrow({ where: { id: sale.paymentId } });
            assert.equal(row.businessDate.toISOString(), payment.businessDate.toISOString());
            assert.equal(row.sourceOccurredAt?.getTime(), payment.collectedAt.getTime());
            assert.equal(await balance(fund.id), 1_000_000n + sale.total);
            // A second pass, and a pass in another call, add nothing.
            assert.equal((await post()).posted.PAYMENT, 0);
            assert.equal((await post(null)).posted.PAYMENT, 0);
            assert.equal((await unposted()).total, 0);
            assert.equal(await tx.fundEntry.count({ where: { sourceId: sale.paymentId } }), 1);
          },
        );

        await suite.test(
          'the periodic window skips what is older than it; the full pass finds it',
          async () => {
            sale = await cashSale(80_000, 1);
            assert.equal((await post(new Date(Date.now() + 60_000))).posted.PAYMENT, 0);
            assert.equal((await unposted(A.id, 'CASH')).items.PAYMENT, 1);
            assert.equal((await post(null)).posted.PAYMENT, 1);
          },
        );

        await suite.test('a cash reversal goes out of the same fund as one OUT entry', async () => {
          const target = await cashSale(60_000, 1);
          await post();
          await confirmAgain(base, people.boss.token);
          await k.ok(() =>
            invoices.reversePayment(people.boss.token, target.invoiceId, target.paymentId, {
              reason: 'Nhập nhầm số tiền',
            }),
          );
          assert.equal((await unposted(A.id, 'CASH')).items.PAYMENT_CORRECTION, 1);
          assert.equal((await post()).posted.PAYMENT_CORRECTION, 1);
          const correction = await tx.paymentCorrection.findUniqueOrThrow({
            where: { paymentId: target.paymentId },
          });
          const out = await entries({ sourceType: 'PAYMENT_CORRECTION', sourceId: correction.id });
          assert.equal(out.length, 1);
          assert.equal(out[0]?.direction, 'OUT');
          assert.equal(out[0]?.category, 'PAYMENT_REVERSAL');
          assert.equal(out[0]?.amountVnd, target.total);
          assert.equal(out[0]?.fundId, (await fundOf(A.id)).id);
          assert.equal((await post()).posted.PAYMENT_CORRECTION, 0);
        });

        const accepted = async (s: Awaited<ReturnType<typeof cashSale>>) => {
          const opened = await k.ok(() =>
            returns.open(clerk.token, {
              branchId: A.id,
              invoiceLineId: s.lineId,
              reason: 'PERSONAL_PREFERENCE',
              requestedOutcome: 'REFUND',
              quantity: s.quantity,
              sealIntact: true,
              notes: null,
              clientRequestId: randomUUID(),
            }),
          );
          return k.ok(() =>
            returns.accept(refunder.token, opened.id, {
              expectedRowVersion: opened.rowVersion,
              outcome: 'REFUND',
              note: null,
            }),
          );
        };
        await suite.test(
          'a cash refund goes out of the branch cash fund, a transfer out of the bank',
          async () => {
            const s1 = await cashSale(100_000, 2);
            const c1 = await accepted(s1);
            await confirmAgain(base, refunder.token);
            await k.ok(() =>
              refunds.refund(refunder.token, c1.id, {
                quantity: 1,
                method: 'CASH',
                bankReference: null,
                restock: 'SELLABLE',
                reason: 'Khách trả hàng',
                clientRequestId: randomUUID(),
              }),
            );
            const s2 = await cashSale(100_000, 2);
            const c2 = await accepted(s2);
            await confirmAgain(base, refunder.token);
            await k.ok(() =>
              refunds.refund(refunder.token, c2.id, {
                quantity: 1,
                method: 'BANK_TRANSFER_MANUAL',
                bankReference: 'FT26101200001',
                restock: 'SELLABLE',
                reason: 'Hoàn khoản qua chuyển khoản',
                clientRequestId: randomUUID(),
              }),
            );
            assert.equal((await unposted(A.id, 'CASH')).items.PRODUCT_REFUND, 1);
            assert.equal((await unposted(A.id, 'ALL')).items.PRODUCT_REFUND, 2);
            assert.equal((await post()).posted.PRODUCT_REFUND, 2);
            const cashRefund = await tx.productRefund.findFirstOrThrow({
              where: { returnCaseId: c1.id },
            });
            const bankRefund = await tx.productRefund.findFirstOrThrow({
              where: { returnCaseId: c2.id },
            });
            const cashRow = (
              await entries({ sourceType: 'PRODUCT_REFUND', sourceId: cashRefund.id })
            )[0]!;
            const bankRow = (
              await entries({ sourceType: 'PRODUCT_REFUND', sourceId: bankRefund.id })
            )[0]!;
            assert.equal(cashRow.fundId, (await fundOf(A.id)).id);
            assert.equal(cashRow.category, 'PRODUCT_REFUND');
            assert.equal(cashRow.direction, 'OUT');
            assert.equal(cashRow.amountVnd, cashRefund.amountVnd);
            assert.equal(bankRow.fundId, (await fundOf(null, 'BANK')).id);
            assert.equal(bankRow.direction, 'OUT');
            assert.equal(bankRow.amountVnd, bankRefund.amountVnd);
          },
        );

        await suite.test(
          'the part of an exchange the shop hands back goes out as one entry',
          async () => {
            const s = await cashSale(200_000, 1);
            const opened = await k.ok(() =>
              returns.open(clerk.token, {
                branchId: A.id,
                invoiceLineId: s.lineId,
                reason: 'PERSONAL_PREFERENCE',
                requestedOutcome: 'EXCHANGE',
                quantity: 1,
                sealIntact: true,
                notes: null,
                clientRequestId: randomUUID(),
              }),
            );
            const kase = await k.ok(() =>
              returns.accept(refunder.token, opened.id, {
                expectedRowVersion: opened.rowVersion,
                outcome: 'EXCHANGE',
                note: null,
              }),
            );
            const cheaper = (await k.product('cheap', [120_000])).variants[0]!;
            await k.receive(cheaper.id, 5);
            const preview = await exchanges.preview(refunder.token, kase.id, cheaper.id);
            assert.equal(preview.refundVnd, '80000');
            await confirmAgain(base, refunder.token);
            await k.ok(() =>
              exchanges.exchange(refunder.token, kase.id, {
                variantId: preview.option.variantId,
                expectedPayableVnd: preview.payableVnd,
                expectedRefundVnd: preview.refundVnd,
                restock: 'SELLABLE',
                refundMethod: 'CASH',
                bankReference: null,
                sellerUserId: null,
                reason: 'Khách đổi sang món rẻ hơn',
                clientRequestId: randomUUID(),
              } as never),
            );
            assert.equal((await unposted(A.id, 'CASH')).items.PRODUCT_EXCHANGE, 1);
            assert.equal((await post()).posted.PRODUCT_EXCHANGE, 1);
            const exchange = await tx.productExchange.findFirstOrThrow({
              where: { returnCaseId: kase.id },
            });
            const row = (
              await entries({ sourceType: 'PRODUCT_EXCHANGE', sourceId: exchange.id })
            )[0]!;
            assert.equal(row.direction, 'OUT');
            assert.equal(row.category, 'EXCHANGE_DIFFERENCE');
            assert.equal(row.amountVnd, 80_000n);
            assert.equal(row.fundId, (await fundOf(A.id)).id);
            assert.equal((await post()).posted.PRODUCT_EXCHANGE, 0);
          },
        );

        await suite.test(
          'a PayOS payment goes to the bank fund (recorded as the provider confirms it)',
          async () => {
            // A confirmed provider payment is built from a cash row of the same kind, with the provider columns filled.
            const base1 = await cashSale(120_000, 1);
            await post();
            const source = await tx.payment.findUniqueOrThrow({ where: { id: base1.paymentId } });
            const id = randomUUID();
            await tx.$executeRawUnsafe('SAVEPOINT bank_payment');
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(
              `INSERT INTO payments (id, invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd, change_vnd,
               collected_by_user_id, idempotency_key, provider_order_code, provider_reference, expires_at, collected_at, business_date)
             VALUES ('${id}'::uuid, '${source.invoiceId}'::uuid, '${A.id}'::uuid, 'PAYOS', 'SUCCEEDED', 70000, 70000, 70000, 0,
               '${source.collectedByUserId}'::uuid, '${randomUUID()}'::uuid, ${9_100_000_000_000 + Math.floor(Math.random() * 1_000_000)}, 'TF-P7', clock_timestamp() + interval '10 minutes', clock_timestamp(), CURRENT_DATE)`,
            );
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT bank_payment');
            assert.equal((await post()).posted.PAYMENT, 1);
            const row = (await entries({ sourceType: 'PAYMENT', sourceId: id }))[0]!;
            assert.equal(row.category, 'SALE_BANK');
            assert.equal(row.direction, 'IN');
            assert.equal(row.fundId, (await fundOf(null, 'BANK')).id);
            assert.equal(row.amountVnd, 70_000n);
            assert.equal(row.branchId, A.id);
          },
        );

        await suite.test(
          'a branch added after go-live gets its own cash fund with an opening balance of 0',
          async () => {
            const added = await base.branch('C-late');
            assert.equal(await tx.cashFund.count({ where: { branchId: added.id } }), 0);
            await post();
            const fund = await tx.cashFund.findFirstOrThrow({
              where: { branchId: added.id, kind: 'CASH' },
            });
            assert.equal(fund.openingBalanceVnd, 0n);
            const again = await post();
            assert.deepEqual(again.posted, {
              PAYMENT: 0,
              PAYMENT_CORRECTION: 0,
              PRODUCT_REFUND: 0,
              PRODUCT_EXCHANGE: 0,
            });
            assert.equal(await tx.cashFund.count({ where: { branchId: added.id } }), 1);
          },
        );

        await suite.test(
          'the book equals the sources: nothing missing, nothing twice, amounts exact',
          async () => {
            const live = await tx.financeGoLive.findUniqueOrThrow({ where: { id: 1 } });
            const cashIn = await tx.payment.aggregate({
              where: {
                branchId: A.id,
                method: 'CASH',
                status: 'SUCCEEDED',
                collectedAt: { gte: live.at },
              },
              _sum: { amountVnd: true },
            });
            const reversed = await tx.$queryRaw<{ s: bigint | null }[]>`
            SELECT sum(p.amount_vnd)::bigint AS s FROM payment_corrections pc JOIN payments p ON p.id = pc.payment_id
            WHERE p.branch_id = ${A.id}::uuid AND p.method = 'CASH' AND pc.occurred_at >= ${live.at}`;
            const cashRefunds = await tx.productRefund.aggregate({
              where: { branchId: A.id, method: 'CASH', occurredAt: { gte: live.at } },
              _sum: { amountVnd: true },
            });
            const exchangeCash = await tx.productExchange.aggregate({
              where: { branchId: A.id, refundMethod: 'CASH', occurredAt: { gte: live.at } },
              _sum: { refundVnd: true },
            });
            const fund = await fundOf(A.id);
            assert.equal(
              await balance(fund.id),
              1_000_000n +
                (cashIn._sum.amountVnd ?? 0n) -
                (reversed[0]?.s ?? 0n) -
                (cashRefunds._sum.amountVnd ?? 0n) -
                (exchangeCash._sum.refundVnd ?? 0n),
            );
            assert.equal((await unposted(A.id, 'ALL')).total, 0);
            // Every entry names its source and no source has two entries.
            const dup = await tx.$queryRaw<{ n: bigint }[]>`
            SELECT count(*)::bigint AS n FROM (SELECT 1 FROM fund_entries WHERE source_type IS NOT NULL
              GROUP BY source_type, source_id, source_leg HAVING count(*) > 1) d`;
            assert.equal(dup[0]?.n, 0n);
            assert.ok(today().length === 10);
            void B;
            void fails;
          },
        );
      });
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  },
);

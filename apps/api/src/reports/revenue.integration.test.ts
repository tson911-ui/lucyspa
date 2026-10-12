import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import type { ProductExchangeResponse } from '@lucy-spa/contracts';
import { ProductExchangeService } from '../product-returns/exchange.service.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { addDays } from './report.dates.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-3 against real PostgreSQL (design PHASE8_REPORTS.md 4.1, P8-T4, P8-T14): the golden dataset. Known sales are made through
 * the real services (cash, a split payment, a Spa+Beauty invoice, a refund, an exchange, a reversed payment, a PayOS online order) and
 * every figure of the revenue report is checked against a hand-computed number: the definition of "doanh thu", the parts adding up to
 * the total, the day boundaries of the branch, the recognition of an online order on its delivery day, the scope by branch and
 * permission, and that a report changes nothing. Fixtures roll back.
 */
test(
  'Phase 8 P8-3 revenue: golden dataset, definition, parts = total, branch days, online recognition, scope, read-only; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, B, people } = k;
      const reports = new ReportsService(base.adapter, base.throttle);
      const exchangesService = new ProductExchangeService(
        base.adapter,
        base.throttle,
        base.environment,
      );
      const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
      const approver = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
      const viewerA = await base.staff(['VIEW_REVENUE'], { branchId: A.id });
      const viewerB = await base.staff(['VIEW_REVENUE'], { branchId: B.id });
      const noRevenue = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const today = await k.day();
      const tomorrow = addDays(today, 1);
      const yesterday = addDays(today, -1);

      const money = (value: string | number | bigint) => BigInt(value);
      let itemNo = 0;
      /** A paid counter sale of one product: `quantity` units at `price`, paid by the given payments (cash). */
      const sale = async (quantity: number, price: number, payments?: number[]) => {
        itemNo += 1;
        const product = await k.product(`rev${itemNo}`, [price]);
        const variant = product.variants[0]!;
        await k.receive(variant.id, quantity + 5);
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity),
        );
        const total = Number(invoice.totalVnd);
        const paid = [];
        for (const part of payments ?? [total]) paid.push(await k.pay(invoice.id, part));
        const view = await k.invoices.get(people.cashier.token, invoice.id);
        await k.runInventory(invoice.id);
        return {
          invoiceId: invoice.id,
          lineId: view.productLines[0]!.id,
          variantId: variant.id,
          total,
          paymentIds: paid.map((p) => p.payment.id),
        };
      };
      const accepted = async (
        s: Awaited<ReturnType<typeof sale>>,
        outcome: 'REFUND' | 'EXCHANGE',
        quantity: number,
      ) => {
        const opened = await k.ok(() =>
          k.returns.open(clerk.token, {
            branchId: A.id,
            invoiceLineId: s.lineId,
            reason: 'PERSONAL_PREFERENCE',
            requestedOutcome: outcome,
            quantity,
            sealIntact: true,
            notes: null,
            clientRequestId: randomUUID(),
          }),
        );
        return k.ok(() =>
          k.returns.accept(approver.token, opened.id, {
            expectedRowVersion: opened.rowVersion,
            outcome,
            note: null,
          }),
        );
      };
      const report = (token: string, query: Record<string, string> = {}) =>
        reports.revenue(token, { from: today, to: today, ...query });

      // ------------------------------------------------------------------------------------ the golden dataset
      // S1 cash product sale 3 x 100,000 = 300,000
      await sale(3, 100_000);
      // S2 product sale 2 x 125,000 = 250,000 paid in two cash payments (100,000 + 150,000)
      await sale(2, 125_000, [100_000, 150_000]);
      // S3 service invoice 200,000 cash
      const service = await k.serviceDraft([k.exact]);
      const serviceInvoice = await k.finalize(service);
      await k.pay(serviceInvoice.id, 200_000);
      // S4 mixed invoice: a service 200,000 + 3 x 33,333 product = 299,999, paid 100,000 then 199,999
      const mixedProduct = await k.product('mix', [33_333]);
      await k.receive(mixedProduct.variants[0]!.id, 10);
      const mixedDraft = await k.serviceDraft([k.exact]);
      const mixed = await k.finalize(await k.addLine(mixedDraft, mixedProduct.variants[0]!.id, 3));
      assert.equal(mixed.totalVnd, '299999');
      await k.pay(mixed.id, 100_000);
      await k.pay(mixed.id, 199_999);
      // S5 sale 2 x 100,000 = 200,000 then one unit refunded in cash (100,000)
      const refunded = await sale(2, 100_000);
      const refundCase = await accepted(refunded, 'REFUND', 1);
      await k.reconfirm(approver.token);
      await k.ok(() =>
        k.refunds.refund(approver.token, refundCase.id, {
          quantity: 1,
          method: 'CASH',
          bankReference: null,
          restock: 'SELLABLE',
          reason: 'Khách trả hàng',
          clientRequestId: randomUUID(),
        }),
      );
      // S6 sale 1 x 200,000 exchanged for a 150,000 item: 50,000 is paid back in cash
      const swapped = await sale(1, 200_000);
      const swapCase = await accepted(swapped, 'EXCHANGE', 1);
      const swapVariantProduct = await k.product('swap', [150_000]);
      const swapVariant = swapVariantProduct.variants[0]!;
      await k.receive(swapVariant.id, 5);
      await k.reconfirm(approver.token);
      const preview = await exchangesService.preview(approver.token, swapCase.id, swapVariant.id);
      assert.equal(preview.refundVnd, '50000');
      await k.reconfirm(approver.token);
      const exchanged = await k.ok(() =>
        exchangesService.exchange(approver.token, swapCase.id, {
          variantId: swapVariant.id,
          expectedPayableVnd: preview.payableVnd,
          expectedRefundVnd: preview.refundVnd,
          restock: preview.payableVnd === '0' ? 'SELLABLE' : null,
          refundMethod: 'CASH',
          bankReference: null,
          sellerUserId: null,
          reason: 'Khách đổi hàng',
          clientRequestId: randomUUID(),
        }),
      );
      assert.ok((exchanged.exchanges.at(-1) as ProductExchangeResponse).refundVnd === '50000');
      // S7 a cash payment of 80,000 recorded by mistake and reversed: not revenue, listed as a correction
      const mistaken = await sale(1, 80_000);
      await k.reconfirm(people.boss.token);
      await k.ok(() =>
        k.invoices.reversePayment(people.boss.token, mistaken.invoiceId, mistaken.paymentIds[0]!, {
          reason: 'Nhập nhầm',
        }),
      );
      // S8 online order, PayOS 200,000, not delivered yet
      await k.open();
      const cream = await k.stocked('cream', 200_000, 40);
      const buyer = await k.member('rev');
      const placed = await k.order(buyer, [{ variantId: cream.variantId, quantity: 1 }]);
      await k.payViaWebhook(buyer, placed);

      const COLLECTED_COUNTER = 300_000 + 250_000 + 200_000 + 299_999 + 200_000 + 200_000;
      const REFUNDS = 100_000;
      const EXCHANGES = 50_000;
      const NET_BEFORE_DELIVERY = COLLECTED_COUNTER - REFUNDS - EXCHANGES;

      await suite.test(
        'the definition: collected minus given back, reversed payment excluded, online not yet',
        async () => {
          const r = await report(people.owner.token, { branchId: A.id });
          assert.equal(r.totals.collectedVnd, String(COLLECTED_COUNTER));
          assert.equal(r.totals.refundsVnd, String(REFUNDS));
          assert.equal(r.totals.exchangesVnd, String(EXCHANGES));
          assert.equal(r.totals.netVnd, String(NET_BEFORE_DELIVERY));
          assert.equal(r.unclassifiedVnd, '0');
          // The PayOS order is paid but not delivered: held, not revenue.
          assert.equal(r.onlineHeldVnd, '200000');
          assert.equal(r.byChannel.find((p) => p.key === 'ONLINE')?.netVnd, '0');
          assert.equal(r.period.previous, null);
          assert.equal(r.previousTotals, null);
        },
      );

      await suite.test(
        'parts add up to the total: side, kind, channel, method, branch, series',
        async () => {
          const r = await report(people.owner.token, { branchId: A.id });
          const net = money(r.totals.netVnd);
          const sum = (parts: { netVnd: string }[]) =>
            parts.reduce((a, p) => a + money(p.netVnd), 0n);
          assert.equal(sum(r.bySide), net);
          assert.equal(sum(r.byKind), net);
          assert.equal(sum(r.byChannel), net);
          assert.equal(sum(r.byMethod), net);
          assert.equal(sum(r.byBranch), net);
          assert.equal(sum(r.series), net);
          // Hand-computed: services 200,000 (S3) + 200,000 (S4) are Spa; every product is Beauty.
          assert.equal(r.bySide.find((p) => p.key === 'SPA')?.netVnd, '400000');
          assert.equal(
            r.bySide.find((p) => p.key === 'BEAUTY')?.netVnd,
            String(NET_BEFORE_DELIVERY - 400_000),
          );
          assert.equal(r.byKind.find((p) => p.key === 'SERVICE')?.netVnd, '400000');
          assert.equal(
            r.byKind.find((p) => p.key === 'COMBO'),
            undefined,
          );
          assert.equal(
            r.byKind.find((p) => p.key === 'PRODUCT')?.netVnd,
            String(NET_BEFORE_DELIVERY - 400_000),
          );
          // Cash in, cash out (the refund and the exchange difference).
          const cash = r.byMethod.find((row) => row.method === 'CASH')!;
          assert.equal(cash.inVnd, String(COLLECTED_COUNTER));
          assert.equal(cash.outVnd, String(REFUNDS + EXCHANGES));
          assert.equal(r.byMethod.find((row) => row.method === 'PAYOS')?.inVnd, '0');
          // Share in basis points: 400000 of the net.
          const spa = r.bySide.find((p) => p.key === 'SPA')!;
          assert.equal(spa.shareBp, Math.round((400_000 * 10_000) / NET_BEFORE_DELIVERY));
          // The old figure stays: paid invoices (counter) count and total.
          assert.ok(r.paidInvoices.count >= 6);
        },
      );

      await suite.test(
        'the online order counts on its delivery day, by PayOS, as online',
        async () => {
          const manager = await base.staff(['MANAGE_PRODUCTS'], {
            globalCodes: ['MANAGE_PRODUCTS'],
          });
          const carriers = await k.online.createCarrier(manager.token, {
            name: 'Hãng thử',
            trackingUrlTemplate: 'https://tracking.example/{code}',
          });
          const carrier = carriers.carriers.find((entry) => entry.name === 'Hãng thử')!;
          const view = await k.online.staffOrder(people.queue.token, placed.id);
          await k.ok(() =>
            k.online.ship(people.queue.token, placed.id, {
              lines: view.lines
                .filter((line) => line.status !== 'CANCELLED')
                .map((line) => ({ id: line.id, rowVersion: line.rowVersion })),
              carrierId: carrier.id,
              trackingCode: 'VN123456789',
              carrierFeeVnd: '35000',
            }),
          );
          // Shipped is still not delivered.
          assert.equal(
            (await report(people.owner.token, { branchId: A.id })).onlineHeldVnd,
            '200000',
          );
          await k.ok(() => k.online.delivered(people.queue.token, placed.id, {}));
          const r = await report(people.owner.token, { branchId: A.id });
          assert.equal(r.onlineHeldVnd, '0');
          assert.equal(r.totals.netVnd, String(NET_BEFORE_DELIVERY + 200_000));
          assert.equal(r.byChannel.find((p) => p.key === 'ONLINE')?.netVnd, '200000');
          assert.equal(r.byMethod.find((row) => row.method === 'PAYOS')?.inVnd, '200000');
          assert.equal(r.byMethod.find((row) => row.method === 'PAYOS')?.outVnd, '0');
          const sum = r.bySide.reduce((a, p) => a + money(p.netVnd), 0n);
          assert.equal(sum, money(r.totals.netVnd));
        },
      );

      await suite.test(
        'periods: another day is empty, the comparison reads the equal period before',
        async () => {
          const empty = await reports.revenue(people.owner.token, {
            from: yesterday,
            to: yesterday,
            branchId: A.id,
          });
          assert.equal(empty.totals.netVnd, '0');
          assert.equal(empty.series.length, 1);
          // Tomorrow compared with the period before it (today): the previous totals are today's.
          const next = await reports.revenue(people.owner.token, {
            from: tomorrow,
            to: tomorrow,
            branchId: A.id,
            compare: 'previous',
          });
          const todayReport = await report(people.owner.token, { branchId: A.id });
          assert.equal(next.totals.netVnd, '0');
          assert.equal(next.previousTotals?.netVnd, todayReport.totals.netVnd);
          assert.deepEqual(next.period.previous, { from: today, to: today });
          assert.equal(next.previousSeries?.[0]?.netVnd, todayReport.totals.netVnd);
          assert.equal(
            next.byBranch.find((row) => row.branch.id === A.id)?.previousNetVnd,
            todayReport.totals.netVnd,
          );
          // A week and a month bucket hold the same total as the day.
          for (const bucket of ['week', 'month', 'quarter', 'year']) {
            const r = await reports.revenue(people.owner.token, {
              from: addDays(today, -3),
              to: addDays(today, 3),
              branchId: A.id,
              bucket,
            });
            assert.equal(r.totals.netVnd, todayReport.totals.netVnd, bucket);
            assert.equal(
              r.series.reduce((a, p) => a + money(p.netVnd), 0n),
              money(todayReport.totals.netVnd),
              bucket,
            );
          }
        },
      );

      await suite.test(
        'scope: a branch filter narrows, other branches and other permissions see nothing',
        async () => {
          const mine = await report(viewerA.token);
          assert.deepEqual(
            mine.branches.map((b) => b.id),
            [A.id],
          );
          assert.equal(
            mine.totals.netVnd,
            (await report(people.owner.token, { branchId: A.id })).totals.netVnd,
          );
          const theirs = await report(viewerB.token);
          assert.deepEqual(
            theirs.branches.map((b) => b.id),
            [B.id],
          );
          assert.equal(theirs.totals.netVnd, '0');
          await fails(() => report(viewerB.token, { branchId: A.id }), 'FORBIDDEN');
          await fails(() => report(noRevenue.token), 'FORBIDDEN');
          await fails(() => report(k.people.nobody.token), 'FORBIDDEN');
          // Owner: every active branch, and the branch rows add up.
          const all = await report(people.owner.token);
          assert.ok(all.branches.length >= 2);
          assert.equal(
            all.byBranch.reduce((a, row) => a + money(row.netVnd), 0n),
            money(all.totals.netVnd),
          );
        },
      );

      await suite.test('validation: dates, ranges, bucket and comparison', async () => {
        await fails(() => reports.revenue(people.owner.token, {}), 'VALIDATION_FAILED', 'from');
        await fails(
          () => reports.revenue(people.owner.token, { from: today, to: yesterday }),
          'REPORT_RANGE_INVALID',
        );
        await fails(
          () => reports.revenue(people.owner.token, { from: '2025-01-01', to: '2026-12-31' }),
          'REPORT_RANGE_TOO_LONG',
        );
        await fails(
          () => report(people.owner.token, { bucket: 'hour' }),
          'VALIDATION_FAILED',
          'bucket',
        );
        await fails(
          () => report(people.owner.token, { compare: 'year' }),
          'VALIDATION_FAILED',
          'compare',
        );
        await fails(
          () => report(people.owner.token, { branchId: 'nope' }),
          'VALIDATION_FAILED',
          'branchId',
        );
      });

      await suite.test(
        'R10 refunds list: refund, exchange difference and the reversed payment, paged, with totals',
        async () => {
          const list = await reports.refunds(people.owner.token, {
            from: today,
            to: today,
            branchId: A.id,
          });
          assert.equal(list.total, 3);
          assert.equal(list.totals.refundsVnd, '100000');
          assert.equal(list.totals.exchangesVnd, '50000');
          assert.equal(list.totals.reversalsVnd, '80000');
          assert.equal(list.totals.paymentAnomalies, 0);
          assert.deepEqual(list.rows.map((row) => row.kind).sort(), [
            'EXCHANGE',
            'PAYMENT_REVERSAL',
            'REFUND',
          ]);
          const reversal = list.rows.find((row) => row.kind === 'PAYMENT_REVERSAL')!;
          assert.equal(reversal.reason, 'Nhập nhầm');
          assert.equal(reversal.method, 'CASH');
          assert.equal(reversal.failedDelivery, false);
          for (const row of list.rows) {
            assert.equal(row.date, today);
            assert.equal(row.branch.id, A.id);
            assert.match(row.invoiceCode, /^INV-/);
          }
          const second = await reports.refunds(people.owner.token, {
            from: today,
            to: today,
            page: '2',
          });
          assert.equal(second.rows.length, 0);
          assert.equal(second.page, 2);
          await fails(
            () => reports.refunds(people.owner.token, { from: today, to: today, page: '0' }),
            'VALIDATION_FAILED',
            'page',
          );
          await fails(
            () => reports.refunds(noRevenue.token, { from: today, to: today }),
            'FORBIDDEN',
          );
        },
      );

      await suite.test(
        'branch days: an instant just before / after local midnight lands on the right day',
        async () => {
          const refundRow = await tx.productRefund.findFirstOrThrow({ select: { id: true } });
          const setAt = async (iso: string) => {
            await tx.$executeRawUnsafe('SAVEPOINT shift');
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
            await tx.$executeRawUnsafe(
              `UPDATE product_refunds SET occurred_at = '${iso}'::timestamptz WHERE id = '${refundRow.id}'`,
            );
            await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
            await tx.$executeRawUnsafe('RELEASE SAVEPOINT shift');
          };
          const refundsOn = async (day: string) =>
            money(
              (await reports.revenue(people.owner.token, { from: day, to: day, branchId: A.id }))
                .totals.refundsVnd,
            );
          const original = await tx.productRefund.findUniqueOrThrow({
            where: { id: refundRow.id },
          });
          // 23:59:59 on `today` in Asia/Ho_Chi_Minh is 16:59:59 UTC; one second later is the next local day.
          await setAt(`${today}T23:59:59+07:00`);
          assert.equal(await refundsOn(today), 100_000n);
          assert.equal(await refundsOn(tomorrow), 0n);
          await setAt(`${tomorrow}T00:00:00+07:00`);
          assert.equal(await refundsOn(today), 0n);
          assert.equal(await refundsOn(tomorrow), 100_000n);
          await setAt(`${today}T00:00:00+07:00`);
          assert.equal(await refundsOn(today), 100_000n);
          assert.equal(await refundsOn(yesterday), 0n);
          // A branch in another zone: the same instant is another day there.
          await tx.$executeRawUnsafe(
            `UPDATE branches SET timezone = 'America/Los_Angeles' WHERE id = '${A.id}'`,
          );
          await setAt(`${today}T02:00:00+07:00`); // the day before at 12:00 in Los Angeles
          assert.equal(await refundsOn(yesterday), 100_000n);
          assert.equal(await refundsOn(today), 0n);
          await tx.$executeRawUnsafe(
            `UPDATE branches SET timezone = 'Asia/Ho_Chi_Minh' WHERE id = '${A.id}'`,
          );
          await setAt(original.occurredAt.toISOString());
          assert.equal(await refundsOn(today), 100_000n);
        },
      );

      await suite.test(
        'a payment with no recorded Spa/Beauty split is kept visible as unclassified, never guessed',
        async () => {
          const before = await report(people.owner.token, { branchId: A.id });
          const target = await tx.payment.findFirstOrThrow({
            where: { invoiceId: swapped.invoiceId },
            select: { id: true },
          });
          await tx.$executeRawUnsafe('SAVEPOINT strip');
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
          await tx.$executeRawUnsafe(
            `DELETE FROM payment_side_allocations WHERE payment_id = '${target.id}'`,
          );
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
          const after = await report(people.owner.token, { branchId: A.id });
          assert.equal(after.totals.netVnd, before.totals.netVnd); // the money is the same
          assert.equal(after.unclassifiedVnd, '200000');
          assert.equal(after.bySide.find((p) => p.key === 'UNCLASSIFIED')?.netVnd, '200000');
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT strip');
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT strip');
          assert.equal((await report(people.owner.token, { branchId: A.id })).unclassifiedVnd, '0');
        },
      );

      await suite.test('read-only: running every report changes no row', async () => {
        const count = async () => {
          const [row] = await tx.$queryRaw<{ n: string }[]>`
            SELECT ((SELECT count(*) FROM invoices) + (SELECT count(*) FROM payments)
                  + (SELECT count(*) FROM payment_side_allocations) + (SELECT count(*) FROM product_refunds)
                  + (SELECT count(*) FROM audit_events) + (SELECT count(*) FROM outbox_events)
                  + (SELECT count(*) FROM sessions))::text AS n`;
          return row!.n;
        };
        const before = await count();
        await report(people.owner.token);
        await reports.refunds(people.owner.token, { from: today, to: today });
        await reports.registry(people.owner.token);
        assert.equal(await count(), before);
      });
    });
  },
);

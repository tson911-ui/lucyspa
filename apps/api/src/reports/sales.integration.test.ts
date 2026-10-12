import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readRows } from '@lucy-spa/server';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ReportExportService } from './export.service.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-7 against real PostgreSQL (design PHASE8_REPORTS.md 4.2, R5-R9): what was sold. Services, products and an online order are
 * made through the real services (cash payments, a refund, a PayOS order delivered by staff); the rows no counter flow can make cheaply
 * (a combo package with its sessions, the discount records, a brand, a campaign, a staff referral code) are inserted as the system writes
 * them, with the triggers lifted for that statement only. Every figure is hand-computed. Fixtures roll back.
 */
test(
  'Phase 8 P8-7 sales reports: services, products, combos, discounts, online orders; scope, parts add up, exports; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, B, people } = k;
      const reports = new ReportsService(base.adapter, base.throttle);
      const exports = new ReportExportService(base.adapter, base.throttle, base.environment);
      const clerk = await base.staff(['MANAGE_PRODUCT_RETURNS'], { branchId: A.id });
      const approver = await base.staff(['REFUND_PRODUCTS'], { branchId: A.id });
      const exporter = await base.staff(['VIEW_REVENUE', 'EXPORT_REPORTS'], { branchId: A.id });
      const viewerB = await base.staff(['VIEW_REVENUE'], { branchId: B.id });
      const noRevenue = await base.staff(['VIEW_INVOICES'], { branchId: A.id });
      const today = await k.day();
      const query = { from: today, to: today, branchId: A.id };
      const replica = async (sql: string) => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.$executeRawUnsafe('SAVEPOINT fixture_row');
        try {
          await tx.$executeRawUnsafe(sql);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fixture_row');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fixture_row');
          const detail =
            error instanceof Error ? error.message.replace(/\s+/g, ' ') : String(error);
          throw new Error(
            `fixture row failed: ${sql.slice(0, 160).replace(/\s+/g, ' ')} -> ${detail.slice(-300)}`,
            { cause: error },
          );
        } finally {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        }
      };
      let counter = 0;
      const code = () => {
        counter += 1;
        // INV-YYMMDD-XXXXXX in the real alphabet, unique by construction.
        const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let n = counter + 1000;
        let tail = '';
        for (let i = 0; i < 6; i += 1) {
          tail = alphabet[n % 32] + tail;
          n = Math.floor(n / 32);
        }
        return `INV-${today.slice(2, 4)}${today.slice(5, 7)}${today.slice(8, 10)}-${tail}`;
      };

      // ------------------------------------------------------------------------------------------------ services (real)
      const exactInvoice = await k.finalize(await k.serviceDraft([k.exact]));
      await k.pay(exactInvoice.id, 200_000); // 200,000
      const rangedInvoice = await k.finalize(await k.serviceDraft([k.ranged]));
      await k.pay(rangedInvoice.id, Number(rangedInvoice.totalVnd)); // 100,000 (the minimum of its range)
      assert.equal(rangedInvoice.totalVnd, '100000');

      // ------------------------------------------------------------------------------------------------ products (real)
      const sale = async (label: string, price: number, quantity: number) => {
        const product = await k.product(label, [price]);
        const variant = product.variants[0]!;
        await k.receive(variant.id, quantity + 5);
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, null), variant.id, quantity),
        );
        await k.pay(invoice.id, Number(invoice.totalVnd));
        const view = await k.invoices.get(people.cashier.token, invoice.id);
        await k.runInventory(invoice.id);
        return {
          invoiceId: invoice.id,
          lineId: view.productLines[0]!.id,
          variantId: variant.id,
          sku: variant.sku,
        };
      };
      const cream = await sale('kem', 100_000, 3); // 300,000, one unit refunded below
      const mask = await sale('matna', 50_000, 2); // 100,000
      const opened = await k.ok(() =>
        k.returns.open(clerk.token, {
          branchId: A.id,
          invoiceLineId: cream.lineId,
          reason: 'PERSONAL_PREFERENCE',
          requestedOutcome: 'REFUND',
          quantity: 1,
          sealIntact: true,
          notes: null,
          clientRequestId: randomUUID(),
        }),
      );
      const accepted = await k.ok(() =>
        k.returns.accept(approver.token, opened.id, {
          expectedRowVersion: opened.rowVersion,
          outcome: 'REFUND',
          note: null,
        }),
      );
      await k.reconfirm(approver.token);
      await k.ok(() =>
        k.refunds.refund(approver.token, accepted.id, {
          quantity: 1,
          method: 'CASH',
          bankReference: null,
          restock: 'SELLABLE',
          reason: 'Khách trả hàng',
          clientRequestId: randomUUID(),
        }),
      );
      // A brand and a category for the cream; a campaign on the mask.
      const brandId = randomUUID();
      const categoryId = randomUUID();
      const campaignId = randomUUID();
      await replica(
        `INSERT INTO brands (id, code, name_vi, name_en) VALUES ('${brandId}', 'b-${base.run.toLowerCase()}', 'Thương hiệu thử', 'Test brand')`,
      );
      await replica(
        `INSERT INTO product_categories (id, code, name_vi, name_en) VALUES ('${categoryId}', 'c-${base.run.toLowerCase()}', 'Dưỡng da', 'Skin care')`,
      );
      await replica(
        `UPDATE invoice_line_products SET brand_id = '${brandId}', category_id = '${categoryId}' WHERE invoice_line_id = '${cream.lineId}'`,
      );
      await replica(
        `INSERT INTO product_campaigns (id, slug, name_vi, name_en, starts_at, ends_at, created_by_user_id)
         VALUES ('${campaignId}', 'c-${base.run.toLowerCase()}', 'Khuyến mãi mùa thu', 'Autumn offer', now() - interval '1 day', now() + interval '1 day', '${people.owner.id}')`,
      );
      await replica(
        `UPDATE invoice_line_products SET campaign_id = '${campaignId}' WHERE invoice_line_id = '${mask.lineId}'`,
      );

      // ------------------------------------------------------------------------------------------ combos (as the system writes them)
      const comboId = randomUUID();
      const versionId = randomUUID();
      const serviceId = (await tx.service.findFirstOrThrow({ where: { id: k.exact.id } })).id;
      const owner = people.owner.id;
      await replica(
        `INSERT INTO combos (id, code, service_id, created_by_user_id) VALUES ('${comboId}', 'CB${base.run}', '${serviceId}', '${owner}')`,
      );
      await replica(
        `INSERT INTO combo_versions (id, combo_id, version, name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode, active, created_by_user_id)
         VALUES ('${versionId}', '${comboId}', 1, 'Gói massage 10+2', 'Massage 10+2', 10, 2, 1500000, 'NONE', true, '${owner}')`,
      );
      const comboSale = async (
        price: number,
        paid: number,
        bonus: number,
        expires: string | null,
      ) => {
        const invoiceId = randomUUID();
        const lineId = randomUUID();
        const paymentId = randomUUID();
        const purchaseId = randomUUID();
        await replica(
          `INSERT INTO invoices (id, code, branch_id, payer_user_id, status, business_date, calculation_version, subtotal_vnd, discount_total_vnd, total_vnd, finalized_at, finalized_by_user_id, paid_at, paid_seq, created_by_user_id, kind, channel, shipping_fee_vnd)
           VALUES ('${invoiceId}', '${code()}', '${A.id}', '${owner}', 'PAID', '${today}', 3, ${price}, 0, ${price}, now(), '${owner}', now(), 1, '${owner}', 'COMBO_SALE', 'COUNTER', 0)`,
        );
        await replica(
          `INSERT INTO invoice_lines (id, invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
           VALUES ('${lineId}', '${invoiceId}', 1, 'COMBO_PURCHASE', 'CB', 'Gói massage 10+2', 'Massage 10+2', 1, ${price}, ${price})`,
        );
        await replica(
          `INSERT INTO invoice_line_combos (invoice_line_id, invoice_id, combo_id, version_id, service_id, service_category_id, name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode)
           VALUES ('${lineId}', '${invoiceId}', '${comboId}', '${versionId}', '${serviceId}', '${randomUUID()}', 'Gói massage 10+2', 'Massage 10+2', ${paid}, ${bonus}, ${price}, 'NONE')`,
        );
        await replica(
          `INSERT INTO payments (id, invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd, change_vnd, collected_by_user_id, collected_at, business_date, idempotency_key)
           VALUES ('${paymentId}', '${invoiceId}', '${A.id}', 'CASH', 'SUCCEEDED', ${price}, ${price}, ${price}, 0, '${owner}', now(), '${today}', '${randomUUID()}')`,
        );
        await replica(
          `INSERT INTO combo_purchases (id, combo_id, version_id, owner_user_id, invoice_line_id, paid_seq, service_id, name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode, expires_at, issued_at)
           VALUES ('${purchaseId}', '${comboId}', '${versionId}', '${owner}', '${lineId}', 1, '${serviceId}', 'Gói massage 10+2', 'Massage 10+2', ${paid}, ${bonus}, ${price}, '${expires ? 'DAYS_AFTER_ISSUE' : 'NONE'}', ${expires ? `'${expires}'` : 'NULL'}, now())`,
        );
        const sessionIds: string[] = [];
        for (let n = 1; n <= paid + bonus; n += 1) {
          const id = randomUUID();
          sessionIds.push(id);
          await replica(
            `INSERT INTO combo_sessions (id, purchase_id, session_no, kind) VALUES ('${id}', '${purchaseId}', ${n}, '${n <= paid ? 'PAID' : 'BONUS'}')`,
          );
        }
        return { purchaseId, sessionIds };
      };
      const consume = async (sessionId: string, options: { release?: boolean } = {}) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO combo_session_consumptions (id, session_id, invoice_line_id, branch_id, used_by, performed_by_user_id)
           VALUES ('${id}', '${sessionId}', '${randomUUID()}', '${A.id}', 'OWNER', '${owner}')`,
        );
        if (options.release) {
          await replica(
            `INSERT INTO combo_session_releases (id, consumption_id, released_by_user_id, cause, reason)
             VALUES ('${randomUUID()}', '${id}', '${owner}', 'INVOICE_CANCELLED_UNPAID', 'Hủy hóa đơn')`,
          );
        }
      };
      const first = await comboSale(1_500_000, 10, 2, null); // 12 sessions, 2 used, 1 used then released
      await consume(first.sessionIds[0]!);
      await consume(first.sessionIds[1]!);
      await consume(first.sessionIds[2]!, { release: true });
      const second = await comboSale(
        500_000,
        4,
        1,
        new Date(Date.now() - 86_400_000).toISOString(),
      ); // expired, 1 of 5 used
      await consume(second.sessionIds[0]!);

      // ----------------------------------------------------------------------------------------------------- discount records
      const discountId = randomUUID();
      const voucherDiscountId = randomUUID();
      const voucherId = randomUUID();
      for (const [id, label] of [
        [discountId, 'Khách mới'],
        [voucherDiscountId, 'Mã tri ân'],
      ] as const) {
        await replica(
          `INSERT INTO discounts (id, code, name_vi, name_en, requires_code) VALUES ('${id}', 'D${id.slice(0, 6).toUpperCase()}', '${label}', '${label}', ${id === voucherDiscountId})`,
        );
      }
      await replica(
        `INSERT INTO vouchers (id, discount_id, code, created_by_user_id) VALUES ('${voucherId}', '${voucherDiscountId}', 'V${base.run}', '${owner}')`,
      );
      const application = async (
        invoiceId: string,
        discount: string,
        voucher: string | null,
        amount: number,
      ) => {
        await replica(
          `INSERT INTO invoice_discount_applications (id, invoice_id, discount_id, version_id, voucher_id, kind, fixed_amount_vnd, eligible_subtotal_vnd, computed_amount_vnd, candidates, selection_reason, finalized_by_user_id)
           VALUES ('${randomUUID()}', '${invoiceId}', '${discount}', '${randomUUID()}', ${voucher ? `'${voucher}'` : 'NULL'}, 'FIXED_AMOUNT', ${amount}, 100000, ${amount}, '[]'::jsonb, 'TEST', '${owner}')`,
        );
        await replica(
          `UPDATE invoices SET discount_total_vnd = ${amount}, total_vnd = subtotal_vnd - ${amount} WHERE id = '${invoiceId}'`,
        );
      };
      await application(cream.invoiceId, discountId, null, 20_000); // a program
      await application(mask.invoiceId, voucherDiscountId, voucherId, 10_000); // a voucher
      await replica(
        `INSERT INTO birthday_redemptions (id, invoice_id, config_id, version_id, payer_user_id, birthday_on, amount_vnd)
         VALUES ('${randomUUID()}', '${exactInvoice.id}', '${randomUUID()}', '${randomUUID()}', '${owner}', '${today}', 7000)`,
      );
      await replica(
        `UPDATE invoices SET discount_total_vnd = 7000, total_vnd = subtotal_vnd - 7000 WHERE id = '${exactInvoice.id}'`,
      );
      await replica(
        `UPDATE invoices SET discount_total_vnd = 3000, total_vnd = subtotal_vnd - 3000 WHERE id = '${rangedInvoice.id}'`,
      ); // a discount nothing explains

      // ------------------------------------------------------------------------------------------------ online orders (real)
      await k.open();
      const lotion = await k.stocked('lotion', 200_000, 40);
      const toner = await k.stocked('toner', 150_000, 40);
      const buyer = await k.member('sales');
      const delivered = await k.order(buyer, [{ variantId: lotion.variantId, quantity: 1 }]);
      await k.payViaWebhook(buyer, delivered);
      const waiting = await k.order(buyer, [{ variantId: toner.variantId, quantity: 1 }]);
      await k.payViaWebhook(buyer, waiting);
      const manager = await base.staff(['MANAGE_PRODUCTS'], { globalCodes: ['MANAGE_PRODUCTS'] });
      const carriers = await k.online.createCarrier(manager.token, {
        name: 'Hãng thử',
        trackingUrlTemplate: 'https://tracking.example/{code}',
      });
      const carrier = carriers.carriers.find((entry) => entry.name === 'Hãng thử')!;
      const view = await k.online.staffOrder(people.queue.token, delivered.id);
      await k.ok(() =>
        k.online.ship(people.queue.token, delivered.id, {
          lines: view.lines
            .filter((l) => l.status !== 'CANCELLED')
            .map((l) => ({ id: l.id, rowVersion: l.rowVersion })),
          carrierId: carrier.id,
          trackingCode: 'VN123456789',
          carrierFeeVnd: '35000',
        }),
      );
      await k.ok(() => k.online.delivered(people.queue.token, delivered.id, {}));
      const deliveredInvoice = await tx.productOrder.findFirstOrThrow({
        where: { id: delivered.id },
        select: { invoiceId: true },
      });
      const codeId = randomUUID();
      await replica(
        `INSERT INTO employee_referral_codes (id, employee_user_id, code, created_by_user_id) VALUES ('${codeId}', '${approver.id}', 'ABC234', '${owner}')`,
      );
      await replica(
        `INSERT INTO order_referrals (invoice_id, employee_user_id, code_id, code) VALUES ('${deliveredInvoice.invoiceId}', '${approver.id}', '${codeId}', 'ABC234')`,
      );

      const net = (rows: { netVnd: string }[]) => rows.reduce((a, r) => a + BigInt(r.netVnd), 0n);

      await suite.test(
        'R5 services: money by service, units, shares; parts add up to the services of the revenue report',
        async () => {
          const r = await reports.serviceRevenue(exporter.token, query);
          const exact = r.rows.find((row) => row.serviceId === k.exact.id)!;
          const ranged = r.rows.find((row) => row.serviceId === k.ranged.id)!;
          assert.equal(exact.netVnd, '200000');
          assert.equal(exact.quantity, 1);
          assert.equal(ranged.netVnd, '100000');
          assert.equal(ranged.quantity, 1);
          assert.equal(exact.shareBp, 6667);
          assert.equal(r.totals.netVnd, '300000');
          assert.equal(net(r.rows), 300_000n);
          // The same money is the SERVICE part of the revenue report.
          const revenue = await reports.revenue(exporter.token, query);
          assert.equal(revenue.byKind.find((p) => p.key === 'SERVICE')?.netVnd, '300000');
          assert.equal(r.truncated, false);
          assert.equal(exact.nameVi, 'Dịch vụ EXACT');
        },
      );

      await suite.test(
        'R6 products: by variant, brand and category, with units sold and refunded',
        async () => {
          const byVariant = await reports.productRevenue(exporter.token, query);
          const creamRow = byVariant.rows.find((row) => row.key === cream.variantId)!;
          assert.equal(creamRow.netVnd, '200000'); // 300,000 sold - 100,000 refunded
          assert.equal(creamRow.unitsSold, 3);
          assert.equal(creamRow.unitsRefunded, 1);
          assert.equal(creamRow.sku, cream.sku);
          assert.equal(creamRow.brandNameVi, 'Thương hiệu thử');
          assert.equal(creamRow.categoryNameVi, 'Dưỡng da');
          const maskRow = byVariant.rows.find((row) => row.key === mask.variantId)!;
          assert.equal(maskRow.netVnd, '100000');
          assert.equal(maskRow.unitsSold, 2);
          assert.equal(maskRow.unitsRefunded, 0);
          assert.equal(byVariant.rows[0]!.key, cream.variantId, 'best seller first');
          const revenue = await reports.revenue(exporter.token, query);
          assert.equal(
            byVariant.totals.netVnd,
            revenue.byKind.find((p) => p.key === 'PRODUCT')?.netVnd,
          );
          const byBrand = await reports.productRevenue(exporter.token, { ...query, by: 'brand' });
          assert.equal(byBrand.rows.find((row) => row.key === brandId)?.netVnd, '200000');
          assert.equal(byBrand.totals.netVnd, byVariant.totals.netVnd);
          const byCategory = await reports.productRevenue(exporter.token, {
            ...query,
            by: 'category',
          });
          assert.equal(byCategory.rows.find((row) => row.key === categoryId)?.nameVi, 'Dưỡng da');
          await fails(
            () => reports.productRevenue(exporter.token, { ...query, by: 'shape' }),
            'VALIDATION_FAILED',
            'by',
          );
        },
      );

      await suite.test(
        'R7 combos: sold, revenue at sale, sessions used (a released one does not count), remaining and expired',
        async () => {
          const r = await reports.combos(exporter.token, query);
          const row = r.rows.find((entry) => entry.comboId === comboId)!;
          assert.equal(row.sold, 2);
          assert.equal(row.voided, 0);
          assert.equal(row.soldPriceVnd, '2000000');
          assert.equal(row.revenueVnd, '2000000');
          assert.equal(row.sessionsSold, 17);
          assert.equal(row.sessionsUsed, 3);
          assert.equal(row.sessionsRemaining, 10); // the first package: 12 - 2 (the released one is free again); the second is expired
          assert.equal(row.sessionsExpired, 4);
          assert.equal(r.totals.revenueVnd, '2000000');
          const revenue = await reports.revenue(exporter.token, query);
          assert.equal(revenue.byKind.find((p) => p.key === 'COMBO')?.netVnd, '2000000');
        },
      );

      await suite.test(
        'R8 discounts and campaigns: by source, the unexplained part shown, revenue by campaign',
        async () => {
          const r = await reports.discounts(exporter.token, query);
          const program = r.rows.find((row) => row.type === 'PROGRAM')!;
          const voucher = r.rows.find((row) => row.type === 'VOUCHER')!;
          const birthday = r.rows.find((row) => row.type === 'BIRTHDAY')!;
          const other = r.rows.find((row) => row.type === 'OTHER')!;
          assert.equal(program.amountVnd, '20000');
          assert.equal(program.nameVi, 'Khách mới');
          assert.equal(voucher.amountVnd, '10000');
          assert.equal(birthday.amountVnd, '7000');
          assert.equal(other.amountVnd, '3000');
          assert.equal(r.totals.discountVnd, '40000');
          assert.equal(
            r.rows.reduce((a, row) => a + BigInt(row.amountVnd), 0n),
            40_000n,
          );
          assert.equal(r.totals.discountedInvoices, 4);
          assert.ok(r.totals.paidInvoices >= 7);
          assert.equal(r.campaigns.length, 1);
          assert.equal(r.campaigns[0]!.nameVi, 'Khuyến mãi mùa thu');
          assert.equal(r.campaigns[0]!.netVnd, '100000');
          assert.equal(r.campaigns[0]!.units, 2);
        },
      );

      await suite.test(
        'R9 online orders: states, money collected and held, the staff code, the full phone, paging',
        async () => {
          const r = await reports.onlineOrders(exporter.token, query);
          assert.equal(r.summary.orders, 2);
          assert.equal(r.summary.delivered, 1);
          assert.equal(r.summary.awaitingDelivery, 1);
          assert.equal(r.summary.cancelled, 0);
          assert.equal(r.summary.collectedVnd, '350000');
          assert.equal(r.summary.refundedVnd, '0');
          assert.equal(r.summary.heldVnd, '150000');
          assert.equal(r.summary.staffCodeOrders, 1);
          assert.equal(r.summary.staffCodeCollectedVnd, '200000');
          assert.equal(r.total, 2);
          const done = r.rows.find((row) => row.state === 'DELIVERED')!;
          assert.equal(done.staffCode, 'ABC234');
          assert.equal(done.deliveredOn, today);
          assert.equal(done.collectedVnd, '200000');
          assert.match(done.contactPhone, /^\+84\d{9}$/, 'the phone is in full');
          assert.equal(r.rows.find((row) => row.state === 'AWAITING_DELIVERY')?.deliveredOn, null);
          const page2 = await reports.onlineOrders(exporter.token, { ...query, page: '2' });
          assert.equal(page2.rows.length, 0);
          await fails(
            () => reports.onlineOrders(exporter.token, { ...query, page: '0' }),
            'VALIDATION_FAILED',
            'page',
          );
        },
      );

      await suite.test(
        'scope: another branch sees none of it; a person without VIEW_REVENUE sees nothing; every report refuses a bad range',
        async () => {
          const theirs = await reports.serviceRevenue(viewerB.token, { from: today, to: today });
          assert.equal(theirs.totals.netVnd, '0');
          assert.deepEqual(
            theirs.branches.map((b) => b.id),
            [B.id],
          );
          await fails(() => reports.serviceRevenue(viewerB.token, query), 'FORBIDDEN');
          for (const call of [
            () => reports.serviceRevenue(noRevenue.token, query),
            () => reports.productRevenue(noRevenue.token, query),
            () => reports.combos(noRevenue.token, query),
            () => reports.discounts(noRevenue.token, query),
            () => reports.onlineOrders(noRevenue.token, query),
          ])
            await fails(call, 'FORBIDDEN');
          await fails(
            () => reports.serviceRevenue(exporter.token, { from: today }),
            'VALIDATION_FAILED',
            'to',
          );
          await fails(
            () => reports.combos(exporter.token, { from: '2026-02-30', to: today }),
            'VALIDATION_FAILED',
            'from',
          );
          await fails(
            () => reports.discounts(exporter.token, { from: today, to: '2020-01-01' }),
            'REPORT_RANGE_INVALID',
          );
        },
      );

      await suite.test(
        'exports: the files hold the screen numbers; the discount file has a campaigns sheet; the online file holds the full phone',
        async () => {
          const decode = (bytes: Uint8Array) =>
            new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
          const service = await exports.export(exporter.token, {
            report: 'revenue-by-service',
            format: 'xlsx',
            ...query,
          });
          const rows = readRows(service.bytes, service.filename);
          assert.deepEqual(rows[0]?.cells, [
            'Mã',
            'Dịch vụ',
            'Nhóm dịch vụ',
            'Số lượng',
            'Doanh thu',
            'Tỷ lệ',
          ]);
          assert.equal(rows[1]?.cells[1], 'Dịch vụ EXACT');
          assert.equal(rows[1]?.cells[4], '200000');
          const product = await exports.export(exporter.token, {
            report: 'revenue-by-product',
            format: 'csv',
            by: 'brand',
            ...query,
          });
          assert.ok(decode(product.bytes).includes('Thương hiệu thử'));
          const combo = await exports.export(exporter.token, {
            report: 'combos',
            format: 'csv',
            ...query,
          });
          assert.ok(decode(combo.bytes).includes('Gói massage 10+2,2,0,2000000,2000000,17,3,10,4'));
          const discount = await exports.export(exporter.token, {
            report: 'discounts-campaigns',
            format: 'xlsx',
            ...query,
          });
          const sheets = (await import('@lucy-spa/server')).readZipParts(discount.bytes);
          assert.ok(decode(sheets['xl/workbook.xml']!).includes('name="Chiến dịch"'));
          assert.ok(decode(sheets['xl/worksheets/sheet2.xml']!).includes('Khuyến mãi mùa thu'));
          const online = await exports.export(exporter.token, {
            report: 'online-orders',
            format: 'csv',
            ...query,
          });
          const text = decode(online.bytes);
          assert.match(text, /\+84\d{9}/);
          assert.ok(text.includes('ABC234'));
          assert.equal(online.rows, 2);
        },
      );
    });
  },
);

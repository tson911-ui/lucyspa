import 'reflect-metadata';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { onlineOrderKit } from '../testing/online-order-kit.js';
import { phase6Fixture } from '../testing/phase6-fixture.js';
import { ReportExportService } from './export.service.js';
import { addDays } from './report.dates.js';
import { ReportsService } from './reports.service.js';

/**
 * Phase 8 P8-9 against real PostgreSQL (design PHASE8_REPORTS.md 4.5, Owner OQ-P8-9): cosmetics and stock. Sales, a refund and the
 * receipts come from the real services; costs, expiry dates, thresholds and a sale made long ago are set as the system would hold them
 * (triggers lifted for that statement only). Every figure is hand-computed. Fixtures roll back.
 */
test(
  'Phase 8 P8-9 stock reports: best sellers, low, slow, expiry, value with coverage, movements, receipts; cost by permission; exports; fixtures roll back',
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
      const viewer = await base.staff(['VIEW_INVENTORY', 'EXPORT_REPORTS'], { branchId: A.id });
      const viewerB = await base.staff(['VIEW_INVENTORY'], { branchId: B.id });
      const noStock = await base.staff(['VIEW_REVENUE'], { branchId: A.id });
      const today = await k.day();
      const query = { from: today, to: today, branchId: A.id };
      const replica = async (sql: string) => {
        await tx.$executeRawUnsafe('SAVEPOINT fixture_row');
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        try {
          await tx.$executeRawUnsafe(sql);
          await tx.$executeRawUnsafe('RELEASE SAVEPOINT fixture_row');
        } catch (error) {
          await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT fixture_row');
          const detail =
            error instanceof Error ? error.message.replace(/\s+/g, ' ') : String(error);
          throw new Error(
            `fixture row failed: ${sql.slice(0, 160).replace(/\s+/g, ' ')} -> ${detail.slice(-300)}`,
          );
        } finally {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        }
      };

      // ------------------------------------------------------------------------------------------------- products and sales (real)
      const supplierId = randomUUID();
      await replica(
        `INSERT INTO suppliers (id, name) VALUES ('${supplierId}', 'Nhà cung cấp thử')`,
      );
      const make = async (label: string, price: number) =>
        (await k.product(label, [price])).variants[0]!;
      const cream = await make('kem', 100_000);
      const mask = await make('matna', 50_000);
      const toner = await make('toner', 80_000);
      const serum = await make('serum', 120_000);
      await k.receive(cream.id, 20);
      await k.receive(mask.id, 10);
      await k.receive(serum.id, 4);
      // The toner comes from a supplier, at a cost.
      const receipt = await k.inventory.createReceipt(people.receiver.token, {
        branchId: A.id,
        supplierId,
        receiptDate: today,
        notes: null,
        lines: [{ variantId: toner.id, quantity: 5, lotCode: 'LOT-TONER', expiryDate: null }],
      });
      await k.inventory.confirmReceipt(people.receiver.token, receipt.id, {
        expectedRowVersion: receipt.rowVersion,
      });
      const sell = async (variantId: string, quantity: number) => {
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, null), variantId, quantity),
        );
        await k.pay(invoice.id, Number(invoice.totalVnd));
        const view = await k.invoices.get(people.cashier.token, invoice.id);
        await k.runInventory(invoice.id);
        return view.productLines[0]!.id;
      };
      const creamLine = await sell(cream.id, 3); // 300,000
      await sell(mask.id, 2); // 100,000
      const opened = await k.ok(() =>
        k.returns.open(clerk.token, {
          branchId: A.id,
          invoiceLineId: creamLine,
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
      // Costs: every lot of the cream at 40,000, the toner at 10,000 (the receipt line too); the mask and the serum have none.
      await replica(
        `UPDATE inventory_lots SET unit_cost_vnd = 40000 WHERE variant_id = '${cream.id}'`,
      );
      await replica(
        `UPDATE inventory_lots SET unit_cost_vnd = 10000 WHERE variant_id = '${toner.id}'`,
      );
      await replica(
        `UPDATE stock_receipt_lines SET unit_cost_vnd = 10000 WHERE receipt_id = '${receipt.id}'`,
      );
      // Expiry: the serum expired 5 days ago, the toner expires in 30 days, the cream in 100 days.
      await replica(
        `UPDATE inventory_lots SET expiry_date = '${addDays(today, -5)}' WHERE variant_id = '${serum.id}'`,
      );
      await replica(
        `UPDATE inventory_lots SET expiry_date = '${addDays(today, 30)}' WHERE variant_id = '${toner.id}'`,
      );
      await replica(
        `UPDATE inventory_lots SET expiry_date = '${addDays(today, 100)}' WHERE variant_id = '${cream.id}'`,
      );
      await replica(`UPDATE product_variants SET low_stock_threshold = 5 WHERE id = '${serum.id}'`);
      await replica(`UPDATE product_variants SET low_stock_threshold = 2 WHERE id = '${cream.id}'`);

      const owner = people.owner.token;
      const decode = (bytes: Uint8Array) =>
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);

      await suite.test(
        'best sellers: units sold, returned and net, with the money of the revenue facts',
        async () => {
          const r = await reports.bestSellers(viewer.token, query);
          assert.equal(r.rows.length, 2);
          const [first, second] = r.rows;
          assert.equal(first!.sku, cream.sku);
          assert.deepEqual([first!.unitsSold, first!.unitsReturned, first!.unitsNet], [3, 1, 2]);
          assert.equal(first!.netVnd, '200000'); // 300,000 sold - 100,000 refunded
          assert.equal(second!.sku, mask.sku);
          assert.deepEqual([second!.unitsSold, second!.unitsReturned, second!.unitsNet], [2, 0, 2]);
          assert.equal(second!.netVnd, '100000');
          assert.equal(first!.shareBp + second!.shareBp, 10000);
          assert.equal(first!.shareBp, 6667);
          assert.equal(r.truncated, false);
        },
      );

      await suite.test(
        'low stock: at or below the threshold; available is on hand minus reserved',
        async () => {
          const r = await reports.lowStock(viewer.token, { branchId: A.id });
          assert.equal(r.rows.length, 1);
          const row = r.rows[0]!;
          assert.equal(row.sku, serum.sku);
          assert.deepEqual([row.onHand, row.reserved, row.available, row.threshold], [4, 0, 4, 5]);
          assert.equal(row.branch.id, A.id);
        },
      );

      await suite.test(
        'expiry: expired and expiring within the window, soonest first; the window is validated',
        async () => {
          const r = await reports.expiringLots(viewer.token, { branchId: A.id });
          assert.deepEqual(
            r.rows.map((x) => [x.sku, x.daysLeft, x.quantity]),
            [
              [serum.sku, -5, 4],
              [toner.sku, 30, 5],
            ],
          );
          assert.equal(r.days, 60);
          const narrow = await reports.expiringLots(viewer.token, { branchId: A.id, days: '20' });
          assert.deepEqual(
            narrow.rows.map((x) => x.sku),
            [serum.sku],
          );
          const wide = await reports.expiringLots(viewer.token, { branchId: A.id, days: '120' });
          assert.equal(wide.rows.length, 4); // the cream has two lots (17 sold from stock, 1 taken back)
          for (const bad of ['0', 'abc', '731', '-1']) {
            await fails(
              () => reports.expiringLots(viewer.token, { branchId: A.id, days: bad }),
              'VALIDATION_FAILED',
              'days',
            );
          }
        },
      );

      await suite.test(
        'value: stock at cost, the share of units that have a cost, and the variants without one',
        async () => {
          const r = await reports.stockValue(owner, { branchId: A.id });
          const row = (sku: string) => r.rows.find((x) => x.sku === sku)!;
          assert.deepEqual(
            [row(cream.sku).onHand, row(cream.sku).unitsWithCost, row(cream.sku).valueVnd],
            [18, 18, '720000'],
          );
          assert.deepEqual(
            [row(toner.sku).onHand, row(toner.sku).unitsWithCost, row(toner.sku).valueVnd],
            [5, 5, '50000'],
          );
          assert.deepEqual(
            [row(mask.sku).onHand, row(mask.sku).unitsWithCost, row(mask.sku).valueVnd],
            [8, 0, '0'],
          );
          assert.deepEqual(
            [row(serum.sku).onHand, row(serum.sku).unitsWithCost, row(serum.sku).valueVnd],
            [4, 0, '0'],
          );
          assert.equal(r.totals.onHand, 35);
          assert.equal(r.totals.unitsWithCost, 23);
          assert.equal(r.totals.valueVnd, '770000');
          assert.equal(r.totals.coverageBp, 6571);
          assert.equal(r.totals.variantsWithoutCost, 2);
          assert.equal(r.rows[0]!.sku, cream.sku, 'largest value first');
          // The value report is cost data: it needs VIEW_PRODUCT_COST, not only VIEW_INVENTORY.
          await fails(() => reports.stockValue(viewer.token, { branchId: A.id }), 'FORBIDDEN');
        },
      );

      await suite.test(
        'movements: by kind and reason; receipts: by supplier, cost only with the permission',
        async () => {
          const m = await reports.stockMovements(viewer.token, query);
          const of = (kind: string) =>
            m.rows
              .filter((x) => x.kind === kind)
              .reduce((a, x) => [a[0]! + x.unitsIn, a[1]! + x.unitsOut], [0, 0]);
          assert.deepEqual(of('RECEIPT'), [39, 0]); // 20 + 10 + 4 + 5
          assert.deepEqual(of('SALE'), [0, 5]);
          assert.deepEqual(of('REFUND_RETURN'), [1, 0]);
          const costed = await reports.stockReceipts(owner, query);
          assert.equal(costed.costColumn, true);
          assert.equal(costed.rows.length, 2);
          const supplied = costed.rows[0]!;
          assert.deepEqual(
            [
              supplied.supplierName,
              supplied.receipts,
              supplied.units,
              supplied.costVnd,
              supplied.linesWithoutCost,
            ],
            ['Nhà cung cấp thử', 1, 5, '50000', 0],
          );
          const rest = costed.rows[1]!;
          assert.deepEqual(
            [rest.supplierId, rest.receipts, rest.units, rest.linesWithoutCost],
            [null, 3, 34, 3],
          );
          const plain = await reports.stockReceipts(viewer.token, query);
          assert.equal(plain.costColumn, false);
          assert.deepEqual(
            plain.rows.map((x) => x.costVnd),
            [null, null],
          );
        },
      );

      await suite.test(
        'slow movers: stock and no sale for the window (never sold counts); cost only with the permission',
        async () => {
          // The mask was last sold 100 days ago (a fixture edit of the movement time); the cream was sold today.
          await replica(
            `UPDATE stock_movements SET created_at = clock_timestamp() - interval '100 days' WHERE variant_id = '${mask.id}' AND kind = 'SALE'`,
          );
          const r = await reports.slowMovers(owner, { branchId: A.id });
          assert.equal(r.days, 60);
          assert.deepEqual(
            r.rows.map((x) => x.sku),
            [...[toner.sku, serum.sku].sort(), mask.sku],
          ); // never sold first, by SKU, then the oldest sale
          const never = r.rows.find((x) => x.sku === toner.sku)!;
          assert.deepEqual(
            [never.lastSoldOn, never.daysSinceSale, never.costValueVnd],
            [null, null, '50000'],
          );
          const old = r.rows.find((x) => x.sku === mask.sku)!;
          assert.equal(old.daysSinceSale, 100);
          assert.equal(old.costValueVnd, null, 'no cost recorded');
          assert.equal(
            r.rows.some((x) => x.sku === cream.sku),
            false,
            'sold today',
          );
          const shorter = await reports.slowMovers(owner, { branchId: A.id, days: '200' });
          assert.equal(
            shorter.rows.some((x) => x.sku === mask.sku),
            false,
          );
          const plain = await reports.slowMovers(viewer.token, { branchId: A.id });
          assert.equal(plain.costColumn, false);
          assert.ok(plain.rows.every((x) => x.costValueVnd === null));
        },
      );

      await suite.test(
        'scope and permissions: another branch sees none of it; every report needs VIEW_INVENTORY',
        async () => {
          assert.equal((await reports.lowStock(viewerB.token, {})).rows.length, 0);
          assert.equal(
            (await reports.stockMovements(viewerB.token, { from: today, to: today })).rows.length,
            0,
          );
          await fails(() => reports.lowStock(viewerB.token, { branchId: A.id }), 'FORBIDDEN');
          for (const call of [
            () => reports.bestSellers(noStock.token, query),
            () => reports.lowStock(noStock.token, {}),
            () => reports.slowMovers(noStock.token, {}),
            () => reports.expiringLots(noStock.token, {}),
            () => reports.stockMovements(noStock.token, query),
            () => reports.stockReceipts(noStock.token, query),
          ]) {
            await fails(call, 'FORBIDDEN');
          }
        },
      );

      await suite.test(
        'exports: stock files hold the screen numbers; the cost column follows the permission',
        async () => {
          const best = await exports.export(viewer.token, {
            report: 'stock-best-sellers',
            format: 'csv',
            ...query,
          });
          assert.ok(decode(best.bytes).includes(`${cream.sku},`));
          assert.ok(decode(best.bytes).includes('200000'));
          const low = await exports.export(viewer.token, {
            report: 'stock-low',
            format: 'csv',
            branchId: A.id,
          });
          assert.ok(decode(low.bytes).includes(serum.sku));
          const expiry = await exports.export(viewer.token, {
            report: 'stock-expiry',
            format: 'csv',
            branchId: A.id,
            days: '20',
          });
          assert.ok(decode(expiry.bytes).includes(serum.sku));
          assert.equal(decode(expiry.bytes).includes(toner.sku), false);
          const slow = await exports.export(viewer.token, {
            report: 'stock-slow',
            format: 'csv',
            branchId: A.id,
          });
          assert.equal(
            decode(slow.bytes).includes('Giá trị tồn theo giá vốn'),
            false,
            'no cost column without VIEW_PRODUCT_COST',
          );
          const receipts = await exports.export(viewer.token, {
            report: 'stock-receipts',
            format: 'csv',
            ...query,
          });
          assert.equal(decode(receipts.bytes).includes('Giá vốn nhập'), false);
          const movements = await exports.export(viewer.token, {
            report: 'stock-movements',
            format: 'xlsx',
            ...query,
          });
          assert.ok(movements.rows >= 3);
          await fails(
            () =>
              exports.export(viewer.token, {
                report: 'stock-value',
                format: 'csv',
                branchId: A.id,
              }),
            'FORBIDDEN',
          );
        },
      );
    });
  },
);

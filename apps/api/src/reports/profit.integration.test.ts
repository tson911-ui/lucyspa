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
 * Phase 8 P8-13 against real PostgreSQL (design PHASE8_REPORTS.md 4.7, Owner OQ-P8-5): provisional profit, line by line. Two sales come from the
 * real services (one product with a lot cost, one without); a return of goods, pay earnings, pay runs and manual expenses are inserted as the
 * books write them (triggers lifted for that statement only). Every figure is hand-computed:
 *
 *   revenue 400,000 (300,000 + 100,000)
 *   cost of goods 40,000 (2 x 40,000 sold, 1 x 40,000 taken back); coverage 1 of 2 units = 50%; the other product is named as missing a cost
 *   tour 25,000 (30,000 less a 5,000 reversal) and commission 5,000
 *   salaries 255,000 (last month 100,000 + 10,000; this month 150,000 - 5,000; tour, tips and advance recoveries are not salaries; a voided item is not)
 *   manual expenses 70,000 (cash 50,000 + bank 20,000; a corrected 30,000 does not count)
 *   profit 400,000 - 40,000 - 25,000 - 5,000 - 255,000 - 70,000 = 5,000
 */
test(
  'Phase 8 P8-13 provisional profit: line by line, cost coverage, salaries by whole months, corrected expenses; Owner only; export; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, people } = k;
      const reports = new ReportsService(base.adapter, base.throttle);
      const exports = new ReportExportService(base.adapter, base.throttle, base.environment);
      const owner = people.owner.id;
      const token = people.owner.token;
      const today = await k.day();
      const month = `${today.slice(0, 7)}-01`;
      const previousMonth = `${addDays(month, -1).slice(0, 7)}-01`;
      const [year, monthNo] = month.split('-').map(Number) as [number, number];
      const lastDay = new Date(Date.UTC(year, monthNo, 0)).toISOString().slice(0, 10);
      const query = { from: previousMonth, to: lastDay };
      const viewer = await base.staff(['VIEW_REVENUE', 'EXPORT_REPORTS'], { branchId: A.id });
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
            { cause: error },
          );
        } finally {
          await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        }
      };

      await suite.test(
        'before the books start: salaries and expenses are not in the books, the report says so',
        async () => {
          const r = await reports.profit(token, query);
          assert.equal(r.started, false);
          assert.equal(r.lines.salariesVnd, '0');
          assert.equal(r.lines.manualExpensesVnd, '0');
        },
      );

      // ------------------------------------------------------------------------------------------ sales and goods (real services)
      const make = async (label: string, price: number) =>
        (await k.product(label, [price])).variants[0]!;
      const costed = await make('gv', 150_000);
      const bare = await make('kg', 100_000);
      await k.receive(costed.id, 5);
      await k.receive(bare.id, 5);
      const sell = async (variantId: string, quantity: number) => {
        const invoice = await k.finalize(
          await k.addLine(await k.openSale(people.cashier, null), variantId, quantity),
        );
        await k.pay(invoice.id, Number(invoice.totalVnd));
        await k.runInventory(invoice.id);
        return invoice;
      };
      const first = await sell(costed.id, 2); // 300,000
      await sell(bare.id, 1); // 100,000
      await replica(
        `UPDATE inventory_lots SET unit_cost_vnd = 40000 WHERE variant_id = '${costed.id}'`,
      );
      const lot = await tx.inventoryLot.findFirstOrThrow({
        where: { variantId: costed.id },
        select: { id: true },
      });
      // One unit of the costed product is taken back into stock (a refund's movement).
      await replica(
        `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, product_refund_id, idempotency_key, actor_user_id)
         VALUES ('${A.id}', '${costed.id}', '${lot.id}', 'REFUND_RETURN', 1, '${randomUUID()}', 'p813-${randomUUID()}', '${owner}')`,
      );
      const line = await tx.invoiceLine.findFirstOrThrow({
        where: { invoiceId: first.id },
        select: { id: true },
      });

      // ------------------------------------------------------------------------------------------------------------ the books
      await replica(
        `INSERT INTO finance_go_live (id, at, set_by_user_id, reauthenticated_at) VALUES (1, now() - interval '90 days', '${owner}', now())`,
      );
      const earning = async (kind: string, amount: number, key: string, reverses?: string) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO pay_earnings (id, kind, employee_user_id, branch_id, invoice_id, invoice_line_id, paid_seq, business_date, amount_vnd, source_key, reverses_id, reason)
           VALUES ('${id}', '${kind}', '${people.ktv.id}', '${A.id}', '${first.id}', '${line.id}', 1, '${today}', ${amount}, '${key}-${randomUUID()}',
             ${reverses ? `'${reverses}'` : 'NULL'}, ${reverses ? "'Hủy bán'" : 'NULL'})`,
        );
        return id;
      };
      const tour = await earning('TOUR', 30_000, 'tour');
      await earning('TOUR', -5_000, 'tour-rev', tour);
      await earning('PRODUCT_COMMISSION', 5_000, 'com');

      const run = async (periodMonth: string, status: 'DRAFT' | 'PAID') => {
        const id = randomUUID();
        await replica(
          status === 'PAID'
            ? `INSERT INTO pay_runs (id, period_month, status, payment_day, created_by_user_id, closed_at, closed_by_user_id, paid_at)
               VALUES ('${id}', '${periodMonth}', 'PAID', '${addDays(periodMonth, 4)}', '${owner}', now(), '${owner}', now())`
            : `INSERT INTO pay_runs (id, period_month, status, created_by_user_id) VALUES ('${id}', '${periodMonth}', 'DRAFT', '${owner}')`,
        );
        const lineId = randomUUID();
        await replica(
          `INSERT INTO pay_run_lines (id, run_id, employee_user_id) VALUES ('${lineId}', '${id}', '${people.ktv.id}')`,
        );
        return { id, lineId };
      };
      const item = (
        r: { id: string; lineId: string },
        kind: string,
        amount: number,
        extra: { generated?: boolean; voided?: boolean } = {},
      ) => {
        const generated = extra.generated ?? true;
        return replica(
          `INSERT INTO pay_run_items (id, run_id, line_id, kind, amount_vnd, generated, reason, created_by_user_id, voided_at, voided_by_user_id, void_reason)
           VALUES ('${randomUUID()}', '${r.id}', '${r.lineId}', '${kind}', ${amount}, ${generated}, ${generated ? 'NULL' : "'Ghi chú thử'"}, '${owner}',
             ${extra.voided ? 'now()' : 'NULL'}, ${extra.voided ? `'${owner}'` : 'NULL'}, ${extra.voided ? "'Nhập nhầm'" : 'NULL'})`,
        );
      };
      const before = await run(previousMonth, 'PAID');
      await item(before, 'BASE_SALARY', 100_000);
      await item(before, 'BONUS', 10_000, { generated: false });
      await item(before, 'BONUS', 99_000, { generated: false, voided: true });
      const now = await run(month, 'DRAFT');
      await item(now, 'BASE_SALARY', 150_000);
      await item(now, 'DEDUCTION', -5_000, { generated: false });
      await item(now, 'TOUR', 30_000);
      await item(now, 'TIP', 20_000);

      const fundA = randomUUID();
      const bank = randomUUID();
      for (const [id, kind, branch, name] of [
        [fundA, 'CASH', A.id, 'Quỹ A'],
        [bank, 'BANK', null, 'Ngân hàng'],
      ] as const) {
        await replica(
          `INSERT INTO cash_funds (id, kind, branch_id, name, opening_balance_vnd, opening_at, opening_by_user_id)
           VALUES ('${id}', '${kind}', ${branch ? `'${branch}'` : 'NULL'}, '${name}', 1000000, now() - interval '90 days', '${owner}')`,
        );
      }
      const expense = async (fundId: string, amount: number) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO fund_entries (id, fund_id, branch_id, business_date, direction, category, amount_vnd, reason, actor_user_id)
           VALUES ('${id}', '${fundId}', '${A.id}', '${today}', 'OUT', 'MANUAL_EXPENSE', ${amount}, 'Chi thử', '${owner}')`,
        );
        return id;
      };
      await expense(fundA, 50_000);
      await expense(bank, 20_000);
      const wrong = await expense(fundA, 30_000);
      await replica(
        `INSERT INTO fund_entries (fund_id, branch_id, business_date, direction, category, amount_vnd, reason, actor_user_id, reverses_entry_id)
         VALUES ('${fundA}', '${A.id}', '${today}', 'IN', 'CORRECTION', 30000, 'Ghi nhầm', '${owner}', '${wrong}')`,
      );

      await suite.test('every line of the profit, and the profit itself', async () => {
        const r = await reports.profit(token, query);
        assert.equal(r.started, true);
        assert.deepEqual(r.lines, {
          revenueVnd: '400000',
          costOfGoodsVnd: '40000',
          tourVnd: '25000',
          commissionVnd: '5000',
          salariesVnd: '255000',
          manualExpensesVnd: '70000',
          profitVnd: '5000',
        });
      });

      await suite.test(
        'cost coverage: the share of units sold that had a cost, and the product still missing one',
        async () => {
          const r = await reports.profit(token, query);
          assert.deepEqual(r.goods, { unitsSold: 2, unitsWithCost: 1, coverageBp: 5000 });
          assert.deepEqual(
            r.withoutCost.map((x) => [x.sku, x.unitsWithoutCost]),
            [[bare.sku, 1]],
          );
        },
      );

      await suite.test(
        'salaries count the pay months that lie fully inside the period; others are named, never guessed',
        async () => {
          const r = await reports.profit(token, query);
          assert.deepEqual(r.salaries, {
            monthsCounted: 2,
            monthsPartial: 0,
            monthsMissing: 0,
            monthsDraft: 1,
          });
          // From the middle of last month: last month only partly inside, so its salaries are not counted.
          const partial = await reports.profit(token, {
            from: addDays(previousMonth, 10),
            to: lastDay,
          });
          assert.equal(partial.lines.salariesVnd, '145000');
          assert.deepEqual(partial.salaries, {
            monthsCounted: 1,
            monthsPartial: 1,
            monthsMissing: 0,
            monthsDraft: 1,
          });
          // Two months back: a month with no pay run is named, not counted as zero silently.
          const twoBack = `${addDays(previousMonth, -1).slice(0, 7)}-01`;
          const missing = await reports.profit(token, { from: twoBack, to: lastDay });
          assert.equal(missing.salaries.monthsMissing, 1);
          assert.equal(missing.lines.salariesVnd, '255000');
        },
      );

      await suite.test(
        'a period with nothing in it is a zero profit, not an error; the range is validated',
        async () => {
          const r = await reports.profit(token, { from: '2001-01-01', to: '2001-01-31' });
          assert.deepEqual(
            [r.lines.revenueVnd, r.lines.profitVnd, r.goods.coverageBp],
            ['0', '0', 10000],
          );
          await fails(
            () => reports.profit(token, { from: lastDay, to: previousMonth }),
            'REPORT_RANGE_INVALID',
          );
          await fails(
            () => reports.profit(token, { from: '2020-01-01', to: lastDay }),
            'REPORT_RANGE_TOO_LONG',
          );
        },
      );

      await suite.test(
        'Owner only: a person without VIEW_PROFIT gets nothing, the registry says it is not available',
        async () => {
          await fails(() => reports.profit(viewer.token, query), 'FORBIDDEN');
          const entry = (await reports.registry(token)).reports.find((x) => x.id === 'profit')!;
          assert.equal(entry.available, true);
          assert.equal(entry.exportReauth, true);
          const theirs = (await reports.registry(viewer.token)).reports.find(
            (x) => x.id === 'profit',
          )!;
          assert.equal(theirs.available, false);
        },
      );

      await suite.test(
        'export: the lines, the note on cost coverage and the disclaimer; products missing a cost on their own sheet',
        async () => {
          const file = await exports.export(token, { report: 'profit', format: 'csv', ...query });
          const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(file.bytes);
          assert.ok(text.includes('400000') && text.includes('5000'));
          assert.ok(text.includes('-255000'));
          assert.ok(text.includes('50.0% số lượng bán có giá vốn'));
          assert.ok(text.includes('không phải báo cáo thuế'));
          await fails(
            () => exports.export(token, { report: 'profit', format: 'xlsx', ...query }),
            'REAUTHENTICATION_REQUIRED',
          );
        },
      );
    });
  },
);

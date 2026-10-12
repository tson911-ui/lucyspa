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
 * Phase 8 P8-12 against real PostgreSQL (design PHASE8_REPORTS.md 4.6, Owner OQ-P8-4): cash, tips, payroll, labour cost and advances. The sale
 * that gives the month its revenue is made through the real services; the books (the go-live, funds, entries, closings, tips, pay runs and
 * advances) are inserted as the Phase 7 flows write them, with the triggers lifted for that statement only. Every figure is hand-computed
 * (see the layout of the days below). Fixtures roll back.
 *
 *   day -3: branch B closes with +300,000 over (alert); the bank pays a 200,000 advance
 *   day -2: branch A closes: float 1,000,000, in 400,000, out 50,000, counted 1,330,000 (-20,000), 330,000 withdrawn
 *   day -1: branch A open (in 300,000, out 20,000), branch B closes with no movement, bank takes 250,000
 *   today : branch B open (in 100,000)
 */
test(
  'Phase 8 P8-12 money reports: cash by day, funds, differences, tips, payroll, labour cost, advances; not started; scope; exports; fixtures roll back',
  { skip: process.env['RUN_AUTH_INTEGRATION'] !== 'true' },
  async (suite) => {
    await phase6Fixture(async (base) => {
      const k = await onlineOrderKit(base);
      const { tx, fails } = base;
      const { A, B, people } = k;
      const reports = new ReportsService(base.adapter, base.throttle);
      const exports = new ReportExportService(base.adapter, base.throttle, base.environment);
      const owner = people.owner.id;
      const ownerToken = people.owner.token;
      const today = await k.day();
      const d1 = addDays(today, -1);
      const d2 = addDays(today, -2);
      const d3 = addDays(today, -3);
      const month = `${today.slice(0, 7)}-01`;
      const previousMonth = `${addDays(month, -1).slice(0, 7)}-01`;
      const cashA = await base.staff(['VIEW_CASH', 'EXPORT_REPORTS'], { branchId: A.id });
      const payA = await base.staff(['VIEW_EMPLOYEE_PAY', 'EXPORT_REPORTS'], { branchId: A.id });
      const nobody = await base.staff(['VIEW_REVENUE'], { branchId: A.id });
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
      const decode = (bytes: Uint8Array) =>
        new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      const query = { from: d3, to: today };

      await suite.test(
        'before the Owner starts the books: "not started", never zeros',
        async () => {
          const daily = await reports.cashDaily(ownerToken, query);
          assert.equal(daily.started, false);
          assert.equal(daily.startedAt, null);
          assert.deepEqual(daily.rows, []);
          assert.equal((await reports.cashFunds(ownerToken, query)).started, false);
          assert.equal((await reports.cashDifferences(ownerToken, query)).rows.length, 0);
          const pay = await reports.payrollMonthly(ownerToken, query);
          assert.equal(pay.started, false);
          assert.deepEqual(pay.rows, []);
          assert.equal((await reports.advances(ownerToken, {})).started, false);
        },
      );

      // ------------------------------------------------------------------------------------------------------ the sale (real)
      const product = await k.product('mny', [150_000]);
      const variant = product.variants[0]!;
      await k.receive(variant.id, 5);
      const sale = await k.finalize(
        await k.addLine(await k.openSale(people.cashier, null), variant.id, 2),
      );
      await k.pay(sale.id, Number(sale.totalVnd)); // revenue of the month: 300,000
      await k.runInventory(sale.id);

      // ------------------------------------------------------------------------------------------------------------ the books
      await replica(
        `INSERT INTO finance_go_live (id, at, set_by_user_id, reauthenticated_at) VALUES (1, now() - interval '30 days', '${owner}', now())`,
      );
      const fundA = randomUUID();
      const fundB = randomUUID();
      const bank = randomUUID();
      const fund = (
        id: string,
        kind: 'CASH' | 'BANK',
        branch: string | null,
        name: string,
        opening: number,
      ) =>
        replica(
          `INSERT INTO cash_funds (id, kind, branch_id, name, opening_balance_vnd, opening_at, opening_by_user_id)
           VALUES ('${id}', '${kind}', ${branch ? `'${branch}'` : 'NULL'}, '${name}', ${opening}, now() - interval '30 days', '${owner}')`,
        );
      await fund(fundA, 'CASH', A.id, 'Quỹ A', 1_000_000);
      await fund(fundB, 'CASH', B.id, 'Quỹ B', 500_000);
      await fund(bank, 'BANK', null, 'Ngân hàng', 2_000_000);
      const entry = async (
        fundId: string,
        branch: string,
        date: string,
        direction: 'IN' | 'OUT',
        category: string,
        amount: number,
      ) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO fund_entries (id, fund_id, branch_id, business_date, direction, category, amount_vnd, reason, actor_user_id)
           VALUES ('${id}', '${fundId}', '${branch}', '${date}', '${direction}', '${category}', ${amount}, 'Ghi sổ thử', '${owner}')`,
        );
        return id;
      };
      const saleEntry = await entry(fundA, A.id, d2, 'IN', 'SALE_CASH', 400_000);
      await entry(fundA, A.id, d2, 'OUT', 'MANUAL_EXPENSE', 50_000);
      await entry(fundA, A.id, d2, 'OUT', 'COUNT_DIFFERENCE', 20_000);
      await entry(fundA, A.id, d2, 'OUT', 'OWNER_WITHDRAWAL', 330_000);
      await entry(fundA, A.id, d1, 'IN', 'SALE_CASH', 300_000);
      await entry(fundA, A.id, d1, 'OUT', 'MANUAL_EXPENSE', 20_000);
      await entry(fundB, B.id, d3, 'IN', 'COUNT_DIFFERENCE', 300_000);
      await entry(fundB, B.id, today, 'IN', 'SALE_CASH', 100_000);
      await entry(bank, A.id, d1, 'IN', 'SALE_BANK', 250_000);
      const advanceEntry = await entry(bank, A.id, d3, 'OUT', 'ADVANCE', 200_000);
      const closing = (
        fundId: string,
        branch: string,
        date: string,
        v: {
          open: number;
          in: number;
          out: number;
          counted: number;
          reason?: string;
          withdrawal?: number;
        },
      ) => {
        const expected = v.open + v.in - v.out;
        const withdrawal = v.withdrawal ?? 0;
        return replica(
          `INSERT INTO cash_day_closings (id, fund_id, branch_id, business_date, opening_float_vnd, cash_in_vnd, cash_out_vnd, expected_vnd, counted_vnd,
             difference_vnd, reason, withdrawal_vnd, next_float_vnd, closed_by_user_id, reauthenticated_at, client_request_id)
           VALUES ('${randomUUID()}', '${fundId}', '${branch}', '${date}', ${v.open}, ${v.in}, ${v.out}, ${expected}, ${v.counted},
             ${v.counted - expected}, ${v.reason ? `'${v.reason}'` : 'NULL'}, ${withdrawal}, ${v.counted - withdrawal}, '${owner}', now(), '${randomUUID()}')`,
        );
      };
      await closing(fundB, B.id, d3, {
        open: 500_000,
        in: 0,
        out: 0,
        counted: 800_000,
        reason: 'Nhập thiếu',
      });
      await closing(fundA, A.id, d2, {
        open: 1_000_000,
        in: 400_000,
        out: 50_000,
        counted: 1_330_000,
        reason: 'Thiếu tiền lẻ',
        withdrawal: 330_000,
      });
      await closing(fundB, B.id, d1, { open: 800_000, in: 0, out: 0, counted: 800_000 });

      // Pay runs: this month (draft) and last month (paid); lines, items, one advance recovered in part.
      const runNow = randomUUID();
      const runBefore = randomUUID();
      await replica(
        `INSERT INTO pay_runs (id, period_month, status, created_by_user_id) VALUES ('${runNow}', '${month}', 'DRAFT', '${owner}')`,
      );
      await replica(
        `INSERT INTO pay_runs (id, period_month, status, payment_day, created_by_user_id, closed_at, closed_by_user_id, paid_at)
         VALUES ('${runBefore}', '${previousMonth}', 'PAID', '${addDays(month, 4)}', '${owner}', now(), '${owner}', now())`,
      );
      const ktv = people.ktv.id;
      const cashier = people.cashier.id;
      const lineOf = async (run: string, user: string) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO pay_run_lines (id, run_id, employee_user_id) VALUES ('${id}', '${run}', '${user}')`,
        );
        return id;
      };
      const ktvLine = await lineOf(runNow, ktv);
      const cashierLine = await lineOf(runNow, cashier);
      const oldLine = await lineOf(runBefore, ktv);
      const advance = randomUUID();
      const item = (
        run: string,
        line: string,
        kind: string,
        amount: number,
        extra: { generated?: boolean; advance?: string; voided?: boolean } = {},
      ) => {
        const generated = extra.generated ?? true;
        return replica(
          `INSERT INTO pay_run_items (id, run_id, line_id, kind, amount_vnd, generated, advance_id, reason, created_by_user_id, voided_at, voided_by_user_id, void_reason)
           VALUES ('${randomUUID()}', '${run}', '${line}', '${kind}', ${amount}, ${generated}, ${extra.advance ? `'${extra.advance}'` : 'NULL'},
             ${generated ? 'NULL' : "'Ghi chú thử'"}, '${owner}', ${extra.voided ? 'now()' : 'NULL'}, ${extra.voided ? `'${owner}'` : 'NULL'}, ${extra.voided ? "'Nhập nhầm'" : 'NULL'})`,
        );
      };
      await item(runNow, ktvLine, 'BASE_SALARY', 150_000);
      await item(runNow, ktvLine, 'TOUR', 30_000);
      await item(runNow, ktvLine, 'COMMISSION', 5_000);
      await item(runNow, ktvLine, 'BONUS', 10_000, { generated: false });
      await item(runNow, ktvLine, 'BONUS', 99_000, { generated: false, voided: true });
      await item(runNow, ktvLine, 'DEDUCTION', -5_000, { generated: false });
      await item(runNow, ktvLine, 'ADVANCE_RECOVERY', -20_000, { advance });
      await item(runNow, ktvLine, 'TIP', 20_000);
      await item(runNow, cashierLine, 'BASE_SALARY', 100_000);
      await item(runBefore, oldLine, 'BASE_SALARY', 100_000);
      const advanceRow = (
        id: string,
        user: string,
        status: string,
        amount: number,
        fields: string,
        values: string,
      ) =>
        replica(
          `INSERT INTO salary_advances (id, employee_user_id, amount_vnd, status, reason, requested_by_user_id, client_request_id${fields})
           VALUES ('${id}', '${user}', ${amount}, '${status}', 'Cần gấp', '${owner}', '${randomUUID()}'${values})`,
        );
      await advanceRow(
        advance,
        ktv,
        'PAID',
        200_000,
        ', approved_at, approved_by_user_id, paid_at, paid_by_user_id, paid_fund_id, paid_entry_id',
        `, now(), '${owner}', now(), '${owner}', '${bank}', '${advanceEntry}'`,
      );
      await advanceRow(randomUUID(), cashier, 'REQUESTED', 50_000, '', '');
      await advanceRow(
        randomUUID(),
        ktv,
        'RECOVERED',
        80_000,
        ', approved_at, approved_by_user_id, paid_at, paid_by_user_id, paid_fund_id, recovered_at',
        `, now(), '${owner}', now(), '${owner}', '${bank}', now()`,
      );

      // Tips: the KTV has a cash tip, a part of it reversed, and a transfer tip (nothing in a run yet); the cashier's is in the draft run;
      // branch B's person has one that branch A may not see.
      const tip = async (
        branch: string,
        user: string,
        amount: number,
        method: 'CASH' | 'TRANSFER',
        extra: { run?: string; reverses?: string } = {},
      ) => {
        const id = randomUUID();
        await replica(
          `INSERT INTO tips (id, branch_id, invoice_id, employee_user_id, amount_vnd, method, business_date, reverses_id, reason, recorded_by_user_id, client_request_id, fund_entry_id, run_id)
           VALUES ('${id}', '${branch}', '${sale.id}', '${user}', ${amount}, '${method}', '${today}', ${extra.reverses ? `'${extra.reverses}'` : 'NULL'},
             ${extra.reverses ? "'Nhập nhầm'" : 'NULL'}, '${owner}', '${randomUUID()}', '${saleEntry}', ${extra.run ? `'${extra.run}'` : 'NULL'})`,
        );
        return id;
      };
      const cashTip = await tip(A.id, ktv, 20_000, 'CASH');
      await tip(A.id, ktv, -5_000, 'CASH', { reverses: cashTip });
      await tip(A.id, ktv, 10_000, 'TRANSFER');
      await tip(A.id, cashier, 15_000, 'CASH', { run: runNow });
      await tip(B.id, people.otherBranch.id, 7_000, 'CASH');

      await suite.test(
        'K1 daily cash: closed days show their closing, open days the book so far; totals; by kind of entry',
        async () => {
          const r = await reports.cashDaily(ownerToken, query);
          assert.equal(r.started, true);
          assert.equal(r.rows.length, 5);
          const row = (branch: string, date: string) =>
            r.rows.find((x) => x.branch.id === branch && x.date === date)!;
          const a2 = row(A.id, d2);
          assert.deepEqual(
            [
              a2.closed,
              a2.openingFloatVnd,
              a2.cashInVnd,
              a2.cashOutVnd,
              a2.expectedVnd,
              a2.countedVnd,
              a2.differenceVnd,
              a2.withdrawalVnd,
              a2.reason,
            ],
            [
              true,
              '1000000',
              '400000',
              '50000',
              '1350000',
              '1330000',
              '-20000',
              '330000',
              'Thiếu tiền lẻ',
            ],
          );
          const a1 = row(A.id, d1);
          assert.deepEqual(
            [
              a1.closed,
              a1.openingFloatVnd,
              a1.cashInVnd,
              a1.cashOutVnd,
              a1.expectedVnd,
              a1.countedVnd,
              a1.differenceVnd,
            ],
            [false, '1000000', '300000', '20000', '1280000', null, null],
          );
          const b0 = row(B.id, today);
          assert.deepEqual(
            [b0.closed, b0.openingFloatVnd, b0.cashInVnd, b0.expectedVnd],
            [false, '800000', '100000', '900000'],
          );
          const b3 = row(B.id, d3);
          assert.deepEqual(
            [b3.closed, b3.countedVnd, b3.differenceVnd],
            [true, '800000', '300000'],
          );
          assert.equal(
            row(B.id, d1).closed,
            true,
            'a closed day without any entry is still listed',
          );
          assert.deepEqual(
            r.rows.map((x) => x.date),
            [today, d1, d1, d2, d3],
            'newest day first',
          );
          assert.deepEqual(r.totals, {
            cashInVnd: '800000',
            cashOutVnd: '70000',
            differenceVnd: '280000',
            closedDays: 3,
            openDays: 2,
          });
          const cat = (name: string) => r.byCategory.find((c) => c.category === name);
          assert.deepEqual([cat('SALE_CASH')?.inVnd, cat('SALE_CASH')?.outVnd], ['800000', '0']);
          assert.deepEqual(
            [cat('MANUAL_EXPENSE')?.inVnd, cat('MANUAL_EXPENSE')?.outVnd],
            ['0', '70000'],
          );
          assert.deepEqual(
            [cat('COUNT_DIFFERENCE')?.inVnd, cat('COUNT_DIFFERENCE')?.outVnd],
            ['300000', '20000'],
          );
          assert.equal(cat('OWNER_WITHDRAWAL')?.outVnd, '330000');
          assert.equal(cat('SALE_BANK'), undefined, 'the bank fund is not the cash');
          // One branch only, by permission and by filter.
          const mine = await reports.cashDaily(cashA.token, query);
          assert.deepEqual(
            mine.rows.map((x) => x.branch.id),
            [A.id, A.id],
          );
          assert.equal(mine.totals.differenceVnd, '-20000');
          const filtered = await reports.cashDaily(ownerToken, { ...query, branchId: B.id });
          assert.ok(filtered.rows.every((x) => x.branch.id === B.id));
        },
      );

      await suite.test(
        'K2 funds: balance at the end of the period, movement of the period, the bank only for who holds the cash everywhere',
        async () => {
          const r = await reports.cashFunds(ownerToken, query);
          const f = (name: string) => r.rows.find((x) => x.name === name)!;
          assert.equal(r.bankIncluded, true);
          assert.deepEqual(
            [
              f('Quỹ A').openingBalanceVnd,
              f('Quỹ A').inVnd,
              f('Quỹ A').outVnd,
              f('Quỹ A').balanceVnd,
              f('Quỹ A').lastClosedDate,
            ],
            ['1000000', '700000', '420000', '1280000', d2],
          );
          assert.deepEqual(
            [f('Quỹ B').inVnd, f('Quỹ B').outVnd, f('Quỹ B').balanceVnd, f('Quỹ B').lastClosedDate],
            ['400000', '0', '900000', d1],
          );
          assert.deepEqual(
            [f('Ngân hàng').kind, f('Ngân hàng').branch, f('Ngân hàng').balanceVnd],
            ['BANK', null, '2050000'],
          );
          assert.deepEqual(
            r.rows.map((x) => x.kind),
            ['CASH', 'CASH', 'BANK'],
          );
          const earlier = await reports.cashFunds(ownerToken, { from: d3, to: d2 });
          const e = (name: string) => earlier.rows.find((x) => x.name === name)!;
          assert.deepEqual(
            [e('Quỹ A').balanceVnd, e('Quỹ B').balanceVnd, e('Ngân hàng').balanceVnd],
            ['1000000', '800000', '1800000'],
          );
          const mine = await reports.cashFunds(cashA.token, query);
          assert.equal(mine.bankIncluded, false);
          assert.deepEqual(
            mine.rows.map((x) => x.name),
            ['Quỹ A'],
          );
        },
      );

      await suite.test(
        'K3 differences: only the days that differ, the alert threshold, who closed',
        async () => {
          const r = await reports.cashDifferences(ownerToken, query);
          assert.deepEqual(
            r.rows.map((x) => [x.branch.id, x.date, x.differenceVnd, x.alert]),
            [
              [A.id, d2, '-20000', false],
              [B.id, d3, '300000', true],
            ],
          );
          assert.equal(r.alertThresholdVnd, '50000');
          assert.deepEqual(r.totals, { differenceVnd: '280000', days: 2, alerts: 1 });
          assert.ok(r.rows[0]!.closedByName);
          assert.equal(r.rows[0]!.reason, 'Thiếu tiền lẻ');
          assert.equal((await reports.cashDifferences(cashA.token, query)).rows.length, 1);
        },
      );

      await suite.test(
        'T1 tips: by person and method, reversals taken off, in a run or still owed; branch scope',
        async () => {
          const r = await reports.tips(payA.token, { from: today, to: today });
          const row = (id: string) => r.rows.find((x) => x.userId === id)!;
          assert.deepEqual(
            [
              row(ktv).cashVnd,
              row(ktv).transferVnd,
              row(ktv).totalVnd,
              row(ktv).inRunVnd,
              row(ktv).owedVnd,
              row(ktv).entries,
            ],
            ['15000', '10000', '25000', '0', '25000', 3],
          );
          assert.deepEqual(
            [row(cashier).totalVnd, row(cashier).inRunVnd, row(cashier).owedVnd],
            ['15000', '15000', '0'],
          );
          assert.equal(
            r.rows.some((x) => x.userId === people.otherBranch.id),
            false,
            'branch B is not branch A',
          );
          assert.deepEqual(r.totals, {
            cashVnd: '30000',
            transferVnd: '10000',
            totalVnd: '40000',
            owedVnd: '25000',
          });
          const all = await reports.tips(ownerToken, { from: today, to: today });
          assert.equal(all.rows.find((x) => x.userId === people.otherBranch.id)?.totalVnd, '7000');
          await fails(() => reports.tips(cashA.token, { from: today, to: today }), 'FORBIDDEN');
        },
      );

      await suite.test(
        'P1 payroll by month: items by kind (voided left out), net and tips, status; needs the pay permission at every branch',
        async () => {
          const r = await reports.payrollMonthly(ownerToken, { from: previousMonth, to: today });
          assert.deepEqual(
            r.rows.map((x) => [x.month, x.status, x.people]),
            [
              [month, 'DRAFT', 2],
              [previousMonth, 'PAID', 1],
            ],
          );
          const now = r.rows[0]!;
          assert.deepEqual(now.byKind, {
            BASE_SALARY: '250000',
            CTV_WORK: '0',
            TOUR: '30000',
            COMMISSION: '5000',
            BONUS: '10000',
            ADJUSTMENT: '0',
            DEDUCTION: '-5000',
            ADVANCE_RECOVERY: '-20000',
          });
          assert.deepEqual([now.netVnd, now.tipsVnd], ['270000', '20000']);
          assert.deepEqual(
            [r.rows[1]!.netVnd, r.rows[1]!.paymentDay],
            ['100000', addDays(month, 4)],
          );
          assert.deepEqual(r.totals, { netVnd: '370000', tipsVnd: '20000' });
          await fails(
            () => reports.payrollMonthly(payA.token, { from: previousMonth, to: today }),
            'FORBIDDEN',
          );
          // A month with no run is simply not listed.
          assert.deepEqual(
            (
              await reports.payrollMonthly(ownerToken, {
                from: addDays(previousMonth, -60),
                to: addDays(previousMonth, -40),
              })
            ).rows,
            [],
          );
        },
      );

      await suite.test(
        "P2 labour cost against revenue: pay plus tips over the month's revenue, null when the month had none",
        async () => {
          const r = await reports.labourCost(ownerToken, { from: previousMonth, to: today });
          const current = r.rows.find((x) => x.month === month)!;
          assert.deepEqual(
            [current.labourVnd, current.revenueVnd, current.shareBp],
            ['290000', '300000', 9667],
          );
          const before = r.rows.find((x) => x.month === previousMonth)!;
          assert.deepEqual(
            [before.labourVnd, before.revenueVnd, before.shareBp],
            ['100000', '0', null],
          );
          await fails(
            () => reports.labourCost(payA.token, { from: previousMonth, to: today }),
            'FORBIDDEN',
          );
        },
      );

      await suite.test(
        'P3 advances: what was paid and not recovered, and what waits; settled advances are left out',
        async () => {
          const r = await reports.advances(ownerToken, {});
          const row = (id: string) => r.rows.find((x) => x.userId === id)!;
          assert.deepEqual(
            [
              row(ktv).paidVnd,
              row(ktv).recoveredVnd,
              row(ktv).outstandingVnd,
              row(ktv).pendingCount,
            ],
            ['200000', '20000', '180000', 0],
          );
          assert.deepEqual(
            [row(cashier).outstandingVnd, row(cashier).pendingCount, row(cashier).pendingVnd],
            ['0', 1, '50000'],
          );
          assert.deepEqual(r.totals, { outstandingVnd: '180000', pendingVnd: '50000' });
          await fails(() => reports.advances(payA.token, {}), 'FORBIDDEN');
        },
      );

      await suite.test(
        'registry: shop-wide reports are open only to a person who holds the permissions at every branch',
        async () => {
          const owners = await reports.registry(ownerToken);
          const entry = (r: typeof owners, id: string) => r.reports.find((x) => x.id === id)!;
          for (const id of ['payroll-monthly', 'labour-cost', 'advances', 'cash-daily', 'tips']) {
            assert.equal(entry(owners, id).available, true, id);
          }
          const mine = await reports.registry(payA.token);
          assert.equal(entry(mine, 'tips').available, true);
          for (const id of ['payroll-monthly', 'advances', 'labour-cost']) {
            assert.equal(entry(mine, id).available, false, id);
          }
          assert.equal(entry(await reports.registry(nobody.token), 'cash-daily').available, false);
        },
      );

      await suite.test(
        "exports: cash and tips files hold the screen numbers; shop-wide files need the whole shop; the audit trail is the export engine's",
        async () => {
          const daily = await exports.export(cashA.token, {
            report: 'cash-daily',
            format: 'csv',
            ...query,
          });
          const text = decode(daily.bytes);
          assert.ok(text.includes('1330000') && text.includes('Thiếu tiền lẻ'));
          const funds = await exports.export(cashA.token, {
            report: 'cash-funds',
            format: 'csv',
            ...query,
          });
          assert.ok(decode(funds.bytes).includes('1280000'));
          const diff = await exports.export(cashA.token, {
            report: 'cash-differences',
            format: 'csv',
            ...query,
          });
          assert.ok(decode(diff.bytes).includes('-20000'));
          const tips = await exports.export(payA.token, {
            report: 'tips',
            format: 'csv',
            from: today,
            to: today,
          });
          assert.ok(decode(tips.bytes).includes('25000'));
          await fails(
            () =>
              exports.export(payA.token, { report: 'payroll-monthly', format: 'csv', ...query }),
            'FORBIDDEN',
          );
          const payroll = await exports.export(ownerToken, {
            report: 'payroll-monthly',
            format: 'xlsx',
            from: previousMonth,
            to: today,
          });
          assert.ok(payroll.rows >= 2);
        },
      );
    });
  },
);

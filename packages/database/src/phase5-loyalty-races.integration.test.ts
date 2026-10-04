import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { generateInvoiceCode } from './invoice-code.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const migrations = new URL('../prisma/migrations/', import.meta.url);

/**
 * Real-connection races of the Phase 5 P5-2 database guards (same isolated-schema approach as the
 * Phase 4 races: the whole migration chain is applied into a throwaway schema, the races run on committed
 * data with separate connections, and the schema is dropped at the end). Like that file it runs in its own
 * second `node --test` invocation because the schema exists while the races run.
 */
test('Phase 5 loyalty guards under real concurrency (isolated schema, dropped afterwards)', async (context) => {
  const run = randomUUID().replaceAll('-', '').slice(0, 10).toLowerCase();
  const schema = `p5r_${run}`;
  const clients: Client[] = [];
  const connect = async () => {
    const client = new Client({
      connectionString: databaseUrl,
      options: `-c search_path=${schema},public`,
    });
    await client.connect();
    clients.push(client);
    return client;
  };
  const admin = new Client({ connectionString: databaseUrl });
  await admin.connect();
  try {
    await admin.query('SET client_min_messages TO warning');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const setup = await connect();
    const folders = (await readdir(migrations, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    for (const folder of folders) {
      await setup.query(await readFile(new URL(`${folder}/migration.sql`, migrations), 'utf8'));
    }

    // ------------------------------------------------------------------ fixtures (committed)
    const id = () => randomUUID();
    const customer = id();
    const staff = id();
    const ktv = id();
    const branch = id();
    const category = id();
    const service = id();
    const user = async (userId: string, kind: 'CUSTOMER' | 'EMPLOYEE', n: number) => {
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO users (id, kind, status, full_name, preferred_locale, email_canonical, email_delivery,
           email_verified_at, phone_canonical, normalization_version, password_hash)
         VALUES ($1, $2, 'ACTIVE', $3, 'vi', $4, $4, now(), $5, 1, '$argon2id$race')`,
        [
          userId,
          kind,
          `Race ${n}`,
          `p5race-${n}-${run}@example.com`,
          `+847${String(n).padStart(2, '0')}${run.replace(/\D/g, '').padEnd(6, '1').slice(0, 6)}`,
        ],
      );
      if (kind === 'CUSTOMER') {
        await setup.query(
          `INSERT INTO customer_profiles (user_id, date_of_birth, address) VALUES ($1, '1990-01-01', 'x')`,
          [userId],
        );
      } else {
        await setup.query(
          `INSERT INTO employee_profiles (user_id, employee_code_canonical, date_of_birth, address)
           VALUES ($1, $2, '1990-01-01', 'x')`,
          [userId, `P5RACE_${n}_${run.toUpperCase()}`],
        );
      }
      await setup.query('COMMIT');
    };
    await user(customer, 'CUSTOMER', 10);
    await user(staff, 'EMPLOYEE', 11);
    await user(ktv, 'EMPLOYEE', 12);
    await setup.query(
      `INSERT INTO branches (id, code, name, timezone) VALUES ($1, $2, 'Race', 'Asia/Ho_Chi_Minh')`,
      [branch, `P5R-${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO service_categories (id, code, name_vi, name_en) VALUES ($1, $2, 'x', 'x')`,
      [category, `P5R_${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO services (id, code, category_id, name_vi, name_en, price_vnd, price_max_vnd,
         duration_minutes, estimated_min_minutes, estimated_max_minutes)
       VALUES ($1, $2, $3, 'Dịch vụ', 'Service', 1000, 10000000, 10, 10, 10)`,
      [service, `P5R_SVC_${run.toUpperCase()}`, category],
    );
    // Go-live is committed in this throwaway schema (it is immutable and dropped with the schema).
    await setup.query(`INSERT INTO loyalty_go_live (activated_by_user_id) VALUES ($1)`, [staff]);

    let slot = 0;
    const completedVisit = async () => {
      slot += 1;
      const visit = id();
      const participant = id();
      const line = id();
      const execution = id();
      const start = `2027-03-01T${String(6 + Math.floor(slot / 6)).padStart(2, '0')}:${String((slot % 6) * 10).padStart(2, '0')}:00+07:00`;
      const end = new Date(new Date(start).getTime() + 10 * 60_000).toISOString();
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO visits (id, code, branch_id, origin, service_date, arrived_at, created_by_user_id, idempotency_key)
         VALUES ($1, $2, $3, 'WALK_IN', '2027-03-01', '2027-02-28T22:30:00Z', $4, $5)`,
        [visit, `VS-P5R-${run.toUpperCase()}-${slot}`, branch, staff, id()],
      );
      await setup.query(
        `INSERT INTO visit_participants (id, visit_id, kind, display_name) VALUES ($1, $2, 'GUEST', 'Khách')`,
        [participant, visit],
      );
      await setup.query(
        `INSERT INTO visit_service_lines (id, visit_id, participant_id, sequence, service_id, employee_user_id,
           assignment_mode, planned_start_at, planned_end_at, duration_minutes, buffer_minutes, service_code,
           service_name_vi, service_name_en, catalog_price_min_vnd, catalog_price_max_vnd, catalog_pricing_unit)
         VALUES ($1, $2, $3, 1, $4, $5, 'ANY', $6, $7, 10, 0, 'P5R_SVC', 'Dịch vụ', 'Service', 1000, 10000000, 'PER_SERVICE')`,
        [line, visit, participant, service, ktv, start, end],
      );
      await setup.query(
        `UPDATE visit_service_lines SET status = 'IN_PROGRESS', row_version = row_version + 1 WHERE id = $1`,
        [line],
      );
      await setup.query(
        `UPDATE visits SET status = 'IN_SERVICE', row_version = row_version + 1 WHERE id = $1`,
        [visit],
      );
      await setup.query(
        `INSERT INTO service_executions (id, visit_service_line_id, employee_user_id, started_at, expected_end_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [execution, line, ktv, start, end],
      );
      await setup.query(
        `UPDATE service_executions SET status = 'ENDED', ended_at = $2, end_kind = 'NORMAL', ended_by_user_id = $3,
           row_version = row_version + 1 WHERE id = $1`,
        [execution, end, ktv],
      );
      await setup.query(
        `UPDATE visit_service_lines SET status = 'DONE', row_version = row_version + 1 WHERE id = $1`,
        [line],
      );
      await setup.query(
        `UPDATE visits SET status = 'COMPLETED', completed_at = '2027-03-01T07:00:00+07', row_version = row_version + 1 WHERE id = $1`,
        [visit],
      );
      await setup.query('COMMIT');
      return { visit, participant, line };
    };
    /** A finalized invoice (PENDING_PAYMENT) with one priced line; optionally paid in full. */
    const invoiceFor = async (price: number, paid: boolean) => {
      const visit = await completedVisit();
      const invoice = id();
      const line = id();
      const business = (
        await setup.query<{ d: string }>(
          `SELECT to_char(lucy_branch_local_date($1::uuid, now()), 'YYYY-MM-DD') AS d`,
          [branch],
        )
      ).rows[0]!.d;
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO invoices (id, code, branch_id, visit_id, business_date, calculation_version, created_by_user_id, payer_user_id)
         VALUES ($1, $2, $3, $4, lucy_branch_local_date($3::uuid, now()), 1, $5, $6)`,
        [invoice, generateInvoiceCode(business), branch, visit.visit, staff, customer],
      );
      await setup.query(
        `INSERT INTO invoice_lines (id, invoice_id, sequence, item_code, name_vi, name_en, quantity, unit_price_vnd,
           gross_vnd, price_set_by_user_id, price_set_at)
         VALUES ($1, $2, 1, 'P5R_SVC', 'Dịch vụ', 'Service', 1, $3, $3, $4, clock_timestamp())`,
        [line, invoice, price, staff],
      );
      await setup.query(
        `INSERT INTO invoice_line_services (invoice_line_id, invoice_id, visit_service_line_id, service_id,
           participant_id, employee_user_id, pricing_unit, catalog_price_min_vnd, catalog_price_max_vnd,
           quantity_limit, added_on_behalf)
         VALUES ($1, $2, $3, $4, $5, $6, 'PER_SERVICE', 1000, 10000000, 1, false)`,
        [line, invoice, visit.line, service, visit.participant, ktv],
      );
      await setup.query(
        `UPDATE invoices SET status = 'PENDING_PAYMENT', subtotal_vnd = $2::bigint, total_vnd = $2::bigint,
           finalized_at = clock_timestamp(), finalized_by_user_id = $3, row_version = row_version + 1 WHERE id = $1`,
        [invoice, price, staff],
      );
      await setup.query('COMMIT');
      if (paid) {
        await setup.query('BEGIN');
        await setup.query(
          `INSERT INTO payments (invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd,
             change_vnd, collected_by_user_id, idempotency_key)
           VALUES ($1, $2, 'CASH', 'SUCCEEDED', $3, $3, $3, 0, $4, $5)`,
          [invoice, branch, price, staff, id()],
        );
        await setup.query(
          `UPDATE invoices SET status = 'PAID', paid_at = clock_timestamp(), paid_seq = paid_seq + 1,
             row_version = row_version + 1 WHERE id = $1`,
          [invoice],
        );
        await setup.query('COMMIT');
      }
      return { invoice, line };
    };
    const count = async (sql: string, args: unknown[]) =>
      Number((await setup.query<{ n: string }>(sql, args)).rows[0]!.n);
    const blocked = async (pid: number) => {
      for (let attempt = 0; attempt < 200; attempt += 1) {
        const state = await admin.query<{ wait_event_type: string | null }>(
          'SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1',
          [pid],
        );
        if (state.rows[0]?.wait_event_type === 'Lock') return;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      assert.fail('the second transaction never blocked on the first');
    };
    const pidOf = async (client: Client) =>
      (await client.query<{ pid: number }>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
    const outcome = (work: Promise<unknown>) =>
      work.then(
        () => null,
        (error: unknown) => error as Error & { code?: string },
      );

    await context.test(
      'one combo session, two invoices consume it at once: the second waits on the session lock, then is refused',
      async () => {
        const combo = id();
        const version = id();
        const purchase = id();
        await setup.query(
          `INSERT INTO combos (id, code, service_id, created_by_user_id) VALUES ($1, $2, $3, $4)`,
          [combo, `P5R_COMBO_${run.toUpperCase()}`, service, staff],
        );
        await setup.query(
          `INSERT INTO combo_versions (id, combo_id, version, name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, active, created_by_user_id)
           VALUES ($1, $2, 1, 'Combo', 'Combo', 1, 0, 100000, true, $3)`,
          [version, combo, staff],
        );
        // Phase 5 P5-7: a combo is issued only from a paid COMBO_SALE invoice (no visit, one combo line).
        const comboCode = `P5R_COMBO_${run.toUpperCase()}`;
        const saleInvoice = id();
        const bought = { invoice: saleInvoice, line: id() };
        const saleDay = (
          await setup.query<{ d: string }>(
            `SELECT to_char(lucy_branch_local_date($1::uuid, now()), 'YYYY-MM-DD') AS d`,
            [branch],
          )
        ).rows[0]!.d;
        await setup.query('BEGIN');
        await setup.query(
          `INSERT INTO invoices (id, code, kind, branch_id, business_date, calculation_version, created_by_user_id, payer_user_id)
           VALUES ($1, $2, 'COMBO_SALE', $3, lucy_branch_local_date($3::uuid, now()), 2, $4, $5)`,
          [saleInvoice, generateInvoiceCode(saleDay), branch, staff, customer],
        );
        await setup.query(
          `INSERT INTO invoice_lines (id, invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
           VALUES ($1, $2, 1, 'COMBO_PURCHASE', $3, 'Combo', 'Combo', 1, 100000, 100000)`,
          [bought.line, saleInvoice, comboCode],
        );
        await setup.query(
          `INSERT INTO invoice_line_combos (invoice_line_id, invoice_id, combo_id, version_id, service_id, service_category_id,
             name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode)
           VALUES ($1, $2, $3, $4, $5, $6, 'Combo', 'Combo', 1, 0, 100000, 'NONE')`,
          [bought.line, saleInvoice, combo, version, service, category],
        );
        await setup.query(
          `UPDATE invoices SET status = 'PENDING_PAYMENT', subtotal_vnd = 100000, total_vnd = 100000,
             finalized_at = clock_timestamp(), finalized_by_user_id = $2, row_version = row_version + 1 WHERE id = $1`,
          [saleInvoice, staff],
        );
        await setup.query('COMMIT');
        await setup.query('BEGIN');
        await setup.query(
          `INSERT INTO payments (invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd,
             change_vnd, collected_by_user_id, idempotency_key)
           VALUES ($1, $2, 'CASH', 'SUCCEEDED', 100000, 100000, 100000, 0, $3, $4)`,
          [saleInvoice, branch, staff, id()],
        );
        await setup.query(
          `UPDATE invoices SET status = 'PAID', paid_at = clock_timestamp(), paid_seq = paid_seq + 1,
             row_version = row_version + 1 WHERE id = $1`,
          [saleInvoice],
        );
        await setup.query('COMMIT');
        await setup.query('BEGIN');
        await setup.query(
          `INSERT INTO combo_purchases (id, combo_id, version_id, owner_user_id, invoice_line_id, paid_seq, service_id,
             name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, expiry_mode)
           VALUES ($1, $2, $3, $4, $5, 1, $6, 'Combo', 'Combo', 1, 0, 100000, 'NONE')`,
          [purchase, combo, version, customer, bought.line, service],
        );
        const session = id();
        await setup.query(
          `INSERT INTO combo_sessions (id, purchase_id, session_no, kind) VALUES ($1, $2, 1, 'PAID')`,
          [session, purchase],
        );
        await setup.query('COMMIT');
        const a = await invoiceFor(50_000, false);
        const b = await invoiceFor(50_000, false);
        const first = await connect();
        const second = await connect();
        const secondPid = await pidOf(second);
        const consume = (client: Client, line: string) =>
          client.query(
            `INSERT INTO combo_session_consumptions (session_id, invoice_line_id, branch_id, used_by, performed_by_user_id)
             VALUES ($1, $2, $3, 'OWNER', $4)`,
            [session, line, branch, staff],
          );
        await first.query('BEGIN');
        await second.query('BEGIN');
        await consume(first, a.line);
        const racing = outcome(consume(second, b.line));
        await blocked(secondPid);
        await first.query('COMMIT');
        const refused = await racing;
        assert.ok(refused, 'the second consumption must not take the same session');
        assert.match(refused.message, /already consumed/);
        await second.query('ROLLBACK');
        assert.equal(
          await count(
            'SELECT count(*) AS n FROM combo_session_consumptions WHERE session_id = $1',
            [session],
          ),
          1,
        );
      },
    );

    await context.test(
      'the last reward quantity, two redemptions at once: serialized on the entitlement, one succeeds',
      async () => {
        const item = id();
        const entitlement = id();
        await setup.query(
          `INSERT INTO reward_catalog_items (id, code, kind, service_id, name_vi, name_en, created_by_user_id)
           VALUES ($1, $2, 'FREE_SERVICE', $3, 'Quà', 'Gift', $4)`,
          [item, `P5R_RW_${run.toUpperCase()}`, service, staff],
        );
        await setup.query(
          `INSERT INTO reward_entitlements (id, owner_user_id, catalog_item_id, source_kind, quantity_issued)
           VALUES ($1, $2, $3, 'CAMPAIGN', 1)`,
          [entitlement, customer, item],
        );
        const a = await invoiceFor(50_000, false);
        const b = await invoiceFor(50_000, false);
        const first = await connect();
        const second = await connect();
        const secondPid = await pidOf(second);
        const redeem = (client: Client, line: string) =>
          client.query(
            `INSERT INTO reward_redemptions (entitlement_id, invoice_line_id, branch_id, redeemed_by_user_id)
             VALUES ($1, $2, $3, $4)`,
            [entitlement, line, branch, staff],
          );
        await first.query('BEGIN');
        await second.query('BEGIN');
        await redeem(first, a.line);
        const racing = outcome(redeem(second, b.line));
        await blocked(secondPid);
        await first.query('COMMIT');
        const refused = await racing;
        assert.ok(refused, 'the second redemption must not take the last quantity');
        assert.match(refused.message, /no quantity left/);
        await second.query('ROLLBACK');
        assert.equal(
          await count('SELECT count(*) AS n FROM reward_redemptions WHERE entitlement_id = $1', [
            entitlement,
          ]),
          1,
        );
      },
    );

    await context.test(
      'two combo versions at once: the second waits on the combo row, then must take the next number',
      async () => {
        const combo = id();
        await setup.query(
          `INSERT INTO combos (id, code, service_id, created_by_user_id) VALUES ($1, $2, $3, $4)`,
          [combo, `P5R_VER_${run.toUpperCase()}`, service, staff],
        );
        const first = await connect();
        const second = await connect();
        const secondPid = await pidOf(second);
        const addVersion = (client: Client, number: number) =>
          client.query(
            `INSERT INTO combo_versions (combo_id, version, name_vi, name_en, paid_sessions, bonus_sessions, price_vnd, active, created_by_user_id)
             VALUES ($1, $2, 'Combo', 'Combo', 1, 0, 100000, true, $3)`,
            [combo, number, staff],
          );
        await first.query('BEGIN');
        await second.query('BEGIN');
        await addVersion(first, 1);
        const racing = outcome(addVersion(second, 1));
        await blocked(secondPid);
        await first.query('COMMIT');
        const refused = await racing;
        assert.ok(refused);
        assert.match(refused.message, /next number of its combo/);
        await second.query('ROLLBACK');
        assert.equal(
          await count('SELECT count(*) AS n FROM combo_versions WHERE combo_id = $1', [combo]),
          1,
        );
      },
    );

    await context.test(
      'a lost wallet update cannot commit: a stale read-modify-write breaks balance = ledger at commit',
      async () => {
        const payer = customer;
        const one = await invoiceFor(100_000, true);
        const two = await invoiceFor(200_000, true);
        await setup.query(`INSERT INTO loyalty_wallets (user_id, wallet) VALUES ($1, 'SPA')`, [
          payer,
        ]);
        const first = await connect();
        const second = await connect();
        const earnFor = (client: Client, invoice: string, points: number, newBalance: number) =>
          client.query('BEGIN').then(async () => {
            // The consumer's rule is: lock the wallet row first. This transaction does NOT (a bug being simulated):
            // it writes a balance computed from a stale read.
            await client.query(
              `INSERT INTO loyalty_ledger_entries (user_id, wallet, kind, points, invoice_id, paid_seq, idempotency_key)
               VALUES ($1, 'SPA', 'EARN', $2, $3, 1, $4)`,
              [payer, points, invoice, `RACE_EARN:${invoice}`],
            );
            await client.query(
              `UPDATE loyalty_wallets SET balance_points = $3, row_version = row_version + 1
               WHERE user_id = $1 AND wallet = $2`,
              [payer, 'SPA', newBalance],
            );
          });
        // Both read balance 0 and write 100 / 200 independently: the second write wins the row but the ledger sums to 300.
        await earnFor(first, one.invoice, 100, 100);
        await first.query('COMMIT');
        await earnFor(second, two.invoice, 200, 200);
        const refused = await outcome(second.query('COMMIT'));
        assert.ok(refused, 'a balance that is not the ledger sum must not commit');
        assert.match(refused.message, /must equal the sum of its ledger entries/);
        await second.query('ROLLBACK').catch(() => undefined);
        // The correct pattern (lock, then add) commits and keeps the invariant.
        const third = await connect();
        await third.query('BEGIN');
        await third.query(
          `SELECT 1 FROM loyalty_wallets WHERE user_id = $1 AND wallet = 'SPA' FOR UPDATE`,
          [payer],
        );
        await third.query(
          `INSERT INTO loyalty_ledger_entries (user_id, wallet, kind, points, invoice_id, paid_seq, idempotency_key)
           VALUES ($1, 'SPA', 'EARN', 200, $2, 1, $3)`,
          [payer, two.invoice, `RACE_EARN:${two.invoice}`],
        );
        await third.query(
          `UPDATE loyalty_wallets SET balance_points = balance_points + 200, row_version = row_version + 1
           WHERE user_id = $1 AND wallet = 'SPA'`,
          [payer],
        );
        await third.query('COMMIT');
        assert.equal(
          (
            await setup.query<{ balance_points: number }>(
              `SELECT balance_points FROM loyalty_wallets WHERE user_id = $1 AND wallet = 'SPA'`,
              [payer],
            )
          ).rows[0]!.balance_points,
          300,
        );
      },
    );

    await context.test(
      'no new table can be truncated (the guard or its references refuse it; run for real in the isolated schema)',
      async () => {
        const tables = [
          'loyalty_go_live',
          'loyalty_wallets',
          'loyalty_ledger_entries',
          'referrals',
          'invoice_loyalty_snapshots',
          'combos',
          'combo_versions',
          'combo_purchases',
          'combo_sessions',
          'combo_session_consumptions',
          'combo_session_releases',
          'combo_session_restorations',
          'reward_catalog_items',
          'reward_entitlements',
          'reward_redemptions',
          'reward_redemption_releases',
        ];
        const client = await connect();
        for (const table of tables) {
          await client.query('BEGIN');
          const refused = await outcome(client.query(`TRUNCATE ${table}`));
          await client.query('ROLLBACK');
          assert.ok(refused, `${table} must refuse TRUNCATE`);
          assert.match(
            refused.message,
            /cannot be removed or rewritten|cannot truncate a table referenced/,
            table,
          );
        }
      },
    );
  } finally {
    for (const client of clients) await client.end().catch(() => undefined);
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`).catch(() => undefined);
    const left = await admin
      .query<{ n: string }>(
        `SELECT count(*) AS n FROM information_schema.schemata WHERE schema_name = $1`,
        [schema],
      )
      .catch(() => ({ rows: [{ n: '?' }] }));
    await admin.end().catch(() => undefined);
    assert.equal(left.rows[0]!.n, '0', 'the throwaway schema must be dropped');
  }
});

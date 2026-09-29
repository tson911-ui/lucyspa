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
 * Real-connection races of the Phase 4 Step 4 database guards.
 *
 * The financial tables are permanent history (no delete, no truncate), so committed race fixtures
 * cannot be cleaned up row by row. Instead the whole migration chain is applied into a throwaway
 * schema of this database, the races run there on committed data with separate connections, and the
 * schema is dropped at the end. Nothing touches the shared tables and nothing is left behind.
 *
 * Because the schema exists while the races run, this file must not overlap with the Phase 1 schema test
 * (which asserts that the database has no extra schema): `test:integration` runs it in its own second
 * `node --test` invocation.
 */
test('Phase 4 POS guards under real concurrency (isolated schema, dropped afterwards)', async (context) => {
  const run = randomUUID().replaceAll('-', '').slice(0, 10).toLowerCase();
  const schema = `p4r_${run}`;
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
    // Apply every migration in order; each file is its own implicit transaction (as `migrate deploy`).
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
      // A user and its matching profile commit together (checked at transaction commit).
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO users (id, kind, status, full_name, preferred_locale, email_canonical, email_delivery,
           email_verified_at, phone_canonical, normalization_version, password_hash)
         VALUES ($1, $2, 'ACTIVE', $3, 'vi', $4, $4, now(), $5, 1, '$argon2id$race')`,
        [
          userId,
          kind,
          `Race ${n}`,
          `race-${n}-${run}@example.com`,
          `+849${String(n).padStart(2, '0')}${run.replace(/\D/g, '').padEnd(6, '1').slice(0, 6)}`,
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
          [userId, `RACE_${n}_${run.toUpperCase()}`],
        );
      }
      await setup.query('COMMIT');
    };
    await user(customer, 'CUSTOMER', 10);
    await user(staff, 'EMPLOYEE', 11);
    await user(ktv, 'EMPLOYEE', 12);
    await setup.query(
      `INSERT INTO branches (id, code, name, timezone) VALUES ($1, $2, 'Race', 'Asia/Ho_Chi_Minh')`,
      [branch, `RACE-${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO service_categories (id, code, name_vi, name_en) VALUES ($1, $2, 'x', 'x')`,
      [category, `RACE_${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO services (id, code, category_id, name_vi, name_en, price_vnd, price_max_vnd,
         duration_minutes, estimated_min_minutes, estimated_max_minutes)
       VALUES ($1, $2, $3, 'Dịch vụ', 'Service', 1000, 10000000, 10, 10, 10)`,
      [service, `RACE_SVC_${run.toUpperCase()}`, category],
    );
    let slot = 0;
    /** A COMPLETED visit with one DONE line (the only shape an invoice can exist for). */
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
        [visit, `VS-R-${run.toUpperCase()}-${slot}`, branch, staff, id()],
      );
      await setup.query(
        `INSERT INTO visit_participants (id, visit_id, kind, display_name) VALUES ($1, $2, 'GUEST', 'Khách')`,
        [participant, visit],
      );
      await setup.query(
        `INSERT INTO visit_service_lines (id, visit_id, participant_id, sequence, service_id, employee_user_id,
           assignment_mode, planned_start_at, planned_end_at, duration_minutes, buffer_minutes, service_code,
           service_name_vi, service_name_en, catalog_price_min_vnd, catalog_price_max_vnd, catalog_pricing_unit)
         VALUES ($1, $2, $3, 1, $4, $5, 'ANY', $6, $7, 10, 0, 'RACE_SVC', 'Dịch vụ', 'Service', 1000, 10000000, 'PER_SERVICE')`,
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
    const businessDay = async (client: Client) =>
      (
        await client.query<{ d: string }>(
          `SELECT to_char(lucy_branch_local_date($1::uuid, now()), 'YYYY-MM-DD') AS d`,
          [branch],
        )
      ).rows[0]!.d;
    type Visit = Awaited<ReturnType<typeof completedVisit>>;
    /** Statements that create a complete DRAFT invoice (header, one priced line and its detail). */
    const createDraft = async (client: Client, visit: Visit, price: number) => {
      const invoice = id();
      const line = id();
      const code = generateInvoiceCode(await businessDay(client));
      await client.query(
        `INSERT INTO invoices (id, code, branch_id, visit_id, business_date, calculation_version, created_by_user_id, payer_user_id)
         VALUES ($1, $2, $3, $4, lucy_branch_local_date($3::uuid, now()), 1, $5, $6)`,
        [invoice, code, branch, visit.visit, staff, customer],
      );
      await client.query(
        `INSERT INTO invoice_lines (id, invoice_id, sequence, item_code, name_vi, name_en, quantity, unit_price_vnd,
           gross_vnd, price_set_by_user_id, price_set_at)
         VALUES ($1, $2, 1, 'RACE_SVC', 'Dịch vụ', 'Service', 1, $3, $3, $4, clock_timestamp())`,
        [line, invoice, price, staff],
      );
      await client.query(
        `INSERT INTO invoice_line_services (invoice_line_id, invoice_id, visit_service_line_id, service_id,
           participant_id, employee_user_id, pricing_unit, catalog_price_min_vnd, catalog_price_max_vnd,
           quantity_limit, added_on_behalf)
         VALUES ($1, $2, $3, $4, $5, $6, 'PER_SERVICE', 1000, 10000000, 1, false)`,
        [line, invoice, visit.line, service, visit.participant, ktv],
      );
      return { invoice, code };
    };
    const finalize = (client: Client, invoice: string, price: number, discount = 0) =>
      client.query(
        `UPDATE invoices SET status = 'PENDING_PAYMENT', subtotal_vnd = $2::bigint, discount_total_vnd = $3::bigint,
           total_vnd = $2::bigint - $3::bigint, finalized_at = clock_timestamp(), finalized_by_user_id = $4,
           row_version = row_version + 1 WHERE id = $1`,
        [invoice, price, discount, staff],
      );
    const pendingInvoice = async (price: number) => {
      const visit = await completedVisit();
      await setup.query('BEGIN');
      const created = await createDraft(setup, visit, price);
      await finalize(setup, created.invoice, price);
      await setup.query('COMMIT');
      return { ...created, visit };
    };
    const insertPayment = (client: Client, invoice: string, due: number, amount: number) =>
      client.query(
        `INSERT INTO payments (invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd,
           change_vnd, collected_by_user_id, idempotency_key)
         VALUES ($1, $2, 'CASH', 'SUCCEEDED', $3, $4, $4, 0, $5, $6)`,
        [invoice, branch, due, amount, staff, id()],
      );
    const count = async (sql: string, args: unknown[]) =>
      Number((await setup.query<{ n: string }>(sql, args)).rows[0]!.n);
    /** Waits until the given backend is blocked on a lock held by another transaction. */
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
      'two cashiers pay the last balance at once: the second is refused, no overpayment',
      async () => {
        const { invoice } = await pendingInvoice(200_000);
        const first = await connect();
        const second = await connect();
        const secondPid = await pidOf(second);
        await first.query('BEGIN');
        await second.query('BEGIN');
        await insertPayment(first, invoice, 200_000, 200_000);
        const racing = outcome(insertPayment(second, invoice, 200_000, 200_000));
        await blocked(secondPid); // serialized by the invoice row lock the payment guard takes
        await first.query(
          `UPDATE invoices SET status = 'PAID', paid_at = clock_timestamp(),
          paid_seq = paid_seq + 1, row_version = row_version + 1 WHERE id = $1`,
          [invoice],
        );
        await first.query('COMMIT');
        const refused = await racing;
        assert.ok(refused, 'the second payment must fail');
        assert.match(refused.message, /awaiting payment/);
        await second.query('ROLLBACK');
        assert.equal(
          await count('SELECT count(*) AS n FROM payments WHERE invoice_id = $1', [invoice]),
          1,
        );
        assert.equal(
          (
            await setup.query<{ status: string }>('SELECT status FROM invoices WHERE id = $1', [
              invoice,
            ])
          ).rows[0]!.status,
          'PAID',
        );
      },
    );

    await context.test(
      'a payment racing a cancellation: serialized on the invoice, the payment is refused',
      async () => {
        const { invoice } = await pendingInvoice(90_000);
        const canceller = await connect();
        const cashier = await connect();
        const cashierPid = await pidOf(cashier);
        await canceller.query('BEGIN');
        await cashier.query('BEGIN');
        await canceller.query(
          `UPDATE invoices SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by_user_id = $2,
             cancelled_from_status = 'PENDING_PAYMENT', cancel_reason = 'Khách hủy', row_version = row_version + 1
           WHERE id = $1`,
          [invoice, staff],
        );
        const racing = outcome(insertPayment(cashier, invoice, 90_000, 90_000));
        await blocked(cashierPid);
        await canceller.query('COMMIT');
        const refused = await racing;
        assert.ok(refused);
        assert.match(refused.message, /awaiting payment/);
        await cashier.query('ROLLBACK');
        assert.equal(
          await count('SELECT count(*) AS n FROM payments WHERE invoice_id = $1', [invoice]),
          0,
        );
        assert.equal(
          (
            await setup.query<{ status: string }>('SELECT status FROM invoices WHERE id = $1', [
              invoice,
            ])
          ).rows[0]!.status,
          'CANCELLED',
        );
      },
    );

    await context.test(
      'two creations for one visit: exactly one active invoice (the second waits, then fails on the unique key)',
      async () => {
        const visit = await completedVisit();
        const first = await connect();
        const second = await connect();
        const secondPid = await pidOf(second);
        await first.query('BEGIN');
        await second.query('BEGIN');
        await createDraft(first, visit, 50_000);
        const racing = outcome(createDraft(second, visit, 50_000));
        await blocked(secondPid);
        await first.query('COMMIT');
        const refused = await racing;
        assert.ok(refused);
        assert.equal(refused.code, '23505');
        assert.match(refused.message, /invoices_visit_active_key/);
        await second.query('ROLLBACK');
        assert.equal(
          await count(
            `SELECT count(*) AS n FROM invoices WHERE visit_id = $1 AND status <> 'CANCELLED'`,
            [visit.visit],
          ),
          1,
        );
      },
    );

    await context.test(
      'the last usage of a limited benefit: two finalizations, one redemption (program row lock)',
      async () => {
        const discount = id();
        const versionId = id();
        await setup.query(
          `INSERT INTO discounts (id, code, name_vi, name_en, requires_code) VALUES ($1, $2, 'Ưu đãi', 'Offer', false)`,
          [discount, `RACE_DISC_${run.toUpperCase()}`],
        );
        await setup.query(
          `INSERT INTO discount_versions (id, discount_id, version_no, kind, percent_bp, valid_from, valid_until,
             scope_mode, usage_limit_total, created_by_user_id)
           VALUES ($1, $2, 1, 'PERCENT', 1000, '2027-01-01', '2028-01-01', 'ALL_SERVICES', 1, $3)`,
          [versionId, discount, staff],
        );
        const visitA = await completedVisit();
        const visitB = await completedVisit();
        const first = await connect();
        const second = await connect();
        const secondPid = await pidOf(second);
        const applyAndRedeem = async (client: Client, invoice: string) => {
          await client.query(
            `INSERT INTO invoice_discount_applications (invoice_id, discount_id, version_id, kind, percent_bp,
               eligible_subtotal_vnd, computed_amount_vnd, candidates, selection_reason, finalized_by_user_id)
             VALUES ($1, $2, $3, 'PERCENT', 1000, 50000, 5000, '[]', 'Lợi ích lớn nhất', $4)`,
            [invoice, discount, versionId, staff],
          );
          await client.query(
            `INSERT INTO discount_redemptions (invoice_id, discount_id, version_id, payer_user_id)
             VALUES ($1, $2, $3, $4)`,
            [invoice, discount, versionId, customer],
          );
        };
        await first.query('BEGIN');
        await second.query('BEGIN');
        const a = await createDraft(first, visitA, 50_000);
        const b = await createDraft(second, visitB, 50_000);
        await applyAndRedeem(first, a.invoice);
        const racing = outcome(applyAndRedeem(second, b.invoice));
        await blocked(secondPid);
        await finalize(first, a.invoice, 50_000, 5_000);
        await first.query('COMMIT');
        const refused = await racing;
        assert.ok(refused, 'the second finalization must not consume the last usage');
        assert.match(refused.message, /total usage limit of the benefit is reached/);
        await second.query('ROLLBACK');
        assert.equal(
          await count('SELECT count(*) AS n FROM discount_redemptions WHERE discount_id = $1', [
            discount,
          ]),
          1,
        );
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
    assert.equal(left.rows[0]?.n, '0', 'the throwaway schema is dropped');
  }
});

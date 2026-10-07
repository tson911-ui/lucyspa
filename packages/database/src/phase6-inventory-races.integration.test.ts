import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const migrations = new URL('../prisma/migrations/', import.meta.url);

/**
 * Real-connection races of the Phase 6 P6-2 database guards (same isolated-schema approach as the Phase 4 and 5 races: the whole
 * migration chain is applied into a throwaway schema, the races run on committed data with separate connections, and the schema
 * is dropped at the end). Like those files it runs in its own second `node --test` invocation.
 */
test('Phase 6 stock, price and promotion guards under real concurrency (isolated schema, dropped afterwards)', async (context) => {
  const run = randomUUID().replaceAll('-', '').slice(0, 10).toLowerCase();
  const schema = `p6r_${run}`;
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
  const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms));
  const state = async <T>(promise: Promise<T>) => {
    // 'pending' when the promise is still waiting after a short wait (it is blocked on a lock held by the other connection).
    const settled = await Promise.race([
      promise.then(
        () => 'done' as const,
        () => 'done' as const,
      ),
      sleep(400).then(() => 'pending' as const),
    ]);
    return settled;
  };
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
    const staff = id();
    const branch = id();
    await setup.query('BEGIN');
    await setup.query(
      `INSERT INTO users (id, kind, status, full_name, preferred_locale, email_canonical, email_delivery,
         email_verified_at, phone_canonical, normalization_version, password_hash)
       VALUES ($1, 'EMPLOYEE', 'ACTIVE', 'Race staff', 'vi', $2, $2, now(), $3, 1, '$argon2id$race')`,
      [
        staff,
        `p6race-${run}@example.com`,
        `+8470${run.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
      ],
    );
    await setup.query(
      `INSERT INTO employee_profiles (user_id, employee_code_canonical, date_of_birth, address)
       VALUES ($1, $2, '1990-01-01', 'x')`,
      [staff, `P6RACE_${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO branches (id, code, name, timezone) VALUES ($1, $2, 'Race', 'Asia/Ho_Chi_Minh')`,
      [branch, `P6R-${run.toUpperCase()}`],
    );
    await setup.query('COMMIT');

    let counter = 0;
    const product = async () => {
      counter += 1;
      const productId = id();
      const variantId = id();
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO products (id, code, name_vi, name_en, created_by_user_id) VALUES ($1, $2, 'Race', 'Race', $3)`,
        [productId, `race-${run}-${counter}`, staff],
      );
      await setup.query(`INSERT INTO product_variants (id, product_id, sku) VALUES ($1, $2, $3)`, [
        variantId,
        productId,
        `RACE-${run.toUpperCase()}-${counter}`,
      ]);
      await setup.query(
        `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
         VALUES ($1, 1, 500000, $2)`,
        [variantId, staff],
      );
      await setup.query('COMMIT');
      return variantId;
    };
    // One confirmed receipt of `quantity` units written in a single transaction on `client` (not committed when `hold`).
    let receiptNo = 0;
    const receive = async (client: Client, variantId: string, quantity: number, commit = true) => {
      const no = ++receiptNo;
      const receiptId = id();
      const lineId = id();
      const lotId = id();
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO stock_receipts (id, code, branch_id, receipt_date, created_by_user_id)
         VALUES ($1, $2, $3, '2027-03-01', $4)`,
        [receiptId, `R-${run}-${no}`, branch, staff],
      );
      await client.query(
        `INSERT INTO stock_receipt_lines (id, receipt_id, line_no, variant_id, quantity) VALUES ($1, $2, 1, $3, $4)`,
        [lineId, receiptId, variantId, quantity],
      );
      const confirmed = await client.query(
        `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = $2, row_version = row_version + 1
         WHERE id = $1 AND status = 'DRAFT'`,
        [receiptId, staff],
      );
      assert.equal(confirmed.rowCount, 1);
      await client.query(
        `INSERT INTO inventory_lots (id, branch_id, variant_id, lot_code, source_receipt_line_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lotId, branch, variantId, `LOT-${no}`, lineId, staff],
      );
      await client.query(
        `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
         VALUES ($1, $2, $3, 'RECEIPT', $4, $5, $6, $7)`,
        [branch, variantId, lotId, quantity, lineId, id(), staff],
      );
      if (commit) await client.query('COMMIT');
      return { receiptId, lineId, lotId };
    };
    const take = (client: Client, variantId: string, lotId: string, quantity = 1) =>
      client.query(
        `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, reason, idempotency_key, actor_user_id)
         VALUES ($1, $2, $3, 'ADJUSTMENT', $4, 'DAMAGED', $5, $6)`,
        [branch, variantId, lotId, -quantity, id(), staff],
      );
    const level = async (variantId: string) =>
      (
        await setup.query(
          `SELECT on_hand, reserved FROM stock_levels WHERE branch_id = $1 AND variant_id = $2`,
          [branch, variantId],
        )
      ).rows[0] as { on_hand: number; reserved: number } | undefined;
    const reconciled = async (variantId: string) => {
      const sums = (
        await setup.query(
          `SELECT COALESCE(sum(quantity_delta), 0)::int AS total FROM stock_movements WHERE branch_id = $1 AND variant_id = $2`,
          [branch, variantId],
        )
      ).rows[0] as { total: number };
      assert.equal(
        (await level(variantId))?.on_hand ?? 0,
        sums.total,
        'level equals the sum of its movements',
      );
      const lots = (
        await setup.query(
          `SELECT l.id, l.quantity_on_hand, COALESCE(sum(m.quantity_delta), 0)::int AS total
           FROM inventory_lots l LEFT JOIN stock_movements m ON m.lot_id = l.id
           WHERE l.variant_id = $1 GROUP BY l.id, l.quantity_on_hand`,
          [variantId],
        )
      ).rows as { quantity_on_hand: number; total: number }[];
      for (const lot of lots)
        assert.equal(lot.quantity_on_hand, lot.total, 'lot equals the sum of its movements');
    };
    const rollbackQuietly = async (client: Client) => {
      try {
        await client.query('ROLLBACK');
      } catch {
        // the connection was already out of the transaction
      }
    };

    // ============================================================ the last unit goes to exactly one buyer
    await context.test(
      'two buyers of the last unit: one wins, the other is refused and nothing goes negative',
      async () => {
        const variantId = await product();
        const { lotId } = await receive(setup, variantId, 1);
        const first = await connect();
        const second = await connect();
        await first.query('BEGIN');
        await take(first, variantId, lotId);
        await second.query('BEGIN');
        const blocked = take(second, variantId, lotId).then(
          () => ({ ok: true as const }),
          (error: { code?: string; message: string }) => ({ ok: false as const, error }),
        );
        assert.equal(await state(blocked), 'pending', 'the second buyer waits on the lot lock');
        await first.query('COMMIT');
        const outcome = await blocked;
        assert.equal(outcome.ok, false);
        if (!outcome.ok) {
          assert.equal(outcome.error.code, '23514');
          assert.match(outcome.error.message, /inventory_lots_quantity/);
        }
        await rollbackQuietly(second);
        assert.deepEqual(await level(variantId), { on_hand: 0, reserved: 0 });
        await reconciled(variantId);
      },
    );

    // ============================================================ many buyers, limited stock
    await context.test(
      'eight buyers of three units: exactly three succeed, the level ends at zero',
      async () => {
        const variantId = await product();
        const { lotId } = await receive(setup, variantId, 3);
        const buyers = await Promise.all(Array.from({ length: 8 }, () => connect()));
        const results = await Promise.allSettled(
          buyers.map(async (client) => {
            await client.query('BEGIN');
            try {
              await take(client, variantId, lotId);
              await client.query('COMMIT');
            } catch (error) {
              await rollbackQuietly(client);
              throw error;
            }
          }),
        );
        assert.equal(results.filter((entry) => entry.status === 'fulfilled').length, 3);
        for (const entry of results) {
          if (entry.status === 'rejected')
            assert.match(String((entry.reason as Error).message), /inventory_lots_quantity/);
        }
        assert.deepEqual(await level(variantId), { on_hand: 0, reserved: 0 });
        await reconciled(variantId);
      },
    );

    // ============================================================ first stock of a variant, two receipts at once
    await context.test(
      'two receipts confirmed at the same moment create one level and add up',
      async () => {
        const variantId = await product();
        const first = await connect();
        const second = await connect();
        const [a, b] = await Promise.allSettled([
          receive(first, variantId, 5),
          receive(second, variantId, 7),
        ]);
        assert.equal(a.status, 'fulfilled', a.status === 'rejected' ? String(a.reason) : '');
        assert.equal(b.status, 'fulfilled', b.status === 'rejected' ? String(b.reason) : '');
        assert.deepEqual(await level(variantId), { on_hand: 12, reserved: 0 });
        assert.equal(
          Number(
            (
              await setup.query(
                `SELECT count(*)::int AS n FROM stock_levels WHERE branch_id = $1 AND variant_id = $2`,
                [branch, variantId],
              )
            ).rows[0].n,
          ),
          1,
        );
        await reconciled(variantId);
      },
    );

    // ============================================================ the same draft confirmed twice
    await context.test(
      'one draft receipt confirmed by two people at once is applied once',
      async () => {
        const variantId = await product();
        const receiptId = id();
        const lineId = id();
        await setup.query(
          `INSERT INTO stock_receipts (id, code, branch_id, receipt_date, created_by_user_id) VALUES ($1, $2, $3, '2027-03-01', $4)`,
          [receiptId, `R-${run}-dup`, branch, staff],
        );
        await setup.query(
          `INSERT INTO stock_receipt_lines (id, receipt_id, line_no, variant_id, quantity) VALUES ($1, $2, 1, $3, 4)`,
          [lineId, receiptId, variantId],
        );
        const first = await connect();
        const second = await connect();
        const confirm = (client: Client) =>
          client.query(
            `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = $2, row_version = row_version + 1
           WHERE id = $1 AND status = 'DRAFT'`,
            [receiptId, staff],
          );
        await first.query('BEGIN');
        assert.equal((await confirm(first)).rowCount, 1);
        await second.query('BEGIN');
        const blocked = confirm(second);
        assert.equal(
          await state(blocked),
          'pending',
          'the second confirmation waits on the receipt row',
        );
        const lotId = id();
        await first.query(
          `INSERT INTO inventory_lots (id, branch_id, variant_id, lot_code, source_receipt_line_id, created_by_user_id)
         VALUES ($1, $2, $3, 'LOT-DUP', $4, $5)`,
          [lotId, branch, variantId, lineId, staff],
        );
        await first.query(
          `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
         VALUES ($1, $2, $3, 'RECEIPT', 4, $4, $5, $6)`,
          [branch, variantId, lotId, lineId, id(), staff],
        );
        await first.query('COMMIT');
        assert.equal(
          (await blocked).rowCount,
          0,
          'the second confirmation finds nothing left to confirm',
        );
        await rollbackQuietly(second);
        assert.deepEqual(await level(variantId), { on_hand: 4, reserved: 0 });
        await reconciled(variantId);
      },
    );

    // ============================================================ prices
    await context.test(
      'two price changes of one variant at once: one version, the other refused',
      async () => {
        const variantId = await product();
        const first = await connect();
        const second = await connect();
        const insertVersion = (client: Client, price: number) =>
          client.query(
            `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id) VALUES ($1, 2, $2, $3)`,
            [variantId, price, staff],
          );
        await first.query('BEGIN');
        await insertVersion(first, 510000);
        await second.query('BEGIN');
        const blocked = insertVersion(second, 520000).then(
          () => ({ ok: true as const }),
          (error: { code?: string; message: string }) => ({ ok: false as const, error }),
        );
        assert.equal(await state(blocked), 'pending');
        await first.query('COMMIT');
        const outcome = await blocked;
        assert.equal(outcome.ok, false);
        if (!outcome.ok) assert.equal(outcome.error.code, '23505');
        await rollbackQuietly(second);
        const latest = await setup.query(
          `SELECT version_no, list_price_vnd::int AS price FROM product_price_versions WHERE variant_id = $1 ORDER BY version_no`,
          [variantId],
        );
        assert.deepEqual(latest.rows, [
          { version_no: 1, price: 500000 },
          { version_no: 2, price: 510000 },
        ]);
      },
    );

    await context.test(
      'two overlapping promotions of one variant at once: only one is created',
      async () => {
        const variantId = await product();
        const first = await connect();
        const second = await connect();
        const insertPromotion = (client: Client, price: number, startMinutes: number) =>
          client.query(
            `INSERT INTO product_promotions (variant_id, promo_price_vnd, starts_at, ends_at, created_by_user_id)
           VALUES ($1, $2, clock_timestamp() + ($3 || ' minutes')::interval, clock_timestamp() + ($4 || ' minutes')::interval, $5)`,
            [variantId, price, String(startMinutes), String(startMinutes + 60), staff],
          );
        await first.query('BEGIN');
        await insertPromotion(first, 400000, 10);
        await second.query('BEGIN');
        const blocked = insertPromotion(second, 390000, 30).then(
          () => ({ ok: true as const }),
          (error: { code?: string; message: string }) => ({ ok: false as const, error }),
        );
        assert.equal(await state(blocked), 'pending');
        await first.query('COMMIT');
        const outcome = await blocked;
        assert.equal(outcome.ok, false);
        if (!outcome.ok) assert.equal(outcome.error.code, '23P01');
        await rollbackQuietly(second);
        assert.equal(
          Number(
            (
              await setup.query(
                `SELECT count(*)::int AS n FROM product_promotions WHERE variant_id = $1`,
                [variantId],
              )
            ).rows[0].n,
          ),
          1,
        );
      },
    );
  } finally {
    for (const client of clients) {
      try {
        await client.end();
      } catch {
        // already closed
      }
    }
    await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await admin.end();
  }
});

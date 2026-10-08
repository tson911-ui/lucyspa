import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { generateInvoiceCode } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const migrations = new URL('../prisma/migrations/', import.meta.url);

/**
 * Real-connection races of the Phase 6 P6-15 database guards (same isolated-schema approach as the other race files: the whole migration
 * chain is applied into a throwaway schema, the races run on committed data with separate connections, and the schema is dropped at
 * the end). The goods that arrive for waiting pre-orders are reserved under the same stock level lock as a counter sale, so the last
 * unit goes to exactly one of them, two waiting lines never share one unit, and whatever the interleaving the reserved quantity of a
 * level equals its open reservations.
 */
test('Phase 6 order-line reservations under real concurrency (isolated schema, dropped afterwards)', async (context) => {
  const run = randomUUID().replaceAll('-', '').slice(0, 10).toLowerCase();
  const schema = `p6o_${run}`;
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
  const state = async <T>(promise: Promise<T>) =>
    Promise.race([
      promise.then(
        () => 'done' as const,
        () => 'done' as const,
      ),
      sleep(400).then(() => 'pending' as const),
    ]);
  const rollbackQuietly = async (client: Client) => {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection was already out of the transaction
    }
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
        `p6orace-${run}@example.com`,
        `+8470${run.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`,
      ],
    );
    await setup.query(
      `INSERT INTO employee_profiles (user_id, employee_code_canonical, date_of_birth, address)
       VALUES ($1, $2, '1990-01-01', 'x')`,
      [staff, `P6ORACE_${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO branches (id, code, name, timezone) VALUES ($1, $2, 'Race', 'Asia/Ho_Chi_Minh')`,
      [branch, `P6O-${run.toUpperCase()}`],
    );
    await setup.query(
      `INSERT INTO employee_branch_assignments (employee_user_id, branch_id, granted_by_user_id) VALUES ($1, $2, $1)`,
      [staff, branch],
    );
    await setup.query('COMMIT');

    let counter = 0;
    const variants = new Map<string, { productId: string; sku: string }>();
    const product = async () => {
      counter += 1;
      const productId = id();
      const variantId = id();
      const sku = `RACE-${run.toUpperCase()}-${counter}`;
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO products (id, code, name_vi, name_en, created_by_user_id) VALUES ($1, $2, 'Race', 'Race', $3)`,
        [productId, `race-${run}-${counter}`, staff],
      );
      await setup.query(`INSERT INTO product_variants (id, product_id, sku) VALUES ($1, $2, $3)`, [
        variantId,
        productId,
        sku,
      ]);
      await setup.query(
        `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
         VALUES ($1, 1, 100000, $2)`,
        [variantId, staff],
      );
      await setup.query(
        `UPDATE products SET status = 'PUBLISHED', row_version = row_version + 1 WHERE id = $1`,
        [productId],
      );
      await setup.query('COMMIT');
      variants.set(variantId, { productId, sku });
      return variantId;
    };
    let receiptNo = 0;
    const receive = async (variantId: string, quantity: number) => {
      const no = ++receiptNo;
      const receiptId = id();
      const lineId = id();
      const lotId = id();
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO stock_receipts (id, code, branch_id, receipt_date, created_by_user_id)
         VALUES ($1, $2, $3, '2027-03-01', $4)`,
        [receiptId, `RO-${run}-${no}`, branch, staff],
      );
      await setup.query(
        `INSERT INTO stock_receipt_lines (id, receipt_id, line_no, variant_id, quantity) VALUES ($1, $2, 1, $3, $4)`,
        [lineId, receiptId, variantId, quantity],
      );
      await setup.query(
        `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = $2, row_version = row_version + 1 WHERE id = $1`,
        [receiptId, staff],
      );
      await setup.query(
        `INSERT INTO inventory_lots (id, branch_id, variant_id, lot_code, source_receipt_line_id, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [lotId, branch, variantId, `LOT-${no}`, lineId, staff],
      );
      await setup.query(
        `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
         VALUES ($1, $2, $3, 'RECEIPT', $4, $5, $6, $7)`,
        [branch, variantId, lotId, quantity, lineId, id(), staff],
      );
      await setup.query('COMMIT');
      return lotId;
    };
    /** A DRAFT product invoice with one line of `quantity` of the variant, in the given mode (the order rows too for a pre-order). */
    const draft = async (variantId: string, quantity: number, mode: 'IN_STOCK' | 'PRE_ORDER') => {
      const meta = variants.get(variantId)!;
      const invoice = id();
      const line = id();
      const day = (
        await setup.query(`SELECT lucy_branch_local_date($1::uuid, clock_timestamp())::text AS d`, [
          branch,
        ])
      ).rows[0].d as string;
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO invoices (id, code, kind, branch_id, business_date, calculation_version, created_by_user_id, created_at)
         VALUES ($1, $2, 'PRODUCT_SALE', $3, $5::date, 2, $4, clock_timestamp())`,
        [invoice, generateInvoiceCode(day), branch, staff, day],
      );
      await setup.query(
        `INSERT INTO invoice_lines (id, invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
         VALUES ($1, $2, 1, 'PRODUCT', $3, 'Race', 'Race', $4, 100000, $5)`,
        [line, invoice, meta.sku, quantity, 100_000 * quantity],
      );
      await setup.query(
        `INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, product_name_vi, product_name_en,
           seller_user_id, list_price_vnd, priced_at, fulfilment_mode)
         VALUES ($1, $2, $3, $4, $5, 'Race', 'Race', $6, 100000, clock_timestamp(), $7::"ProductLineMode")`,
        [line, invoice, meta.productId, variantId, meta.sku, staff, mode],
      );
      await setup.query('COMMIT');
      return {
        invoice,
        line,
        variantId,
        quantity,
        orderLine: mode === 'PRE_ORDER' ? id() : null,
        total: 100_000 * quantity,
      };
    };
    /** The order and its line, written by the finalization of the draft (the same transaction as the status change). */
    const orderRows = async (
      client: Client,
      sale: {
        invoice: string;
        line: string;
        variantId: string;
        quantity: number;
        orderLine: string | null;
      },
    ) => {
      const order = id();
      await client.query(
        `INSERT INTO product_orders (id, code, invoice_id, branch_id, contact_phone, created_by_user_id)
         VALUES ($1, $2, $3, $4, '+84901234567', $5)`,
        [order, `DT-${run}-${++counter}`, sale.invoice, branch, staff],
      );
      await client.query(
        `INSERT INTO product_order_lines (id, order_id, invoice_id, invoice_line_id, branch_id, variant_id, quantity)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [sale.orderLine, order, sale.invoice, sale.line, branch, sale.variantId, sale.quantity],
      );
    };
    const finalize = (client: Client, sale: { invoice: string; total: number }) =>
      client.query(
        `UPDATE invoices SET status = 'PENDING_PAYMENT', subtotal_vnd = $2, total_vnd = $2,
           finalized_at = (SELECT priced_at FROM invoice_line_products WHERE invoice_id = $1 LIMIT 1),
           finalized_by_user_id = $3, row_version = row_version + 1 WHERE id = $1`,
        [sale.invoice, sale.total, staff],
      );
    /** A committed, finalized and fully paid pre-order. */
    const paidPreOrder = async (variantId: string, quantity: number) => {
      const sale = await draft(variantId, quantity, 'PRE_ORDER');
      await setup.query('BEGIN');
      await orderRows(setup, sale);
      await finalize(setup, sale);
      await setup.query('COMMIT');
      await setup.query('BEGIN');
      await setup.query(
        `INSERT INTO payments (invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd, change_vnd,
           collected_by_user_id, idempotency_key)
         VALUES ($1, $2, 'CASH', 'SUCCEEDED', $3, $3, $3, 0, $4, $5)`,
        [sale.invoice, branch, sale.total, staff, id()],
      );
      await setup.query(
        `UPDATE invoices SET status = 'PAID', paid_at = clock_timestamp(), paid_seq = paid_seq + 1, row_version = row_version + 1 WHERE id = $1`,
        [sale.invoice],
      );
      await setup.query('COMMIT');
      return sale;
    };
    const allocate = (
      client: Client,
      sale: { invoice: string; line: string; orderLine: string | null },
      variantId: string,
      quantity: number,
    ) =>
      client.query(
        `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, source, created_by_user_id)
         VALUES ($1, $2, $3, $4, $5, 'ORDER_LINE'::"StockReservationSource", $6)`,
        [sale.line, sale.invoice, branch, variantId, quantity, staff],
      );
    const arrive = (client: Client, orderLine: string) =>
      client.query(
        `UPDATE product_order_lines SET status = 'ARRIVED', arrived_by_user_id = $2 WHERE id = $1`,
        [orderLine, staff],
      );
    const level = async (variantId: string) =>
      (
        await setup.query(
          `SELECT on_hand, reserved FROM stock_levels WHERE branch_id = $1 AND variant_id = $2`,
          [branch, variantId],
        )
      ).rows[0] as { on_hand: number; reserved: number };
    /** The reserved quantity of a level is the sum of its open reservations, whatever source they came from. */
    const reconciled = async (variantId: string) => {
      const held = (
        await setup.query(
          `SELECT COALESCE(sum(quantity), 0)::int AS n FROM stock_reservations
           WHERE branch_id = $1 AND variant_id = $2 AND status = 'RESERVED'`,
          [branch, variantId],
        )
      ).rows[0] as { n: number };
      assert.equal((await level(variantId)).reserved, held.n, 'reserved = open reservations');
    };

    // ============================================================ the last unit: counter sale or waiting pre-order
    await context.test(
      'the last unit goes to either the counter sale or the waiting pre-order, never to both',
      async () => {
        for (let round = 0; round < 4; round += 1) {
          const variantId = await product();
          await receive(variantId, 1);
          const waiting = await paidPreOrder(variantId, 1);
          const counterSale = await draft(variantId, 1, 'IN_STOCK');
          const allocator = await connect();
          const seller = await connect();
          await allocator.query('BEGIN');
          await allocate(allocator, waiting, variantId, 1);
          await seller.query('BEGIN');
          const blocked = seller
            .query(
              `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, created_by_user_id)
               VALUES ($1, $2, $3, $4, 1, $5)`,
              [counterSale.line, counterSale.invoice, branch, variantId, staff],
            )
            .then(
              () => ({ ok: true as const }),
              (error: Error) => ({ ok: false as const, error }),
            );
          assert.equal(await state(blocked), 'pending', 'the counter sale waits on the level lock');
          await arrive(allocator, waiting.orderLine!);
          await allocator.query('COMMIT');
          const outcome = await blocked;
          assert.equal(outcome.ok, false, `round ${round}: the counter sale finds nothing left`);
          if (!outcome.ok) assert.match(outcome.error.message, /not enough stock available/);
          await rollbackQuietly(seller);
          assert.deepEqual(await level(variantId), { on_hand: 1, reserved: 1 });
          await reconciled(variantId);
        }
      },
    );

    await context.test(
      'the counter sale that reserves first leaves the waiting pre-order without the unit',
      async () => {
        const variantId = await product();
        await receive(variantId, 1);
        const waiting = await paidPreOrder(variantId, 1);
        const counterSale = await draft(variantId, 1, 'IN_STOCK');
        const seller = await connect();
        const allocator = await connect();
        await seller.query('BEGIN');
        await seller.query(
          `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, created_by_user_id)
           VALUES ($1, $2, $3, $4, 1, $5)`,
          [counterSale.line, counterSale.invoice, branch, variantId, staff],
        );
        await allocator.query('BEGIN');
        const blocked = allocate(allocator, waiting, variantId, 1).then(
          () => ({ ok: true as const }),
          (error: Error) => ({ ok: false as const, error }),
        );
        assert.equal(await state(blocked), 'pending');
        await finalize(seller, counterSale);
        await seller.query('COMMIT');
        const outcome = await blocked;
        assert.equal(outcome.ok, false);
        if (!outcome.ok) assert.match(outcome.error.message, /not enough stock available/);
        await rollbackQuietly(allocator);
        assert.deepEqual(await level(variantId), { on_hand: 1, reserved: 1 });
        assert.equal(
          (
            await setup.query(`SELECT status::text FROM product_order_lines WHERE id = $1`, [
              waiting.orderLine,
            ])
          ).rows[0].status,
          'PAID',
          'the waiting line keeps waiting',
        );
        await reconciled(variantId);
      },
    );

    // ============================================================ two receipts, one queue
    await context.test(
      'two allocations of the same free units to two waiting lines: each unit is held once',
      async () => {
        for (let round = 0; round < 4; round += 1) {
          const variantId = await product();
          await receive(variantId, 1);
          const first = await paidPreOrder(variantId, 1);
          const second = await paidPreOrder(variantId, 1);
          const a = await connect();
          const b = await connect();
          await a.query('BEGIN');
          await b.query('BEGIN');
          // The older line is allocated by `a`, the younger by `b`: only one unit exists.
          const results = await Promise.allSettled([
            (async () => {
              await allocate(a, first, variantId, 1);
              await arrive(a, first.orderLine!);
              await a.query('COMMIT');
            })(),
            (async () => {
              await allocate(b, second, variantId, 1);
              await arrive(b, second.orderLine!);
              await b.query('COMMIT');
            })(),
          ]);
          await rollbackQuietly(a);
          await rollbackQuietly(b);
          assert.equal(
            results.filter((entry) => entry.status === 'fulfilled').length,
            1,
            `round ${round}: exactly one allocation wins`,
          );
          for (const entry of results) {
            if (entry.status === 'rejected') {
              assert.match(String((entry.reason as Error).message), /not enough stock available/);
            }
          }
          assert.deepEqual(await level(variantId), { on_hand: 1, reserved: 1 });
          await reconciled(variantId);
        }
      },
    );

    await context.test(
      'a payment reversal racing the arrival of its goods: the line is either waiting for payment or arrived, never both',
      async () => {
        for (let round = 0; round < 4; round += 1) {
          const variantId = await product();
          await receive(variantId, 1);
          const sale = await paidPreOrder(variantId, 1);
          const allocator = await connect();
          const reverser = await connect();
          await allocator.query('BEGIN');
          await allocate(allocator, sale, variantId, 1);
          await arrive(allocator, sale.orderLine!);
          await reverser.query('BEGIN');
          // The reversal is refused once the goods are reserved and the line has arrived (T22 extended); here it must wait for the
          // allocation's invoice share lock and then find an ordered-or-arrived line.
          const blocked = reverser
            .query(
              `UPDATE invoices SET status = 'PENDING_PAYMENT', paid_at = NULL, row_version = row_version + 1 WHERE id = $1`,
              [sale.invoice],
            )
            .then(
              () => ({ ok: true as const }),
              (error: Error) => ({ ok: false as const, error }),
            );
          await allocator.query('COMMIT');
          const outcome = await blocked;
          await rollbackQuietly(reverser);
          assert.equal(outcome.ok, false, `round ${round}`);
          if (!outcome.ok) {
            assert.match(outcome.error.message, /keeps its payments and stays paid/);
          }
          assert.equal(
            (await setup.query(`SELECT status::text FROM invoices WHERE id = $1`, [sale.invoice]))
              .rows[0].status,
            'PAID',
          );
          await reconciled(variantId);
        }
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
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    } finally {
      await admin.end();
    }
  }
});

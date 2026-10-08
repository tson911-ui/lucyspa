import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, generateInvoiceCode } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

/**
 * Phase 6 P6-15 database rules (migrations 20261116000000/1): the PRE_ORDER line mode, the order and its lines (created by the
 * finalization of a draft, moved by the invoice status and by the staff commands), the order-line reservation (taken for goods that
 * arrived, sold at hand-over, released at cancellation), the history, the T22 extension and the return rule for a pre-order line.
 * Every fixture rolls back.
 */
test('Phase 6 P6-15 product orders, order-line reservations and their guards (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 6 wave 3b foundation rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8);
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const settle = async () => {
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
          };
          const exec = (sql: string) => tx.$executeRawUnsafe(sql);
          const rows = <T>(sql: string) => tx.$queryRawUnsafe<T[]>(sql);
          const one = async <T>(sql: string): Promise<T> => (await rows<T>(sql))[0]!;

          // ---------------------------------------------------------------------------------- fixtures
          const employee = async (label: string) => {
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind: 'EMPLOYEE',
                status: 'ACTIVE',
                fullName: `P6-15 ${label}`,
                preferredLocale: 'vi',
                emailCanonical: `p615-${label}-${run}@example.com`,
                emailDelivery: `p615-${label}-${run}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+8479${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                employeeProfile: {
                  create: {
                    employeeCodeCanonical: `P615_${label.toUpperCase()}_${run.toUpperCase()}`,
                    dateOfBirth: new Date('1990-01-01'),
                    address: 'Fixture',
                  },
                },
              },
            });
            return id;
          };
          const customer = async (label: string) => {
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind: 'CUSTOMER',
                status: 'ACTIVE',
                fullName: `Khách ${label}`,
                preferredLocale: 'vi',
                emailCanonical: `p615-c-${label}-${run}@example.com`,
                emailDelivery: `p615-c-${label}-${run}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+8470${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                customerProfile: {
                  create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                },
              },
            });
            return id;
          };
          const actor = await employee('actor');
          const seller = await employee('seller');
          const member = await customer('member');
          const branch = (
            await tx.branch.create({
              data: { code: `IT-P615-${run}`, name: 'P615 A', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          await exec(
            `INSERT INTO employee_branch_assignments (employee_user_id, branch_id, granted_by_user_id)
             VALUES ('${seller}'::uuid, '${branch}'::uuid, '${actor}'::uuid)`,
          );
          const product = await one<{ id: string }>(
            `INSERT INTO products (code, name_vi, name_en, created_by_user_id)
             VALUES ('p615-${run}', 'Kem dưỡng', 'Day cream', '${actor}'::uuid) RETURNING id`,
          );
          let skuNo = 0;
          const variant = async (
            price: number,
            sellOnOrder = true,
            leadMin?: number,
            leadMax?: number,
          ) => {
            const created = await one<{ id: string; sku: string }>(
              `INSERT INTO product_variants (product_id, sku, label_vi, label_en, sell_on_order, lead_time_days_min, lead_time_days_max)
               VALUES ('${product.id}'::uuid, 'P615-${run.toUpperCase()}-${++skuNo}', '50 ml', '50 ml', ${sellOnOrder},
                 ${leadMin ?? 'NULL'}, ${leadMax ?? 'NULL'}) RETURNING id, sku`,
            );
            await exec(
              `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
               VALUES ('${created.id}'::uuid, 1, ${price}, '${actor}'::uuid)`,
            );
            return { ...created, price };
          };
          const preOrdered = await variant(200_000);
          const secondOrdered = await variant(100_000);
          const withLeadTime = await variant(80_000, true, 7, 10);
          const stocked = await variant(50_000, false);
          const free = await variant(30_000);
          await exec(
            `UPDATE products SET status = 'PUBLISHED', row_version = row_version + 1 WHERE id = '${product.id}'::uuid`,
          );
          let receiptNo = 0;
          const receive = async (variantId: string, quantity: number) => {
            const receipt = await one<{ id: string }>(
              `INSERT INTO stock_receipts (code, branch_id, receipt_date, created_by_user_id)
               VALUES ('R615-${run}-${++receiptNo}', '${branch}'::uuid, '2027-03-01', '${actor}'::uuid) RETURNING id`,
            );
            const line = await one<{ id: string }>(
              `INSERT INTO stock_receipt_lines (receipt_id, line_no, variant_id, quantity)
               VALUES ('${receipt.id}'::uuid, 1, '${variantId}'::uuid, ${quantity}) RETURNING id`,
            );
            await exec(
              `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = '${actor}'::uuid, row_version = row_version + 1
               WHERE id = '${receipt.id}'::uuid`,
            );
            const lot = await one<{ id: string }>(
              `INSERT INTO inventory_lots (branch_id, variant_id, lot_code, source_receipt_line_id, created_by_user_id)
               VALUES ('${branch}'::uuid, '${variantId}'::uuid, 'L615-${receiptNo}', '${line.id}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            await exec(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
               VALUES ('${branch}'::uuid, '${variantId}'::uuid, '${lot.id}'::uuid, 'RECEIPT', ${quantity}, '${line.id}'::uuid,
                 'RECEIPT:${line.id}', '${actor}'::uuid)`,
            );
            return { lot: lot.id, receipt: receipt.id };
          };
          const level = (variantId: string) =>
            one<{ on_hand: number; reserved: number }>(
              `SELECT on_hand, reserved FROM stock_levels
               WHERE branch_id = '${branch}'::uuid AND variant_id = '${variantId}'::uuid`,
            );
          await receive(stocked.id, 10);

          const newInvoice = async (payer: string | null = null) => {
            const clock = await one<{ created: Date; day: string }>(
              `SELECT clock_timestamp() AS created, lucy_branch_local_date('${branch}'::uuid, clock_timestamp())::text AS day`,
            );
            return tx.invoice.create({
              data: {
                code: generateInvoiceCode(clock.day),
                kind: 'PRODUCT_SALE',
                branchId: branch,
                payerUserId: payer,
                businessDate: new Date(`${clock.day}T00:00:00.000Z`),
                calculationVersion: 2,
                createdByUserId: actor,
                createdAt: clock.created,
              },
              select: { id: true },
            });
          };
          const addLine = async (
            invoiceId: string,
            sequence: number,
            variantRow: { id: string; sku: string; price: number },
            quantity: number,
            mode: 'IN_STOCK' | 'PRE_ORDER',
          ) => {
            const pricedAt = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
            const line = await one<{ id: string }>(
              `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
               VALUES ('${invoiceId}'::uuid, ${sequence}, 'PRODUCT', '${variantRow.sku}', 'Kem dưỡng - 50 ml', 'Day cream - 50 ml',
                 ${quantity}, ${variantRow.price}, ${variantRow.price * quantity}) RETURNING id`,
            );
            await exec(
              `INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, product_name_vi,
                 product_name_en, variant_label_vi, variant_label_en, seller_user_id, list_price_vnd, priced_at, fulfilment_mode)
               VALUES ('${line.id}'::uuid, '${invoiceId}'::uuid, '${product.id}'::uuid, '${variantRow.id}'::uuid, '${variantRow.sku}',
                 'Kem dưỡng', 'Day cream', '50 ml', '50 ml', '${seller}'::uuid, ${variantRow.price}, '${pricedAt}'::timestamptz,
                 '${mode}'::"ProductLineMode")`,
            );
            return line.id;
          };
          let orderNo = 0;
          const addOrder = async (
            invoiceId: string,
            phone = '+84901234567',
            payer: string | null = null,
          ) =>
            (
              await one<{ id: string }>(
                `INSERT INTO product_orders (code, invoice_id, branch_id, customer_user_id, contact_phone, created_by_user_id)
                 VALUES ('DT615-${run}-${++orderNo}', '${invoiceId}'::uuid, '${branch}'::uuid,
                   ${payer ? `'${payer}'::uuid` : 'NULL'}, '${phone}', '${actor}'::uuid) RETURNING id`,
              )
            ).id;
          const addOrderLine = async (
            orderId: string,
            invoiceId: string,
            lineId: string,
            variantId: string,
            quantity: number,
          ) =>
            (
              await one<{ id: string }>(
                `INSERT INTO product_order_lines (order_id, invoice_id, invoice_line_id, branch_id, variant_id, quantity)
                 VALUES ('${orderId}'::uuid, '${invoiceId}'::uuid, '${lineId}'::uuid, '${branch}'::uuid, '${variantId}'::uuid, ${quantity})
                 RETURNING id`,
              )
            ).id;
          const finalize = (invoiceId: string, subtotal: number, zeroBalance = false) =>
            exec(
              `UPDATE invoices SET status = '${zeroBalance ? 'PAID' : 'PENDING_PAYMENT'}', subtotal_vnd = ${subtotal},
                 discount_total_vnd = ${zeroBalance ? subtotal : 0}, total_vnd = ${zeroBalance ? 0 : subtotal},
                 finalized_at = (SELECT priced_at FROM invoice_line_products WHERE invoice_id = '${invoiceId}'::uuid LIMIT 1),
                 finalized_by_user_id = '${actor}'::uuid,
                 ${zeroBalance ? `paid_at = (SELECT priced_at FROM invoice_line_products WHERE invoice_id = '${invoiceId}'::uuid LIMIT 1), paid_seq = paid_seq + 1,` : ''}
                 row_version = row_version + 1
               WHERE id = '${invoiceId}'::uuid`,
            );
          const pay = async (invoiceId: string, amount: number) => {
            await exec(
              `INSERT INTO payments (invoice_id, branch_id, method, status, amount_due_vnd, amount_vnd, tendered_vnd, change_vnd,
                 collected_by_user_id, idempotency_key)
               VALUES ('${invoiceId}'::uuid, '${branch}'::uuid, 'CASH', 'SUCCEEDED', ${amount}, ${amount}, ${amount}, 0,
                 '${actor}'::uuid, '${randomUUID()}')`,
            );
            await exec(
              `UPDATE invoices SET status = 'PAID', paid_at = clock_timestamp(), paid_seq = paid_seq + 1, row_version = row_version + 1
               WHERE id = '${invoiceId}'::uuid`,
            );
          };
          const lineState = (orderLineId: string) =>
            one<{
              status: string;
              paid_at: Date | null;
              expected_from: string | null;
              expected_to: string | null;
              row_version: number;
            }>(
              `SELECT status::text, paid_at, expected_from::text, expected_to::text, row_version FROM product_order_lines
               WHERE id = '${orderLineId}'::uuid`,
            );
          /** A finalized, unpaid pre-order of `quantity` of one variant. */
          const preOrder = async (
            variantRow: { id: string; sku: string; price: number },
            quantity: number,
            payer: string | null = null,
          ) => {
            const invoice = await newInvoice(payer);
            const line = await addLine(invoice.id, 1, variantRow, quantity, 'PRE_ORDER');
            const order = await addOrder(invoice.id, '+84901234567', payer);
            const orderLine = await addOrderLine(order, invoice.id, line, variantRow.id, quantity);
            await finalize(invoice.id, variantRow.price * quantity);
            await settle();
            return { invoice: invoice.id, line, order, orderLine };
          };
          const reserveForOrder = (
            invoiceId: string,
            lineId: string,
            variantId: string,
            quantity: number,
          ) =>
            exec(
              `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, source, created_by_user_id)
               VALUES ('${lineId}'::uuid, '${invoiceId}'::uuid, '${branch}'::uuid, '${variantId}'::uuid, ${quantity},
                 'ORDER_LINE'::"StockReservationSource", '${actor}'::uuid)`,
            );

          // ============================================================ the line mode
          await context.test(
            'a PRE_ORDER line needs a variant sold on order; the mode is never rewritten',
            async () => {
              const invoice = await newInvoice();
              await rejects(
                () => addLine(invoice.id, 1, stocked, 1, 'PRE_ORDER'),
                /A pre-order line needs a variant that is sold on order/,
              );
              const line = await addLine(invoice.id, 1, preOrdered, 1, 'PRE_ORDER');
              await rejects(
                () =>
                  exec(
                    `UPDATE invoice_line_products SET fulfilment_mode = 'IN_STOCK' WHERE invoice_line_id = '${line}'::uuid`,
                  ),
                /The copy of a product on an invoice line is never rewritten/,
              );
              const inStock = await addLine(invoice.id, 2, stocked, 1, 'IN_STOCK');
              assert.equal(
                (
                  await one<{ mode: string }>(
                    `SELECT fulfilment_mode::text AS mode FROM invoice_line_products WHERE invoice_line_id = '${inStock}'::uuid`,
                  )
                ).mode,
                'IN_STOCK',
              );
            },
          );

          // ============================================================ order creation
          await context.test(
            'the order and its lines come with the finalization, complete and matching',
            async () => {
              // Finalized without an order: refused at commit.
              const bare = await newInvoice();
              await addLine(bare.id, 1, preOrdered, 1, 'PRE_ORDER');
              await rejects(
                () => finalize(bare.id, 200_000),
                /exactly one order line for each of its pre-order lines/,
              );
              // An order on an invoice without a pre-order line, or a draft that keeps one.
              const plain = await newInvoice();
              await addLine(plain.id, 1, stocked, 1, 'IN_STOCK');
              await rejects(() => addOrder(plain.id), /A draft invoice has no product order/);
              // The phone is mandatory and canonical.
              const phoneInvoice = await newInvoice();
              await addLine(phoneInvoice.id, 1, preOrdered, 1, 'PRE_ORDER');
              await rejects(() => addOrder(phoneInvoice.id, '0901234567'), /product_orders_phone/);
              await rejects(() => addOrder(phoneInvoice.id, ''), /product_orders_phone/);
              // The customer of the order is the payer of the invoice.
              await rejects(
                () => addOrder(phoneInvoice.id, '+84901234567', member),
                /the branch, channel and customer of its invoice/,
              );
              // The order line copies the quantity of its invoice line; a pre-order line has exactly one order line.
              const orderId = await addOrder(phoneInvoice.id);
              const lineRow = await one<{ id: string }>(
                `SELECT invoice_line_id AS id FROM invoice_line_products WHERE invoice_id = '${phoneInvoice.id}'::uuid`,
              );
              await rejects(
                () => addOrderLine(orderId, phoneInvoice.id, lineRow.id, preOrdered.id, 3),
                /branch, variant and quantity of its invoice line/,
              );
              await rejects(
                () => addOrderLine(orderId, phoneInvoice.id, lineRow.id, secondOrdered.id, 1),
                /branch, variant and quantity of its invoice line/,
              );
              const inStockInvoice = await newInvoice();
              const inStockLine = await addLine(inStockInvoice.id, 1, stocked, 1, 'IN_STOCK');
              await rejects(async () => {
                const inStockOrder = await addOrder(inStockInvoice.id);
                await addOrderLine(inStockOrder, inStockInvoice.id, inStockLine, stocked.id, 1);
              }, /for a pre-order product line/);
              const ok = await addOrderLine(orderId, phoneInvoice.id, lineRow.id, preOrdered.id, 1);
              await finalize(phoneInvoice.id, 200_000);
              await settle();
              assert.equal((await lineState(ok)).status, 'AWAITING_PAYMENT');
              // A finalized invoice takes no new order, and no line is added to its order.
              await rejects(
                () => addOrder(phoneInvoice.id),
                /created by the finalization of a draft invoice|product_orders_invoice_key/,
              );
              // The order is immutable apart from its contact.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_orders SET branch_id = branch_id, code = 'X' WHERE id = '${orderId}'::uuid`,
                  ),
                /Only the contact of a product order can change/,
              );
              await exec(
                `UPDATE product_orders SET contact_name = 'Chị Lan' WHERE id = '${orderId}'::uuid`,
              );
              await rejects(
                () => exec(`DELETE FROM product_orders WHERE id = '${orderId}'::uuid`),
                /never deleted/,
              );
              await rejects(
                () => exec(`DELETE FROM product_order_lines WHERE id = '${ok}'::uuid`),
                /never deleted/,
              );
              await rejects(() => exec('TRUNCATE product_order_events'), /never truncated/);
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_events SET note = 'x' WHERE order_line_id = '${ok}'::uuid`,
                  ),
                /never changed or deleted/,
              );
              // No reservation is held by a pre-order line, and none is needed for the finalized invoice.
              assert.equal(
                (
                  await one<{ n: bigint }>(
                    `SELECT count(*) AS n FROM stock_reservations WHERE invoice_id = '${phoneInvoice.id}'::uuid`,
                  )
                ).n,
                0n,
              );
            },
          );

          // ============================================================ payment drives the status
          await context.test(
            'payment fixes the paid time and the expected range; the history is written by SQL',
            async () => {
              const sale = await preOrder(preOrdered, 2, member);
              await pay(sale.invoice, 400_000);
              await settle();
              const paid = await lineState(sale.orderLine);
              assert.equal(paid.status, 'PAID');
              assert.ok(paid.paid_at);
              const days = await one<{ lo: number; hi: number }>(
                `SELECT (expected_from - lucy_branch_local_date('${branch}'::uuid, paid_at))::int AS lo,
                      (expected_to - lucy_branch_local_date('${branch}'::uuid, paid_at))::int AS hi
               FROM product_order_lines WHERE id = '${sale.orderLine}'::uuid`,
              );
              assert.deepEqual(days, { lo: 3, hi: 5 }, 'the settings default is 3 to 5 days');
              const events = await rows<{
                from_status: string | null;
                to_status: string;
                actor_user_id: string | null;
              }>(
                `SELECT from_status::text, to_status::text, actor_user_id::text FROM product_order_events
               WHERE order_line_id = '${sale.orderLine}'::uuid ORDER BY occurred_at, id`,
              );
              assert.deepEqual(
                events.map((event) => [event.from_status, event.to_status]),
                [
                  [null, 'AWAITING_PAYMENT'],
                  ['AWAITING_PAYMENT', 'PAID'],
                ],
              );
              // A variant's own lead time wins over the settings default.
              const custom = await preOrder(withLeadTime, 1);
              await pay(custom.invoice, 80_000);
              await settle();
              const customDays = await one<{ lo: number; hi: number }>(
                `SELECT (expected_from - lucy_branch_local_date('${branch}'::uuid, paid_at))::int AS lo,
                      (expected_to - lucy_branch_local_date('${branch}'::uuid, paid_at))::int AS hi
               FROM product_order_lines WHERE id = '${custom.orderLine}'::uuid`,
              );
              assert.deepEqual(customDays, { lo: 7, hi: 10 });
              // The paid facts and the line facts never change afterwards.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'ORDERED', ordered_at = now(), ordered_by_user_id = '${actor}'::uuid, expected_from = expected_from + 1
                   WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /The paid time and the expected range are fixed at payment/,
              );
            },
          );

          await context.test(
            'an unpaid invoice that is cancelled cancels its order lines',
            async () => {
              // (A zero-balance pre-order needs discount rows to exist; the API integration test covers that path with a real voucher.)
              const sale = await preOrder(free, 1);
              assert.equal((await lineState(sale.orderLine)).status, 'AWAITING_PAYMENT');
              // An unpaid invoice cancelled: its order line is cancelled by the system with it.
              await exec(
                `UPDATE invoices SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by_user_id = '${actor}'::uuid,
                 cancelled_from_status = 'PENDING_PAYMENT', cancel_reason = 'test', row_version = row_version + 1 WHERE id = '${sale.invoice}'::uuid`,
              );
              await settle();
              assert.equal((await lineState(sale.orderLine)).status, 'CANCELLED');
            },
          );

          // ============================================================ reversal before ordering
          await context.test(
            'a payment reversal before anything was ordered sends the lines back to awaiting payment',
            async () => {
              const sale = await preOrder(preOrdered, 1);
              await pay(sale.invoice, 200_000);
              await settle();
              await exec('SAVEPOINT reversal');
              await exec(
                `UPDATE invoices SET status = 'PENDING_PAYMENT', paid_at = NULL, row_version = row_version + 1 WHERE id = '${sale.invoice}'::uuid`,
              );
              const back = await lineState(sale.orderLine);
              assert.equal(back.status, 'AWAITING_PAYMENT');
              assert.equal(back.paid_at, null);
              assert.equal(back.expected_from, null);
              await exec('ROLLBACK TO SAVEPOINT reversal');
              assert.equal((await lineState(sale.orderLine)).status, 'PAID');
            },
          );

          // ============================================================ the supplier order, arrival, hand-over
          await context.test(
            'ordered, arrived, handed over and completed: the facts, the reservation and the sale',
            async () => {
              const sale = await preOrder(secondOrdered, 2, member);
              await pay(sale.invoice, 200_000);
              await settle();
              // The goods are not there yet: no reservation, no arrival.
              await rejects(
                () => reserveForOrder(sale.invoice, sale.line, secondOrdered.id, 2),
                /not enough stock available|There is not enough stock/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'ARRIVED' WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /follow its status|CHECK|check constraint|violates/i,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'ORDERED' WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /product_order_lines_facts/,
              );
              await exec(
                `UPDATE product_order_lines SET status = 'ORDERED', ordered_by_user_id = '${actor}'::uuid, ordered_note = 'NCC Hà Nội'
               WHERE id = '${sale.orderLine}'::uuid`,
              );
              assert.equal((await lineState(sale.orderLine)).status, 'ORDERED');
              // ORDERED is one-way and its facts are kept.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'PAID', ordered_at = NULL, ordered_by_user_id = NULL WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /Illegal order line status transition|What was recorded/,
              );
              // A reversal of the payment is refused from now on (T22 extended).
              await rejects(
                () =>
                  exec(
                    `UPDATE invoices SET status = 'PENDING_PAYMENT', paid_at = NULL, row_version = row_version + 1 WHERE id = '${sale.invoice}'::uuid`,
                  ),
                /An invoice whose pre-order was ordered keeps its payments and stays paid/,
              );
              // Stock arrives (3 units): the whole line is reserved for the order line, the line is ARRIVED.
              const { lot, receipt } = await receive(secondOrdered.id, 3);
              assert.deepEqual(await level(secondOrdered.id), { on_hand: 3, reserved: 0 });
              await reserveForOrder(sale.invoice, sale.line, secondOrdered.id, 2);
              await exec(
                `UPDATE product_order_lines SET status = 'ARRIVED', arrival_receipt_id = '${receipt}'::uuid WHERE id = '${sale.orderLine}'::uuid`,
              );
              await settle();
              assert.deepEqual(await level(secondOrdered.id), { on_hand: 3, reserved: 2 });
              assert.equal(
                (
                  await one<{ n: number }>(
                    `SELECT lucy_available_stock('${branch}'::uuid, '${secondOrdered.id}'::uuid) AS n`,
                  )
                ).n,
                1,
                'the goods held for the order are not free stock',
              );
              // The reservation is not sold before the hand-over, whatever the paid episode.
              const paidSeq = (
                await one<{ n: number }>(
                  `SELECT paid_seq AS n FROM invoices WHERE id = '${sale.invoice}'::uuid`,
                )
              ).n;
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET status = 'CONSUMED', consumed_paid_seq = ${paidSeq} WHERE invoice_line_id = '${sale.line}'::uuid`,
                  ),
                /sold only when their pre-order line is handed over/,
              );
              // Hand-over: who, to whom; a representative is named.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'HANDED_OVER', handed_over_by_user_id = '${actor}'::uuid, handed_over_to = 'REPRESENTATIVE'
                   WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /product_order_lines_handover_to/,
              );
              await exec(
                `UPDATE product_order_lines SET status = 'HANDED_OVER', handed_over_by_user_id = '${actor}'::uuid, handed_over_to = 'REPRESENTATIVE',
                 handed_over_to_name = 'Em gái khách' WHERE id = '${sale.orderLine}'::uuid`,
              );
              // The stock sale of the hand-over: the reservation first, then the movements, then COMPLETED.
              await exec(
                `UPDATE stock_reservations SET status = 'CONSUMED', consumed_paid_seq = ${paidSeq} WHERE invoice_line_id = '${sale.line}'::uuid`,
              );
              await exec(
                `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, invoice_line_id, paid_seq, idempotency_key, actor_user_id)
               VALUES ('${branch}'::uuid, '${secondOrdered.id}'::uuid, '${lot}'::uuid, 'SALE', -2, '${sale.line}'::uuid, ${paidSeq},
                 'ORDER_SALE:${sale.line}', '${actor}'::uuid)`,
              );
              await rejects(
                () =>
                  settle().then(() =>
                    exec(
                      `UPDATE product_order_lines SET status = 'HANDED_OVER' WHERE id = '${sale.orderLine}'::uuid`,
                    ),
                  ),
                /Illegal order line status transition|changes only by moving/,
              );
              await exec(
                `UPDATE product_order_lines SET status = 'COMPLETED' WHERE id = '${sale.orderLine}'::uuid`,
              );
              await settle();
              assert.deepEqual(await level(secondOrdered.id), { on_hand: 1, reserved: 0 });
              const done = await one<{
                status: string;
                to_name: string | null;
                completed: Date | null;
                row_version: number;
              }>(
                `SELECT status::text, handed_over_to_name AS to_name, completed_at AS completed, row_version FROM product_order_lines WHERE id = '${sale.orderLine}'::uuid`,
              );
              assert.equal(done.status, 'COMPLETED');
              assert.equal(done.to_name, 'Em gái khách');
              assert.ok(done.completed);
              assert.equal(done.row_version, 6, 'one version per change');
              const history = await rows<{
                to_status: string;
                actor_user_id: string | null;
                note: string | null;
              }>(
                `SELECT to_status::text, actor_user_id::text, note FROM product_order_events WHERE order_line_id = '${sale.orderLine}'::uuid ORDER BY occurred_at, id`,
              );
              assert.deepEqual(
                history.map((event) => event.to_status),
                ['AWAITING_PAYMENT', 'PAID', 'ORDERED', 'ARRIVED', 'HANDED_OVER', 'COMPLETED'],
              );
              assert.equal(history[2]?.actor_user_id, actor);
              assert.equal(history[2]?.note, 'NCC Hà Nội');
              // A completed line is final, and its reservation is never given back.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'CANCELLED' WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /Illegal order line status transition/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET status = 'RESERVED', consumed_paid_seq = NULL, consumed_at = NULL WHERE invoice_line_id = '${sale.line}'::uuid`,
                  ),
                /never given back/,
              );
            },
          );

          // ============================================================ cancellation of arrived goods
          await context.test(
            'a cancelled line releases its goods, and only a cancelled line does',
            async () => {
              const sale = await preOrder(preOrdered, 2);
              await pay(sale.invoice, 400_000);
              await settle();
              await receive(preOrdered.id, 2);
              await reserveForOrder(sale.invoice, sale.line, preOrdered.id, 2);
              await exec(
                `UPDATE product_order_lines SET status = 'ARRIVED' WHERE id = '${sale.orderLine}'::uuid`,
              );
              await settle();
              // Releasing while the line is not cancelled is refused.
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET status = 'RELEASED', released_by_user_id = '${actor}'::uuid, release_cause = 'ORDER_LINE_CANCELLED'
                   WHERE invoice_line_id = '${sale.line}'::uuid`,
                  ),
                /released only when the line is cancelled/,
              );
              // A cancellation needs a cause, a person and a reason.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'CANCELLED', cancel_cause = 'CUSTOMER_CHANGED_MIND' WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /product_order_lines_facts/,
              );
              // Cancelling without releasing leaves the goods held: refused at commit.
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_lines SET status = 'CANCELLED', cancel_cause = 'CUSTOMER_CHANGED_MIND',
                     cancelled_by_user_id = '${actor}'::uuid, cancel_note = 'NCC hết hàng' WHERE id = '${sale.orderLine}'::uuid`,
                  ),
                /follow its status/,
              );
              await exec(
                `UPDATE product_order_lines SET status = 'CANCELLED', cancel_cause = 'CUSTOMER_CHANGED_MIND',
                 cancelled_by_user_id = '${actor}'::uuid, cancel_note = 'NCC hết hàng' WHERE id = '${sale.orderLine}'::uuid`,
              );
              await exec(
                `UPDATE stock_reservations SET status = 'RELEASED', released_by_user_id = '${actor}'::uuid, release_cause = 'ORDER_LINE_CANCELLED'
               WHERE invoice_line_id = '${sale.line}'::uuid`,
              );
              await settle();
              assert.deepEqual(await level(preOrdered.id), { on_hand: 2, reserved: 0 });
              // The invoice stays paid, with its payment: the refund Step gives the money back.
              assert.equal(
                (
                  await one<{ status: string }>(
                    `SELECT status::text FROM invoices WHERE id = '${sale.invoice}'::uuid`,
                  )
                ).status,
                'PAID',
              );
              // Payment reversal after a cancellation is refused as well.
              await rejects(
                () =>
                  exec(
                    `UPDATE invoices SET status = 'PENDING_PAYMENT', paid_at = NULL, row_version = row_version + 1 WHERE id = '${sale.invoice}'::uuid`,
                  ),
                /An invoice whose pre-order was ordered keeps its payments and stays paid/,
              );
              // Goods cannot be reserved for a cancelled line or for a line that is waiting for payment.
              await rejects(
                () => reserveForOrder(sale.invoice, sale.line, preOrdered.id, 2),
                /duplicate key|stock_reservations_line_key|waiting for them/,
              );
            },
          );

          // ============================================================ reservation rules
          await context.test(
            'an order-line reservation is for a paid, waiting pre-order line, whole and available',
            async () => {
              const unpaid = await preOrder(preOrdered, 1);
              await receive(preOrdered.id, 1);
              await rejects(
                () => reserveForOrder(unpaid.invoice, unpaid.line, preOrdered.id, 1),
                /waiting for them/,
              );
              const sale = await preOrder(preOrdered, 1);
              await pay(sale.invoice, 200_000);
              await settle();
              // A reservation for a quantity other than the line's is refused.
              await rejects(
                () => reserveForOrder(sale.invoice, sale.line, preOrdered.id, 2),
                /matches the variant and quantity of its product line/,
              );
              // The reservation of a plain in-stock line keeps its rule (a draft, at finalization) and cannot be taken for a pre-order line.
              await rejects(
                () =>
                  exec(
                    `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, created_by_user_id)
                   VALUES ('${sale.line}'::uuid, '${sale.invoice}'::uuid, '${branch}'::uuid, '${preOrdered.id}'::uuid, 1, '${actor}'::uuid)`,
                  ),
                /finalization of a draft invoice/,
              );
              // An order-line reservation without its ARRIVED line is refused at commit.
              await rejects(
                () => reserveForOrder(sale.invoice, sale.line, preOrdered.id, 1),
                /follow its status/,
              );
            },
          );

          // ============================================================ the return rule for a pre-order line
          await context.test(
            'a pre-order line has a return case only once completed, counted from the hand-over',
            async () => {
              const sale = await preOrder(preOrdered, 1);
              await pay(sale.invoice, 200_000);
              await settle();
              const paidAt = (
                await one<{ t: string }>(
                  `SELECT paid_at::text AS t FROM invoices WHERE id = '${sale.invoice}'::uuid`,
                )
              ).t;
              const paidSeq = (
                await one<{ n: number }>(
                  `SELECT paid_seq AS n FROM invoices WHERE id = '${sale.invoice}'::uuid`,
                )
              ).n;
              const openCase = () =>
                exec(
                  `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity,
                   seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id)
                 VALUES ('TH615-${run}-${++orderNo}', '${branch}'::uuid, '${sale.invoice}'::uuid, '${sale.line}'::uuid, 'PERSONAL_PREFERENCE',
                   'REFUND', 1, true, '${paidAt}'::timestamptz, ${paidSeq}, '${paidAt}'::timestamptz + interval '168 hours',
                   '${actor}'::uuid, '${randomUUID()}'::uuid)`,
                );
              await rejects(openCase, /only after its goods were handed over and sold/);
              const { lot } = await receive(preOrdered.id, 1);
              await reserveForOrder(sale.invoice, sale.line, preOrdered.id, 1);
              await exec(
                `UPDATE product_order_lines SET status = 'ARRIVED' WHERE id = '${sale.orderLine}'::uuid`,
              );
              await exec(
                `UPDATE product_order_lines SET status = 'HANDED_OVER', handed_over_by_user_id = '${actor}'::uuid, handed_over_to = 'CUSTOMER'
               WHERE id = '${sale.orderLine}'::uuid`,
              );
              await rejects(openCase, /only after its goods were handed over and sold/);
              await exec(
                `UPDATE stock_reservations SET status = 'CONSUMED', consumed_paid_seq = ${paidSeq} WHERE invoice_line_id = '${sale.line}'::uuid`,
              );
              await exec(
                `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, invoice_line_id, paid_seq, idempotency_key, actor_user_id)
               VALUES ('${branch}'::uuid, '${preOrdered.id}'::uuid, '${lot}'::uuid, 'SALE', -1, '${sale.line}'::uuid, ${paidSeq},
                 'ORDER_SALE:${sale.line}', '${actor}'::uuid)`,
              );
              await exec(
                `UPDATE product_order_lines SET status = 'COMPLETED' WHERE id = '${sale.orderLine}'::uuid`,
              );
              await settle();
              // The window of the case must start at the hand-over, not at the payment.
              await rejects(openCase, /The return window starts when the goods were handed over/);
              const handover = (
                await one<{ t: string }>(
                  `SELECT handed_over_at::text AS t FROM product_order_lines WHERE id = '${sale.orderLine}'::uuid`,
                )
              ).t;
              await exec(
                `INSERT INTO product_return_cases (code, branch_id, invoice_id, invoice_line_id, reason, requested_outcome, quantity,
                 seal_intact, handover_at, paid_seq, window_ends_at, opened_by_user_id, client_request_id)
               VALUES ('TH615-${run}-${++orderNo}', '${branch}'::uuid, '${sale.invoice}'::uuid, '${sale.line}'::uuid, 'PERSONAL_PREFERENCE',
                 'REFUND', 1, true, '${handover}'::timestamptz, ${paidSeq}, '${handover}'::timestamptz + interval '168 hours',
                 '${actor}'::uuid, '${randomUUID()}'::uuid)`,
              );
            },
          );

          // ============================================================ the cancellation causes
          await context.test(
            'a cancellation cause fits the state of the line (OQ-32), and lateness needs more than 7 days past the expected date',
            async () => {
              const cancel = (id: string, cause: string) =>
                exec(
                  `UPDATE product_order_lines SET status = 'CANCELLED', cancel_cause = '${cause}'::"ProductOrderCancelCause",
                     cancelled_by_user_id = '${actor}'::uuid, cancel_note = 'ghi chú' WHERE id = '${id}'::uuid`,
                );
              const ordered = async () => {
                const sale = await preOrder(preOrdered, 1);
                await pay(sale.invoice, 200_000);
                return sale;
              };
              const markOrdered = (id: string) =>
                exec(
                  `UPDATE product_order_lines SET status = 'ORDERED', ordered_by_user_id = '${actor}'::uuid WHERE id = '${id}'::uuid`,
                );
              // Before the supplier order: only for a line that was not ordered.
              const fresh = await ordered();
              await markOrdered(fresh.orderLine);
              await rejects(
                () => cancel(fresh.orderLine, 'CUSTOMER_CANCELLED_BEFORE_ORDERING'),
                /only for a line that was not ordered yet/,
              );
              // A change of mind is for a line that was ordered (or arrived), not one that is only paid.
              const paidOnly = await ordered();
              await rejects(
                () => cancel(paidOnly.orderLine, 'CUSTOMER_CHANGED_MIND'),
                /for an ordered or arrived line/,
              );
              // The supplier cannot deliver: PAID or ORDERED, never arrived.
              await rejects(
                () => cancel(paidOnly.orderLine, 'LATE_OVER_7_DAYS'),
                /more than 7 days after its expected date/,
              );
              // A paid line the supplier cannot deliver is cancelled with the right cause (the refund follows in the API command).
              await cancel(paidOnly.orderLine, 'SUPPLIER_CANNOT_DELIVER');
              assert.equal((await lineState(paidOnly.orderLine)).status, 'CANCELLED');
            },
          );

          // ============================================================ the ticket link
          await context.test(
            'a ticket link is history: one active link per order, revoked once, never rewritten or deleted',
            async () => {
              const sale = await preOrder(preOrdered, 1);
              const hash = (letter: string) => letter.repeat(64);
              const insert = (letter: string) =>
                exec(
                  `INSERT INTO product_order_tickets (order_id, token_hash, created_by_user_id)
                   VALUES ('${sale.order}'::uuid, '${hash(letter)}', '${actor}'::uuid)`,
                );
              await insert('a');
              await rejects(() => insert('b'), /product_order_tickets_active_key/);
              await rejects(
                () =>
                  exec(
                    `INSERT INTO product_order_tickets (order_id, token_hash, created_by_user_id)
                     VALUES ('${sale.order}'::uuid, 'not-a-hash', '${actor}'::uuid)`,
                  ),
                /product_order_tickets_hash/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_tickets SET token_hash = '${hash('c')}' WHERE token_hash = '${hash('a')}'`,
                  ),
                /never rewritten/,
              );
              await rejects(
                () => exec(`DELETE FROM product_order_tickets WHERE token_hash = '${hash('a')}'`),
                /never deleted/,
              );
              await exec(
                `UPDATE product_order_tickets SET revoked_at = now(), revoked_by_user_id = '${actor}'::uuid
                 WHERE token_hash = '${hash('a')}'`,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_order_tickets SET revoked_at = now(), revoked_by_user_id = '${actor}'::uuid
                     WHERE token_hash = '${hash('a')}'`,
                  ),
                /revoked once/,
              );
              await insert('b');
              await rejects(() => exec('TRUNCATE product_order_tickets'), /never truncated/);
              assert.equal(
                (
                  await one<{ n: bigint }>(
                    `SELECT count(*) AS n FROM product_order_tickets WHERE order_id = '${sale.order}'::uuid AND revoked_at IS NULL`,
                  )
                ).n,
                1n,
              );
            },
          );
          throw rollback;
        },
        { timeout: 120_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});

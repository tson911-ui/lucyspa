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
 * Phase 6 P6-8 database rules (migrations 20261107000000/1): the invoice channel and shipping fee, the product-only invoice kind and
 * the PRODUCT line with its detail (copy of the product, required seller, price re-derived from the effective price and frozen at
 * finalization), the stock reservation (T15: taken by the finalization, level cache, availability backstop, released only by the
 * cancellation, never deleted) and the guards that keep every Phase 4/5 rule for the other kinds. Every fixture rolls back.
 */
test('Phase 6 P6-8 product lines, reservations, channel and shipping fee (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 6 wave 2 foundation rollback');
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
              // Deferred checks fire at commit; fixtures never commit, so force them inside the savepoint.
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
          const employee = async (label: string, status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE') => {
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind: 'EMPLOYEE',
                status,
                fullName: `P6-8 ${label}`,
                preferredLocale: 'vi',
                emailCanonical: `p68-${label}-${run}@example.com`,
                emailDelivery: `p68-${label}-${run}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+8479${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
                normalizationVersion: 1,
                passwordHash: status === 'ACTIVE' ? '$argon2id$fixture-password-hash' : null,
                employeeProfile: {
                  create: {
                    employeeCodeCanonical: `P68_${label.toUpperCase()}_${run.toUpperCase()}`,
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
                emailCanonical: `p68-c-${label}-${run}@example.com`,
                emailDelivery: `p68-c-${label}-${run}@example.com`,
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
          const sellerElsewhere = await employee('elsewhere');
          const sellerInactive = await employee('inactive', 'INACTIVE');
          const member = await customer('member');
          const branch = (
            await tx.branch.create({
              data: { code: `IT-P68-${run}`, name: 'P68 A', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const otherBranch = (
            await tx.branch.create({
              data: { code: `IT-P68B-${run}`, name: 'P68 B', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const assign = (userId: string, branchId: string) =>
            exec(
              `INSERT INTO employee_branch_assignments (employee_user_id, branch_id, granted_by_user_id)
               VALUES ('${userId}'::uuid, '${branchId}'::uuid, '${actor}'::uuid)`,
            );
          await assign(seller, branch);
          await assign(sellerElsewhere, otherBranch);
          await assign(sellerInactive, branch);

          const product = await one<{ id: string }>(
            `INSERT INTO products (code, name_vi, name_en, created_by_user_id)
             VALUES ('p68-${run}', 'Kem dưỡng', 'Day cream', '${actor}'::uuid) RETURNING id`,
          );
          let skuNo = 0;
          const variant = async (price: number | null) => {
            const created = await one<{ id: string; sku: string }>(
              `INSERT INTO product_variants (product_id, sku, label_vi, label_en)
               VALUES ('${product.id}'::uuid, 'P68-${run.toUpperCase()}-${++skuNo}', '50 ml', '50 ml') RETURNING id, sku`,
            );
            if (price !== null) {
              await exec(
                `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
                 VALUES ('${created.id}'::uuid, 1, ${price}, '${actor}'::uuid)`,
              );
            }
            return created;
          };
          const v1 = await variant(200_000);
          const v2 = await variant(50_000);
          await exec(
            `UPDATE products SET status = 'PUBLISHED', row_version = row_version + 1 WHERE id = '${product.id}'::uuid`,
          );
          let receiptNo = 0;
          /** A confirmed receipt of `quantity` units, its lot and the RECEIPT movement. */
          const receive = async (
            variantId: string,
            quantity: number,
            expiry: string | null = null,
          ) => {
            const receipt = await one<{ id: string }>(
              `INSERT INTO stock_receipts (code, branch_id, receipt_date, created_by_user_id)
               VALUES ('R68-${run}-${++receiptNo}', '${branch}'::uuid, '2027-03-01', '${actor}'::uuid) RETURNING id`,
            );
            const line = await one<{ id: string }>(
              `INSERT INTO stock_receipt_lines (receipt_id, line_no, variant_id, quantity, expiry_date)
               VALUES ('${receipt.id}'::uuid, 1, '${variantId}'::uuid, ${quantity}, ${expiry ? `'${expiry}'` : 'NULL'}) RETURNING id`,
            );
            await exec(
              `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = '${actor}'::uuid, row_version = row_version + 1
               WHERE id = '${receipt.id}'::uuid`,
            );
            const lot = await one<{ id: string }>(
              `INSERT INTO inventory_lots (branch_id, variant_id, lot_code, expiry_date, source_receipt_line_id, created_by_user_id)
               VALUES ('${branch}'::uuid, '${variantId}'::uuid, 'L-${receiptNo}', ${expiry ? `'${expiry}'` : 'NULL'},
                 '${line.id}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            await exec(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
               VALUES ('${branch}'::uuid, '${variantId}'::uuid, '${lot.id}'::uuid, 'RECEIPT', ${quantity}, '${line.id}'::uuid,
                 'RECEIPT:${line.id}', '${actor}'::uuid)`,
            );
            return lot.id;
          };
          const lot1 = await receive(v1.id, 5);
          await receive(v2.id, 10);
          const level = (variantId: string) =>
            one<{ on_hand: number; reserved: number }>(
              `SELECT on_hand, reserved FROM stock_levels
               WHERE branch_id = '${branch}'::uuid AND variant_id = '${variantId}'::uuid`,
            );

          // A DRAFT product invoice, a line per call. Returns the ids; the price is the effective price at `at`.
          const newInvoice = async (
            kind: 'PRODUCT_SALE' | 'VISIT' | 'COMBO_SALE' = 'PRODUCT_SALE',
            options: { channel?: 'COUNTER' | 'ONLINE'; fee?: number; payer?: string | null } = {},
          ) => {
            const clock = await one<{ created: Date; day: string }>(
              `SELECT clock_timestamp() AS created, lucy_branch_local_date('${branch}'::uuid, clock_timestamp())::text AS day`,
            );
            return tx.invoice.create({
              data: {
                code: generateInvoiceCode(clock.day),
                kind,
                channel: options.channel ?? 'COUNTER',
                shippingFeeVnd: BigInt(options.fee ?? 0),
                branchId: branch,
                payerUserId: options.payer ?? null,
                businessDate: new Date(`${clock.day}T00:00:00.000Z`),
                calculationVersion: 2,
                totalVnd: BigInt(options.fee ?? 0),
                createdByUserId: actor,
                createdAt: clock.created,
              },
              select: { id: true },
            });
          };
          const addLine = async (
            invoiceId: string,
            sequence: number,
            variantRow: { id: string; sku: string },
            quantity: number,
            options: { sellerId?: string; price?: number; pricedAt?: string } = {},
          ) => {
            const price = options.price ?? (variantRow.id === v1.id ? 200_000 : 50_000);
            const pricedAt =
              options.pricedAt ??
              (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
            const line = await one<{ id: string }>(
              `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
               VALUES ('${invoiceId}'::uuid, ${sequence}, 'PRODUCT', '${variantRow.sku}', 'Kem dưỡng - 50 ml', 'Day cream - 50 ml',
                 ${quantity}, ${price}, ${price * quantity}) RETURNING id`,
            );
            await exec(
              `INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, product_name_vi,
                 product_name_en, variant_label_vi, variant_label_en, seller_user_id, list_price_vnd, priced_at)
               VALUES ('${line.id}'::uuid, '${invoiceId}'::uuid, '${product.id}'::uuid, '${variantRow.id}'::uuid, '${variantRow.sku}',
                 'Kem dưỡng', 'Day cream', '50 ml', '50 ml', '${options.sellerId ?? seller}'::uuid, ${variantRow.id === v1.id ? 200_000 : 50_000}, '${pricedAt}'::timestamptz)`,
            );
            return line.id;
          };
          /** The finalization step of the database: header amounts, status and the facts of the new status. */
          const finalize = (invoiceId: string, subtotal: number, at: string, fee = 0) =>
            exec(
              `UPDATE invoices SET status = 'PENDING_PAYMENT', subtotal_vnd = ${subtotal}, total_vnd = ${subtotal + fee},
                 finalized_at = '${at}'::timestamptz, finalized_by_user_id = '${actor}'::uuid, row_version = row_version + 1
               WHERE id = '${invoiceId}'::uuid`,
            );
          const reserve = (
            invoiceId: string,
            lineId: string,
            variantId: string,
            quantity: number,
          ) =>
            exec(
              `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, created_by_user_id)
               VALUES ('${lineId}'::uuid, '${invoiceId}'::uuid, '${branch}'::uuid, '${variantId}'::uuid, ${quantity}, '${actor}'::uuid)`,
            );

          // ============================================================ columns, defaults, money identity
          await context.test(
            'channel and fee: counter by default, fee 0; the total gains the fee term',
            async () => {
              const invoice = await newInvoice();
              const stored = await one<{
                channel: string;
                fee: string;
                kind: string;
                visit: string | null;
              }>(
                `SELECT channel::text, shipping_fee_vnd::text AS fee, kind::text, visit_id::text AS visit FROM invoices WHERE id = '${invoice.id}'::uuid`,
              );
              assert.deepEqual(stored, {
                channel: 'COUNTER',
                fee: '0',
                kind: 'PRODUCT_SALE',
                visit: null,
              });
              // A counter invoice has no fee; only an online product sale may carry one; the identity includes the fee.
              await rejects(
                () => newInvoice('PRODUCT_SALE', { fee: 30_000 }),
                /invoices_channel_fee|channel_fee/,
              );
              const onlineRule = await one<{ definition: string }>(
                `SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conname = 'invoices_online_product_sale'`,
              );
              assert.match(onlineRule.definition, /channel.*COUNTER.*kind.*PRODUCT_SALE/s);
              const online = await newInvoice('PRODUCT_SALE', { channel: 'ONLINE', fee: 30_000 });
              assert.equal(
                (
                  await one<{ total: string }>(
                    `SELECT total_vnd::text AS total FROM invoices WHERE id = '${online.id}'::uuid`,
                  )
                ).total,
                '30000',
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoices SET total_vnd = 0, row_version = row_version + 1 WHERE id = '${online.id}'::uuid`,
                  ),
                /invoices_money/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoices SET channel = 'COUNTER', shipping_fee_vnd = 0, total_vnd = 0, row_version = row_version + 1 WHERE id = '${online.id}'::uuid`,
                  ),
                /Invoice identity cannot be rewritten/,
              );
            },
          );

          await context.test(
            'a product sale is not a visit and never waits for loyalty to be live',
            async () => {
              assert.equal(
                (await one<{ n: bigint }>(`SELECT count(*) AS n FROM loyalty_go_live`)).n,
                0n,
              );
              const guest = await newInvoice('PRODUCT_SALE');
              const paying = await newInvoice('PRODUCT_SALE', { payer: member });
              assert.ok(guest.id && paying.id);
              // A combo sale still needs loyalty live (Phase 5 rule, unchanged).
              await rejects(
                () => newInvoice('COMBO_SALE', { payer: member }),
                /A combo is sold only once loyalty is live/,
              );
            },
          );

          // ============================================================ line kinds and the product detail
          await context.test(
            'line kinds follow the invoice kind; the detail copies the product and names an eligible seller',
            async () => {
              const invoice = await newInvoice();
              for (const kind of ['SERVICE', 'COMBO_PURCHASE']) {
                await rejects(
                  () =>
                    exec(
                      `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
                       VALUES ('${invoice.id}'::uuid, 1, '${kind}', 'X', 'x', 'x', 1, 1, 1)`,
                    ),
                  /The line kind must match the invoice kind/,
                );
              }
              await addLine(invoice.id, 1, v1, 2);
              await settle();
              // The seller: an ACTIVE employee assigned to the branch of the invoice, nobody else.
              for (const who of [sellerElsewhere, sellerInactive, member]) {
                await rejects(async () => {
                  const draft = await newInvoice();
                  await addLine(draft.id, 1, v1, 1, { sellerId: who });
                }, /The seller is an active employee assigned/);
              }
              // A product that is not published, a variant that is not active: not sold.
              const hidden = await one<{ id: string }>(
                `INSERT INTO products (code, name_vi, name_en, created_by_user_id) VALUES ('p68h-${run}', 'Ẩn', 'Hidden', '${actor}'::uuid) RETURNING id`,
              );
              const hiddenVariant = await one<{ id: string; sku: string }>(
                `INSERT INTO product_variants (product_id, sku) VALUES ('${hidden.id}'::uuid, 'P68H-${run.toUpperCase()}') RETURNING id, sku`,
              );
              await rejects(async () => {
                const another = await newInvoice();
                const line = await one<{ id: string }>(
                  `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
                   VALUES ('${another.id}'::uuid, 1, 'PRODUCT', '${hiddenVariant.sku}', 'Ẩn', 'Hidden', 1, 1, 1) RETURNING id`,
                );
                await exec(
                  `INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, product_name_vi, product_name_en,
                     seller_user_id, list_price_vnd, priced_at)
                   VALUES ('${line.id}'::uuid, '${another.id}'::uuid, '${hidden.id}'::uuid, '${hiddenVariant.id}'::uuid, '${hiddenVariant.sku}',
                     'Ẩn', 'Hidden', '${seller}'::uuid, 1, clock_timestamp())`,
                );
              }, /Only a published product with an active variant is added/);
              // The copy is exact: a wrong name is refused.
              await rejects(async () => {
                const copy = await newInvoice();
                const copyLine = await one<{ id: string }>(
                  `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
                   VALUES ('${copy.id}'::uuid, 1, 'PRODUCT', '${v1.sku}', 'Kem', 'Cream', 1, 200000, 200000) RETURNING id`,
                );
                await exec(
                  `INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, product_name_vi, product_name_en,
                     variant_label_vi, variant_label_en, seller_user_id, list_price_vnd, priced_at)
                   VALUES ('${copyLine.id}'::uuid, '${copy.id}'::uuid, '${product.id}'::uuid, '${v1.id}'::uuid, '${v1.sku}',
                     'Tên khác', 'Day cream', '50 ml', '50 ml', '${seller}'::uuid, 200000, clock_timestamp())`,
                );
              }, /The product detail must copy the product as it is now/);
              // A line without its detail is refused at commit.
              await rejects(async () => {
                const bare = await newInvoice();
                await exec(
                  `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
                   VALUES ('${bare.id}'::uuid, 1, 'PRODUCT', '${v1.sku}', 'Kem', 'Cream', 1, 200000, 200000)`,
                );
              }, /Every product line has its product detail/);
            },
          );

          await context.test(
            'the price is the effective price at the recorded instant; nobody can type another',
            async () => {
              await rejects(async () => {
                const invoice = await newInvoice();
                await addLine(invoice.id, 1, v1, 1, { price: 150_000 });
              }, /priced at the effective price of its variant/);
              const second = await newInvoice();
              await addLine(second.id, 1, v1, 3);
              await settle();
              // A promotion running at the recorded instant changes the effective price the line must carry.
              await exec(
                `INSERT INTO product_promotions (variant_id, promo_price_vnd, starts_at, ends_at, created_by_user_id)
               VALUES ('${v2.id}'::uuid, 40000, clock_timestamp() - interval '1 hour', clock_timestamp() + interval '1 hour', '${actor}'::uuid)`,
              );
              await rejects(async () => {
                const promo = await newInvoice();
                await addLine(promo.id, 1, v2, 1, { price: 50_000 });
              }, /priced at the effective price of its variant/);
              const promoOk = await newInvoice();
              const lineId = await addLine(promoOk.id, 1, v2, 2, { price: 40_000 });
              await settle();
              assert.ok(lineId);
            },
          );

          // ============================================================ reservations
          await context.test(
            'finalization reserves each line; the level follows; availability and release are guarded',
            async () => {
              const invoice = await newInvoice('PRODUCT_SALE', { payer: member });
              const at = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
              const a = await addLine(invoice.id, 1, v1, 2, { pricedAt: at });
              const b = await addLine(invoice.id, 2, v2, 3, { pricedAt: at, price: 40_000 });
              // Drafts hold no stock; a reservation must match the variant and quantity of its product line.
              await settle();
              assert.deepEqual(await level(v1.id), { on_hand: 5, reserved: 0 });
              await rejects(
                () => reserve(invoice.id, a, v1.id, 3),
                /A reservation matches the variant and quantity of its product line/,
              );
              await rejects(
                () => reserve(invoice.id, a, v2.id, 2),
                /A reservation matches the variant and quantity of its product line/,
              );
              // A draft with stock held is refused at commit.
              await rejects(
                () => reserve(invoice.id, a, v1.id, 2),
                /A draft invoice holds no stock/,
              );
              assert.deepEqual(await level(v1.id), { on_hand: 5, reserved: 0 });
              await reserve(invoice.id, a, v1.id, 2);
              await reserve(invoice.id, b, v2.id, 3);
              assert.deepEqual(await level(v1.id), { on_hand: 5, reserved: 2 });
              assert.deepEqual(await level(v2.id), { on_hand: 10, reserved: 3 });
              await finalize(invoice.id, 2 * 200_000 + 3 * 40_000, at);
              await settle();
              // A second invoice may take what is left, never more.
              const second = await newInvoice();
              const t2 = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
              const c = await addLine(second.id, 1, v1, 4, { pricedAt: t2 });
              await rejects(
                () => reserve(second.id, c, v1.id, 4),
                /There is not enough stock available to reserve/,
              );
              await exec(
                `UPDATE invoice_lines SET quantity = 3, gross_vnd = 600000, row_version = row_version + 1 WHERE id = '${c}'::uuid`,
              );
              await reserve(second.id, c, v1.id, 3);
              await finalize(second.id, 600_000, t2);
              await settle();
              assert.deepEqual(await level(v1.id), { on_hand: 5, reserved: 5 });
              // The level is a cache written only by the reservation trigger.
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_levels SET reserved = 0 WHERE branch_id = '${branch}'::uuid AND variant_id = '${v1.id}'::uuid`,
                  ),
                /A stock level changes only through a stock movement or a reservation/,
              );
              // Stock cannot be taken out from under a reservation (T13: reserved <= on hand).
              await rejects(
                () =>
                  exec(
                    `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, reason, idempotency_key, actor_user_id)
                   VALUES ('${branch}'::uuid, '${v1.id}'::uuid, '${lot1}'::uuid, 'ADJUSTMENT', -1, 'LOSS', '${randomUUID()}', '${actor}'::uuid)`,
                  ),
                /stock_levels_reserved/,
              );
              // A reservation is released only when its invoice is cancelled; never deleted; never edited otherwise.
              const reservation = await one<{ id: string }>(
                `SELECT id FROM stock_reservations WHERE invoice_line_id = '${a}'::uuid`,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET status = 'RELEASED', released_by_user_id = '${actor}'::uuid, release_cause = 'INVOICE_CANCELLED_UNPAID'
                   WHERE id = '${reservation.id}'::uuid`,
                  ),
                /A reservation is released only when its invoice is cancelled/,
              );
              await rejects(
                () => exec(`DELETE FROM stock_reservations WHERE id = '${reservation.id}'::uuid`),
                /never deleted/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET status = 'CONSUMED' WHERE id = '${reservation.id}'::uuid`,
                  ),
                /changes only from reserved to released/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET quantity = 1 WHERE id = '${reservation.id}'::uuid`,
                  ),
                /immutable/,
              );
              // Cancelling the unpaid invoice without releasing its stock is refused at commit; with the release it stands.
              const cancel = () =>
                exec(
                  `UPDATE invoices SET status = 'CANCELLED', cancelled_at = clock_timestamp(), cancelled_by_user_id = '${actor}'::uuid,
                   cancelled_from_status = 'PENDING_PAYMENT', cancel_reason = 'Khách đổi ý', row_version = row_version + 1
                 WHERE id = '${invoice.id}'::uuid`,
                );
              await rejects(() => cancel(), /A cancelled invoice holds no stock/);
              await cancel();
              for (const id of [a, b]) {
                await exec(
                  `UPDATE stock_reservations SET status = 'RELEASED', released_by_user_id = '${actor}'::uuid,
                   release_cause = 'INVOICE_CANCELLED_UNPAID' WHERE invoice_line_id = '${id}'::uuid`,
                );
              }
              await settle();
              assert.deepEqual(await level(v1.id), { on_hand: 5, reserved: 3 });
              assert.deepEqual(await level(v2.id), { on_hand: 10, reserved: 0 });
              // Release is once: a released reservation is final.
              await rejects(
                () =>
                  exec(
                    `UPDATE stock_reservations SET status = 'RESERVED' WHERE invoice_line_id = '${a}'::uuid`,
                  ),
                /changes only from reserved to released/,
              );
            },
          );

          await context.test(
            'a finalized invoice must have reserved every product line, with the price frozen at finalization',
            async () => {
              await rejects(async () => {
                const invoice = await newInvoice();
                const at = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
                await addLine(invoice.id, 1, v2, 1, { pricedAt: at, price: 40_000 });
                await finalize(invoice.id, 40_000, at);
              }, /A finalized invoice reserves the stock of every product line/);
              // The price instant must be the finalization instant.
              await rejects(async () => {
                const early = await newInvoice();
                const t0 = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
                const line = await addLine(early.id, 1, v2, 1, { pricedAt: t0, price: 40_000 });
                await reserve(early.id, line, v2.id, 1);
                await finalize(
                  early.id,
                  40_000,
                  (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t,
                );
              }, /frozen at finalization/);
              // A finalized invoice keeps its amounts, fee and lines.
              const ok = await newInvoice();
              const t1 = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
              const okLine = await addLine(ok.id, 1, v2, 1, { pricedAt: t1, price: 40_000 });
              await reserve(ok.id, okLine, v2.id, 1);
              await finalize(ok.id, 40_000, t1);
              await settle();
              await rejects(
                () =>
                  exec(
                    `UPDATE invoices SET shipping_fee_vnd = 5, row_version = row_version + 1 WHERE id = '${ok.id}'::uuid`,
                  ),
                /invoices_channel_fee|keeps its payer, amounts/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoice_lines SET quantity = 2, gross_vnd = 80000, row_version = row_version + 1 WHERE id = '${okLine}'::uuid`,
                  ),
                /created and priced only while the invoice is a draft/,
              );
              // Not a published product any more: the invoice cannot be finalized (the guard re-checks at finalization).
              await rejects(async () => {
                const late = await newInvoice();
                const t3 = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
                const lateLine = await addLine(late.id, 1, v2, 1, { pricedAt: t3, price: 40_000 });
                await reserve(late.id, lateLine, v2.id, 1);
                await exec(
                  `UPDATE product_variants SET is_active = false, row_version = row_version + 1 WHERE id = '${v2.id}'::uuid`,
                );
                await finalize(late.id, 40_000, t3);
              }, /Only a published product with an active variant is sold|keeps at least one active/);
            },
          );

          await context.test(
            'only a PRODUCT line of a DRAFT can be deleted; every financial record stays',
            async () => {
              const invoice = await newInvoice();
              const line = await addLine(invoice.id, 1, v1, 1);
              await exec(
                `DELETE FROM invoice_line_products WHERE invoice_line_id = '${line}'::uuid`,
              );
              await exec(`DELETE FROM invoice_lines WHERE id = '${line}'::uuid`);
              await settle();
              assert.equal(
                (
                  await one<{ n: bigint }>(
                    `SELECT count(*) AS n FROM invoice_lines WHERE invoice_id = '${invoice.id}'::uuid`,
                  )
                ).n,
                0n,
              );
              const finalizedInvoice = await newInvoice();
              const at = (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
              const kept = await addLine(finalizedInvoice.id, 1, v1, 1, { pricedAt: at });
              await reserve(finalizedInvoice.id, kept, v1.id, 1);
              await finalize(finalizedInvoice.id, 200_000, at);
              await rejects(
                () =>
                  exec(`DELETE FROM invoice_line_products WHERE invoice_line_id = '${kept}'::uuid`),
                /Financial records are never deleted/,
              );
              await rejects(
                () => exec(`DELETE FROM invoice_lines WHERE id = '${kept}'::uuid`),
                /Financial records are never deleted/,
              );
              await rejects(
                () => exec(`DELETE FROM invoices WHERE id = '${finalizedInvoice.id}'::uuid`),
                /Financial records are never deleted/,
              );
            },
          );

          await context.test(
            'the seller can change on a draft, the copy and identity never do',
            async () => {
              const invoice = await newInvoice();
              const line = await addLine(invoice.id, 1, v1, 1);
              await assign(sellerElsewhere, branch);
              await exec(
                `UPDATE invoice_line_products SET seller_user_id = '${sellerElsewhere}'::uuid WHERE invoice_line_id = '${line}'::uuid`,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoice_line_products SET sku = 'OTHER' WHERE invoice_line_id = '${line}'::uuid`,
                  ),
                /names the product, variant and SKU of its line/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoice_line_products SET product_name_vi = 'Tên khác' WHERE invoice_line_id = '${line}'::uuid`,
                  ),
                /The copy of a product on an invoice line is never rewritten/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoice_line_products SET seller_user_id = '${sellerInactive}'::uuid WHERE invoice_line_id = '${line}'::uuid`,
                  ),
                /The seller is an active employee assigned/,
              );
            },
          );

          throw rollback;
        },
        { timeout: 120_000, maxWait: 30_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});

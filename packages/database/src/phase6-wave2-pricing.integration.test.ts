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
 * Phase 6 P6-9 database rules (migrations 20261108000000/1): the discount scope and its product targets, the SQL twin of the split
 * primitive, the shared-amount rules of an application, one redemption per (invoice, program), the Beauty-side rows, the line net
 * allocations and the commit-time integrity of a version 3 invoice. The payment side attribution needs two sides and is covered
 * with the real services (`pricing-v3.integration`). Every fixture rolls back.
 */
test('Phase 6 P6-9 scope, split twin, Beauty side rows and version 3 integrity (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 6 pricing v3 foundation rollback');
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
          const user = async (kind: 'EMPLOYEE' | 'CUSTOMER', label: string) => {
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind,
                status: 'ACTIVE',
                fullName: `P6-9 ${label}`,
                preferredLocale: 'vi',
                emailCanonical: `p69-${label}-${run}@example.com`,
                emailDelivery: `p69-${label}-${run}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+8479${String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                ...(kind === 'EMPLOYEE'
                  ? {
                      employeeProfile: {
                        create: {
                          employeeCodeCanonical: `P69_${label.toUpperCase()}_${run.toUpperCase()}`,
                          dateOfBirth: new Date('1990-01-01'),
                          address: 'Fixture',
                        },
                      },
                    }
                  : {
                      customerProfile: {
                        create: { dateOfBirth: new Date('1990-01-01'), address: 'Fixture' },
                      },
                    }),
              },
            });
            return id;
          };
          const actor = await user('EMPLOYEE', 'actor');
          const seller = await user('EMPLOYEE', 'seller');
          const member = await user('CUSTOMER', 'member');
          const branch = (
            await tx.branch.create({
              data: { code: `IT-P69-${run}`, name: 'P69 A', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          await exec(
            `INSERT INTO employee_branch_assignments (employee_user_id, branch_id, granted_by_user_id)
             VALUES ('${seller}'::uuid, '${branch}'::uuid, '${actor}'::uuid)`,
          );
          const brandA = await one<{ id: string }>(
            `INSERT INTO brands (code, name_vi, name_en) VALUES ('p69a-${run}', 'Nhãn A', 'Brand A') RETURNING id`,
          );
          const brandB = await one<{ id: string }>(
            `INSERT INTO brands (code, name_vi, name_en) VALUES ('p69b-${run}', 'Nhãn B', 'Brand B') RETURNING id`,
          );
          const product = await one<{ id: string }>(
            `INSERT INTO products (code, name_vi, name_en, brand_id, created_by_user_id)
             VALUES ('p69-${run}', 'Kem dưỡng', 'Day cream', '${brandA.id}'::uuid, '${actor}'::uuid) RETURNING id`,
          );
          let skuNo = 0;
          const variant = async (price: number) => {
            const created = await one<{ id: string; sku: string }>(
              `INSERT INTO product_variants (product_id, sku, label_vi, label_en)
               VALUES ('${product.id}'::uuid, 'P69-${run.toUpperCase()}-${++skuNo}', '50 ml', '50 ml') RETURNING id, sku`,
            );
            await exec(
              `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
               VALUES ('${created.id}'::uuid, 1, ${price}, '${actor}'::uuid)`,
            );
            return created;
          };
          const v1 = await variant(200_000);
          const v2 = await variant(50_000);
          await exec(
            `UPDATE products SET status = 'PUBLISHED', row_version = row_version + 1 WHERE id = '${product.id}'::uuid`,
          );
          let receiptNo = 0;
          const receive = async (variantId: string, quantity: number) => {
            const receipt = await one<{ id: string }>(
              `INSERT INTO stock_receipts (code, branch_id, receipt_date, created_by_user_id)
               VALUES ('R69-${run}-${++receiptNo}', '${branch}'::uuid, '2027-03-01', '${actor}'::uuid) RETURNING id`,
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
               VALUES ('${branch}'::uuid, '${variantId}'::uuid, 'L-${receiptNo}', '${line.id}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            await exec(
              `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, receipt_line_id, idempotency_key, actor_user_id)
               VALUES ('${branch}'::uuid, '${variantId}'::uuid, '${lot.id}'::uuid, 'RECEIPT', ${quantity}, '${line.id}'::uuid,
                 'RECEIPT:${line.id}', '${actor}'::uuid)`,
            );
          };
          await receive(v1.id, 100);
          await receive(v2.id, 100);
          const serviceCategory = await one<{ id: string }>(
            `INSERT INTO service_categories (code, name_vi, name_en) VALUES ('P69_${run.toUpperCase()}', 'Nhóm', 'Group') RETURNING id`,
          );
          const service = await one<{ id: string }>(
            `INSERT INTO services (code, category_id, name_vi, name_en, price_vnd, price_max_vnd, duration_minutes,
               estimated_min_minutes, estimated_max_minutes)
             VALUES ('P69_SVC_${run.toUpperCase()}', '${serviceCategory.id}'::uuid, 'Dịch vụ', 'Service', 100000, 100000, 10, 10, 10) RETURNING id`,
          );
          await exec(
            `INSERT INTO loyalty_go_live (activated_by_user_id) VALUES ('${actor}'::uuid)`,
          );

          let programNo = 0;
          type Target = {
            brand?: string;
            productCategory?: string;
            product?: string;
            service?: string;
          };
          /** A program with one version; `targets` makes it a SELECTED version. */
          const program = async (
            options: {
              scope?: 'SERVICES' | 'PRODUCTS' | 'BOTH' | null;
              kind?: 'PERCENT' | 'FIXED_AMOUNT';
              percentBp?: number;
              fixed?: number;
              requiresCode?: boolean;
              targets?: Target[];
              mode?: 'ALL_SERVICES' | 'SELECTED';
            } = {},
          ) => {
            const code = `P69_${run.toUpperCase()}_${++programNo}`;
            const kind = options.kind ?? 'FIXED_AMOUNT';
            const created = await one<{ id: string }>(
              `INSERT INTO discounts (code, name_vi, name_en, requires_code)
               VALUES ('${code}', 'Chương trình', 'Program', ${options.requiresCode ?? false}) RETURNING id`,
            );
            const targets = options.targets ?? [];
            const mode = options.mode ?? (targets.length > 0 ? 'SELECTED' : 'ALL_SERVICES');
            const scopeSql =
              options.scope === undefined ? '' : options.scope === null ? '' : `, scope`;
            const scopeValue =
              options.scope === undefined || options.scope === null ? '' : `, '${options.scope}'`;
            const version = await one<{ id: string }>(
              `INSERT INTO discount_versions (discount_id, version_no, kind, percent_bp, fixed_amount_vnd, valid_from, valid_until,
                 min_spend_vnd, scope_mode, created_by_user_id${scopeSql})
               VALUES ('${created.id}'::uuid, 1, '${kind}', ${kind === 'PERCENT' ? (options.percentBp ?? 1000) : 'NULL'},
                 ${kind === 'FIXED_AMOUNT' ? (options.fixed ?? 30_000) : 'NULL'}, now() - interval '1 day', now() + interval '30 days',
                 0, '${mode}', '${actor}'::uuid${scopeValue}) RETURNING id`,
            );
            for (const target of targets) {
              if (target.brand)
                await exec(
                  `INSERT INTO discount_version_brands (version_id, brand_id) VALUES ('${version.id}'::uuid, '${target.brand}'::uuid)`,
                );
              if (target.productCategory)
                await exec(
                  `INSERT INTO discount_version_product_categories (version_id, category_id) VALUES ('${version.id}'::uuid, '${target.productCategory}'::uuid)`,
                );
              if (target.product)
                await exec(
                  `INSERT INTO discount_version_products (version_id, product_id) VALUES ('${version.id}'::uuid, '${target.product}'::uuid)`,
                );
              if (target.service)
                await exec(
                  `INSERT INTO discount_version_services (version_id, service_id) VALUES ('${version.id}'::uuid, '${target.service}'::uuid)`,
                );
            }
            return { id: created.id, versionId: version.id, code };
          };
          let voucherNo = 0;
          const voucher = async (programId: string) =>
            (
              await one<{ id: string }>(
                `INSERT INTO vouchers (discount_id, code, created_by_user_id)
                 VALUES ('${programId}'::uuid, 'V69-${run.toUpperCase()}-${++voucherNo}', '${actor}'::uuid) RETURNING id`,
              )
            ).id;

          // ===================================================================== scope and product targets
          await context.test(
            'scope: every version without one is SERVICES; targets must fit the scope and the mode; scope rows are append-only',
            async () => {
              const legacy = await program();
              assert.equal(
                (
                  await one<{ scope: string }>(
                    `SELECT scope::text FROM discount_versions WHERE id = '${legacy.versionId}'::uuid`,
                  )
                ).scope,
                'SERVICES',
              );
              await settle();
              // PRODUCTS and BOTH: all of the scope, or a selection of brands, categories (that exact one) and products.
              await program({ scope: 'PRODUCTS' });
              await program({ scope: 'BOTH' });
              await program({ scope: 'PRODUCTS', targets: [{ brand: brandA.id }] });
              await program({
                scope: 'PRODUCTS',
                targets: [{ brand: brandA.id }, { product: product.id }],
              });
              await program({
                scope: 'BOTH',
                targets: [{ brand: brandB.id }, { service: service.id }],
              });
              await settle();
              // SELECTED names at least one target; ALL names none; targets must belong to the scope.
              await rejects(
                () => program({ scope: 'PRODUCTS', mode: 'SELECTED' }),
                /A selected-scope version names its targets/,
              );
              await rejects(
                () =>
                  program({
                    scope: 'PRODUCTS',
                    mode: 'ALL_SERVICES',
                    targets: [{ brand: brandA.id }],
                  }),
                /all-services version names none/,
              );
              await rejects(
                () => program({ scope: 'SERVICES', targets: [{ brand: brandA.id }] }),
                /A program names only the targets of its scope/,
              );
              await rejects(
                () => program({ scope: 'PRODUCTS', targets: [{ service: service.id }] }),
                /A program names only the targets of its scope/,
              );
              // A brand that does not exist is refused by the foreign key; a target is never rewritten or removed.
              await rejects(
                () =>
                  exec(
                    `INSERT INTO discount_version_brands (version_id, brand_id) VALUES ('${legacy.versionId}'::uuid, '${randomUUID()}'::uuid)`,
                  ),
                /foreign key/i,
              );
              const target = await program({ scope: 'PRODUCTS', targets: [{ brand: brandA.id }] });
              await settle();
              await rejects(
                () =>
                  exec(
                    `DELETE FROM discount_version_brands WHERE version_id = '${target.versionId}'::uuid`,
                  ),
                /Permanent identity and audit history/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE discount_versions SET scope = 'SERVICES' WHERE id = '${target.versionId}'::uuid`,
                  ),
                /Permanent identity and audit history/,
              );
            },
          );

          // ============================================================================ the split twin
          await context.test(
            'lucy_split_pro_rata is the SQL twin of the split primitive (vectors and 2,000 random splits)',
            async () => {
              const split = async (total: number, weights: number[]) =>
                (
                  await one<{ shares: string[] }>(
                    `SELECT lucy_split_pro_rata(${total}::bigint, ARRAY[${weights.join(',')}]::bigint[]) AS shares`,
                  )
                ).shares.map(BigInt);
              assert.deepEqual(await split(30_000, [100_000, 200_000]), [10_000n, 20_000n]);
              assert.deepEqual(await split(100_000, [300_000, 200_000]), [60_000n, 40_000n]);
              assert.deepEqual(await split(100, [1, 1, 1]), [33n, 34n, 33n]);
              assert.deepEqual(await split(1, [1, 1]), [1n, 0n]);
              assert.deepEqual(await split(10, [0, 5, 0]), [0n, 10n, 0n]);
              assert.deepEqual(await split(0, [0, 0]), [0n, 0n]);
              await rejects(
                () => one(`SELECT lucy_split_pro_rata(1::bigint, ARRAY[0,0]::bigint[])`),
                /Nothing to split over/,
              );
              await rejects(
                () => one(`SELECT lucy_split_pro_rata(-1::bigint, ARRAY[1]::bigint[])`),
                /cannot be negative/,
              );
              // Parity with the reference formula of design 6.4 (Ck = floor((2 * D * prefix + W) / (2 * W))).
              let seed = 20_261_008;
              const random = () => {
                seed = (Math.imul(seed, 1_103_515_245) + 12_345) >>> 0;
                return seed / 4_294_967_296;
              };
              for (let round = 0; round < 2_000; round += 1) {
                const count = 1 + Math.floor(random() * 5);
                const weights = Array.from({ length: count }, () =>
                  random() < 0.2 ? 0 : Math.floor(random() * 5_000_000),
                );
                const sum = weights.reduce((a, b) => a + b, 0);
                if (sum === 0) continue;
                const total = Math.floor(random() * 10_000_000);
                let prefix = 0n;
                let previous = 0n;
                const expected = weights.map((weight) => {
                  prefix += BigInt(weight);
                  const cumulative =
                    (2n * BigInt(total) * prefix + BigInt(sum)) / (2n * BigInt(sum));
                  const share = cumulative - previous;
                  previous = cumulative;
                  return share;
                });
                assert.deepEqual(await split(total, weights), expected);
              }
            },
          );

          // ======================================================================= version 3 invoices
          const clockText = async () =>
            (await one<{ t: string }>(`SELECT clock_timestamp()::text AS t`)).t;
          /** A DRAFT product sale with a line for 200,000 (v1 x 1) and a line for 100,000 (v2 x 2); returns the ids and the pricing instant. */
          const draft = async (payer: string | null = null) => {
            const clock = await one<{ created: Date; day: string }>(
              `SELECT clock_timestamp() AS created, lucy_branch_local_date('${branch}'::uuid, clock_timestamp())::text AS day`,
            );
            const invoice = await tx.invoice.create({
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
            const at = await clockText();
            const lines: { id: string; variantId: string; quantity: number; gross: number }[] = [];
            for (const [index, [variantRow, quantity, price]] of (
              [
                [v1, 1, 200_000],
                [v2, 2, 50_000],
              ] as const
            ).entries()) {
              const line = await one<{ id: string }>(
                `INSERT INTO invoice_lines (invoice_id, sequence, kind, item_code, name_vi, name_en, quantity, unit_price_vnd, gross_vnd)
                 VALUES ('${invoice.id}'::uuid, ${index + 1}, 'PRODUCT', '${variantRow.sku}', 'Kem', 'Cream', ${quantity}, ${price}, ${price * quantity}) RETURNING id`,
              );
              await exec(
                `INSERT INTO invoice_line_products (invoice_line_id, invoice_id, product_id, variant_id, sku, brand_id, product_name_vi,
                   product_name_en, variant_label_vi, variant_label_en, seller_user_id, list_price_vnd, priced_at)
                 VALUES ('${line.id}'::uuid, '${invoice.id}'::uuid, '${product.id}'::uuid, '${variantRow.id}'::uuid, '${variantRow.sku}',
                   '${brandA.id}'::uuid, 'Kem dưỡng', 'Day cream', '50 ml', '50 ml', '${seller}'::uuid, ${price}, '${at}'::timestamptz)`,
              );
              lines.push({
                id: line.id,
                variantId: variantRow.id,
                quantity,
                gross: price * quantity,
              });
            }
            return { id: invoice.id, at, lines };
          };
          type Draft = Awaited<ReturnType<typeof draft>>;
          const application = (
            table: 'invoice_beauty_applications' | 'invoice_discount_applications',
            invoice: Draft,
            p: { id: string; versionId: string },
            values: {
              voucherId?: string | null;
              kind?: 'PERCENT' | 'FIXED_AMOUNT';
              percentBp?: number | null;
              fixed?: number | null;
              eligible: number;
              computed: number;
              sharedEligible?: number;
              sharedAmount?: number;
            },
          ) =>
            exec(
              `INSERT INTO ${table} (invoice_id, discount_id, version_id, voucher_id, kind, percent_bp, fixed_amount_vnd,
                 eligible_subtotal_vnd, computed_amount_vnd, shared_eligible_subtotal_vnd, shared_amount_vnd, candidates,
                 selection_reason, finalized_by_user_id)
               VALUES ('${invoice.id}'::uuid, '${p.id}'::uuid, '${p.versionId}'::uuid, ${values.voucherId ? `'${values.voucherId}'::uuid` : 'NULL'},
                 '${values.kind ?? 'FIXED_AMOUNT'}', ${values.percentBp ?? 'NULL'}, ${(values.kind ?? 'FIXED_AMOUNT') === 'FIXED_AMOUNT' ? (values.fixed ?? values.computed) : 'NULL'},
                 ${values.eligible}, ${values.computed}, ${values.sharedEligible ?? 'NULL'}, ${values.sharedAmount ?? 'NULL'},
                 '[]'::jsonb, 'ONLY_ELIGIBLE', '${actor}'::uuid)`,
            );
          const redeem = (
            invoice: Draft,
            p: { id: string; versionId: string },
            voucherId: string | null,
            payer: string | null,
          ) =>
            exec(
              `INSERT INTO discount_redemptions (invoice_id, discount_id, version_id, voucher_id, payer_user_id)
               VALUES ('${invoice.id}'::uuid, '${p.id}'::uuid, '${p.versionId}'::uuid, ${voucherId ? `'${voucherId}'::uuid` : 'NULL'},
                 ${payer ? `'${payer}'::uuid` : 'NULL'})`,
            );
          const supply = (invoice: Draft, voucherId: string) =>
            exec(
              `INSERT INTO invoice_voucher_entries (invoice_id, voucher_id, supplied_by_user_id)
               VALUES ('${invoice.id}'::uuid, '${voucherId}'::uuid, '${actor}'::uuid)`,
            );
          const memberSnapshot = (invoice: Draft, amount: number) =>
            exec(
              `INSERT INTO invoice_beauty_snapshots (invoice_id, payer_user_id, balance_before, tier, tier_table_version, member_discount_bp,
                 calculation_version, eligible_beauty_vnd, member_amount_vnd, candidates, winner_source, selection_reason)
               VALUES ('${invoice.id}'::uuid, '${member}'::uuid, 600, 'SILVER', 1, 300, 3, 300000, ${amount},
                 '{"member":null,"programs":[]}'::jsonb, ${amount > 0 ? `'MEMBER_TIER'` : 'NULL'}, ${amount > 0 ? `'MEMBER_ONLY_ELIGIBLE'` : 'NULL'})`,
            );
          const allocate = async (
            invoice: Draft,
            shares: number[],
            overrides: { side?: 'SPA' | 'BEAUTY'; gross?: number; skip?: number } = {},
          ) => {
            for (const [index, line] of invoice.lines.entries()) {
              if (overrides.skip === index) continue;
              const share = shares[index] ?? 0;
              await exec(
                `INSERT INTO invoice_line_allocations (invoice_id, invoice_line_id, side, gross_vnd, discount_share_vnd, net_vnd)
                 VALUES ('${invoice.id}'::uuid, '${line.id}'::uuid, '${overrides.side ?? 'BEAUTY'}',
                   ${overrides.gross ?? line.gross}, ${share}, ${(overrides.gross ?? line.gross) - share})`,
              );
            }
          };
          const reserveAll = async (invoice: Draft) => {
            for (const line of invoice.lines) {
              await exec(
                `INSERT INTO stock_reservations (invoice_line_id, invoice_id, branch_id, variant_id, quantity, created_by_user_id)
                 VALUES ('${line.id}'::uuid, '${invoice.id}'::uuid, '${branch}'::uuid, '${line.variantId}'::uuid, ${line.quantity}, '${actor}'::uuid)`,
              );
            }
          };
          /** The finalization step of the database for a version 3 product sale (300,000 subtotal). */
          const finalize = (invoice: Draft, discount: number, version = 3) =>
            exec(
              `UPDATE invoices SET status = 'PENDING_PAYMENT', calculation_version = ${version}, subtotal_vnd = 300000,
                 discount_total_vnd = ${discount}, total_vnd = ${300_000 - discount},
                 finalized_at = '${invoice.at}'::timestamptz, finalized_by_user_id = '${actor}'::uuid, row_version = row_version + 1
               WHERE id = '${invoice.id}'::uuid`,
            );

          await context.test(
            'a Beauty-only version 3 invoice: member discount (snapshot), then a PRODUCTS voucher, then a shared BOTH program; all stand at commit',
            async () => {
              // Member discount: Silver 3% of 300,000 = 9,000, split over the lines 6,000 + 3,000.
              const withMember = await draft(member);
              await reserveAll(withMember);
              await memberSnapshot(withMember, 9_000);
              await allocate(withMember, [6_000, 3_000]);
              await finalize(withMember, 9_000);
              await settle();
              // A PRODUCTS fixed voucher of 30,000: application + redemption + allocation 20,000 + 10,000.
              const productsProgram = await program({
                scope: 'PRODUCTS',
                fixed: 30_000,
                requiresCode: true,
              });
              const code = await voucher(productsProgram.id);
              const withVoucher = await draft(member);
              await supply(withVoucher, code);
              await reserveAll(withVoucher);
              await application('invoice_beauty_applications', withVoucher, productsProgram, {
                voucherId: code,
                eligible: 300_000,
                computed: 30_000,
              });
              await redeem(withVoucher, productsProgram, code, member);
              await allocate(withVoucher, [20_000, 10_000]);
              await finalize(withVoucher, 30_000);
              await settle();
              // A BOTH percent program with no Spa side: shared eligible = this side's eligible, the whole amount is this side's.
              const bothProgram = await program({
                scope: 'BOTH',
                kind: 'PERCENT',
                percentBp: 1000,
              });
              const withShared = await draft(null);
              await reserveAll(withShared);
              await application('invoice_beauty_applications', withShared, bothProgram, {
                kind: 'PERCENT',
                percentBp: 1000,
                eligible: 300_000,
                computed: 30_000,
                sharedEligible: 300_000,
                sharedAmount: 30_000,
              });
              await redeem(withShared, bothProgram, null, null);
              await allocate(withShared, [20_000, 10_000]);
              await finalize(withShared, 30_000);
              await settle();
              // No benefit at all: allocations with no discount.
              const plain = await draft(null);
              await reserveAll(plain);
              await allocate(plain, [0, 0]);
              await finalize(plain, 0);
              await settle();
              const stored = await one<{ n: bigint; net: bigint }>(
                `SELECT count(*) AS n, COALESCE(sum(net_vnd), 0)::bigint AS net FROM invoice_line_allocations WHERE invoice_id = '${withVoucher.id}'::uuid`,
              );
              assert.equal(stored.n, 2n);
              assert.equal(stored.net, 270_000n);
            },
          );

          /** Runs `work` and rolls everything it did back (a positive check that leaves nothing pending for later deferred checks). */
          const accepts = async (work: () => Promise<unknown>) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } finally {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
            }
          };

          await context.test(
            'the integrity check refuses every inconsistent version 3 invoice at commit',
            async () => {
              const products = await program({
                scope: 'PRODUCTS',
                fixed: 30_000,
                requiresCode: true,
              });
              const code = await voucher(products.id);
              const shared = await program({ scope: 'BOTH', kind: 'PERCENT', percentBp: 1000 });
              const codeless = await program({ scope: 'PRODUCTS', fixed: 30_000 });
              await settle();
              // Each case is built INSIDE its savepoint, so a refused attempt leaves nothing pending.
              // The header discount must be what the sides applied.
              await rejects(async () => {
                const invoice = await draft(member);
                await reserveAll(invoice);
                await memberSnapshot(invoice, 9_000);
                await allocate(invoice, [6_000, 3_000]);
                await finalize(invoice, 9_001);
              }, /The invoice discount total must equal the benefits applied to its sides|invoices_money/);
              // Every line has its allocation, and the shares add up to the side's discount.
              await rejects(async () => {
                const invoice = await draft(member);
                await reserveAll(invoice);
                await memberSnapshot(invoice, 9_000);
                await allocate(invoice, [6_000, 3_000], { skip: 1 });
                await finalize(invoice, 9_000);
              }, /Every line of a version 3 invoice has its net allocation/);
              await rejects(async () => {
                const invoice = await draft(member);
                await reserveAll(invoice);
                await memberSnapshot(invoice, 9_000);
                await allocate(invoice, [5_000, 3_000]);
                await finalize(invoice, 9_000);
              }, /The line allocations must add up to the discount of each side/);
              // An applied program is redeemed exactly once.
              await rejects(async () => {
                const invoice = await draft(member);
                await supply(invoice, code);
                await reserveAll(invoice);
                await application('invoice_beauty_applications', invoice, products, {
                  voucherId: code,
                  eligible: 300_000,
                  computed: 30_000,
                });
                await allocate(invoice, [20_000, 10_000]);
                await finalize(invoice, 30_000);
              }, /An applied benefit is redeemed exactly once/);
              // A voucher benefit needs its code supplied.
              await rejects(async () => {
                const invoice = await draft(member);
                await reserveAll(invoice);
                await application('invoice_beauty_applications', invoice, products, {
                  voucherId: code,
                  eligible: 300_000,
                  computed: 30_000,
                });
                await redeem(invoice, products, code, member);
                await allocate(invoice, [20_000, 10_000]);
                await finalize(invoice, 30_000);
              }, /A voucher benefit needs its code supplied/);
              // A member discount and a program are never both applied on one side.
              await rejects(async () => {
                const invoice = await draft(member);
                await supply(invoice, code);
                await reserveAll(invoice);
                await memberSnapshot(invoice, 9_000);
                await application('invoice_beauty_applications', invoice, products, {
                  voucherId: code,
                  eligible: 300_000,
                  computed: 30_000,
                });
                await redeem(invoice, products, code, member);
                await allocate(invoice, [20_000, 10_000]);
                await finalize(invoice, 39_000);
              }, /A member discount excludes every program benefit on the Beauty side/);
              // A BOTH program on a version 3 invoice records its shared amount.
              await rejects(async () => {
                const invoice = await draft(null);
                await reserveAll(invoice);
                await application('invoice_beauty_applications', invoice, shared, {
                  kind: 'PERCENT',
                  percentBp: 1000,
                  eligible: 300_000,
                  computed: 30_000,
                });
                await redeem(invoice, shared, null, null);
                await allocate(invoice, [20_000, 10_000]);
                await finalize(invoice, 30_000);
              }, /records its shared amount/);
              // Per-side rows belong to a version 3 invoice only.
              await rejects(async () => {
                const invoice = await draft(member);
                await reserveAll(invoice);
                await memberSnapshot(invoice, 9_000);
                await allocate(invoice, [6_000, 3_000]);
                await finalize(invoice, 9_000, 2);
              }, /Per-side pricing rows belong to a version 3 invoice|The invoice discount total must equal its applied benefit/);
              // The eligible subtotal cannot exceed the side it belongs to.
              await rejects(async () => {
                const invoice = await draft(null);
                await reserveAll(invoice);
                await application('invoice_beauty_applications', invoice, codeless, {
                  eligible: 300_001,
                  computed: 30_000,
                });
                await redeem(invoice, codeless, null, null);
                await allocate(invoice, [20_000, 10_000]);
                await finalize(invoice, 30_000);
              }, /The eligible subtotal cannot exceed the side it belongs to/);
            },
          );

          await context.test(
            'row guards: scope per side, the shared amount, the amount rules, the allocation of a line, and append-only',
            async () => {
              const services = await program({ scope: 'SERVICES', fixed: 30_000 });
              const products = await program({ scope: 'PRODUCTS', fixed: 30_000 });
              const both = await program({ scope: 'BOTH', kind: 'PERCENT', percentBp: 1000 });
              await settle();
              const target = await draft(null);
              await rejects(
                () =>
                  application('invoice_beauty_applications', target, services, {
                    eligible: 300_000,
                    computed: 30_000,
                  }),
                /may only discount services cannot apply to the Beauty side/,
              );
              await rejects(
                () =>
                  application('invoice_discount_applications', target, products, {
                    eligible: 300_000,
                    computed: 30_000,
                  }),
                /may only discount products cannot apply to the Spa side/,
              );
              // A shared amount only on a BOTH program.
              await rejects(
                () =>
                  application('invoice_beauty_applications', target, products, {
                    eligible: 300_000,
                    computed: 30_000,
                    sharedEligible: 300_000,
                    sharedAmount: 30_000,
                  }),
                /Only a shared \(BOTH\) program records a shared amount/,
              );
              // The amount rules: the Phase 4 exact amount, or the share of the shared amount by cumulative rounding.
              await rejects(
                () =>
                  application('invoice_beauty_applications', target, products, {
                    eligible: 300_000,
                    computed: 29_999,
                    fixed: 30_000,
                  }),
                /invoice_beauty_applications_amount/,
              );
              // 500,000 eligible in all, 10% = 50,000; Beauty eligible 200,000 -> 20,000 (the Spa side keeps 30,000).
              await accepts(() =>
                application('invoice_beauty_applications', target, both, {
                  kind: 'PERCENT',
                  percentBp: 1000,
                  eligible: 200_000,
                  computed: 20_000,
                  sharedEligible: 500_000,
                  sharedAmount: 50_000,
                }),
              );
              for (const wrong of [
                { computed: 20_001, sharedAmount: 50_000 },
                { computed: 20_000, sharedAmount: 50_001 },
                { computed: 30_000, sharedAmount: 50_000 },
              ]) {
                await rejects(
                  () =>
                    application('invoice_beauty_applications', target, both, {
                      kind: 'PERCENT',
                      percentBp: 1000,
                      eligible: 200_000,
                      sharedEligible: 500_000,
                      ...wrong,
                    }),
                  /invoice_beauty_applications_amount/,
                );
              }
              // The Spa side keeps the 30,000 of the same split (weights: Spa eligible, then the rest).
              await accepts(() =>
                application('invoice_discount_applications', target, both, {
                  kind: 'PERCENT',
                  percentBp: 1000,
                  eligible: 300_000,
                  computed: 30_000,
                  sharedEligible: 500_000,
                  sharedAmount: 50_000,
                }),
              );
              await rejects(
                () => redeem(target, products, null, null),
                /A redemption records exactly the applied benefit of its invoice/,
              );
              // One redemption per (invoice, program).
              await rejects(async () => {
                const solo = await draft(null);
                await application('invoice_beauty_applications', solo, products, {
                  eligible: 300_000,
                  computed: 30_000,
                });
                await redeem(solo, products, null, null);
                await redeem(solo, products, null, null);
              }, /discount_redemptions_invoice_discount_key/);
              // The allocation of a line: its own gross, its own side, only while the invoice is being finalized.
              const alloc = await draft(null);
              await rejects(
                () => allocate(alloc, [0, 0], { gross: 1 }),
                /A line allocation records the gross of its line/,
              );
              await rejects(
                () => allocate(alloc, [0, 0], { side: 'SPA' }),
                /A product line belongs to the Beauty side/,
              );
              await reserveAll(alloc);
              await allocate(alloc, [0, 0]);
              await finalize(alloc, 0);
              await settle();
              await rejects(
                () =>
                  exec(
                    `INSERT INTO invoice_line_allocations (invoice_id, invoice_line_id, side, gross_vnd, discount_share_vnd, net_vnd)
                     VALUES ('${alloc.id}'::uuid, '${alloc.lines[0]!.id}'::uuid, 'BEAUTY', 200000, 0, 200000)`,
                  ),
                /invoice_line_allocations_line_key|written while the invoice is being finalized/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE invoice_line_allocations SET discount_share_vnd = 1, net_vnd = 199999 WHERE invoice_id = '${alloc.id}'::uuid`,
                  ),
                /Permanent identity and audit history/,
              );
              await rejects(
                () =>
                  exec(
                    `DELETE FROM invoice_line_allocations WHERE invoice_id = '${alloc.id}'::uuid`,
                  ),
                /Permanent identity and audit history/,
              );
              await rejects(
                () => exec(`TRUNCATE invoice_line_allocations`),
                /Permanent identity and audit history/,
              );
              await rejects(
                () => exec(`TRUNCATE payment_side_allocations`),
                /Permanent identity and audit history/,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO payment_side_allocations (invoice_id, payment_id, side, kind, amount_vnd)
                     VALUES ('${alloc.id}'::uuid, '${randomUUID()}'::uuid, 'SPA', 'PAYMENT', 0)`,
                  ),
                /payment_side_allocations_nonzero/,
              );
            },
          );

          await context.test(
            'every function of this step has its fixed search_path and no PUBLIC execute',
            async () => {
              const names = [
                'lucy_cumulative_share',
                'lucy_split_pro_rata',
                'lucy_guard_discount_application',
                'lucy_guard_beauty_application',
                'lucy_guard_discount_redemption',
                'lucy_guard_invoice_beauty_snapshot',
                'lucy_guard_invoice_line_allocation',
                'lucy_allocate_payment_sides',
                'lucy_allocate_payment_reversal_sides',
                'lucy_check_payment_side_allocations',
                'lucy_check_invoice_pricing_v3',
                'lucy_check_invoice_pricing_row',
                'lucy_check_invoice_discount',
                'lucy_check_discount_version_scope',
              ];
              const settings = await rows<{
                proname: string;
                proconfig: string[] | null;
                acl: string | null;
              }>(
                `SELECT proname, proconfig, proacl::text AS acl FROM pg_proc
                 WHERE proname = ANY(ARRAY[${names.map((name) => `'${name}'`).join(',')}])`,
              );
              assert.equal(settings.length, names.length);
              for (const entry of settings) {
                assert.ok(
                  (entry.proconfig ?? []).some((value) =>
                    value.startsWith('search_path=pg_catalog'),
                  ),
                  `${entry.proname} has a fixed search_path`,
                );
                assert.ok(
                  entry.acl !== null && !/(^|[{,])=X\//.test(entry.acl),
                  `${entry.proname} has no PUBLIC execute`,
                );
              }
            },
          );
          throw rollback;
        },
        { timeout: 120_000, maxWait: 10_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});

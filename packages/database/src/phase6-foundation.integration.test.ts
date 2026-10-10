import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, PERMISSION_CATALOG, syncPermissionCatalog } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

const PHASE6_CODES = [
  'MANAGE_PRODUCTS',
  'MANAGE_PRODUCT_PRICES',
  'VIEW_PRODUCT_COST',
  'VIEW_INVENTORY',
  'MANAGE_STOCK_RECEIPTS',
  'ADJUST_STOCK',
  'IMPORT_PRODUCT_DATA',
  'SELL_PRODUCTS',
  'MANAGE_PRODUCT_RETURNS',
  'REFUND_PRODUCTS',
  'MANAGE_PRODUCT_CAMPAIGNS',
] as const;
const GLOBAL_ONLY_CODES: readonly string[] = [
  'MANAGE_PRODUCTS',
  'MANAGE_PRODUCT_PRICES',
  'VIEW_PRODUCT_COST',
  'IMPORT_PRODUCT_DATA',
  'MANAGE_PRODUCT_CAMPAIGNS',
];
const FINANCIAL_CODES: readonly string[] = [
  'MANAGE_PRODUCT_PRICES',
  'VIEW_PRODUCT_COST',
  'MANAGE_STOCK_RECEIPTS',
  'IMPORT_PRODUCT_DATA',
  'REFUND_PRODUCTS',
  'MANAGE_PRODUCT_CAMPAIGNS',
];

const NEW_TABLES = [
  'brands',
  'product_categories',
  'products',
  'product_variants',
  'product_price_versions',
  'product_promotions',
  'product_images',
  'product_import_jobs',
  'product_import_rows',
  'suppliers',
  'stock_receipts',
  'stock_receipt_lines',
  'inventory_lots',
  'stock_levels',
  'stock_count_sessions',
  'stock_count_lines',
  'stock_movements',
] as const;

test('Phase 6 P6-2 catalog / import / inventory database foundation (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 6 foundation rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8);
  try {
    await assert.rejects(
      database.$transaction(
        async (tx) => {
          let savepoints = 0;
          // Each rejected statement runs in its own savepoint so the fixture transaction survives.
          const rejects = async (work: () => Promise<unknown>, pattern: RegExp) => {
            const name = `sp_${++savepoints}`;
            await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
            try {
              await work();
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              const text = `${String((error as Error).message)} ${JSON.stringify((error as { meta?: unknown }).meta ?? {})}`;
              assert.match(text, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          // Deferred integrity triggers fire at commit; fixtures never commit, so check on demand.
          const settle = async () => {
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
            await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
          };
          const rejectsAtCommit = (work: () => Promise<unknown>, pattern: RegExp) =>
            rejects(async () => {
              await work();
              await settle();
            }, pattern);
          const exec = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);
          const rows = <T>(sql: string, ...params: unknown[]) =>
            tx.$queryRawUnsafe<T[]>(sql, ...params);
          const one = async <T>(sql: string, ...params: unknown[]): Promise<T> =>
            (await rows<T>(sql, ...params))[0]!;
          const count = async (table: string, where = 'true') =>
            Number(
              (
                await one<{ n: bigint }>(
                  `SELECT count(*)::bigint AS n FROM ${table} WHERE ${where}`,
                )
              ).n,
            );
          const dbNow = async () => (await one<{ t: Date }>('SELECT clock_timestamp() AS t')).t;

          let sequence = 0;
          const phoneBase = String(Math.floor(Math.random() * 100_000)).padStart(5, '0');
          const employee = async () => {
            sequence += 1;
            const id = randomUUID();
            await tx.user.create({
              data: {
                id,
                kind: 'EMPLOYEE',
                status: 'ACTIVE',
                fullName: `P6 fixture ${sequence}`,
                preferredLocale: 'vi',
                emailCanonical: `p6-${sequence}-${run}@example.com`,
                emailDelivery: `p6-${sequence}-${run}@example.com`,
                emailVerifiedAt: new Date(),
                phoneCanonical: `+848${phoneBase}${String(sequence).padStart(3, '0')}`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture-password-hash',
                employeeProfile: {
                  create: {
                    employeeCodeCanonical: `P6_${run.toUpperCase()}_${sequence}`,
                    dateOfBirth: new Date('1990-01-01'),
                    address: 'Fixture',
                  },
                },
              },
              select: { id: true },
            });
            return id;
          };
          const actor = await employee();
          const branch = (
            await tx.branch.create({
              data: { code: `IT-P6-${run}`, name: 'P6 branch', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;
          const otherBranch = (
            await tx.branch.create({
              data: { code: `IT-P6B-${run}`, name: 'P6 other', timezone: 'Asia/Ho_Chi_Minh' },
              select: { id: true },
            })
          ).id;

          // ============================================================ permissions (P6-T24, granted to no one)
          await context.test(
            'permissions: the eleven Phase 6 codes, semantics, granted to no one',
            async () => {
              const labels = (
                await rows<{ labels: string[] }>(
                  `SELECT enum_range(NULL::"PermissionCode")::text[] AS labels`,
                )
              )[0]?.labels;
              for (const code of PHASE6_CODES) {
                assert.ok(labels?.includes(code), code);
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
              }
              assert.equal(PERMISSION_CATALOG.length, 68);
              await syncPermissionCatalog(tx);
              const stored = await tx.permission.findMany({
                where: { code: { in: [...PHASE6_CODES] } },
                select: { code: true, scopeCapability: true, dataClassification: true },
              });
              assert.equal(stored.length, 11);
              for (const row of stored) {
                assert.equal(
                  row.scopeCapability,
                  GLOBAL_ONLY_CODES.includes(row.code) ? 'GLOBAL_ONLY' : 'BRANCH_CAPABLE',
                  row.code,
                );
                assert.equal(
                  row.dataClassification,
                  FINANCIAL_CODES.includes(row.code) ? 'FINANCIAL' : 'STANDARD',
                  row.code,
                );
              }
              const wrong = (
                code: string,
                scope: 'GLOBAL_ONLY' | 'BRANCH_CAPABLE',
                classification: 'STANDARD' | 'EMPLOYEE_PAY' | 'FINANCIAL',
              ) =>
                rejects(
                  () =>
                    exec(
                      `INSERT INTO permissions (id, code, scope_capability, data_classification)
                     VALUES (gen_random_uuid(), '${code}'::"PermissionCode", '${scope}'::"ScopeCapability", '${classification}'::"DataClassification")`,
                    ),
                  /permissions_catalog_semantics/,
                );
              await wrong('MANAGE_PRODUCTS', 'BRANCH_CAPABLE', 'STANDARD');
              await wrong('MANAGE_PRODUCT_PRICES', 'GLOBAL_ONLY', 'STANDARD');
              await wrong('VIEW_PRODUCT_COST', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('VIEW_INVENTORY', 'GLOBAL_ONLY', 'STANDARD');
              await wrong('MANAGE_STOCK_RECEIPTS', 'BRANCH_CAPABLE', 'STANDARD');
              await wrong('ADJUST_STOCK', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('IMPORT_PRODUCT_DATA', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('SELL_PRODUCTS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('REFUND_PRODUCTS', 'BRANCH_CAPABLE', 'STANDARD');
              await wrong('MANAGE_PRODUCT_CAMPAIGNS', 'GLOBAL_ONLY', 'STANDARD');
              // Earlier semantics are unchanged.
              await wrong('MANAGE_DISCOUNTS', 'BRANCH_CAPABLE', 'FINANCIAL');
              await wrong('ACTIVATE_LOYALTY', 'BRANCH_CAPABLE', 'STANDARD');
              await rejects(
                () =>
                  exec(
                    "UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'MANAGE_PRODUCTS'",
                  ),
                /code-owned and immutable/,
              );
              // A GLOBAL_ONLY code is overridden at GLOBAL scope only; branch-capable ones can be granted at a branch.
              const catalog = new Map(
                (await tx.permission.findMany({ select: { id: true, code: true } })).map((row) => [
                  row.code,
                  row.id,
                ]),
              );
              const grantee = await employee();
              for (const code of GLOBAL_ONLY_CODES) {
                await rejects(
                  () =>
                    tx.userPermissionOverride.create({
                      data: {
                        userId: grantee,
                        permissionId: catalog.get(code as never)!,
                        effect: 'ALLOW',
                        scopeKind: 'BRANCH',
                        branchId: branch,
                      },
                    }),
                  /GLOBAL_ONLY permission cannot be overridden/,
                );
              }
              await tx.userPermissionOverride.create({
                data: {
                  userId: grantee,
                  permissionId: catalog.get('SELL_PRODUCTS')!,
                  effect: 'ALLOW',
                  scopeKind: 'BRANCH',
                  branchId: branch,
                },
              });
              // None is Owner-only: the Owner can grant any of them at GLOBAL scope.
              await tx.userPermissionOverride.create({
                data: {
                  userId: grantee,
                  permissionId: catalog.get('MANAGE_PRODUCTS')!,
                  effect: 'ALLOW',
                  scopeKind: 'GLOBAL',
                },
              });
              assert.equal(
                await tx.rolePermission.count({
                  where: { permission: { code: { in: [...PHASE6_CODES] } } },
                }),
                0,
                'no role receives a Phase 6 permission by default',
              );
            },
          );

          // ============================================================ tables start empty
          await context.test('every new table starts empty except the settings row', async () => {
            for (const table of NEW_TABLES) {
              assert.equal(
                await count(table),
                0,
                `${table} starts empty (the Owner enters real data)`,
              );
            }
            const settings = await rows<{
              id: number;
              expiry_warning_days: number;
              new_badge_days: number;
            }>('SELECT id, expiry_warning_days, new_badge_days FROM product_settings');
            assert.deepEqual(settings, [{ id: 1, expiry_warning_days: 90, new_badge_days: 30 }]);
          });

          // ============================================================ catalog
          const ids: Record<string, string> = {};
          await context.test('catalog: brands, categories, products, variants', async () => {
            const brand = await one<{ id: string }>(
              `INSERT INTO brands (code, name_vi, name_en) VALUES ('brand-${run}', 'Nhãn A', 'Brand A') RETURNING id`,
            );
            ids['brand'] = brand.id;
            await rejects(
              () =>
                exec(`INSERT INTO brands (code, name_vi, name_en) VALUES ('Bad Code', 'x', 'x')`),
              /brands_code/,
            );
            await rejects(
              () =>
                exec(`INSERT INTO brands (code, name_vi, name_en) VALUES ('ok-${run}', ' ', 'x')`),
              /brands_names/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO brands (code, name_vi, name_en) VALUES ('brand-${run}', 'Trùng', 'Dup')`,
                ),
              /brands_code_key/,
            );
            await rejects(
              () => exec(`UPDATE brands SET name_vi = 'Sửa' WHERE id = '${brand.id}'::uuid`),
              /advance the row version by one/,
            );
            await exec(
              `UPDATE brands SET name_vi = 'Sửa', row_version = row_version + 1 WHERE id = '${brand.id}'::uuid`,
            );

            const parent = await one<{ id: string }>(
              `INSERT INTO product_categories (code, name_vi, name_en) VALUES ('cat-${run}', 'Chăm sóc da', 'Skincare') RETURNING id`,
            );
            const child = await one<{ id: string }>(
              `INSERT INTO product_categories (parent_id, code, name_vi, name_en)
               VALUES ('${parent.id}'::uuid, 'child-${run}', 'Mặt nạ', 'Masks') RETURNING id`,
            );
            ids['category'] = child.id;
            await rejects(
              () =>
                exec(
                  `INSERT INTO product_categories (parent_id, code, name_vi, name_en)
                   VALUES ('${child.id}'::uuid, 'grand-${run}', 'x', 'x')`,
                ),
              /must not be a child itself/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_categories SET parent_id = '${child.id}'::uuid, row_version = row_version + 1
                   WHERE id = '${parent.id}'::uuid`,
                ),
              /must not be a child itself|has children|product_categories_parent/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_categories SET parent_id = id, row_version = row_version + 1 WHERE id = '${parent.id}'::uuid`,
                ),
              /has children|product_categories_parent/,
            );

            await rejects(
              () =>
                exec(
                  `INSERT INTO products (code, name_vi, name_en, status, published_at, created_by_user_id)
                   VALUES ('p-pub-${run}', 'x', 'x', 'PUBLISHED', now(), '${actor}'::uuid)`,
                ),
              /created as a draft/,
            );
            const product = await one<{ id: string }>(
              `INSERT INTO products (code, brand_id, category_id, name_vi, name_en, created_by_user_id)
               VALUES ('p-${run}', '${brand.id}'::uuid, '${child.id}'::uuid, 'Kem dưỡng', 'Cream', '${actor}'::uuid) RETURNING id`,
            );
            ids['product'] = product.id;
            const publish = (version = true) =>
              exec(
                `UPDATE products SET status = 'PUBLISHED'${version ? ', row_version = row_version + 1' : ''}
                 WHERE id = '${product.id}'::uuid`,
              );
            await rejects(() => publish(), /active, priced variant/);
            await rejects(
              () =>
                exec(
                  `INSERT INTO product_variants (product_id, sku, label_vi) VALUES ('${product.id}'::uuid, 'abc', 'x')`,
                ),
              /product_variants_sku/,
            );
            const variant = await one<{ id: string }>(
              `INSERT INTO product_variants (product_id, sku, label_vi, label_en, cost_price_vnd, low_stock_threshold)
               VALUES ('${product.id}'::uuid, 'P6-${run.toUpperCase()}-50', '50 ml', '50 ml', 120000, 3) RETURNING id`,
            );
            ids['variant'] = variant.id;
            await rejects(
              () =>
                exec(
                  `INSERT INTO product_variants (product_id, sku) VALUES ('${product.id}'::uuid, 'P6-${run.toUpperCase()}-50')`,
                ),
              /product_variants_sku_key/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_variants SET cost_price_vnd = -1, row_version = row_version + 1 WHERE id = '${variant.id}'::uuid`,
                ),
              /product_variants_cost/,
            );
            // Still no price: cannot publish.
            await rejects(() => publish(), /active, priced variant/);
            await exec(
              `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
               VALUES ('${variant.id}'::uuid, 1, 389000, '${actor}'::uuid)`,
            );
            await rejects(() => publish(false), /advance the row version by one/);
            await publish();
            const published = await one<{ published_at: Date | null; status: string }>(
              `SELECT published_at, status::text AS status FROM products WHERE id = '${product.id}'::uuid`,
            );
            assert.equal(published.status, 'PUBLISHED');
            assert.ok(
              published.published_at instanceof Date,
              'the database stamps the first publication',
            );
            await rejects(
              () =>
                exec(
                  `UPDATE products SET published_at = now(), row_version = row_version + 1 WHERE id = '${product.id}'::uuid`,
                ),
              /first publication time is immutable/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE products SET status = 'DRAFT', row_version = row_version + 1 WHERE id = '${product.id}'::uuid`,
                ),
              /never returns to draft/,
            );
            await exec(
              `UPDATE products SET status = 'INACTIVE', row_version = row_version + 1 WHERE id = '${product.id}'::uuid`,
            );
            await publish();
            assert.deepEqual(
              (
                await one<{ published_at: Date }>(
                  `SELECT published_at FROM products WHERE id = '${product.id}'::uuid`,
                )
              ).published_at,
              published.published_at,
              'republishing keeps the first publication time',
            );
            // A variant is deactivated, never deleted; a published product keeps one active priced variant.
            await rejects(
              () => exec(`DELETE FROM product_variants WHERE id = '${variant.id}'::uuid`),
              /never deleted/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_variants SET is_active = false, row_version = row_version + 1 WHERE id = '${variant.id}'::uuid`,
                ),
              /keeps at least one active, priced variant/,
            );
            const second = await one<{ id: string }>(
              `INSERT INTO product_variants (product_id, sku, barcode) VALUES ('${product.id}'::uuid, 'P6-${run.toUpperCase()}-100', '893${run}') RETURNING id`,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_variants SET is_active = false, row_version = row_version + 1 WHERE id = '${variant.id}'::uuid`,
                ),
              /keeps at least one active, priced variant/,
            );
            await exec(
              `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
               VALUES ('${second.id}'::uuid, 1, 650000, '${actor}'::uuid)`,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO product_variants (product_id, sku, barcode) VALUES ('${product.id}'::uuid, 'P6-${run.toUpperCase()}-DUP', '893${run}')`,
                ),
              /product_variants_barcode_key/,
            );
            await exec(
              `UPDATE product_variants SET is_active = false, row_version = row_version + 1 WHERE id = '${variant.id}'::uuid`,
            );
            await exec(
              `UPDATE product_variants SET is_active = true, row_version = row_version + 1 WHERE id = '${variant.id}'::uuid`,
            );
            const other = await one<{ id: string }>(
              `INSERT INTO products (code, name_vi, name_en, created_by_user_id) VALUES ('p2-${run}', 'Khác', 'Other', '${actor}'::uuid) RETURNING id`,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_variants SET product_id = '${other.id}'::uuid, row_version = row_version + 1 WHERE id = '${second.id}'::uuid`,
                ),
              /never moves to another product/,
            );
            ids['second'] = second.id;
          });

          // ============================================================ prices and promotions
          await context.test(
            'prices: append-only versions, promotions, the effective price',
            async () => {
              const variant = ids['variant']!;
              await rejects(
                () =>
                  exec(
                    `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
                   VALUES ('${variant}'::uuid, 3, 400000, '${actor}'::uuid)`,
                  ),
                /follows the previous one/,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
                   VALUES ('${variant}'::uuid, 2, 0, '${actor}'::uuid)`,
                  ),
                /product_price_versions_price/,
              );
              const afterV1 = await dbNow();
              await exec(
                `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, reason, created_by_user_id)
               VALUES ('${variant}'::uuid, 2, 420000, 'Tăng giá', '${actor}'::uuid)`,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_price_versions SET list_price_vnd = 1 WHERE variant_id = '${variant}'::uuid`,
                  ),
                /append-only/,
              );
              await rejects(
                () =>
                  exec(`DELETE FROM product_price_versions WHERE variant_id = '${variant}'::uuid`),
                /append-only/,
              );
              // The price in force at an instant is the version written at or before it (history is never rewritten).
              const historic = await rows<{ list_price_vnd: bigint; effective_price_vnd: bigint }>(
                'SELECT list_price_vnd, effective_price_vnd FROM lucy_variant_price_at($1::uuid, $2::timestamptz)',
                variant,
                afterV1,
              );
              assert.deepEqual(historic, [
                { list_price_vnd: 389000n, effective_price_vnd: 389000n },
              ]);
              const current = await rows<{ list_price_vnd: bigint }>(
                'SELECT list_price_vnd FROM lucy_variant_price_at($1::uuid, clock_timestamp())',
                variant,
              );
              assert.deepEqual(current, [{ list_price_vnd: 420000n }]);
              assert.equal(
                (
                  await rows<unknown>(
                    `SELECT 1 FROM lucy_variant_price_at($1::uuid, clock_timestamp() - interval '1 day')`,
                    variant,
                  )
                ).length,
                0,
                'before its first price a variant has no price',
              );

              const promotion = (price: number, start: string, end: string) =>
                exec(
                  `INSERT INTO product_promotions (variant_id, promo_price_vnd, starts_at, ends_at, created_by_user_id)
                 VALUES ('${variant}'::uuid, ${price}, ${start}, ${end}, '${actor}'::uuid)`,
                );
              await rejects(
                () =>
                  promotion(420000, 'clock_timestamp()', "clock_timestamp() + interval '1 hour'"),
                /below the current list price/,
              );
              await rejects(
                () => promotion(0, 'clock_timestamp()', "clock_timestamp() + interval '1 hour'"),
                /product_promotions_price/,
              );
              await rejects(
                () =>
                  promotion(
                    300000,
                    "clock_timestamp() + interval '2 hour'",
                    "clock_timestamp() + interval '1 hour'",
                  ),
                /product_promotions_window/,
              );
              await rejects(
                () =>
                  promotion(
                    300000,
                    "clock_timestamp() - interval '2 hour'",
                    "clock_timestamp() - interval '1 hour'",
                  ),
                /cannot already be over/,
              );
              await promotion(
                330000,
                "clock_timestamp() - interval '1 minute'",
                "clock_timestamp() + interval '1 hour'",
              );
              await rejects(
                () =>
                  promotion(
                    300000,
                    "clock_timestamp() + interval '30 minute'",
                    "clock_timestamp() + interval '3 hour'",
                  ),
                /product_promotions_no_overlap|conflicting key value/,
              );
              await promotion(
                310000,
                "clock_timestamp() + interval '2 hour'",
                "clock_timestamp() + interval '3 hour'",
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
                   VALUES ('${variant}'::uuid, 3, 330000, '${actor}'::uuid)`,
                  ),
                /must stay above the price of a promotion/,
              );
              await exec(
                `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
               VALUES ('${variant}'::uuid, 3, 440000, '${actor}'::uuid)`,
              );
              const running = await one<{
                list_price_vnd: bigint;
                promo_price_vnd: bigint;
                effective_price_vnd: bigint;
              }>(
                'SELECT list_price_vnd, promo_price_vnd, effective_price_vnd FROM lucy_variant_price_at($1::uuid, clock_timestamp())',
                variant,
              );
              assert.deepEqual(running, {
                list_price_vnd: 440000n,
                promo_price_vnd: 330000n,
                effective_price_vnd: 330000n,
              });
              const later = await one<{
                effective_price_vnd: bigint;
                promo_price_vnd: bigint | null;
              }>(
                `SELECT effective_price_vnd, promo_price_vnd FROM lucy_variant_price_at($1::uuid, clock_timestamp() + interval '90 minute')`,
                variant,
              );
              assert.deepEqual(later, { effective_price_vnd: 440000n, promo_price_vnd: null });
              const scheduled = await one<{ effective_price_vnd: bigint }>(
                `SELECT effective_price_vnd FROM lucy_variant_price_at($1::uuid, clock_timestamp() + interval '150 minute')`,
                variant,
              );
              assert.equal(scheduled.effective_price_vnd, 310000n);
              // Manual early end: once, stamped with the database clock, nothing else may change.
              const promoId = (
                await one<{ id: string }>(
                  `SELECT id FROM product_promotions WHERE variant_id = '${variant}'::uuid AND promo_price_vnd = 330000`,
                )
              ).id;
              await rejects(
                () =>
                  exec(
                    `UPDATE product_promotions SET promo_price_vnd = 1 WHERE id = '${promoId}'::uuid`,
                  ),
                /only be ended early/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_promotions SET ended_early_by_user_id = '${actor}'::uuid, ended_early_at = NULL WHERE id = '${promoId}'::uuid`,
                  ),
                /only be ended early|product_promotions_ended_pair/,
              );
              await exec(
                `UPDATE product_promotions SET ended_early_by_user_id = '${actor}'::uuid, ended_early_at = now() WHERE id = '${promoId}'::uuid`,
              );
              const ended = await one<{ ended_early_at: Date; starts_at: Date }>(
                `SELECT ended_early_at, starts_at FROM product_promotions WHERE id = '${promoId}'::uuid`,
              );
              assert.ok(ended.ended_early_at.getTime() >= ended.starts_at.getTime());
              await rejects(
                () =>
                  exec(
                    `UPDATE product_promotions SET ended_early_by_user_id = '${actor}'::uuid, ended_early_at = now() WHERE id = '${promoId}'::uuid`,
                  ),
                /only be ended early, once/,
              );
              await rejects(
                () => exec(`DELETE FROM product_promotions WHERE id = '${promoId}'::uuid`),
                /ended, never deleted/,
              );
              const afterEnd = await one<{ effective_price_vnd: bigint }>(
                "SELECT effective_price_vnd FROM lucy_variant_price_at($1::uuid, clock_timestamp() + interval '1 second')",
                variant,
              );
              assert.equal(
                afterEnd.effective_price_vnd,
                440000n,
                'an ended promotion returns the list price by itself',
              );
              // The hour that was freed can take another promotion.
              await promotion(
                320000,
                "clock_timestamp() + interval '1 second'",
                "clock_timestamp() + interval '1 hour'",
              );
              // Owner fix (2026-10-07): a promotion ended by hand before it started no longer blocks lowering the list price.
              await promotion(
                400000,
                "clock_timestamp() + interval '5 hour'",
                "clock_timestamp() + interval '6 hour'",
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
                   VALUES ('${variant}'::uuid, 4, 350000, '${actor}'::uuid)`,
                  ),
                /must stay above the price of a promotion/,
              );
              await exec(
                `UPDATE product_promotions SET ended_early_by_user_id = '${actor}'::uuid, ended_early_at = now()
                 WHERE variant_id = '${variant}'::uuid AND promo_price_vnd = 400000`,
              );
              await exec(
                `INSERT INTO product_price_versions (variant_id, version_no, list_price_vnd, created_by_user_id)
               VALUES ('${variant}'::uuid, 4, 350000, '${actor}'::uuid)`,
              );
              const notApplied = await one<{ effective_price_vnd: bigint }>(
                `SELECT effective_price_vnd FROM lucy_variant_price_at($1::uuid, clock_timestamp() + interval '330 minute')`,
                variant,
              );
              assert.equal(
                notApplied.effective_price_vnd,
                350000n,
                'the ended promotion never applies',
              );
            },
          );

          // ============================================================ images and settings
          await context.test(
            'images use the media library; settings are one guarded row',
            async () => {
              const asset = await tx.mediaAsset.create({
                data: {
                  storageKey: `2026/10/${randomUUID()}.png`,
                  originalFilename: 'product.png',
                  mime: 'image/png',
                  bytes: 1000,
                  width: 800,
                  height: 600,
                  sha256: randomUUID().replaceAll('-', '').padEnd(64, '0'),
                  createdByUserId: actor,
                },
              });
              await exec(
                `INSERT INTO product_images (product_id, media_asset_id, created_by_user_id)
               VALUES ('${ids['product']}'::uuid, '${asset.id}'::uuid, '${actor}'::uuid)`,
              );
              await rejects(
                () =>
                  exec(
                    `INSERT INTO product_images (product_id, media_asset_id, created_by_user_id)
                   VALUES ('${ids['product']}'::uuid, '${asset.id}'::uuid, '${actor}'::uuid)`,
                  ),
                /product_images_product_asset_key/,
              );
              await rejects(
                () => exec(`DELETE FROM media_assets WHERE id = '${asset.id}'::uuid`),
                /product_images_media_asset_id_fkey|foreign key/,
              );
              await exec(`DELETE FROM product_images WHERE media_asset_id = '${asset.id}'::uuid`);
              await exec(`DELETE FROM media_assets WHERE id = '${asset.id}'::uuid`);

              await rejects(
                () => exec(`INSERT INTO product_settings (id) VALUES (2)`),
                /product_settings_singleton/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_settings SET expiry_warning_days = 0, row_version = row_version + 1`,
                  ),
                /product_settings_expiry/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE product_settings SET new_badge_days = 366, row_version = row_version + 1`,
                  ),
                /product_settings_new_badge/,
              );
              await rejects(
                () => exec(`UPDATE product_settings SET new_badge_days = 45`),
                /advance the row version by one/,
              );
              await exec(
                `UPDATE product_settings SET new_badge_days = 45, updated_by_user_id = '${actor}'::uuid, row_version = row_version + 1`,
              );
              assert.equal(
                (await one<{ n: number }>('SELECT new_badge_days AS n FROM product_settings')).n,
                45,
              );
            },
          );

          // ============================================================ import
          await context.test('import: jobs, preview rows, one-way lifecycle', async () => {
            const sha = 'a'.repeat(64);
            const job = (kind: string, branchSql: string, filename = 'catalog.xlsx') =>
              one<{ id: string }>(
                `INSERT INTO product_import_jobs (kind, original_filename, file_sha256, branch_id, created_by_user_id)
                 VALUES ('${kind}'::"ProductImportKind", '${filename}', '${sha}', ${branchSql}, '${actor}'::uuid) RETURNING id`,
              );
            await rejects(() => job('OPENING_STOCK', 'NULL'), /product_import_jobs_branch/);
            await rejects(() => job('CATALOG', `'${branch}'::uuid`), /product_import_jobs_branch/);
            await rejects(() => job('CATALOG', 'NULL', ' '), /product_import_jobs_filename/);
            await rejects(
              () =>
                exec(
                  `INSERT INTO product_import_jobs (kind, original_filename, file_sha256, created_by_user_id)
                   VALUES ('CATALOG', 'x.csv', 'XYZ', '${actor}'::uuid)`,
                ),
              /product_import_jobs_sha/,
            );
            const catalog = await job('CATALOG', 'NULL');
            await rejects(
              () =>
                exec(
                  `INSERT INTO product_import_jobs (kind, status, original_filename, file_sha256, created_by_user_id)
                   VALUES ('CATALOG', 'APPLIED', 'x.csv', '${sha}', '${actor}'::uuid)`,
                ),
              /starts as uploaded/,
            );
            const row = (no: number, status: string, errors: string) =>
              exec(
                `INSERT INTO product_import_rows (job_id, row_no, raw, status, action, errors)
                 VALUES ('${catalog.id}'::uuid, ${no}, '{"sku":"X"}'::jsonb, '${status}'::"ProductImportRowStatus",
                         '${status === 'VALID' ? 'CREATE' : 'NONE'}'::"ProductImportRowAction", '${errors}'::jsonb)`,
              );
            await row(1, 'VALID', '[]');
            await row(2, 'INVALID', '["duplicate SKU"]');
            await rejects(() => row(3, 'INVALID', '[]'), /product_import_rows_validity/);
            await rejects(() => row(4, 'VALID', '["x"]'), /product_import_rows_validity/);
            await rejects(() => row(1, 'VALID', '[]'), /product_import_rows_job_row_key/);
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_jobs SET row_count = 1, valid_count = 2, row_version = row_version + 1 WHERE id = '${catalog.id}'::uuid`,
                ),
              /product_import_jobs_counts/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_jobs SET status = 'APPLIED', row_version = row_version + 1 WHERE id = '${catalog.id}'::uuid`,
                ),
              /transition is not allowed/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_rows SET applied_at = now() WHERE job_id = '${catalog.id}'::uuid AND row_no = 1`,
                ),
              /valid row of a previewed job/,
            );
            await exec(
              `UPDATE product_import_jobs SET status = 'PREVIEWED', row_count = 2, valid_count = 1, invalid_count = 1, create_count = 1,
                 row_version = row_version + 1 WHERE id = '${catalog.id}'::uuid`,
            );
            assert.ok(
              (
                await one<{ previewed_at: Date | null }>(
                  `SELECT previewed_at FROM product_import_jobs WHERE id = '${catalog.id}'::uuid`,
                )
              ).previewed_at,
            );
            await rejects(() => row(5, 'VALID', '[]'), /while the job is being uploaded/);
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_rows SET applied_at = now() WHERE job_id = '${catalog.id}'::uuid AND row_no = 2`,
                ),
              /valid row of a previewed job/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_rows SET raw = '{}'::jsonb WHERE job_id = '${catalog.id}'::uuid AND row_no = 1`,
                ),
              /only be marked applied, once/,
            );
            await exec(
              `UPDATE product_import_rows SET applied_at = now() WHERE job_id = '${catalog.id}'::uuid AND row_no = 1`,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_rows SET applied_at = now() WHERE job_id = '${catalog.id}'::uuid AND row_no = 1`,
                ),
              /only be marked applied, once/,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_jobs SET status = 'APPLIED', row_version = row_version + 1 WHERE id = '${catalog.id}'::uuid`,
                ),
              /product_import_jobs_state_facts/,
            );
            await exec(
              `UPDATE product_import_jobs SET status = 'APPLIED', applied_by_user_id = '${actor}'::uuid, row_version = row_version + 1
               WHERE id = '${catalog.id}'::uuid`,
            );
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_jobs SET summary = '{}'::jsonb, row_version = row_version + 1 WHERE id = '${catalog.id}'::uuid`,
                ),
              /finished import job is immutable/,
            );
            await rejects(
              () => exec(`DELETE FROM product_import_jobs WHERE id = '${catalog.id}'::uuid`),
              /never deleted/,
            );
            await rejects(
              () => exec(`DELETE FROM product_import_rows WHERE job_id = '${catalog.id}'::uuid`),
              /never deleted/,
            );
            const failing = await job('PRICE_UPDATE', 'NULL', 'prices.csv');
            await rejects(
              () =>
                exec(
                  `UPDATE product_import_jobs SET status = 'FAILED', row_version = row_version + 1 WHERE id = '${failing.id}'::uuid`,
                ),
              /product_import_jobs_state_facts/,
            );
            await exec(
              `UPDATE product_import_jobs SET status = 'FAILED', failure_message = 'File unreadable', row_version = row_version + 1 WHERE id = '${failing.id}'::uuid`,
            );
          });

          // ============================================================ inventory
          await context.test('inventory: receipts, lots, movements, levels, counts', async () => {
            const variant = ids['variant']!;
            const supplier = await one<{ id: string }>(
              `INSERT INTO suppliers (name) VALUES ('Nhà cung cấp ${run}') RETURNING id`,
            );
            await rejects(
              () => exec(`INSERT INTO suppliers (name) VALUES ('NHÀ CUNG CẤP ${run}')`),
              /suppliers_name_key/,
            );
            await rejects(
              () => exec(`INSERT INTO suppliers (name) VALUES ('  ')`),
              /suppliers_name/,
            );

            const newReceipt = (code: string, branchId = branch) =>
              one<{ id: string }>(
                `INSERT INTO stock_receipts (code, branch_id, supplier_id, receipt_date, created_by_user_id)
                 VALUES ('${code}', '${branchId}'::uuid, '${supplier.id}'::uuid, '2027-03-01', '${actor}'::uuid) RETURNING id`,
              );
            await rejects(
              () =>
                exec(
                  `INSERT INTO stock_receipts (code, branch_id, receipt_date, status, confirmed_by_user_id, confirmed_at, created_by_user_id)
                   VALUES ('R-X-${run}', '${branch}'::uuid, '2027-03-01', 'CONFIRMED', '${actor}'::uuid, now(), '${actor}'::uuid)`,
                ),
              /starts as a draft/,
            );
            const receipt = await newReceipt(`R-${run}-1`);
            const confirm = (id: string) =>
              exec(
                `UPDATE stock_receipts SET status = 'CONFIRMED', confirmed_by_user_id = '${actor}'::uuid, row_version = row_version + 1
                 WHERE id = '${id}'::uuid`,
              );
            await rejects(() => confirm(receipt.id), /at least one line/);
            const line = (
              receiptId: string,
              no: number,
              qty: number,
              variantId = variant,
              extra = 'NULL, NULL',
            ) =>
              one<{ id: string }>(
                `INSERT INTO stock_receipt_lines (receipt_id, line_no, variant_id, quantity, unit_cost_vnd, lot_code, expiry_date)
                 VALUES ('${receiptId}'::uuid, ${no}, '${variantId}'::uuid, ${qty}, 100000, ${extra}) RETURNING id`,
              );
            await rejects(() => line(receipt.id, 1, 0), /stock_receipt_lines_quantity/);
            const line1 = await line(receipt.id, 1, 10, variant, `'LOT-A', '2027-12-31'`);
            await rejects(() => line(receipt.id, 1, 5), /stock_receipt_lines_receipt_no_key/);
            // Confirmed without its lots and movements: refused at commit.
            await rejectsAtCommit(() => confirm(receipt.id), /stock movement for every line/);

            const lot = (
              receiptLine: string | null,
              branchId = branch,
              code = 'LOT-A',
              expiry = "'2027-12-31'",
              qty = 0,
            ) =>
              one<{ id: string }>(
                `INSERT INTO inventory_lots (branch_id, variant_id, lot_code, expiry_date, unit_cost_vnd, source_receipt_line_id,
                   quantity_on_hand, created_by_user_id)
                 VALUES ('${branchId}'::uuid, '${variant}'::uuid, '${code}', ${expiry}, 100000,
                   ${receiptLine ? `'${receiptLine}'::uuid` : 'NULL'}, ${qty}, '${actor}'::uuid) RETURNING id`,
              );
            const movement = (
              lotId: string,
              branchId: string,
              kind: string,
              delta: number,
              keys: {
                receiptLine?: string;
                countLine?: string;
                job?: string;
                reason?: string;
                key?: string;
              },
            ) =>
              exec(
                `INSERT INTO stock_movements (branch_id, variant_id, lot_id, kind, quantity_delta, reason, receipt_line_id,
                   count_line_id, import_job_id, idempotency_key, actor_user_id)
                 VALUES ('${branchId}'::uuid, '${variant}'::uuid, '${lotId}'::uuid, '${kind}'::"StockMovementKind", ${delta},
                   ${keys.reason ? `'${keys.reason}'::"StockAdjustmentReason"` : 'NULL'},
                   ${keys.receiptLine ? `'${keys.receiptLine}'::uuid` : 'NULL'},
                   ${keys.countLine ? `'${keys.countLine}'::uuid` : 'NULL'},
                   ${keys.job ? `'${keys.job}'::uuid` : 'NULL'}, '${keys.key ?? randomUUID()}', '${actor}'::uuid)`,
              );
            await rejects(() => lot(null, branch, 'LOT-X', 'NULL', 5), /lot starts empty/);
            await rejects(
              () => lot(line1.id, otherBranch),
              /matches the branch and variant of its receipt line/,
            );

            // The proper flow: confirm, create the lot, write the receipt movement; the invariants hold at commit.
            await confirm(receipt.id);
            await rejects(() => line(receipt.id, 2, 1), /only while the receipt is a draft/);
            await rejects(
              () =>
                exec(
                  `UPDATE stock_receipts SET notes = 'edit', row_version = row_version + 1 WHERE id = '${receipt.id}'::uuid`,
                ),
              /immutable/,
            );
            await rejects(
              () => exec(`DELETE FROM stock_receipts WHERE id = '${receipt.id}'::uuid`),
              /never deleted/,
            );
            const lotA = await lot(line1.id);
            await rejects(
              () => movement(lotA.id, branch, 'RECEIPT', 9, { receiptLine: line1.id }),
              /matches a confirmed receipt line/,
            );
            await rejects(
              () => movement(lotA.id, otherBranch, 'RECEIPT', 10, { receiptLine: line1.id }),
              /lot of its own branch and variant|matches a confirmed receipt line/,
            );
            await movement(lotA.id, branch, 'RECEIPT', 10, {
              receiptLine: line1.id,
              key: `receipt-${run}-1`,
            });
            await settle();
            await rejects(
              () => movement(lotA.id, branch, 'RECEIPT', 10, { receiptLine: line1.id }),
              /stock_movements_receipt_line_key/,
            );
            const levelOf = async (branchId = branch) =>
              (
                await rows<{ on_hand: number; reserved: number }>(
                  `SELECT on_hand, reserved FROM stock_levels WHERE branch_id = '${branchId}'::uuid AND variant_id = '${variant}'::uuid`,
                )
              )[0];
            assert.deepEqual(await levelOf(), { on_hand: 10, reserved: 0 });
            assert.equal(
              (
                await one<{ q: number }>(
                  `SELECT quantity_on_hand AS q FROM inventory_lots WHERE id = '${lotA.id}'::uuid`,
                )
              ).q,
              10,
            );

            // Lots and levels change only through movements; nothing is edited or deleted.
            await rejects(
              () =>
                exec(
                  `UPDATE inventory_lots SET quantity_on_hand = 99 WHERE id = '${lotA.id}'::uuid`,
                ),
              /only through a stock movement/,
            );
            await rejects(
              () =>
                exec(`UPDATE inventory_lots SET lot_code = 'EDIT' WHERE id = '${lotA.id}'::uuid`),
              /immutable except its quantity/,
            );
            await rejects(
              () => exec(`DELETE FROM inventory_lots WHERE id = '${lotA.id}'::uuid`),
              /never deleted/,
            );
            await rejects(
              () =>
                exec(`UPDATE stock_levels SET on_hand = 99 WHERE branch_id = '${branch}'::uuid`),
              /only through a stock movement/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO stock_levels (branch_id, variant_id) VALUES ('${otherBranch}'::uuid, '${variant}'::uuid)`,
                ),
              /only through a stock movement/,
            );
            await rejects(
              () => exec(`DELETE FROM stock_levels WHERE branch_id = '${branch}'::uuid`),
              /never deleted/,
            );

            // Adjustments need a reason and take stock out (except a count correction); never below zero.
            await rejects(
              () => movement(lotA.id, branch, 'ADJUSTMENT', -1, {}),
              /stock_movements_kind_shape/,
            );
            await rejects(
              () => movement(lotA.id, branch, 'ADJUSTMENT', 2, { reason: 'DAMAGED' }),
              /stock_movements_kind_shape/,
            );
            await rejects(
              () => movement(lotA.id, branch, 'ADJUSTMENT', -1, { reason: 'COUNT_CORRECTION' }),
              /stock_movements_kind_shape|count correction belongs/,
            );
            await rejects(
              () => movement(lotA.id, branch, 'ADJUSTMENT', 0, { reason: 'LOSS' }),
              /stock_movements_delta/,
            );
            await movement(lotA.id, branch, 'ADJUSTMENT', -3, {
              reason: 'DAMAGED',
              key: `adj-${run}-1`,
            });
            await rejects(
              () =>
                movement(lotA.id, branch, 'ADJUSTMENT', -3, {
                  reason: 'DAMAGED',
                  key: `adj-${run}-1`,
                }),
              /stock_movements_idempotency_key/,
            );
            await rejects(
              () => movement(lotA.id, branch, 'ADJUSTMENT', -8, { reason: 'LOSS' }),
              /inventory_lots_quantity/,
            );
            await settle();
            assert.deepEqual(await levelOf(), { on_hand: 7, reserved: 0 });
            await rejects(() => exec(`UPDATE stock_movements SET note = 'edit'`), /append-only/);
            await rejects(() => exec(`DELETE FROM stock_movements`), /append-only/);

            // A second receipt and lot at the same branch; the level is the sum of both lots.
            const receipt2 = await newReceipt(`R-${run}-2`);
            const line2 = await line(receipt2.id, 1, 10, variant, `'LOT-B', NULL`);
            await confirm(receipt2.id);
            const lotB = await lot(line2.id, branch, 'LOT-B', 'NULL');
            await movement(lotB.id, branch, 'RECEIPT', 10, { receiptLine: line2.id });
            await settle();
            assert.deepEqual(await levelOf(), { on_hand: 17, reserved: 0 });
            assert.equal(await levelOf(otherBranch), undefined, 'stock is per branch (Q13)');

            // Opening stock comes from a previewed OPENING_STOCK import of the same branch.
            const sha = 'b'.repeat(64);
            const opening = await one<{ id: string }>(
              `INSERT INTO product_import_jobs (kind, original_filename, file_sha256, branch_id, created_by_user_id)
               VALUES ('OPENING_STOCK', 'opening.xlsx', '${sha}', '${otherBranch}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            const lotOpen = await lot(null, otherBranch, 'OPENING', 'NULL');
            await rejects(
              () => movement(lotOpen.id, otherBranch, 'OPENING', 5, { job: opening.id }),
              /previewed opening-stock import/,
            );
            await exec(
              `UPDATE product_import_jobs SET status = 'PREVIEWED', row_version = row_version + 1 WHERE id = '${opening.id}'::uuid`,
            );
            await rejects(
              () => movement(lotA.id, branch, 'OPENING', 5, { job: opening.id }),
              /previewed opening-stock import/,
            );
            await movement(lotOpen.id, otherBranch, 'OPENING', 5, { job: opening.id });
            await settle();
            assert.deepEqual(await levelOf(otherBranch), { on_hand: 5, reserved: 0 });
            const catalogJob = await one<{ id: string }>(
              `INSERT INTO product_import_jobs (kind, original_filename, file_sha256, created_by_user_id)
               VALUES ('CATALOG', 'c.xlsx', '${sha}', '${actor}'::uuid) RETURNING id`,
            );
            await exec(
              `UPDATE product_import_jobs SET status = 'PREVIEWED', row_version = row_version + 1 WHERE id = '${catalogJob.id}'::uuid`,
            );
            await rejects(
              () => movement(lotOpen.id, otherBranch, 'OPENING', 1, { job: catalogJob.id }),
              /previewed opening-stock import/,
            );

            // Physical count: the difference becomes a COUNT_CORRECTION, never a silent overwrite (PRD 27.6).
            const session = await one<{ id: string }>(
              `INSERT INTO stock_count_sessions (code, branch_id, created_by_user_id) VALUES ('C-${run}-1', '${branch}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            const countLine = await one<{ id: string }>(
              `INSERT INTO stock_count_lines (session_id, variant_id, counted_quantity) VALUES ('${session.id}'::uuid, '${variant}'::uuid, 15) RETURNING id`,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO stock_count_lines (session_id, variant_id, counted_quantity) VALUES ('${session.id}'::uuid, '${variant}'::uuid, 1)`,
                ),
              /stock_count_lines_session_variant_key/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO stock_count_lines (session_id, variant_id, counted_quantity) VALUES ('${session.id}'::uuid, '${ids['second']}'::uuid, -1)`,
                ),
              /stock_count_lines_counted/,
            );
            await exec(
              `UPDATE stock_count_lines SET counted_quantity = 15 WHERE id = '${countLine.id}'::uuid`,
            );
            const approve = () =>
              exec(
                `UPDATE stock_count_sessions SET status = 'APPROVED', approved_by_user_id = '${actor}'::uuid, row_version = row_version + 1
                 WHERE id = '${session.id}'::uuid`,
              );
            // Approving without stamping and correcting the lines is refused at commit.
            const stamp = () =>
              exec(
                `UPDATE stock_count_lines SET system_quantity = 17, difference = -2 WHERE id = '${countLine.id}'::uuid`,
              );
            await rejectsAtCommit(approve, /approved count has every line stamped/);
            // Stamped but the difference is not carried out by a movement: also refused at commit.
            await rejectsAtCommit(async () => {
              await approve();
              await stamp();
            }, /differences carried out/);
            await approve();
            await stamp();
            await rejects(
              () =>
                exec(
                  `UPDATE stock_count_lines SET counted_quantity = 1 WHERE id = '${countLine.id}'::uuid`,
                ),
              /stamped count line is immutable/,
            );
            await movement(lotA.id, branch, 'ADJUSTMENT', -2, {
              reason: 'COUNT_CORRECTION',
              countLine: countLine.id,
              key: `count-${run}-1`,
            });
            await settle();
            assert.deepEqual(await levelOf(), { on_hand: 15, reserved: 0 });
            await rejects(
              () =>
                exec(
                  `UPDATE stock_count_sessions SET notes = 'x', row_version = row_version + 1 WHERE id = '${session.id}'::uuid`,
                ),
              /finished stock count is immutable/,
            );
            await rejects(
              () => exec(`DELETE FROM stock_count_lines WHERE id = '${countLine.id}'::uuid`),
              /only from an open count/,
            );
            await rejects(
              () => exec(`DELETE FROM stock_count_sessions WHERE id = '${session.id}'::uuid`),
              /never deleted/,
            );
            // A correction must belong to a count of the same branch.
            const otherSession = await one<{ id: string }>(
              `INSERT INTO stock_count_sessions (code, branch_id, created_by_user_id) VALUES ('C-${run}-2', '${otherBranch}'::uuid, '${actor}'::uuid) RETURNING id`,
            );
            const otherLine = await one<{ id: string }>(
              `INSERT INTO stock_count_lines (session_id, variant_id, counted_quantity) VALUES ('${otherSession.id}'::uuid, '${variant}'::uuid, 1) RETURNING id`,
            );
            await rejects(
              () =>
                movement(lotA.id, branch, 'ADJUSTMENT', -1, {
                  reason: 'COUNT_CORRECTION',
                  countLine: otherLine.id,
                }),
              /count correction belongs to a count line of the same branch/,
            );
            // Cancelled counts and receipts keep their facts.
            await exec(
              `UPDATE stock_count_sessions SET status = 'CANCELLED', cancelled_by_user_id = '${actor}'::uuid, row_version = row_version + 1 WHERE id = '${otherSession.id}'::uuid`,
            );
            const draft = await newReceipt(`R-${run}-3`);
            await rejects(
              () =>
                exec(
                  `UPDATE stock_receipts SET status = 'CANCELLED', cancelled_by_user_id = '${actor}'::uuid, row_version = row_version + 1 WHERE id = '${draft.id}'::uuid`,
                ),
              /stock_receipts_state_facts/,
            );
            await exec(
              `UPDATE stock_receipts SET status = 'CANCELLED', cancelled_by_user_id = '${actor}'::uuid, cancel_reason = 'Nhập nhầm', row_version = row_version + 1 WHERE id = '${draft.id}'::uuid`,
            );
            await rejects(() => confirm(draft.id), /immutable/);
          });
          // Nothing is committed: every fixture above rolls back with this error.
          throw rollback;
        },
        { timeout: 120_000, maxWait: 20_000 },
      ),
      rollback,
    );
  } finally {
    await database.$disconnect();
  }
});

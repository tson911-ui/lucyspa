import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient, PERMISSION_CATALOG, syncPermissionCatalog } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

/**
 * Claude integration Wave A (CI-X1) database foundation: the two permissions (global, standard, granted to nobody), the settings row (one,
 * everything off, "chính hãng" off, never deleted), the append-only ledger, the draft history rules, one open draft per product, the content
 * origin of a product and the text lock against imports (with the explicit override). All fixtures roll back.
 */
test('Claude integration Wave A permissions, tables and guards (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Claude foundation rollback');
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
            } catch (error) {
              await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
              assert.match(String((error as Error).message), pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };
          const rows = <T>(sql: string, ...params: unknown[]) =>
            tx.$queryRawUnsafe<T[]>(sql, ...params);
          const exec = (sql: string, ...params: unknown[]) => tx.$executeRawUnsafe(sql, ...params);
          await syncPermissionCatalog(tx);

          const owner =
            (await tx.user.findFirst({ where: { kind: 'OWNER' }, select: { id: true } })) ??
            (await tx.user.create({
              data: {
                kind: 'OWNER',
                status: 'ACTIVE',
                fullName: 'Chủ spa fixture',
                preferredLocale: 'vi',
                emailCanonical: `claude-owner-${Date.now()}@example.com`,
                emailDelivery: `claude-owner-${Date.now()}@example.com`,
                normalizationVersion: 1,
                passwordHash: '$argon2id$fixture',
              },
              select: { id: true },
            }));

          await context.test(
            'the two permissions are global and standard, granted to nobody',
            async () => {
              for (const code of ['MANAGE_AI_SETTINGS', 'USE_AI_CONTENT']) {
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
                const stored = await tx.permission.findFirstOrThrow({
                  where: { code: code as never },
                  select: { scopeCapability: true, dataClassification: true, id: true },
                });
                assert.equal(stored.scopeCapability, 'GLOBAL_ONLY', code);
                assert.equal(stored.dataClassification, 'STANDARD', code);
                const granted = await rows<{ n: number }>(
                  `SELECT count(*)::int AS n FROM role_permissions WHERE permission_id = $1::uuid`,
                  stored.id,
                );
                assert.equal(granted[0]!.n, 0, `${code} is granted to nobody`);
              }
              // The catalog semantics refuse another scope for them.
              await rejects(
                () =>
                  exec(
                    `UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'USE_AI_CONTENT'`,
                  ),
                /code-owned and immutable|permissions_catalog_semantics/,
              );
            },
          );

          await context.test(
            'the settings row: one, everything off, "chính hãng" off, never deleted',
            async () => {
              const settings = await rows<Record<string, unknown>>(`SELECT * FROM ai_settings`);
              assert.equal(settings.length, 1);
              const row = settings[0]!;
              assert.equal(row['id'], 1);
              assert.equal(row['enabled'], false);
              assert.equal(row['rewrite_enabled'], false);
              assert.equal(row['allow_authenticity_claims'], false);
              assert.equal(row['rewrite_model'], 'claude-opus-5-5');
              assert.equal(
                row['vnd_per_usd'],
                null,
                'the rate is typed by the Owner, never guessed',
              );
              assert.equal(Number(row['monthly_cap_vnd']), 3_000_000);
              assert.equal(row['run_all_unlocked_at'], null);
              await rejects(() => exec(`DELETE FROM ai_settings`), /never deleted/);
              await rejects(
                () => exec(`INSERT INTO ai_settings (id) VALUES (2)`),
                /ai_settings_single|duplicate|violates check/,
              );
              // Checks: model allow-list, effort, concurrency, rate range, the unlock pair; every update moves the version by one.
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_settings SET rewrite_model = 'gpt-4', row_version = row_version + 1`,
                  ),
                /ai_settings_model/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_settings SET rewrite_effort = 'extreme', row_version = row_version + 1`,
                  ),
                /ai_settings_effort/,
              );
              await rejects(
                () => exec(`UPDATE ai_settings SET concurrency = 9, row_version = row_version + 1`),
                /ai_settings_concurrency/,
              );
              await rejects(
                () => exec(`UPDATE ai_settings SET vnd_per_usd = 5, row_version = row_version + 1`),
                /ai_settings_rate/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_settings SET run_all_unlocked_at = now(), row_version = row_version + 1`,
                  ),
                /ai_settings_unlock_pair/,
              );
              await rejects(
                () => exec(`UPDATE ai_settings SET enabled = true`),
                /advance the row version/,
              );
              await exec(
                `UPDATE ai_settings SET vnd_per_usd = 26000, row_version = row_version + 1`,
              );
              assert.equal(
                (await rows<{ v: number }>(`SELECT vnd_per_usd AS v FROM ai_settings`))[0]!.v,
                26000,
              );
            },
          );

          await context.test('the ledger is append-only and checked', async () => {
            await exec(
              `INSERT INTO ai_usage_ledger (feature, model, outcome, input_tokens, output_tokens, cost_micro_usd)
               VALUES ('PRODUCT_REWRITE', 'claude-opus-5-5', 'SUCCEEDED', 1200, 5000, 104800)`,
            );
            const [entry] = await rows<{ id: string }>(`SELECT id FROM ai_usage_ledger LIMIT 1`);
            await rejects(
              () => exec(`UPDATE ai_usage_ledger SET cost_micro_usd = 1 WHERE id = '${entry!.id}'`),
              /append-only/,
            );
            await rejects(
              () => exec(`DELETE FROM ai_usage_ledger WHERE id = '${entry!.id}'`),
              /append-only/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO ai_usage_ledger (feature, model, outcome) VALUES ('WHATEVER', 'x', 'SUCCEEDED')`,
                ),
              /ai_usage_ledger_feature/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO ai_usage_ledger (feature, model, outcome) VALUES ('PRODUCT_REWRITE', 'x', 'MAYBE')`,
                ),
              /ai_usage_ledger_outcome/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO ai_usage_ledger (feature, model, outcome, cost_micro_usd) VALUES ('PRODUCT_REWRITE', 'x', 'FAILED', -1)`,
                ),
              /ai_usage_ledger_counts/,
            );
            await rejects(
              () =>
                exec(
                  `INSERT INTO ai_reservations (feature, amount_micro_usd, expires_at) VALUES ('PRODUCT_REWRITE', 0, now() + interval '1 minute')`,
                ),
              /ai_reservations_amount/,
            );
          });

          await context.test(
            'drafts: one open draft per product, history is never reopened or deleted',
            async () => {
              const product = await tx.product.create({
                data: {
                  code: `claude-f-${Date.now()}`,
                  nameVi: 'Kem thử',
                  nameEn: 'Test cream',
                  createdByUserId: owner.id,
                },
                select: { id: true, rowVersion: true },
              });
              const [run] = await rows<{ id: string }>(
                `INSERT INTO ai_runs (kind, scope, model, effort, prompt_version, started_by_user_id)
               VALUES ('PRODUCT_TEXT', 'FIRST_THREE', 'claude-opus-5-5', 'medium', 'product-rewrite.v1', $1::uuid) RETURNING id`,
                owner.id,
              );
              const item = async (status = 'QUEUED') =>
                rows<{ id: string }>(
                  `INSERT INTO ai_items (run_id, kind, target_type, target_id, status, base_row_version)
                 VALUES ($1::uuid, 'PRODUCT_TEXT', 'PRODUCT', $2::uuid, $3, $4) RETURNING id`,
                  run!.id,
                  product.id,
                  status,
                  product.rowVersion,
                );
              const [first] = await item();
              await rejects(() => item(), /ai_items_open_target_key|duplicate key/);
              await exec(
                `UPDATE ai_items SET status = 'DRAFT_READY', row_version = row_version + 1 WHERE id = '${first!.id}'`,
              );
              // Applied needs its pair; then it is history.
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_items SET status = 'APPLIED', row_version = row_version + 1 WHERE id = '${first!.id}'`,
                  ),
                /ai_items_applied_status|applied/,
              );
              await exec(
                `UPDATE ai_items SET status = 'APPLIED', applied_at = now(), applied_by_user_id = '${owner.id}', row_version = row_version + 1 WHERE id = '${first!.id}'`,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_items SET status = 'DRAFT_READY', row_version = row_version + 1 WHERE id = '${first!.id}'`,
                  ),
                /never reopened|ai_items_applied_status/,
              );
              await rejects(
                () => exec(`DELETE FROM ai_items WHERE id = '${first!.id}'`),
                /never deleted/,
              );
              // After the first draft is applied, the product may have a new one.
              await item();
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_items SET regenerations = 4, row_version = row_version + 1 WHERE target_id = '${product.id}' AND status = 'QUEUED'`,
                  ),
                /ai_items_counts/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE ai_runs SET scope = 'EVERYTHING', row_version = row_version + 1 WHERE id = '${run!.id}'`,
                  ),
                /ai_runs_scope/,
              );
            },
          );

          await context.test(
            'product text: origin, SEO fields and the lock against imports',
            async () => {
              const make = async (nameVi: string) =>
                tx.product.create({
                  data: {
                    code: `claude-t-${Date.now()}-${nameVi.length}`,
                    nameVi,
                    nameEn: nameVi,
                    descriptionVi: 'Mô tả cũ',
                    createdByUserId: owner.id,
                  },
                  select: { id: true, contentOrigin: true, rowVersion: true },
                });
              const product = await make('Kem một');
              assert.equal(
                product.contentOrigin,
                'LUCY_MANUAL',
                'a product made by hand is Lucy-owned',
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE products SET content_origin = 'ROBOT', row_version = row_version + 1 WHERE id = '${product.id}'`,
                  ),
                /products_content_origin/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE products SET seo_title_vi = '', row_version = row_version + 1 WHERE id = '${product.id}'`,
                  ),
                /products_seo_text/,
              );
              await rejects(
                () =>
                  exec(
                    `UPDATE products SET description_sections_vi = '[]'::jsonb, row_version = row_version + 1 WHERE id = '${product.id}'`,
                  ),
                /products_sections_json/,
              );
              // A person's edit (no import declared) goes through and the SEO columns accept text.
              await exec(
                `UPDATE products SET description_vi = 'Mô tả mới', seo_title_vi = 'Kem một | Lucy Spa', description_sections_vi = '{"benefits":"Dưỡng ẩm"}'::jsonb, row_version = row_version + 1 WHERE id = '${product.id}'`,
              );
              // An import that declares itself is stopped for a Lucy-owned product, in a transaction-local setting.
              for (const source of ['SUPPLIER_IMPORT', 'FILE_IMPORT']) {
                await exec(`SET LOCAL lucy.text_change_source = '${source}'`);
                await rejects(
                  () =>
                    exec(
                      `UPDATE products SET description_vi = 'Bị ghi đè', row_version = row_version + 1 WHERE id = '${product.id}'`,
                    ),
                  /not overwritten by an import/,
                );
                await rejects(
                  () =>
                    exec(
                      `UPDATE products SET name_en = 'Overwritten', row_version = row_version + 1 WHERE id = '${product.id}'`,
                    ),
                  /not overwritten by an import/,
                );
                // Fields that are not text stay editable by an import.
                await exec(
                  `UPDATE products SET featured = true, row_version = row_version + 1 WHERE id = '${product.id}'`,
                );
                await exec(
                  `UPDATE products SET featured = false, row_version = row_version + 1 WHERE id = '${product.id}'`,
                );
                // The explicit tick with a reason lifts the lock for that transaction.
                await exec(`SET LOCAL lucy.text_lock_override = 'on'`);
                await exec(
                  `UPDATE products SET description_vi = 'Ghi đè có chủ ý', row_version = row_version + 1 WHERE id = '${product.id}'`,
                );
                await exec(`SET LOCAL lucy.text_lock_override = ''`);
                await rejects(
                  () =>
                    exec(
                      `UPDATE products SET description_vi = 'Lại bị chặn', row_version = row_version + 1 WHERE id = '${product.id}'`,
                    ),
                  /not overwritten by an import/,
                );
                await exec(`SET LOCAL lucy.text_change_source = ''`);
                await exec(
                  `UPDATE products SET description_vi = 'Mô tả mới', row_version = row_version + 1 WHERE id = '${product.id}'`,
                );
              }
              // The supplier's copy is not locked (the importers never update existing text; this proves the guard only protects Lucy text).
              const copy = await make('Kem hai');
              await exec(
                `UPDATE products SET content_origin = 'SUPPLIER_COPY', row_version = row_version + 1 WHERE id = '${copy.id}'`,
              );
              await exec(`SET LOCAL lucy.text_change_source = 'SUPPLIER_IMPORT'`);
              await exec(
                `UPDATE products SET description_vi = 'Bản của nhà cung cấp mới', row_version = row_version + 1 WHERE id = '${copy.id}'`,
              );
              await exec(`SET LOCAL lucy.text_change_source = ''`);
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

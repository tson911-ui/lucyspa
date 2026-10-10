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

const PHASE9_CODES = ['MANAGE_SUPPLIER_SOURCES', 'REVIEW_SUPPLIER_IMPORTS'] as const;
const PHASE9_TABLES = [
  'supplier_sources',
  'import_scans',
  'source_records',
  'source_price_observations',
  'import_candidates',
  'candidate_sources',
  'candidate_images',
  'source_value_mappings',
] as const;

/**
 * Phase 9 P9-2 database foundation (design PHASE9_PRODUCT_IMPORT.md; P9-T8): the two permissions are in the catalog with the right
 * semantics and are granted to nobody, and the eight tables exist empty. The table rules themselves are exercised through the API
 * (apps/api supplier-source.integration.test). All fixtures roll back.
 */
test('Phase 9 P9-2 permissions and tables (all fixtures roll back)', async (context) => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional Phase 9 foundation rollback');
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

          await context.test(
            'the catalog has 68 codes and the two new ones are global and standard',
            async () => {
              const labels = (
                await rows<{ labels: string[] }>(
                  `SELECT enum_range(NULL::"PermissionCode")::text[] AS labels`,
                )
              )[0]?.labels;
              for (const code of PHASE9_CODES) {
                assert.ok(labels?.includes(code), code);
                assert.ok(
                  PERMISSION_CATALOG.some((entry) => entry.code === code),
                  code,
                );
              }
              assert.equal(PERMISSION_CATALOG.length, 68);
              await syncPermissionCatalog(tx);
              const stored = await tx.permission.findMany({
                where: { code: { in: [...PHASE9_CODES] } },
                select: { code: true, scopeCapability: true, dataClassification: true },
              });
              assert.equal(stored.length, 2);
              for (const row of stored) {
                assert.equal(row.scopeCapability, 'GLOBAL_ONLY', row.code);
                assert.equal(row.dataClassification, 'STANDARD', row.code);
              }
              assert.equal(await tx.permission.count(), 68);
            },
          );

          await context.test(
            'the catalog semantics refuse a branch scope or another class for them',
            async () => {
              for (const [code, scope, classification] of [
                ['MANAGE_SUPPLIER_SOURCES', 'BRANCH_CAPABLE', 'STANDARD'],
                ['REVIEW_SUPPLIER_IMPORTS', 'BRANCH_CAPABLE', 'STANDARD'],
                ['MANAGE_SUPPLIER_SOURCES', 'GLOBAL_ONLY', 'FINANCIAL'],
                ['REVIEW_SUPPLIER_IMPORTS', 'GLOBAL_ONLY', 'EMPLOYEE_PAY'],
              ] as const) {
                await rejects(
                  () =>
                    tx.$executeRawUnsafe(
                      `INSERT INTO permissions (id, code, scope_capability, data_classification)
                     VALUES (gen_random_uuid(), '${code}'::"PermissionCode", '${scope}'::"ScopeCapability", '${classification}'::"DataClassification")`,
                    ),
                  /permissions_catalog_semantics/,
                );
              }
              // The earlier semantics are unchanged by the rewritten constraint.
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE permissions SET scope_capability = 'BRANCH_CAPABLE' WHERE code = 'MANAGE_PRODUCTS'::"PermissionCode"`,
                  ),
                /code-owned and immutable/,
              );
              await rejects(
                () =>
                  tx.$executeRawUnsafe(
                    `UPDATE permissions SET data_classification = 'STANDARD' WHERE code = 'MANAGE_PRODUCT_PRICES'::"PermissionCode"`,
                  ),
                /code-owned and immutable/,
              );
            },
          );

          await context.test(
            'nobody holds them: no role, override or owner path carries the new codes',
            async () => {
              const granted = await rows<{ count: bigint }>(
                `SELECT count(*) FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                WHERE p.code IN ('MANAGE_SUPPLIER_SOURCES'::"PermissionCode", 'REVIEW_SUPPLIER_IMPORTS'::"PermissionCode")`,
              );
              assert.equal(granted[0]?.count, 0n);
              const overrides = await rows<{ count: bigint }>(
                `SELECT count(*) FROM user_permission_overrides po JOIN permissions p ON p.id = po.permission_id
                WHERE p.code IN ('MANAGE_SUPPLIER_SOURCES'::"PermissionCode", 'REVIEW_SUPPLIER_IMPORTS'::"PermissionCode")`,
              );
              assert.equal(overrides[0]?.count, 0n);
            },
          );

          await context.test('the eight tables exist and start empty', async () => {
            for (const table of PHASE9_TABLES) {
              const found = await rows<{ count: bigint }>(
                `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = '${table}'`,
              );
              assert.equal(found[0]?.count, 1n, table);
              const content = await rows<{ count: bigint }>(`SELECT count(*) FROM "${table}"`);
              assert.equal(content[0]?.count, 0n, `${table} starts empty`);
            }
          });

          throw rollback;
        },
        { timeout: 60_000 },
      ),
      (error) => error === rollback,
    );
  } finally {
    await database.$disconnect();
  }
});

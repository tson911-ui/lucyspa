import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabaseClient } from './index.js';

const environmentPath = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(environmentPath)) loadEnvFile(environmentPath);
const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) throw new Error('DATABASE_URL is required for database integration tests.');

// UX/UI Step 11: the website permission semantics and the media library tables (all fixtures roll back).
test('website media foundation: GLOBAL_ONLY permission, constrained assets, cascading variants', async () => {
  const database = createDatabaseClient(databaseUrl);
  const rollback = new Error('Intentional website media rollback');
  const run = randomUUID().replaceAll('-', '').slice(0, 8).toLowerCase();
  const hex = (seed: string) => seed.repeat(64).slice(0, 64);
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
              assert.match(`${String((error as Error).message)}`, pattern);
              return;
            }
            await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
            assert.fail(`Expected rejection matching ${String(pattern)}`);
          };

          // The catalog rule: the new code is GLOBAL_ONLY and STANDARD, nothing else is accepted.
          const insertPermission = (scope: string, classification: string) =>
            tx.$executeRawUnsafe(
              `INSERT INTO permissions (id, code, scope_capability, data_classification)
               VALUES (gen_random_uuid(), 'MANAGE_WEBSITE_CONTENT'::"PermissionCode", '${scope}'::"ScopeCapability", '${classification}'::"DataClassification")`,
            );
          await tx.permission.deleteMany({ where: { code: 'MANAGE_WEBSITE_CONTENT' } });
          await rejects(
            () => insertPermission('BRANCH_CAPABLE', 'STANDARD'),
            /permissions_catalog_semantics/,
          );
          await rejects(
            () => insertPermission('GLOBAL_ONLY', 'FINANCIAL'),
            /permissions_catalog_semantics/,
          );
          await insertPermission('GLOBAL_ONLY', 'STANDARD');
          // Other codes keep their semantics: a branch-capable code still cannot be GLOBAL_ONLY.
          await rejects(
            () =>
              tx.$executeRawUnsafe(
                `INSERT INTO permissions (id, code, scope_capability, data_classification)
                 VALUES (gen_random_uuid(), 'MANAGE_BOOKINGS', 'GLOBAL_ONLY', 'STANDARD')`,
              ),
            /permissions_catalog_semantics|permissions_code_key|duplicate key/,
          );

          const user = await tx.user.create({
            data: {
              kind: 'EMPLOYEE',
              status: 'ACTIVE',
              fullName: 'Media fixture',
              preferredLocale: 'vi',
              emailCanonical: `wm-${run}@example.com`,
              emailDelivery: `wm-${run}@example.com`,
              normalizationVersion: 1,
              passwordHash: '$argon2id$fixture',
              phoneCanonical: `+84918${String(Math.floor(Math.random() * 1_000_000)).padStart(6, '0')}`,
              employeeProfile: {
                create: {
                  employeeCodeCanonical: `WM-${run}`.toUpperCase(),
                  dateOfBirth: new Date('1990-01-01'),
                  address: 'Fixture',
                },
              },
            },
          });
          const asset = (change: Record<string, unknown> = {}) => ({
            storageKey: `2026/10/${randomUUID()}.png`,
            originalFilename: 'hero.png',
            mime: 'image/png',
            bytes: 1_000,
            width: 800,
            height: 600,
            sha256: hex(randomUUID().replaceAll('-', '')),
            createdByUserId: user.id,
            ...change,
          });

          const created = await tx.mediaAsset.create({
            data: {
              ...asset(),
              variants: {
                create: (['THUMB', 'MD', 'LG'] as const).map((kind, index) => ({
                  kind,
                  storageKey: `2026/10/${randomUUID()}-${kind.toLowerCase()}.webp`,
                  width: 320 * (index + 1),
                  height: 240 * (index + 1),
                  bytes: 100,
                })),
              },
            },
            include: { variants: true },
          });
          assert.equal(created.rowVersion, 1);
          assert.equal(created.altVi, null);
          assert.equal(created.variants.length, 3);

          // Row rules: type, size, dimensions, hash shape and text bounds are enforced by the database.
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ mime: 'image/svg+xml' }) }),
            /media_assets_mime/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ mime: 'image/gif' }) }),
            /media_assets_mime/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ bytes: 10_485_761 }) }),
            /media_assets_bytes/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ bytes: 0 }) }),
            /media_assets_bytes/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ width: 6001 }) }),
            /media_assets_dimensions/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ height: 0 }) }),
            /media_assets_dimensions/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ sha256: 'ABC' }) }),
            /media_assets_sha256/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ sha256: hex('G') }) }),
            /media_assets_sha256/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ altVi: '' }) }),
            /media_assets_texts/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ altEn: 'x'.repeat(301) }) }),
            /media_assets_texts/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ originalFilename: '' }) }),
            /media_assets_texts/,
          );
          // Identical bytes are one asset; keys are unique.
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ sha256: created.sha256 }) }),
            /media_assets_sha256_key|Unique constraint/,
          );
          await rejects(
            () => tx.mediaAsset.create({ data: asset({ storageKey: created.storageKey }) }),
            /media_assets_storage_key_key|Unique constraint/,
          );

          // A variant kind appears once per asset and is bounded.
          await rejects(
            () =>
              tx.mediaVariant.create({
                data: {
                  assetId: created.id,
                  kind: 'MD',
                  storageKey: `2026/10/${randomUUID()}.webp`,
                  width: 1,
                  height: 1,
                  bytes: 1,
                },
              }),
            /media_variants_pkey|Unique constraint/,
          );
          await rejects(
            () =>
              tx.mediaVariant.create({
                data: {
                  assetId: randomUUID(),
                  kind: 'THUMB',
                  storageKey: `2026/10/${randomUUID()}.webp`,
                  width: 1,
                  height: 1,
                  bytes: 1,
                },
              }),
            /foreign key|media_variants_asset_id_fkey/i,
          );

          // The creator is never deleted from under an asset; deleting an asset removes its renditions.
          // (Users are never deleted at all; the refusal's wording is not this test's concern.)
          await rejects(() => tx.user.delete({ where: { id: user.id } }), /[\s\S]*/);
          assert.equal(await tx.mediaAsset.count({ where: { id: created.id } }), 1);
          await tx.mediaAsset.delete({ where: { id: created.id } });
          assert.equal(await tx.mediaVariant.count({ where: { assetId: created.id } }), 0);

          await tx.$executeRaw`SET CONSTRAINTS ALL IMMEDIATE`;
          throw rollback;
        },
        { timeout: 60_000 },
      ),
      (error: unknown) => error === rollback,
    );
  } finally {
    await database.$disconnect();
  }
});

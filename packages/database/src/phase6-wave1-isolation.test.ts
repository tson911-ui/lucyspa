import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Owner decision P6-Q17 (2026-10-07): Wave 1 of Phase 6 must not touch the payment/POS flow. The P6-2 migrations are the
 * database part of Wave 1, so this guard reads them and fails if any of them alters, creates a trigger on, writes to or references
 * a table of invoices, discounts, payments, loyalty, combos, rewards, visits or bookings. Only brand-new Phase 6 tables, the
 * `permissions` catalog constraint and the `PermissionCode` enum may be changed. It needs no database.
 */
const migrations = new URL('../prisma/migrations/', import.meta.url);
const WAVE1 = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^20261106\d{6}_phase6_/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

const NEW_TABLES = new Set([
  'brands',
  'product_categories',
  'products',
  'product_variants',
  'product_price_versions',
  'product_promotions',
  'product_images',
  'product_settings',
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
]);
// Existing tables a new foreign key may point at (identity, branches, media library, the catalog of permissions).
const REFERENCEABLE = new Set(['users', 'branches', 'media_assets', 'permissions']);
const PROTECTED_SOURCE =
  'invoices?(_\\w+)?|discounts?(_\\w+)?|vouchers?(_\\w+)?|payments?(_\\w+)?|payos_\\w+|loyalty_\\w+|referrals?(_\\w+)?|birthday_\\w+|combos?(_\\w+)?|reward_\\w+|visits?(_\\w+)?|bookings?(_\\w+)?|service_executions|outbox_\\w+|notifications?';
const PROTECTED = new RegExp(`\\b(${PROTECTED_SOURCE})\\b`);
const PROTECTED_EXACT = new RegExp(`^(${PROTECTED_SOURCE})$`);

const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

test('Wave 1 has its seven migrations', () => {
  assert.equal(WAVE1.length, 7, WAVE1.join(', '));
});

test('Wave 1 migrations touch no POS, invoice, discount, payment, loyalty or booking table', () => {
  for (const name of WAVE1) {
    const text = sql(name);
    const quoted = [...text.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]!);
    for (const word of quoted) {
      // No quoted identifier (table, column, constraint, index) names a protected table: a stray reference would show here.
      assert.ok(!PROTECTED_EXACT.test(word), `${name}: unexpected identifier ${word}`);
    }
    for (const match of text.matchAll(
      /(?:ALTER TABLE|INSERT INTO|UPDATE|DELETE FROM|DROP TABLE|TRUNCATE(?: TABLE)?)\s+"([a-z_]+)"/g,
    )) {
      const table = match[1]!;
      assert.ok(NEW_TABLES.has(table) || table === 'permissions', `${name}: statement on ${table}`);
    }
    for (const match of text.matchAll(
      /CREATE (?:CONSTRAINT )?TRIGGER\s+\w+\s+(?:BEFORE|AFTER)[^;]*?\sON\s+"([a-z_]+)"/g,
    )) {
      assert.ok(NEW_TABLES.has(match[1]!), `${name}: trigger on ${match[1]}`);
    }
    for (const match of text.matchAll(/REFERENCES\s+"([a-z_]+)"/g)) {
      const table = match[1]!;
      assert.ok(
        NEW_TABLES.has(table) || REFERENCEABLE.has(table),
        `${name}: foreign key to ${table}`,
      );
      assert.ok(!PROTECTED.test(table), `${name}: foreign key to a protected table ${table}`);
    }
    for (const match of text.matchAll(/ALTER TYPE\s+"([A-Za-z]+)"/g)) {
      assert.equal(match[1], 'PermissionCode', `${name}: enum ${match[1]} changed`);
    }
    // Functions and bodies never read or write a protected table either.
    for (const match of text.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)\b/g)) {
      assert.ok(!PROTECTED.test(match[1]!), `${name}: a function reads or writes ${match[1]}`);
    }
  }
});

test('the only row Wave 1 inserts is the settings row with the Owner-approved defaults', () => {
  const inserts = WAVE1.flatMap((name) =>
    [...sql(name).matchAll(/^INSERT INTO\s+"([a-z_]+)"[^;]*;/gm)].map(
      (match) => `${name}:${match[1]}`,
    ),
  );
  assert.deepEqual(inserts, ['20261106000002_phase6_catalog_foundation:product_settings']);
});

test('Wave 1 migrations are additive: no drop of an existing table, column or type', () => {
  for (const name of WAVE1) {
    const text = sql(name);
    const drops = [
      ...text.matchAll(/\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|TRIGGER|FUNCTION)\b[^;]*/gi),
    ].map((match) => match[0]);
    // The one allowed drop replaces the semantics constraint of the permission catalog (as every permission migration does).
    for (const drop of drops) {
      assert.match(drop, /CONSTRAINT|permissions/i, `${name}: ${drop}`);
    }
    for (const match of text.matchAll(
      /ALTER TABLE\s+"permissions"\s+DROP CONSTRAINT\s+"([a-z_]+)"/g,
    )) {
      assert.equal(match[1], 'permissions_catalog_semantics');
    }
  }
});

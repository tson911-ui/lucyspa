import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Wave 2 of Phase 6 (P6-8) changes the live POS tables, so this guard pins EXACTLY what the migrations may touch (Owner rule,
 * 2026-10-07: service-only invoices behave as today). It reads the Wave 2 migrations and fails if one of them drops or rewrites an
 * existing table, column, type or row, alters a payment, discount, loyalty, combo, reward, birthday, booking or outbox table, or
 * replaces a function beyond the pinned list. It needs no database.
 */
const migrations = new URL('../prisma/migrations/', import.meta.url);
const WAVE2 = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^20261107\d{6}_phase6_wave2_/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const NEW_TABLES = new Set(['invoice_line_products', 'stock_reservations']);
// The only existing tables a statement of Wave 2 may alter or attach a trigger to.
const EXISTING_ALTERED = new Set(['invoices', 'invoice_lines']);
// Existing tables a new foreign key may point at (the invoice, the catalog, people, stock).
const REFERENCEABLE = new Set([
  'invoice_lines',
  'products',
  'product_variants',
  'brands',
  'product_categories',
  'product_promotions',
  'users',
  'stock_levels',
]);
const REPLACED_FUNCTIONS = new Set([
  'lucy_guard_stock_level',
  'lucy_guard_invoice',
  'lucy_guard_invoice_line',
  'lucy_check_invoice_integrity',
]);
const CREATED_FUNCTIONS = new Set([
  'lucy_guard_invoice_line_product',
  'lucy_guard_draft_product_delete',
  'lucy_guard_stock_reservation',
  'lucy_apply_stock_reservation',
  'lucy_check_stock_reservations',
]);

test('Wave 2 has its two migrations: the enum values alone, then everything that uses them', () => {
  assert.deepEqual(WAVE2, [
    '20261107000000_phase6_wave2_invoice_kinds',
    '20261107000001_phase6_wave2_product_sales',
  ]);
  const first = sql(WAVE2[0]!)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.deepEqual(first, [
    `ALTER TYPE "InvoiceKind" ADD VALUE 'PRODUCT_SALE'`,
    `ALTER TYPE "InvoiceLineKind" ADD VALUE 'PRODUCT'`,
  ]);
});

test('Wave 2 never drops, truncates, deletes or rewrites existing data', () => {
  const text = sql(WAVE2[1]!);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SEQUENCE|SCHEMA)\b/i);
  assert.doesNotMatch(text, /\b(?<!BEFORE\s)TRUNCATE\b/i);
  assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(text, /\bALTER\s+COLUMN\b/i);
  assert.doesNotMatch(text, /\bRENAME\b/i);
  // No row is written: no INSERT and no UPDATE of an existing table (the two UPDATEs below are inside trigger bodies).
  assert.doesNotMatch(
    text.replace(/\$\$[\s\S]*?\$\$/g, ''),
    /\b(INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET)\b/i,
  );
  // The only constraint and trigger dropped are the ones replaced in the same migration.
  const drops = [...text.matchAll(/\bDROP\s+(CONSTRAINT|TRIGGER)\s+("[^"]+")/gi)].map(
    (match) => `${match[1]!.toUpperCase()} ${match[2]}`,
  );
  assert.deepEqual(drops.sort(), [
    'CONSTRAINT "invoices_money"',
    'TRIGGER "invoice_lines_no_delete"',
  ]);
});

test('Wave 2 alters only the invoice and invoice line tables among the existing ones', () => {
  const text = sql(WAVE2[1]!);
  const altered = [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]!);
  for (const table of altered) {
    assert.ok(EXISTING_ALTERED.has(table) || NEW_TABLES.has(table), `ALTER TABLE ${table}`);
  }
  const triggers = [
    ...text.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?\w+"?[\s\S]*?\bON\s+"?(\w+)"?/gi),
  ].map((match) => match[1]!);
  for (const table of triggers) {
    assert.ok(EXISTING_ALTERED.has(table) || NEW_TABLES.has(table), `TRIGGER on ${table}`);
  }
  const references = [...text.matchAll(/\bREFERENCES\s+"?(\w+)"?/gi)].map((match) => match[1]!);
  for (const table of references) {
    assert.ok(NEW_TABLES.has(table) || REFERENCEABLE.has(table), `REFERENCES ${table}`);
  }
  // Nothing of payments, discounts, vouchers, loyalty, combos, rewards, birthdays, visits, bookings or the outbox is named
  // outside a comment-free statement that is part of an integrity function body reading it.
  const outsideBodies = text.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.doesNotMatch(
    outsideBodies,
    /\b(payments?|payment_\w+|discounts?|discount_(versions|redemptions|redemption_releases)|invoice_discount_applications|vouchers?|loyalty_\w+|referrals?|birthday_\w+|combos?|combo_\w+|reward_\w+|visits?|bookings?|outbox_\w+|notifications?)\b/i,
  );
});

test('Wave 2 replaces exactly the pinned functions, hardens every function it touches and adds no permission', () => {
  const text = sql(WAVE2[1]!);
  const replaced = [...text.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map(
    (match) => match[1]!,
  );
  assert.deepEqual([...replaced].sort(), [...REPLACED_FUNCTIONS].sort());
  const created = [...text.matchAll(/CREATE FUNCTION (\w+)\(/g)].map((match) => match[1]!);
  assert.deepEqual([...created].sort(), [...CREATED_FUNCTIONS].sort());
  const hardened = [...text.matchAll(/'(lucy_\w+)'/g)].map((match) => match[1]!);
  for (const name of [...REPLACED_FUNCTIONS, ...CREATED_FUNCTIONS]) {
    assert.ok(hardened.includes(name), `${name} gets its fixed search_path`);
  }
  assert.doesNotMatch(text, /PermissionCode|permissions/i);
});

test('Wave 2 adds to the invoice header only the channel and the shipping fee, both with defaults', () => {
  const text = sql(WAVE2[1]!);
  const columns = [...text.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;]+)/g)].map(
    (match) => `${match[1]} ${match[2]!.trim()}`,
  );
  assert.deepEqual(columns, [
    `channel "InvoiceChannel" NOT NULL DEFAULT 'COUNTER'`,
    'shipping_fee_vnd BIGINT NOT NULL DEFAULT 0',
  ]);
});

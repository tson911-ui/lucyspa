import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-10 (the sale of reserved stock) touches only the stock tables: this guard pins EXACTLY what its migrations may do
 * (Owner rule, 2026-10-07: service-only invoices behave as today). It fails if one of them drops or rewrites an existing table,
 * column, type or row, alters an invoice, payment, discount, loyalty, combo, reward, birthday, booking or outbox table, or replaces a
 * function beyond the pinned list. It needs no database.
 */
const migrations = new URL('../prisma/migrations/', import.meta.url);
const WAVE2_STOCK = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^20261109\d{6}_phase6_wave2_/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const ALTERED = new Set(['stock_movements', 'stock_reservations']);
const REPLACED_FUNCTIONS = [
  'lucy_apply_stock_reservation',
  'lucy_guard_stock_movement',
  'lucy_guard_stock_reservation',
];
const CREATED_FUNCTIONS = ['lucy_check_stock_sales'];

test('the sale of reserved stock has two migrations: the enum values alone, then everything that uses them', () => {
  assert.deepEqual(WAVE2_STOCK, [
    '20261109000000_phase6_wave2_stock_sale_kinds',
    '20261109000001_phase6_wave2_stock_consumption',
  ]);
  const first = sql(WAVE2_STOCK[0]!)
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
  assert.deepEqual(first, [
    `ALTER TYPE "StockMovementKind" ADD VALUE 'SALE'`,
    `ALTER TYPE "StockMovementKind" ADD VALUE 'SALE_REVERSAL'`,
  ]);
});

test('it never drops, truncates, deletes or rewrites existing data', () => {
  const text = sql(WAVE2_STOCK[1]!);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SEQUENCE|SCHEMA|TRIGGER)\b/i);
  assert.doesNotMatch(text, /\b(?<!BEFORE\s)TRUNCATE\b/i);
  assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(text, /\bALTER\s+COLUMN\b/i);
  assert.doesNotMatch(text, /\bRENAME\b/i);
  assert.doesNotMatch(
    text.replace(/\$\$[\s\S]*?\$\$/g, ''),
    /\b(INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET)\b/i,
  );
  // The only constraints dropped are the two CHECKs replaced in the same migration, each added back at once.
  const drops = [...text.matchAll(/\bDROP\s+CONSTRAINT\s+("[^"]+")/gi)].map((match) => match[1]);
  assert.deepEqual(drops.sort(), ['"stock_movements_kind_shape"', '"stock_reservations_facts"']);
  for (const name of drops) {
    assert.match(text, new RegExp(`ADD CONSTRAINT ${name} CHECK`));
  }
});

test('it alters only the stock movement and reservation tables and adds only nullable columns', () => {
  const text = sql(WAVE2_STOCK[1]!);
  const altered = [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]!);
  for (const table of altered) assert.ok(ALTERED.has(table), `ALTER TABLE ${table}`);
  const triggers = [
    ...text.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?\w+"?[\s\S]*?\bON\s+"?(\w+)"?/gi),
  ].map((match) => match[1]!);
  assert.deepEqual(triggers.sort(), ['stock_movements', 'stock_reservations']);
  const columns = [...text.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^;]+);/g)].map(
    (match) => `${match[1]} ${match[2]!.trim()}`,
  );
  assert.deepEqual(columns, [
    'invoice_line_id UUID',
    'paid_seq INTEGER',
    'consumed_paid_seq INTEGER',
    'consumed_at TIMESTAMPTZ(3)',
  ]);
  const references = [...text.matchAll(/\bREFERENCES\s+"?(\w+)"?/gi)].map((match) => match[1]!);
  assert.deepEqual(references, ['invoice_lines']);
  // Nothing of invoices, payments, discounts, vouchers, loyalty, combos, rewards, birthdays, visits, bookings or the outbox is
  // named outside a function body that only reads the reservation, invoice or movement rows it guards.
  const outsideBodies = text.replace(/\$\$[\s\S]*?\$\$/g, '');
  assert.doesNotMatch(
    outsideBodies,
    /\b(invoices|payments?|payment_\w+|discounts?|discount_\w+|vouchers?|loyalty_\w+|referrals?|birthday_\w+|combos?|combo_\w+|reward_\w+|visits?|bookings?|outbox_\w+)\b/i,
  );
});

test('it replaces exactly the pinned functions, hardens every function it touches and adds no permission', () => {
  const text = sql(WAVE2_STOCK[1]!);
  const replaced = [...text.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map(
    (match) => match[1]!,
  );
  assert.deepEqual([...replaced].sort(), REPLACED_FUNCTIONS);
  const created = [...text.matchAll(/CREATE FUNCTION (\w+)\(/g)].map((match) => match[1]!);
  assert.deepEqual([...created].sort(), CREATED_FUNCTIONS);
  const hardened = [...text.matchAll(/'(lucy_\w+)'/g)].map((match) => match[1]!);
  for (const name of [...REPLACED_FUNCTIONS, ...CREATED_FUNCTIONS]) {
    assert.ok(hardened.includes(name), `${name} gets its fixed search_path`);
  }
  assert.doesNotMatch(text, /PermissionCode|permissions/i);
});

test('the earlier Wave 2 guards keep their messages (the tests of P6-8 match them)', () => {
  const text = sql(WAVE2_STOCK[1]!);
  for (const message of [
    'A reservation is released only when its invoice is cancelled',
    'A stock reservation changes only from reserved to released',
    'A reservation matches the variant and quantity of its product line',
    'There is not enough stock available to reserve',
    'is immutable apart from',
  ]) {
    assert.ok(text.includes(message), message);
  }
});

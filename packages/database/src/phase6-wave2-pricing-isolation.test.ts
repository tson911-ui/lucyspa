import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-9 changes the live discount, redemption, application and payment rules (pricing calculation_version 3), so this guard pins
 * EXACTLY what its two migrations may touch (Owner rule, 2026-10-07/08: service-only invoices behave as today). It reads the
 * migrations and fails if one drops or rewrites existing data, changes a table beyond the pinned list, replaces a function beyond
 * the pinned list, or lets a payment trigger do anything but add side attribution rows after the fact. It needs no database.
 */
const migrations = new URL('../prisma/migrations/', import.meta.url);
const PRICING = readdirSync(migrations, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && /^20261108\d{6}_phase6_wave2_/.test(entry.name))
  .map((entry) => entry.name)
  .sort();

const sql = (name: string) =>
  readFileSync(new URL(`${name}/migration.sql`, migrations), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');

const NEW_TABLES = new Set([
  'discount_version_brands',
  'discount_version_product_categories',
  'discount_version_products',
  'invoice_beauty_applications',
  'invoice_beauty_snapshots',
  'invoice_line_allocations',
  'payment_side_allocations',
]);
// The only existing tables a statement may alter.
const EXISTING_ALTERED = new Set(['discount_versions', 'invoice_discount_applications']);
// Existing tables a trigger may be attached to (besides the new ones): the payments get AFTER triggers that only add attribution rows.
const EXISTING_TRIGGERED = new Set(['payments', 'payment_corrections']);
const REFERENCEABLE = new Set([
  'discount_versions',
  'brands',
  'product_categories',
  'products',
  'invoices',
  'invoice_lines',
  'payments',
  'vouchers',
  'users',
]);
const REPLACED_FUNCTIONS = new Set([
  'lucy_check_discount_version_scope',
  'lucy_guard_discount_application',
  'lucy_guard_discount_redemption',
  'lucy_check_invoice_discount',
]);
const CREATED_FUNCTIONS = new Set([
  'lucy_cumulative_share',
  'lucy_split_pro_rata',
  'lucy_guard_beauty_application',
  'lucy_guard_invoice_beauty_snapshot',
  'lucy_guard_invoice_line_allocation',
  'lucy_allocate_payment_sides',
  'lucy_allocate_payment_reversal_sides',
  'lucy_check_payment_side_allocations',
  'lucy_check_invoice_pricing_v3',
  'lucy_check_invoice_pricing_row',
]);

test('P6-9 has its two migrations: the scope and its targets, then the persistence of version 3', () => {
  assert.deepEqual(PRICING, [
    '20261108000000_phase6_wave2_discount_scope',
    '20261108000001_phase6_wave2_pricing_v3',
  ]);
});

test('P6-9 never drops, truncates, deletes or rewrites existing data; it replaces exactly one index and one constraint', () => {
  const text = PRICING.map(sql).join('\n');
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|SEQUENCE|SCHEMA|TRIGGER)\b/i);
  assert.doesNotMatch(text, /\b(?<!BEFORE\s)TRUNCATE\b/i);
  assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(text, /\bALTER\s+COLUMN\b/i);
  assert.doesNotMatch(text, /\bRENAME\b/i);
  // No row is written: no INSERT and no UPDATE statement outside function bodies (the ones inside write the new attribution rows).
  assert.doesNotMatch(
    text.replace(/\$\$[\s\S]*?\$\$/g, ''),
    /\b(INSERT\s+INTO|UPDATE\s+"?\w+"?\s+SET)\b/i,
  );
  const drops = [...text.matchAll(/\bDROP\s+(INDEX|CONSTRAINT)\s+("[^"]+")/gi)].map(
    (match) => `${match[1]!.toUpperCase()} ${match[2]}`,
  );
  assert.deepEqual(drops.sort(), [
    'CONSTRAINT "invoice_discount_applications_amount"',
    'INDEX "discount_redemptions_invoice_key"',
  ]);
});

test('P6-9 alters only the discount version and application tables among the existing ones, and adds only the pinned columns', () => {
  const text = PRICING.map(sql).join('\n');
  const altered = [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]!);
  for (const table of altered) {
    assert.ok(EXISTING_ALTERED.has(table) || NEW_TABLES.has(table), `ALTER TABLE ${table}`);
  }
  const columns = [...text.matchAll(/ADD COLUMN\s+"(\w+)"\s+([^,;]+)/g)].map(
    (match) => `${match[1]} ${match[2]!.trim()}`,
  );
  assert.deepEqual(columns, [
    `scope "DiscountScope" NOT NULL DEFAULT 'SERVICES'`,
    'shared_eligible_subtotal_vnd BIGINT',
    'shared_amount_vnd BIGINT',
  ]);
  const triggers = [
    ...text.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?\w+"?[\s\S]*?\bON\s+"?(\w+)"?/gi),
  ].map((match) => match[1]!);
  for (const table of triggers) {
    assert.ok(
      NEW_TABLES.has(table) || EXISTING_TRIGGERED.has(table) || table === 'discount_versions',
      `TRIGGER on ${table}`,
    );
  }
  const references = [...text.matchAll(/\bREFERENCES\s+"?(\w+)"?/gi)].map((match) => match[1]!);
  for (const table of references) {
    assert.ok(NEW_TABLES.has(table) || REFERENCEABLE.has(table), `REFERENCES ${table}`);
  }
});

test('P6-9 payment triggers are AFTER triggers that only add attribution rows, and return at once for a service-only invoice', () => {
  const text = sql(PRICING[1]!);
  const onPayments = [
    ...text.matchAll(
      /CREATE\s+TRIGGER\s+"(\w+)"\s+(\w+)\s+([A-Z ]+?)\s+ON\s+"(payments|payment_corrections)"/g,
    ),
  ].map((match) => `${match[1]} ${match[2]} ${match[3]} ${match[4]}`);
  assert.deepEqual(onPayments, [
    'payments_side_allocation AFTER INSERT OR UPDATE payments',
    'payment_corrections_side_allocation AFTER INSERT payment_corrections',
  ]);
  const body = (name: string) =>
    new RegExp(`CREATE FUNCTION ${name}\\(\\)[\\s\\S]*?\\$\\$([\\s\\S]*?)\\$\\$;`).exec(text)![1]!;
  // The attribution writes only its own table, and a version below 3 returns before anything is read or written.
  for (const name of ['lucy_allocate_payment_sides', 'lucy_allocate_payment_reversal_sides']) {
    const function_ = body(name);
    assert.doesNotMatch(function_, /\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/);
    assert.deepEqual(
      [...function_.matchAll(/INSERT\s+INTO\s+(\w+)/g)].map((match) => match[1]),
      name === 'lucy_allocate_payment_sides'
        ? ['payment_side_allocations', 'payment_side_allocations']
        : ['payment_side_allocations'],
    );
  }
  assert.match(body('lucy_allocate_payment_sides'), /version_value < 3 THEN\s+RETURN NULL/);
  assert.match(
    body('lucy_allocate_payment_reversal_sides'),
    /calculation_version >= 3 FOR UPDATE;\s+IF NOT FOUND THEN\s+RETURN NULL/,
  );
});

test('P6-9 replaces exactly the pinned functions, hardens every function it touches and adds no permission', () => {
  const text = PRICING.map(sql).join('\n');
  const replaced = [...text.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map(
    (match) => match[1]!,
  );
  assert.deepEqual([...new Set(replaced)].sort(), [...REPLACED_FUNCTIONS].sort());
  const created = [...text.matchAll(/CREATE FUNCTION (\w+)\(/g)].map((match) => match[1]!);
  assert.deepEqual([...created].sort(), [...CREATED_FUNCTIONS].sort());
  const hardened = [...text.matchAll(/'(lucy_\w+)'|\.(lucy_\w+)\(/g)].map(
    (match) => match[1] ?? match[2]!,
  );
  for (const name of [...REPLACED_FUNCTIONS, ...CREATED_FUNCTIONS]) {
    assert.ok(hardened.includes(name), `${name} gets its fixed search_path`);
  }
  assert.doesNotMatch(text, /PermissionCode|permissions/i);
});

test('P6-9 keeps the Phase 4/5 integrity check for every invoice below version 3 and hands version 3 to its own check', () => {
  const text = sql(PRICING[1]!);
  const replaced =
    /CREATE OR REPLACE FUNCTION lucy_check_invoice_discount\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(
      text,
    )![1]!;
  // The only new statement before the Phase 5 body is the dispatch.
  assert.match(
    replaced,
    /IF target\.calculation_version >= 3 THEN\s+PERFORM lucy_check_invoice_pricing_v3\(target\.id\);\s+RETURN NULL;\s+END IF;/,
  );
  // Apart from that dispatch the function is the Phase 5 birthday migration's, statement for statement (comments and blank lines aside).
  const normalize = (source: string) =>
    source
      .split('\n')
      .map((line) => line.replace(/--.*$/, '').trimEnd())
      .filter((line) => line.trim() !== '')
      .join('\n');
  const phase5 = readFileSync(
    new URL('20261031000000_phase5_birthday_reward/migration.sql', migrations),
    'utf8',
  );
  const original =
    /CREATE OR REPLACE FUNCTION lucy_check_invoice_discount\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/.exec(
      phase5,
    )![1]!;
  assert.equal(
    normalize(
      replaced.replace(/ {2}IF target\.calculation_version >= 3 THEN[\s\S]*?END IF;\n/, ''),
    ),
    normalize(original),
  );
  // The one-redemption-per-invoice key is widened, never removed: (invoice, program) stays unique.
  assert.match(
    text,
    /CREATE UNIQUE INDEX "discount_redemptions_invoice_discount_key" ON "discount_redemptions"\("invoice_id", "discount_id"\)/,
  );
});

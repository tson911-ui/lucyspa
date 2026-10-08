import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-14: the exchange migrations are additive. This guard needs no database. It pins what they may touch: one enum value on its
 * own, then three new tables, one enum and one sequence, a column on each of three existing tables (the password uses, the lots, the
 * movements), the replaced bodies of exactly three guards (the refund guard, the pricing check of a version 3 invoice, the T22 guard),
 * and the new guards. No existing row is written, no permission is granted, nothing calls PayOS, and the customer's bank account has
 * no column.
 */
const read = (name: string) => {
  const raw = readFileSync(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );
  return raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
};
const kinds = read('20261115000000_phase6_wave3_exchange_kinds');
const text = read('20261115000001_phase6_wave3_product_exchanges');

test('the enum value is committed on its own, before anything uses it', () => {
  assert.equal(kinds.match(/ADD VALUE/g)?.length, 1);
  assert.match(kinds, /ALTER TYPE "StockMovementKind" ADD VALUE 'EXCHANGE_RETURN';/);
  assert.doesNotMatch(kinds, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
});

test('it creates exactly the three exchange tables and alters only its own tables, the password uses, the lots and the movements', () => {
  const created = [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(created.sort(), [
    'product_exchange_completions',
    'product_exchange_corrections',
    'product_exchanges',
  ]);
  const altered = new Set(
    [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...altered].sort(),
    [
      'inventory_lots',
      'product_exchange_completions',
      'product_exchange_corrections',
      'product_exchanges',
      'refund_reauthentication_uses',
      'stock_movements',
    ].sort(),
  );
  const columns = [...text.matchAll(/ADD COLUMN\s+"(\w+)"\s+([A-Z()0-9]+)/g)].map((match) => [
    match[1],
    match[2],
  ]);
  assert.deepEqual(columns, [
    ['product_exchange_id', 'UUID'],
    ['source_exchange_id', 'UUID'],
    ['product_exchange_id', 'UUID'],
  ]);
  assert.doesNotMatch(text, /ADD COLUMN[^;]*NOT NULL/);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  // The only constraints dropped are the two that are widened and re-added.
  assert.deepEqual([...text.matchAll(/DROP CONSTRAINT "(\w+)"/g)].map((match) => match[1]).sort(), [
    'refund_reauthentication_uses_owner',
    'stock_movements_kind_shape',
  ]);
  assert.equal(text.match(/CREATE TYPE/g)?.length, 1);
  assert.match(
    text,
    /CREATE TYPE "ProductExchangeRule" AS ENUM \('SAME_ITEM', 'PRICE_DIFFERENCE'\);/,
  );
  assert.equal(text.match(/CREATE SEQUENCE/g)?.length, 1);
});

test('it writes no data and grants no permission', () => {
  assert.doesNotMatch(text, /\b(UPDATE\s+\S+\s+SET|DELETE\s+FROM|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(text, /role_permissions|permissions|GRANT\s/i);
});

test('every foreign key restricts: nothing cascades into exchange, refund, stock or points history', () => {
  const keys = [...text.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 15, `foreign keys: ${keys.length}`);
  for (const key of keys) {
    assert.match(key, /ON DELETE RESTRICT ON UPDATE RESTRICT/, key);
    assert.doesNotMatch(key, /CASCADE|SET NULL/i);
  }
});

test('money handed back is cash or a manual transfer: no PayOS, no card, no account number', () => {
  assert.match(text, /"refund_method" "ProductRefundMethod"/);
  assert.doesNotMatch(text, /PAYOS|CARD|account_number|bank_account/i);
  assert.match(text, /"refund_bank_reference" ~ '\^\[A-Za-z0-9\._\/-\]\{4,64\}\$'/);
  assert.match(text, /"refund_method" = 'CASH' AND "refund_bank_reference" IS NULL/);
});

test('the OQ-82 rule is in the table: same item has no difference, otherwise the credit is taken off the price and the rest handed back', () => {
  assert.match(
    text,
    /"rule" = 'SAME_ITEM' AND "applied_credit_vnd" = "replacement_gross_vnd" AND "refund_vnd" = 0/,
  );
  assert.match(text, /"applied_credit_vnd" = LEAST\("credit_vnd", "replacement_gross_vnd"\)/);
  assert.match(text, /"refund_vnd" = "credit_vnd" - "applied_credit_vnd"/);
  assert.match(text, /"payable_vnd" = "replacement_gross_vnd" - "applied_credit_vnd"/);
  assert.match(
    text,
    /\(NEW\.rule = 'SAME_ITEM'\) <> \(NEW\.replacement_variant_id = orig_variant\)/,
  );
});

test('an exchange is immutable, follows an accepted exchange case, shares the line sequence and recomputes its credit', () => {
  assert.match(text, /A product exchange is history and is never changed or deleted/);
  assert.match(text, /BEFORE INSERT OR UPDATE OR DELETE ON "product_exchanges"/);
  assert.match(text, /BEFORE TRUNCATE ON "product_exchanges"/);
  assert.match(text, /kase\.decided_outcome IS DISTINCT FROM 'EXCHANGE'/);
  assert.match(text, /FROM lucy_line_claims\(NEW\.invoice_line_id\)/);
  assert.match(text, /lucy_open_exchange_on_line\(NEW\.invoice_line_id\)/);
  assert.match(text, /A case has one exchange at a time/);
  assert.match(
    text,
    /before_share := \(2 \* net \* prior_units \+ total_units\) \/ \(2 \* total_units\)/,
  );
  assert.match(text, /The invoice of an exchange carries exactly the replacement line/);
  assert.match(
    text,
    /CONSTRAINT TRIGGER "product_exchanges_commit_check" AFTER INSERT ON "product_exchanges"/,
  );
});

test('it replaces exactly three earlier guards, and keeps their earlier rules', () => {
  const replaced = [...text.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(replaced.sort(), [
    'lucy_check_invoice_pricing_v3',
    'lucy_guard_product_refund',
    'lucy_refuse_when_refunded',
  ]);
  // The refund guard keeps every rule it had and reads the shared claims.
  for (const rule of [
    'A refund needs a paid invoice',
    'Only counter sales have a refund for now',
    'A refund follows an accepted return case that was decided as a refund, for its own line',
    'A refund is the net share of the units refunded, not another amount',
    'The running total of an invoice matches the refunds before it',
  ]) {
    assert.ok(text.includes(rule), rule);
  }
  assert.match(text, /FROM lucy_line_claims\(NEW\.invoice_line_id\) c/);
  // The pricing check keeps its rules and adds the exchange credit as the only benefit of an exchange invoice.
  for (const rule of [
    'The invoice discount total must equal the benefits applied to its sides',
    'The line allocations must add up to the discount of each side',
    'The line net amounts must add up to the receivable without the shipping fee',
    'An applied benefit is redeemed exactly once',
  ]) {
    assert.ok(text.includes(rule), rule);
  }
  assert.match(text, /The invoice of an exchange has no benefit but its exchange credit/);
  assert.match(text, /beauty_discount := swap_credit;/);
  // T22: the refund rule stays and the two exchange rules are added.
  assert.match(text, /An invoice with a refund keeps its payments and stays paid/);
  assert.match(text, /An invoice with an exchange keeps its payments and stays paid/);
  assert.match(text, /The invoice of a completed exchange keeps its payments and stays paid/);
});

test('stock: returned goods enter a new lot named after the exchange, never phantom stock', () => {
  assert.match(text, /\("kind" = 'EXCHANGE_RETURN'\) = \("product_exchange_id" IS NOT NULL\)/);
  assert.match(
    text,
    /An exchange completed as sellable puts back exactly its units and any other exchange puts back none/,
  );
  assert.match(
    text,
    /A returned lot belongs to a sellable exchange of its branch and variant and keeps the expiry of a lot the line was sold from/,
  );
  assert.match(text, /CREATE UNIQUE INDEX "inventory_lots_exchange_code_key"/);
  assert.match(
    text,
    /BEFORE INSERT ON "stock_movements"\s+FOR EACH ROW WHEN \(NEW\.kind = 'EXCHANGE_RETURN'\)/,
  );
});

test('one password confirmation covers one exchange, from the same pool as the refunds', () => {
  assert.match(text, /num_nonnulls\("product_refund_id", "product_exchange_id"\) = 1/);
  assert.match(text, /CREATE UNIQUE INDEX "refund_reauthentication_uses_exchange_key"/);
  assert.match(text, /An exchange uses its own password confirmation once/);
});

test('every replaced or new function gets a fixed search_path and no PUBLIC execute', () => {
  for (const name of [
    'lucy_guard_product_refund',
    'lucy_guard_product_exchange',
    'lucy_guard_product_exchange_completion',
    'lucy_guard_product_exchange_correction',
    'lucy_check_product_exchange',
    'lucy_guard_exchange_lot',
    'lucy_guard_exchange_return_movement',
    'lucy_check_exchange_stock',
    'lucy_refuse_when_refunded',
  ]) {
    assert.ok(text.includes(`'${name}'`), name);
  }
  for (const signature of [
    'lucy_line_claims(uuid)',
    'lucy_open_exchange_on_line(uuid)',
    'lucy_check_invoice_pricing_v3(uuid)',
  ]) {
    assert.ok(text.includes(signature), signature);
  }
  assert.match(text, /SET search_path TO pg_catalog/);
  assert.match(text, /REVOKE ALL ON FUNCTION/);
});

test('a return case can never be opened on the invoice of an exchange: one guard, nothing else touched (P14-15)', () => {
  const guard = read('20261115000002_phase6_wave3_exchange_return_guard');
  assert.deepEqual(
    [...guard.matchAll(/\bCREATE\s+(?:OR REPLACE\s+)?(FUNCTION|TRIGGER)\s+(\w+)/gi)].map(
      (match) => match[2],
    ),
    ['lucy_refuse_return_of_exchange_invoice', 'lucy_product_return_cases_exchange_invoice'],
  );
  assert.match(guard, /BEFORE INSERT ON "product_return_cases"/);
  assert.match(guard, /x\.exchange_invoice_id = NEW\.invoice_id/);
  assert.doesNotMatch(
    guard,
    /\bDROP\b|ALTER\s+TABLE|UPDATE\s+\S+\s+SET|INSERT\s+INTO|DELETE\s+FROM/i,
  );
  assert.match(guard, /SET search_path TO pg_catalog/);
  assert.match(guard, /REVOKE ALL ON FUNCTION/);
});

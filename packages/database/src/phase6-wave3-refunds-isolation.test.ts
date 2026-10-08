import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-13: the refund migrations are additive. This guard needs no database. It pins what they may touch: two enum values on their
 * own, then two new tables, their enums and sequence, one column on each of three existing tables (the ledger, the movements, the lots),
 * the replaced CHECKs and guards of those three, and the new guards that keep an invoice with a refund paid. No existing row is written,
 * no permission is granted, nothing calls PayOS, and the customer's bank account has no column.
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
const kinds = read('20261113000000_phase6_wave3_refund_kinds');
const text = read('20261113000001_phase6_wave3_product_refunds');

test('the enum values are committed on their own, before anything uses them', () => {
  assert.equal(kinds.match(/ADD VALUE/g)?.length, 2);
  assert.match(kinds, /ALTER TYPE "StockMovementKind" ADD VALUE 'REFUND_RETURN';/);
  assert.match(kinds, /ALTER TYPE "LoyaltyLedgerKind" ADD VALUE 'REFUND_REVERSAL';/);
  assert.doesNotMatch(kinds, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
});

test('it creates exactly the two refund tables and alters only the ledger, the movements and the lots besides', () => {
  const created = [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(created.sort(), ['product_refund_corrections', 'product_refunds']);
  const altered = new Set(
    [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...altered].sort(),
    [
      'inventory_lots',
      'loyalty_ledger_entries',
      'product_refund_corrections',
      'product_refunds',
      'stock_movements',
    ].sort(),
  );
  const columns = [...text.matchAll(/ADD COLUMN\s+"(\w+)"\s+([A-Z()0-9]+)/g)].map((match) => [
    match[1],
    match[2],
  ]);
  assert.deepEqual(columns, [
    ['product_refund_id', 'UUID'],
    ['product_refund_id', 'UUID'],
    ['source_refund_id', 'UUID'],
  ]);
  assert.doesNotMatch(text, /ADD COLUMN[^;]*NOT NULL/);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  // The only constraints dropped are the two shape CHECKs that are widened and re-added.
  assert.deepEqual(
    [...text.matchAll(/DROP CONSTRAINT "(\w+)"/g)].map((match) => match[1]),
    ['loyalty_ledger_entries_kind_shape', 'stock_movements_kind_shape'],
  );
  assert.doesNotMatch(
    text,
    /\bTRUNCATE\s+TABLE|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b/i,
  );
  assert.doesNotMatch(text, /role_permissions|user_permission|PermissionCode/i);
});

test('every foreign key restricts: nothing cascades into refund, stock or points history', () => {
  const keys = [...text.matchAll(/FOREIGN KEY[\s\S]*?;/gi)].map((match) => match[0]);
  assert.ok(keys.length >= 10);
  for (const key of keys) {
    assert.match(key, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
    assert.doesNotMatch(key, /CASCADE|SET NULL/i);
  }
});

test('a refund is money by cash or a manual transfer: no PayOS, no card, no account number', () => {
  assert.match(
    text,
    /CREATE TYPE "ProductRefundMethod" AS ENUM \('CASH', 'BANK_TRANSFER_MANUAL'\)/,
  );
  assert.doesNotMatch(text, /payos|card|provider|account_number|bank_account/i);
  assert.match(text, /\[A-Za-z0-9\._\/-\]\{4,64\}/);
  assert.match(text, /"bank_reference" IS NOT NULL AND "bank_reference" ~/);
  assert.match(text, /"method" = 'CASH' AND "bank_reference" IS NULL/);
});

test('a refund is immutable, follows an accepted refund case and recomputes its amount by the cumulative unit split', () => {
  assert.match(text, /A product refund is history and is never changed or deleted/);
  assert.match(text, /Refund history is never truncated/);
  assert.match(
    text,
    /kase\.status <> 'ACCEPTED' OR kase\.decided_outcome IS DISTINCT FROM 'REFUND'/,
  );
  assert.match(text, /\(2 \* net \* prior_units \+ total_units\) \/ \(2 \* total_units\)/);
  assert.match(
    text,
    /\(2 \* net \* \(prior_units \+ NEW\.quantity\) \+ total_units\) \/ \(2 \* total_units\)/,
  );
  assert.match(text, /A line cannot be refunded more units than were sold/);
  assert.match(text, /A case cannot be refunded more units than it accepted/);
  assert.match(text, /FOR NO KEY UPDATE OF l/);
  // Only a product line can be refunded (PRD 29): the foreign key names the product detail row.
  assert.match(text, /FOREIGN KEY \("invoice_line_id"\) REFERENCES "invoice_line_products"/);
  assert.match(text, /CREATE UNIQUE INDEX "product_refunds_request_key"/);
  assert.match(text, /CREATE UNIQUE INDEX "product_refunds_line_units_key"/);
});

test('points: one linked entry per refund, never more than the invoice earned; stock: new lots, no phantom stock', () => {
  assert.match(text, /CREATE UNIQUE INDEX "loyalty_ledger_entries_refund_key"/);
  assert.match(
    text,
    /"kind" = 'REFUND_REVERSAL' AND "points" <= 0 AND "product_refund_id" IS NOT NULL/,
  );
  assert.match(text, /Refunds cannot take back more points than the invoice earned/);
  assert.match(text, /A product refund takes back Beauty points only/);
  for (const kind of [
    'EARN',
    'EARN_REVERSAL',
    'REFERRAL_AWARD',
    'MANUAL_ADJUSTMENT',
    'MANUAL_CORRECTION',
  ]) {
    assert.match(text, new RegExp(`"kind" = '${kind}'`), kind);
  }
  assert.match(text, /"kind" = 'REFUND_RETURN' AND "quantity_delta" > 0/);
  assert.match(
    text,
    /A refund recorded as sellable puts back exactly its units and any other refund puts back none/,
  );
  assert.match(text, /keeps the expiry of a lot the line was sold from/);
  assert.match(text, /"source_receipt_line_id" IS NULL OR "source_refund_id" IS NULL/);
  assert.match(text, /DEFERRABLE INITIALLY DEFERRED/);
});

test('T22: an invoice with a refund keeps its payments and stays paid', () => {
  assert.match(text, /An invoice with a refund keeps its payments and stays paid/);
  assert.match(
    text,
    /CREATE TRIGGER lucy_payment_corrections_refund_guard BEFORE INSERT ON "payment_corrections"/,
  );
  assert.match(text, /CREATE TRIGGER lucy_invoices_refund_guard BEFORE UPDATE ON "invoices"/);
  assert.match(text, /WHEN \(OLD\.status = 'PAID' AND NEW\.status <> 'PAID'\)/);
});

test('every replaced or new function gets a fixed search_path and no PUBLIC execute', () => {
  for (const name of [
    'lucy_guard_product_refund',
    'lucy_guard_product_refund_correction',
    'lucy_guard_product_refund_truncate',
    'lucy_guard_loyalty_ledger',
    'lucy_guard_inventory_lot',
    'lucy_guard_stock_movement',
    'lucy_check_refund_stock',
    'lucy_refuse_when_refunded',
  ]) {
    assert.match(text, new RegExp(`'${name}'`));
  }
  assert.match(text, /SET search_path TO pg_catalog, %I, pg_temp/);
  assert.match(text, /REVOKE ALL ON FUNCTION %I\.%I\(\) FROM PUBLIC/);
});

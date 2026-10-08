import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-17: the order-actions migration is additive. It adds one table (the daily scan claim), one nullable column on two
 * tables, replaces three guard functions, widens (never narrows) the notification CHECKs, writes no data and grants no permission.
 */
const text = readFileSync(
  new URL(
    '../prisma/migrations/20261118000000_phase6_wave3b_order_actions/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('it creates one table and alters only the tables it names', () => {
  assert.deepEqual(
    [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
    ['product_order_scans'],
  );
  assert.deepEqual(
    [
      ...new Set([...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1])),
    ].sort(),
    ['notifications', 'product_order_scans', 'product_refunds', 'product_variants'],
  );
});

test('it writes no data, grants no permission and drops nothing but the checks it replaces', () => {
  assert.doesNotMatch(text, /\b(INSERT\s+INTO|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(text, /\bUPDATE\s+"?\w+"?\s+SET\b/i);
  assert.doesNotMatch(text, /role_permissions|GRANT\s/i);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|TRIGGER)\b/i);
  const dropped = [...text.matchAll(/\bDROP\s+CONSTRAINT\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(dropped.sort(), [
    'notifications_entity_type_check',
    'notifications_type_check',
    'notifications_type_entity',
  ]);
});

test('the refund of a cancelled line is the same immutable record: one per line, never a restock to the shelf', () => {
  assert.match(text, /"product_refunds_order_line_key" ON "product_refunds"\("order_line_id"\)/);
  assert.match(
    text,
    /"order_line_id" IS NOT NULL AND "restock" = 'NOT_SELLABLE'/,
    'a cancelled line is refunded without putting goods back as sellable',
  );
  assert.match(
    text,
    /"return_case_id" IS NOT NULL AND "case_ordinal" IS NOT NULL AND "order_line_id" IS NULL/,
  );
});

test('the daily scan row is history: insert-only, never truncated', () => {
  assert.match(text, /PRIMARY KEY \("branch_id", "business_date"\)/);
  assert.match(text, /An order scan is history and is never changed or deleted/);
  assert.match(text, /BEFORE TRUNCATE ON "product_order_scans"/);
  assert.match(text, /"outcome" IN \('PUBLISHED', 'NOTHING_TO_REPORT', 'UNROUTABLE'\)/);
});

test('the notification checks are widened, not narrowed: every old type stays, two new ones and one entity are added', () => {
  for (const type of [
    'BOOKING_CREATED',
    'LEAVE_DECIDED',
    'INVOICE_CANCELLED_ALERT',
    'REVENUE_DAILY_SUMMARY',
    'LOW_STOCK_REACHED',
    'EXPIRY_ALERT',
    'EXPIRED_LOT_SOLD',
    'PRODUCT_RETURN_OPENED',
    'PRODUCT_REFUND_MADE',
  ]) {
    assert.match(text, new RegExp(`'${type}'`), type);
  }
  assert.match(text, /'PRODUCT_ORDER_ARRIVED', 'PRODUCT_ORDER_ALERT'/);
  assert.match(text, /'ProductReturnCase', 'ProductOrder'\)/);
  // A return notice still points at a return case; a refund notice may point at a return case or an order.
  assert.match(text, /"type" = 'PRODUCT_RETURN_OPENED' AND "entity_type" = 'ProductReturnCase'/);
  assert.match(
    text,
    /"type" = 'PRODUCT_REFUND_MADE' AND "entity_type" IN \('ProductReturnCase', 'ProductOrder'\)/,
  );
});

test('the usual supplier is optional and restricts: a supplier in use is never deleted', () => {
  assert.match(text, /ADD COLUMN "usual_supplier_id" UUID;/);
  assert.doesNotMatch(text, /"usual_supplier_id" UUID NOT NULL/);
  assert.match(
    text,
    /"product_variants_usual_supplier_id_fkey"\s+FOREIGN KEY \("usual_supplier_id"\) REFERENCES "suppliers"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
});

test('every function it creates or replaces gets a fixed search_path and no PUBLIC execute', () => {
  assert.match(text, /SET search_path TO pg_catalog, %I, pg_temp/);
  assert.match(text, /REVOKE ALL ON FUNCTION %I\.%I\(\) FROM PUBLIC/);
  for (const name of [
    'lucy_guard_product_order_line',
    'lucy_check_product_orders',
    'lucy_guard_product_refund',
    'lucy_guard_product_order_scan',
  ]) {
    assert.match(text, new RegExp(`'${name}'`), name);
  }
});

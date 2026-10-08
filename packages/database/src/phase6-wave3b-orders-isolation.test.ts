import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-15: the product-order migrations are additive. This guard needs no database. It pins what they may touch: two enum values on
 * their own, then three new tables, four enums and one sequence, one column on one existing table (the line mode), one replaced CHECK, the
 * replaced bodies of exactly five guards and the new guards. No existing row is written, no permission is granted, nothing is deleted, and no
 * money is stored on an order.
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
const kinds = read('20261116000000_phase6_wave3b_order_kinds');
const text = read('20261116000001_phase6_wave3b_product_orders');

test('the enum values are committed on their own, before anything uses them', () => {
  assert.equal(kinds.match(/ADD VALUE/g)?.length, 2);
  assert.match(kinds, /ALTER TYPE "PermissionCode" ADD VALUE 'MANAGE_PRODUCT_ORDERS';/);
  assert.match(kinds, /ALTER TYPE "StockReservationSource" ADD VALUE 'ORDER_LINE';/);
  assert.doesNotMatch(kinds, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
});

test('it creates exactly the three order tables and alters only its own tables, the invoice line details and the reservations', () => {
  const created = [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(created.sort(), [
    'product_order_events',
    'product_order_lines',
    'product_orders',
  ]);
  const altered = new Set(
    [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
  );
  assert.deepEqual(
    [...altered].sort(),
    [
      'invoice_line_products',
      'product_order_events',
      'product_order_lines',
      'product_orders',
      'stock_reservations',
    ].sort(),
  );
  const columns = [...text.matchAll(/ADD COLUMN\s+"(\w+)"\s+("\w+")/g)].map((match) => [
    match[1],
    match[2],
  ]);
  assert.deepEqual(columns, [['fulfilment_mode', '"ProductLineMode"']]);
  assert.match(text, /"fulfilment_mode" "ProductLineMode" NOT NULL DEFAULT 'IN_STOCK'/);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  assert.deepEqual(
    [...text.matchAll(/DROP CONSTRAINT "(\w+)"/g)].map((match) => match[1]),
    ['stock_reservations_facts'],
  );
  assert.equal(text.match(/CREATE TYPE/g)?.length, 4);
  assert.equal(text.match(/CREATE SEQUENCE/g)?.length, 1);
});

test('it writes no data and grants no permission', () => {
  assert.doesNotMatch(text, /\bDELETE\s+FROM\b/i);
  // The only INSERT is the history row written by the trigger; no migration-time INSERT or UPDATE of existing rows.
  const inserts = [...text.matchAll(/\bINSERT\s+INTO\s+(\w+)/gi)].map((match) => match[1]);
  assert.deepEqual(inserts, ['product_order_events']);
  const updates = [...text.matchAll(/\bUPDATE\s+(\w+)\s+SET/gi)].map((match) => match[1]);
  assert.deepEqual(updates.sort(), [
    'product_order_lines',
    'product_order_lines',
    'product_order_lines',
  ]);
  assert.doesNotMatch(text, /role_permissions|GRANT\s/i);
  assert.doesNotMatch(text, /INSERT\s+INTO\s+"?permissions/i);
});

test('every foreign key restricts: nothing cascades into order, stock or payment history', () => {
  const keys = [...text.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 15, `foreign keys: ${keys.length}`);
  for (const key of keys) {
    assert.match(key, /ON DELETE RESTRICT ON UPDATE RESTRICT/, key);
    assert.doesNotMatch(key, /CASCADE|SET NULL/i);
  }
});

test('an order holds no money, no card and no address', () => {
  const orderTables = text.slice(
    text.indexOf('CREATE TABLE "product_orders"'),
    text.indexOf('ALTER TABLE "stock_reservations" DROP CONSTRAINT'),
  );
  assert.doesNotMatch(orderTables, /_vnd|amount|PAYOS|CARD|account_number|bank_|address/i);
  assert.match(orderTables, /CONSTRAINT "product_orders_counter" CHECK \("channel" = 'COUNTER'\)/);
  assert.match(orderTables, /CONSTRAINT "product_orders_phone" CHECK/);
});

test('the status machine is one-way, every change is an append-only event and nothing is deleted or truncated', () => {
  assert.match(
    text,
    /\(OLD\.status = 'AWAITING_PAYMENT' AND NEW\.status IN \('PAID', 'CANCELLED'\)\)/,
  );
  assert.match(
    text,
    /\(OLD\.status = 'PAID' AND NEW\.status IN \('AWAITING_PAYMENT', 'ORDERED', 'ARRIVED', 'CANCELLED'\)\)/,
  );
  assert.match(text, /\(OLD\.status = 'ORDERED' AND NEW\.status IN \('ARRIVED', 'CANCELLED'\)\)/);
  assert.match(
    text,
    /\(OLD\.status = 'ARRIVED' AND NEW\.status IN \('HANDED_OVER', 'CANCELLED'\)\)/,
  );
  assert.match(text, /\(OLD\.status = 'HANDED_OVER' AND NEW\.status = 'COMPLETED'\)/);
  assert.match(text, /A product order line is history and is never deleted/);
  assert.match(text, /A product order is history and is never deleted/);
  assert.match(text, /A product order event is history and is never changed or deleted/);
  for (const table of ['product_orders', 'product_order_lines', 'product_order_events']) {
    assert.match(text, new RegExp(`BEFORE TRUNCATE ON "${table}"`));
  }
  assert.match(
    text,
    /AFTER INSERT OR UPDATE ON "product_order_lines"\s+FOR EACH ROW EXECUTE FUNCTION lucy_record_product_order_event/,
  );
});

test('the invoice status drives the order lines, and the commit-time check ties orders, lines, invoices and reservations together', () => {
  assert.match(text, /AFTER UPDATE OF status ON "invoices"/);
  for (const trigger of [
    'product_orders_integrity',
    'product_order_lines_integrity',
    'product_order_reservations_integrity',
    'product_order_details_integrity',
    'product_order_invoices_integrity',
  ]) {
    assert.match(text, new RegExp(`CONSTRAINT TRIGGER "${trigger}"`));
  }
  assert.match(text, /IS NOT TRUE\) THEN/);
  assert.match(
    text,
    /A finalized invoice has one order with exactly one order line for each of its pre-order lines/,
  );
});

test('it replaces exactly five earlier guards, and keeps their earlier rules', () => {
  const replaced = [...text.matchAll(/CREATE OR REPLACE FUNCTION (\w+)\(/g)].map(
    (match) => match[1],
  );
  assert.deepEqual(replaced.sort(), [
    'lucy_check_invoice_integrity',
    'lucy_guard_invoice_line_product',
    'lucy_guard_product_return_case',
    'lucy_guard_stock_reservation',
    'lucy_refuse_when_refunded',
  ]);
  // Rules that must survive in the replaced bodies.
  for (const rule of [
    'A product detail belongs to a product line of a draft visit or product-sale invoice',
    'Only a published product with an active variant is added to an invoice',
    'The seller is an active employee assigned to the branch of the invoice',
    'A finalized invoice reserves the stock of every product line',
    'A cancelled invoice holds no stock and a live one keeps its reservations',
    'Payments must reconcile with the invoice status and receivable',
    'Stock is reserved by the finalization of a draft invoice, at its branch',
    'There is not enough stock available to reserve',
    'A consumed reservation returns to reserved only when its paid episode has ended and the invoice is not cancelled',
    'The return window is over',
    'Only the Owner may approve a return outside its window',
    'A wrong or damaged product needs a photo taken within 48 hours',
    'An invoice with a refund keeps its payments and stays paid',
    'An invoice with an exchange keeps its payments and stays paid',
    'The invoice of a completed exchange keeps its payments and stays paid',
  ]) {
    assert.ok(text.includes(rule), rule);
  }
  // The new rules.
  assert.match(text, /A pre-order line needs a variant that is sold on order/);
  assert.match(
    text,
    /A pre-order line has a return case only after its goods were handed over and sold/,
  );
  assert.match(text, /An invoice whose pre-order was ordered keeps its payments and stays paid/);
  assert.match(text, /Reserved goods are sold only when their pre-order line is handed over/);
});

test('every replaced or new function gets a fixed search_path and no PUBLIC execute', () => {
  for (const name of [
    'lucy_guard_invoice_line_product',
    'lucy_check_invoice_integrity',
    'lucy_guard_product_order',
    'lucy_guard_product_order_truncate',
    'lucy_guard_product_order_line',
    'lucy_record_product_order_event',
    'lucy_guard_product_order_event',
    'lucy_sync_product_order_lines',
    'lucy_guard_stock_reservation',
    'lucy_check_product_orders',
    'lucy_guard_product_return_case',
    'lucy_refuse_when_refunded',
  ]) {
    assert.ok(text.includes(`'${name}'`), name);
  }
  assert.match(text, /SET search_path TO pg_catalog, %I, pg_temp/);
  assert.match(text, /REVOKE ALL ON FUNCTION %I\.%I\(\) FROM PUBLIC/);
});

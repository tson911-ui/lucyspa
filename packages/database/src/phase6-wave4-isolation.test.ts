import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 Wave 4 (P6-19..P6-23): the online-order and campaign migrations are additive. This guard needs no database. It pins what they
 * may touch: two enum values on their own, then new tables only for the online shop, its shipments and its settlements and for the
 * campaigns; the existing tables they alter get new columns, widened checks or replaced guard bodies and nothing else. No existing row is
 * written (the one INSERT is the settings row that keeps online sales OFF), no permission is granted, nothing is deleted, truncated or
 * dropped other than the constraints that are replaced by wider ones.
 */
const read = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const names = [
  '20261121000000_phase6_wave4_kinds',
  '20261121000001_phase6_wave4_online_checkout',
  '20261122000000_phase6_wave4_fulfilment',
  '20261123000000_phase6_wave4_refunds_returns',
  '20261124000000_phase6_wave4_campaigns',
];
const [kinds, checkout, fulfilment, refunds, campaigns] = names.map(read) as [
  string,
  string,
  string,
  string,
  string,
];
const all = [kinds, checkout, fulfilment, refunds, campaigns].join('\n');
const tables = (text: string) =>
  [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]).sort();

test('the enum values are committed on their own, before anything uses them', () => {
  assert.equal(kinds.match(/ADD VALUE/g)?.length, 2);
  assert.doesNotMatch(kinds, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
});

test('each migration creates exactly its own tables', () => {
  assert.deepEqual(tables(checkout), [
    'customer_addresses',
    'online_cart_lines',
    'online_carts',
    'online_order_details',
    'online_sales_settings',
  ]);
  assert.deepEqual(tables(fulfilment), [
    'online_address_corrections',
    'online_order_logs',
    'online_order_scans',
    'online_shipment_corrections',
    'online_shipments',
    'shipping_carriers',
  ]);
  assert.deepEqual(tables(refunds), ['online_failed_delivery_settlements', 'online_return_costs']);
  assert.deepEqual(tables(campaigns), [
    'product_campaign_groups',
    'product_campaign_items',
    'product_campaigns',
  ]);
});

test('the existing tables they alter are only the ones the online shop and the campaigns need', () => {
  const created = new Set(names.flatMap((name) => tables(read(name))));
  const altered = new Set(
    [...all.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
      .map((match) => match[1]!)
      .filter((table) => !created.has(table)),
  );
  assert.deepEqual([...altered].sort(), [
    'invoice_line_products',
    'notifications',
    'product_order_lines',
    'product_orders',
    'product_refunds',
    'product_variants',
    'refund_reauthentication_uses',
    'stock_reservations',
  ]);
});

test('only constraints that are replaced by wider ones are dropped; no table, column, type, index or trigger goes', () => {
  assert.doesNotMatch(all, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  const dropped = [...all.matchAll(/DROP CONSTRAINT "(\w+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(dropped, [
    'notifications_type_check',
    'notifications_type_entity',
    'product_order_lines_facts',
    'product_orders_counter',
    'product_refunds_origin',
    'refund_reauthentication_uses_owner',
    'stock_reservations_facts',
  ]);
  // Each dropped constraint is replaced by a wider CHECK in the same migration (a new name or the same).
  assert.ok((all.match(/ADD CONSTRAINT "[a-z_]+"\s+CHECK/gi) ?? []).length >= dropped.length);
});

test('no existing row is written, no permission is granted, nothing is deleted or truncated', () => {
  assert.doesNotMatch(all, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(all, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(all, /role_permissions|GRANT\s|INSERT\s+INTO\s+"?permissions/i);
  const inserts = [...all.matchAll(/\bINSERT\s+INTO\s+"?(\w+)"?/gi)]
    .map((match) => match[1])
    .sort();
  // The settings row (online sales OFF) and the history row a guard writes for an order line.
  assert.deepEqual(inserts, ['online_sales_settings', 'product_order_events']);
  assert.match(checkout, /INSERT INTO "online_sales_settings"[^;]*;/s);
  const row = checkout.match(/INSERT INTO "online_sales_settings"[^;]*;/s)?.[0] ?? '';
  assert.doesNotMatch(row, /true/i, 'online sales start OFF');
});

test('every foreign key of the new tables restricts: nothing cascades into order, stock, payment or campaign history', () => {
  const keys = [
    ...[checkout, fulfilment, refunds, campaigns].join('\n').matchAll(/FOREIGN KEY[^;]*?;/gs),
  ].map((match) => match[0]);
  assert.ok(keys.length >= 30, `foreign keys: ${keys.length}`);
  // The only cascade is the cart basket: its lines go with the cart (a cart is a mutable basket, never history).
  const cascading = keys.filter((key) => /CASCADE|SET NULL/i.test(key));
  assert.deepEqual(cascading, [
    'FOREIGN KEY ("cart_id") REFERENCES "online_carts"("id") ON DELETE CASCADE ON UPDATE RESTRICT;',
  ]);
});

test('history is guarded: shipments, corrections, logs, settlements, costs and campaigns are never truncated', () => {
  for (const table of [
    'online_shipments',
    'online_shipment_corrections',
    'online_address_corrections',
    'online_order_logs',
    'online_failed_delivery_settlements',
    'online_return_costs',
    'product_campaigns',
    'product_campaign_groups',
    'product_campaign_items',
  ]) {
    assert.match(all, new RegExp(`BEFORE TRUNCATE ON "${table}"`), `${table} cannot be truncated`);
  }
  assert.match(campaigns, /A published campaign is history and is never deleted/);
  assert.match(campaigns, /The window and the rules of a published campaign never change/);
});

test('the money of a failed delivery is one formula held by the database', () => {
  assert.match(refunds, /online_failed_delivery_settlements_money/);
  assert.match(refunds, /"refund_vnd" > 0 OR "restock" = 'NOT_SELLABLE'/);
});

test('the price function keeps its columns and gains one candidate', () => {
  assert.match(
    campaigns,
    /CREATE OR REPLACE FUNCTION lucy_variant_price_at\(p_variant uuid, p_at timestamptz\)/,
  );
  assert.match(
    campaigns,
    /RETURNS TABLE \(list_price_vnd bigint, promo_price_vnd bigint, effective_price_vnd bigint, promotion_id uuid\)/,
  );
  assert.match(campaigns, /CREATE FUNCTION lucy_variant_campaign_at/);
});

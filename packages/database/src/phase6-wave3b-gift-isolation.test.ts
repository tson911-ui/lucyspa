import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-18: the gift-stock migrations are additive. The first one only adds two enum values (a new value cannot be used in the
 * transaction that adds it); the second adds one nullable column to each of two tables, replaces two guards, adds one commit-time check,
 * writes no data and grants no permission.
 */
const read = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const kinds = read('20261119000000_phase6_wave3b_gift_kinds');
const text = read('20261119000001_phase6_wave3b_gift_stock');

test('the first migration adds the two movement kinds and nothing else', () => {
  assert.deepEqual(
    [...kinds.matchAll(/\bADD\s+VALUE\s+'(\w+)'/gi)].map((match) => match[1]),
    ['GIFT_OUT', 'GIFT_RETURN'],
  );
  assert.equal([...kinds.matchAll(/;/g)].length, 2);
  assert.doesNotMatch(kinds, /\b(CREATE|DROP|INSERT|UPDATE|DELETE)\b/i);
});

test('the second creates no table and adds only nullable columns', () => {
  assert.doesNotMatch(text, /\bCREATE\s+TABLE\b/i);
  assert.deepEqual(
    [...text.matchAll(/\bADD\s+COLUMN\s+"(\w+)"\s+(\w+)/gi)].map((match) => [match[1], match[2]]),
    [
      ['variant_id', 'UUID'],
      ['reward_manual_use_id', 'UUID'],
    ],
  );
  assert.equal(
    [...text.matchAll(/ADD COLUMN "\w+" UUID;/g)].length,
    2,
    'both columns are nullable',
  );
});

test('it writes no data, grants no permission and drops nothing but the shape check it replaces', () => {
  assert.doesNotMatch(text, /\b(INSERT\s+INTO|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(text, /\bUPDATE\s+"?\w+"?\s+SET\b/i);
  assert.doesNotMatch(text, /role_permissions|GRANT\s/i);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|TRIGGER)\b/i);
  assert.deepEqual(
    [...text.matchAll(/\bDROP\s+CONSTRAINT\s+"?(\w+)"?/gi)].map((match) => match[1]),
    ['stock_movements_kind_shape'],
  );
});

test('a gift movement is one unit, names its use and nothing else; only a gift movement names a use', () => {
  assert.match(
    text,
    /"kind" = 'GIFT_OUT' AND "quantity_delta" = -1 AND "reward_manual_use_id" IS NOT NULL/,
  );
  assert.match(
    text,
    /"kind" = 'GIFT_RETURN' AND "quantity_delta" = 1 AND "reward_manual_use_id" IS NOT NULL/,
  );
  assert.match(
    text,
    /"stock_movements_gift_link"\s+CHECK \(\("kind" IN \('GIFT_OUT', 'GIFT_RETURN'\)\) = \("reward_manual_use_id" IS NOT NULL\)\)/,
  );
  // Every older kind of the shape stays (the check is widened, never narrowed).
  for (const kind of [
    'RECEIPT',
    'OPENING',
    'ADJUSTMENT',
    'SALE',
    'SALE_REVERSAL',
    'REFUND_RETURN',
    'EXCHANGE_RETURN',
  ]) {
    assert.match(text, new RegExp(`"kind" = '${kind}'`), kind);
  }
});

test('the stock link exists only on a product gift, restricts, and cannot change once a unit was used', () => {
  assert.match(text, /CHECK \("variant_id" IS NULL OR "kind" = 'PRODUCT_GIFT'\)/);
  assert.match(
    text,
    /"reward_catalog_items_variant_id_fkey"\s+FOREIGN KEY \("variant_id"\) REFERENCES "product_variants"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
  assert.match(text, /The stock link of a gift cannot change once a unit was used/);
  assert.match(
    text,
    /"reward_manual_use_id"\) REFERENCES "reward_manual_uses"\("id"\) ON DELETE RESTRICT ON UPDATE RESTRICT/,
  );
});

test('a gift goes back only after its restore, into its own lot, and never more than it took', () => {
  assert.match(text, /A gift goes back to stock only when its use is restored/);
  assert.match(text, /A gift goes back to the lot it was taken from/);
  assert.match(text, /A gift goes back no more than it took/);
  assert.match(text, /A gift use takes one unit/);
  for (const trigger of [
    'reward_manual_uses_gift_balance',
    'reward_manual_use_restorations_gift_balance',
    'stock_movements_gift_balance',
  ]) {
    assert.match(
      text,
      new RegExp(`CREATE CONSTRAINT TRIGGER "${trigger}"[^;]*DEFERRABLE INITIALLY DEFERRED`),
      trigger,
    );
  }
});

test('every function it replaces or creates gets a fixed search_path and no PUBLIC execute', () => {
  assert.match(text, /SET search_path TO pg_catalog, %I, pg_temp/);
  assert.match(text, /REVOKE ALL ON FUNCTION %I\.%I\(\) FROM PUBLIC/);
  for (const name of [
    'lucy_guard_reward_catalog_item',
    'lucy_guard_stock_movement',
    'lucy_check_gift_stock',
  ]) {
    assert.match(text, new RegExp(`'${name}'`), name);
  }
});

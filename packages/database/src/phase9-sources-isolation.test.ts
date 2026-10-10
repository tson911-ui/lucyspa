import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 9 P9-2: the two supplier-import migrations are additive. This guard needs no database. It pins what they may touch: two enum
 * values on their own, then eight new tables and their guards; the one existing table they alter is `permissions` (its catalog
 * semantics constraint is replaced by a wider one). No existing row is written, no permission is granted, nothing is deleted or
 * dropped, and every foreign key of the new tables restricts.
 */
const read = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const codes = read('20261125000000_phase9_permission_codes');
const sources = read('20261125000001_phase9_supplier_sources');
const all = `${codes}\n${sources}`;
const tables = (text: string) =>
  [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]).sort();

test('the enum values are committed on their own, before anything uses them', () => {
  assert.equal(codes.match(/ADD VALUE/g)?.length, 2);
  assert.match(codes, /ADD VALUE 'MANAGE_SUPPLIER_SOURCES'/);
  assert.match(codes, /ADD VALUE 'REVIEW_SUPPLIER_IMPORTS'/);
  assert.doesNotMatch(codes, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
});

test('the second migration creates exactly the eight Phase 9 tables', () => {
  assert.deepEqual(tables(sources), [
    'candidate_images',
    'candidate_sources',
    'import_candidates',
    'import_scans',
    'source_price_observations',
    'source_records',
    'source_value_mappings',
    'supplier_sources',
  ]);
});

test('the only existing table altered is permissions, and only its catalog semantics constraint', () => {
  const created = new Set(tables(sources));
  const altered = [...all.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1]!)
    .filter((table) => !created.has(table));
  assert.deepEqual([...new Set(altered)], ['permissions']);
  assert.deepEqual(
    [...sources.matchAll(/DROP CONSTRAINT "(\w+)"/g)].map((match) => match[1]),
    ['permissions_catalog_semantics'],
  );
  assert.doesNotMatch(all, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
});

test('both new codes are GLOBAL_ONLY in the rewritten constraint and nobody is granted anything', () => {
  const constraint =
    sources.match(/ADD CONSTRAINT "permissions_catalog_semantics"[\s\S]*?\n {2}\);/)?.[0] ?? '';
  assert.ok(constraint.length > 0);
  assert.equal(constraint.match(/'MANAGE_SUPPLIER_SOURCES'/g)?.length, 2);
  assert.equal(constraint.match(/'REVIEW_SUPPLIER_IMPORTS'/g)?.length, 2);
  // They are never in the FINANCIAL or EMPLOYEE_PAY lists (STANDARD data).
  const classification = constraint.slice(constraint.indexOf("'VIEW_EMPLOYEE_PAY'"));
  assert.doesNotMatch(classification, /SUPPLIER/);
  assert.doesNotMatch(all, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(all, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(all, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(all, /role_permissions|GRANT\s/i);
});

test('every foreign key of the new tables restricts: nothing cascades into history', () => {
  const keys = [...sources.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 25, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('history is guarded: sources, scans, records, candidates are never deleted; price observations are append-only', () => {
  for (const table of ['supplier_sources', 'import_scans', 'source_records', 'import_candidates']) {
    assert.match(
      sources,
      new RegExp(`BEFORE (INSERT OR UPDATE OR )?DELETE ON "${table}"`),
      `${table} refuses a delete`,
    );
  }
  assert.match(sources, /BEFORE UPDATE OR DELETE ON "source_price_observations"/);
  assert.match(sources, /append-only/);
});

test('the permission gate is a database rule too, and no column holds a selling price or a cost', () => {
  assert.match(sources, /CONSTRAINT "supplier_sources_enabled_gate" CHECK/);
  assert.match(sources, /NOT "is_enabled" OR \("permission_confirmed_at" IS NOT NULL/);
  assert.match(
    sources,
    /A confirmed permission record cannot change without clearing the confirmation/,
  );
  assert.match(sources, /The address of an enabled source cannot change/);
  // Supplier prices are reference data: the only money columns are the observed prices.
  const moneyColumns = [...sources.matchAll(/"(\w*(price|cost)\w*)"\s+(BIGINT|NUMERIC)/gi)].map(
    (match) => match[1],
  );
  assert.deepEqual(moneyColumns.sort(), ['price_vnd', 'promo_price_vnd']);
  assert.doesNotMatch(sources, /cost_price_vnd|list_price_vnd/);
});

test('at most six images per candidate: positions 0 to 5', () => {
  assert.match(sources, /CHECK \("sort_order" BETWEEN 0 AND 5\)/);
});

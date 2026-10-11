import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-9: the earnings migration is additive. This guard needs no database. It creates exactly two new tables (both empty),
 * alters no existing table, writes no row, keeps earnings immutable (only the claiming payroll run is set, once), and every foreign
 * key restricts.
 */
const sql = readFileSync(
  new URL('../prisma/migrations/20261203000000_phase7_earnings/migration.sql', import.meta.url),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const tables = [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]).sort();

test('the migration creates exactly the two earnings tables and touches nothing else', () => {
  assert.deepEqual(tables, ['pay_earnings', 'pay_seller_overrides']);
  const created = new Set(tables);
  const altered = [...sql.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1]!)
    .filter((table) => !created.has(table));
  assert.deepEqual(altered, []);
  assert.doesNotMatch(sql, /\bDROP\s+/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('an earning is immutable and every foreign key restricts', () => {
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON "pay_earnings"/);
  assert.match(sql, /Earnings are history and are never deleted/);
  assert.match(sql, /An earning never changes; only the payroll run that claims it is set, once/);
  assert.match(sql, /Reversals never exceed the earning they reverse/);
  assert.match(
    sql,
    /BEFORE UPDATE OR DELETE ON "pay_seller_overrides"\s+FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change/,
  );
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 8, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('money is integer VND, signs are checked, and every row names its source once', () => {
  assert.doesNotMatch(sql, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
  assert.match(sql, /CONSTRAINT "pay_earnings_amount_sign" CHECK/);
  assert.match(sql, /CREATE UNIQUE INDEX "pay_earnings_source_key"/);
});

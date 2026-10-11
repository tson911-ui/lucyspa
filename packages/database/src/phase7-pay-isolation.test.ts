import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-8: the pay-rules migration is additive. This guard needs no database. It creates exactly three new tables (all empty:
 * rules ship empty), alters no existing table, writes no row (in particular no salary version is made from the old base salary),
 * keeps history append-only, and every foreign key restricts.
 */
const read = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const sql = read('20261202000000_phase7_pay_rules');
const tables = [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]).sort();

test('the migration creates exactly the three pay tables and no other object it did not name', () => {
  assert.deepEqual(tables, ['commission_rules', 'employee_salary_versions', 'tour_rules']);
  const created = new Set(tables);
  const altered = [...sql.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1]!)
    .filter((table) => !created.has(table));
  assert.deepEqual(altered, []);
  assert.doesNotMatch(sql, /\bDROP\s+/i);
});

test('it writes no row: nothing is backfilled and nothing is granted', () => {
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /base_salary_vnd/);
  assert.doesNotMatch(sql, /role_permissions|GRANT\s/i);
});

test('history is append-only and every foreign key restricts', () => {
  for (const table of tables) {
    assert.match(
      sql,
      new RegExp(
        `BEFORE UPDATE OR DELETE ON "${table}"\\s+FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change`,
      ),
      table,
    );
  }
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 9, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('money is integer VND, a percentage is basis points up to 10000, and a rule has a shape', () => {
  assert.doesNotMatch(sql, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
  assert.match(sql, /"kind" = 'PERCENT' AND "value" BETWEEN 0 AND 10000/);
  assert.match(sql, /CONSTRAINT "commission_rules_scope_shape" CHECK/);
  assert.match(sql, /CREATE UNIQUE INDEX "commission_rules_scope_date_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "tour_rules_date_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "employee_salary_versions_date_key"/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-12: the payroll-run migration is additive. This guard needs no database. It creates exactly the three new tables (all empty),
 * alters no existing table, writes no row, keeps a run moving forward only, keeps everything under a closed run frozen, and every foreign
 * key restricts.
 */
const sql = readFileSync(
  new URL('../prisma/migrations/20261206000000_phase7_payroll_runs/migration.sql', import.meta.url),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('the migration creates exactly the three payroll tables and writes nothing', () => {
  const tables = [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(tables, ['pay_run_items', 'pay_run_lines', 'pay_runs']);
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

test('a run only moves forward, a closed run is frozen, and every foreign key restricts', () => {
  assert.match(sql, /A payroll run is history and is never deleted/);
  assert.match(sql, /A payroll run only moves forward: draft, closed, paid/);
  assert.match(sql, /The payment day of a closed run never changes/);
  assert.match(sql, /Nothing under a closed payroll run can change/);
  assert.match(sql, /A manual payroll item is voided with a reason, never deleted/);
  assert.match(sql, /CREATE UNIQUE INDEX "pay_runs_month_key"/);
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 9, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('money is integer VND and the origin and sign of every item are checked', () => {
  assert.doesNotMatch(sql, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
  assert.match(sql, /CONSTRAINT "pay_run_items_origin" CHECK/);
  assert.match(sql, /CONSTRAINT "pay_run_items_sign" CHECK/);
  assert.match(sql, /CONSTRAINT "pay_run_items_manual_reason" CHECK/);
});

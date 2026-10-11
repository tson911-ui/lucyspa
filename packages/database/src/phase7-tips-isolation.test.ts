import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-10: the tips migration is additive. This guard needs no database. It creates exactly one new table (empty) and its enum,
 * alters no existing table, writes no row, keeps tips immutable (only the claiming payroll run is set, once), and every foreign key
 * restricts.
 */
const sql = readFileSync(
  new URL('../prisma/migrations/20261204000000_phase7_tips/migration.sql', import.meta.url),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('the migration creates exactly the tips table and touches nothing else', () => {
  const tables = [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(tables, ['tips']);
  const altered = [...sql.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1]!)
    .filter((table) => table !== 'tips');
  assert.deepEqual(altered, []);
  assert.doesNotMatch(sql, /\bDROP\s+/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('a tip is immutable and every foreign key restricts', () => {
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON "tips"/);
  assert.match(sql, /Tips are history and are never deleted/);
  assert.match(sql, /A tip never changes; only the payroll run that pays it is set, once/);
  assert.match(
    sql,
    /A tip reversal undoes one tip of the same invoice, person and method, in full/,
  );
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 6, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('money is integer VND, signs are checked, and a reversal happens once', () => {
  assert.doesNotMatch(sql, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
  assert.match(sql, /CONSTRAINT "tips_amount_sign" CHECK/);
  assert.match(sql, /CREATE UNIQUE INDEX "tips_reverses_key"/);
  assert.match(sql, /CREATE UNIQUE INDEX "tips_request_key"/);
});

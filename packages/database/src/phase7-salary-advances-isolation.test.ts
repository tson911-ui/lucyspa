import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-13: the salary-advance migration is additive. This guard needs no database. It creates exactly one new table (empty), adds one
 * nullable column to the payroll item table, writes no row, lets an advance only move forward, keeps one open advance per person, and every
 * foreign key restricts.
 */
const sql = readFileSync(
  new URL(
    '../prisma/migrations/20261207000000_phase7_salary_advances/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('the migration creates one table, adds one nullable column, and writes nothing', () => {
  assert.deepEqual(
    [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
    ['salary_advances'],
  );
  const altered = [
    ...sql.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?\s+(\w+)/gi),
  ].map((match) => `${match[1]}.${match[2]} ${match[3]}`);
  assert.deepEqual(altered, ['pay_run_items.advance_id UUID']);
  assert.doesNotMatch(sql, /\bDROP\s+/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('an advance moves forward only, one is open per person, and every foreign key restricts', () => {
  assert.match(sql, /A salary advance is history and is never deleted/);
  assert.match(sql, /A salary advance only moves forward/);
  assert.match(sql, /A finished stage of a salary advance never changes/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "salary_advances_one_open_key"[^;]*WHERE "status" IN \('REQUESTED', 'APPROVED', 'PAID'\)/,
  );
  assert.match(sql, /CONSTRAINT "pay_run_items_advance_shape" CHECK/);
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 9, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('money is integer VND and every status has the fields it needs', () => {
  assert.doesNotMatch(sql, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
  assert.match(sql, /CONSTRAINT "salary_advances_shape" CHECK/);
  assert.match(sql, /CONSTRAINT "salary_advances_amount" CHECK/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-14: the closing migration is additive. This guard needs no database. It creates one new table (empty), adds foreign keys to the
 * `run_id` columns that are always NULL until a run is closed, adds one nullable column to collaborator work, writes no row, keeps a payslip
 * moving forward only with its printed totals fixed, freezes the work a closed run paid, and every foreign key restricts.
 */
const sql = readFileSync(
  new URL(
    '../prisma/migrations/20261208000000_phase7_payroll_close/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('the migration creates one table and a nullable column, and writes nothing', () => {
  assert.deepEqual(
    [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
    ['payslips'],
  );
  const columns = [
    ...sql.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?\s+ADD\s+COLUMN\s+"?(\w+)"?\s+(\w+)/gi),
  ].map((match) => `${match[1]}.${match[2]} ${match[3]}`);
  assert.deepEqual(columns, ['collaborator_work_occurrences.pay_run_id UUID']);
  assert.doesNotMatch(sql, /\bDROP\s+/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
});

test('a payslip is made for a closed run and moves forward only; paid work is frozen; every foreign key restricts', () => {
  assert.match(sql, /A payslip is made when its run is closed, and starts pending/);
  assert.match(sql, /A payslip keeps its printed totals/);
  assert.match(sql, /A payslip only moves forward: pending, paid, reversed/);
  assert.match(sql, /A finished stage of a payslip never changes/);
  assert.match(sql, /A payslip is history and is never deleted/);
  assert.match(sql, /Work paid by a closed payroll run cannot change; correct it in the next run/);
  assert.match(sql, /Only scheduled work can be taken by a closed payroll run/);
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 11, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('money is integer VND and net pay and tips are two separate amounts', () => {
  assert.doesNotMatch(sql, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
  assert.match(sql, /"net_vnd" BIGINT NOT NULL/);
  assert.match(sql, /"tips_vnd" BIGINT NOT NULL/);
  assert.match(sql, /CONSTRAINT "payslips_amounts" CHECK/);
  assert.match(sql, /CONSTRAINT "payslips_shape" CHECK/);
});

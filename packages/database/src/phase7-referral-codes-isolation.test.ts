import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-10b: the referral-code migration is additive. This guard needs no database. It creates exactly the two new tables (both
 * empty, and no code is written by the migration), alters no existing table, keeps codes immutable and never deleted, keeps the code on an
 * order frozen from the moment it is written, and every foreign key restricts.
 */
const sql = readFileSync(
  new URL(
    '../prisma/migrations/20261205000000_phase7_referral_codes/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('the migration creates exactly the two referral tables and writes nothing', () => {
  const tables = [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1])
    .sort();
  assert.deepEqual(tables, ['employee_referral_codes', 'order_referrals']);
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

test('codes are unique for ever, one active per person, immutable, and the order copy is frozen', () => {
  assert.match(sql, /CREATE UNIQUE INDEX "employee_referral_codes_code_key"/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "employee_referral_codes_one_active_key"[^;]*WHERE "is_active"/,
  );
  assert.match(sql, /CONSTRAINT "employee_referral_codes_code_shape" CHECK/);
  assert.match(sql, /Referral codes are history and are never deleted/);
  assert.match(sql, /A referral code never changes; an active one can only be switched off, once/);
  assert.match(
    sql,
    /BEFORE UPDATE OR DELETE ON "order_referrals"\s+FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change/,
  );
  assert.match(sql, /belongs to an online order that is still being built/);
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 6, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

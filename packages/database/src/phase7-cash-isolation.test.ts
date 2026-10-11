import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-2: the two cash-book migrations are additive. This guard needs no database. It pins what they may touch: five enum values
 * on their own, then five new tables and their guards; the one existing table they alter is `permissions` (its catalog semantics
 * constraint is replaced by a wider one). No existing row is written, no permission is granted, nothing is deleted or dropped, and
 * every foreign key of the new tables restricts.
 */
const read = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const codes = read('20261201000000_phase7_permission_codes');
const cash = read('20261201000001_phase7_cash_foundation');
const all = `${codes}\n${cash}`;
const tables = (text: string) =>
  [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]).sort();

test('the enum values are committed on their own, before anything uses them', () => {
  assert.equal(codes.match(/ADD VALUE/g)?.length, 5);
  for (const code of [
    'MANAGE_PAY_RULES',
    'MANAGE_PAYROLL',
    'APPROVE_PAYROLL',
    'VIEW_CASH',
    'MANAGE_CASH',
  ]) {
    assert.match(codes, new RegExp(`ADD VALUE '${code}'`));
  }
  assert.doesNotMatch(codes, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
});

test('the second migration creates exactly the five Phase 7 cash-book tables', () => {
  assert.deepEqual(tables(cash), [
    'cash_day_closings',
    'cash_funds',
    'finance_go_live',
    'fund_entries',
    'reauth_uses',
  ]);
});

test('the only existing table altered is permissions, and only its catalog semantics constraint', () => {
  const created = new Set(tables(cash));
  const altered = [...all.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1]!)
    .filter((table) => !created.has(table));
  assert.deepEqual([...new Set(altered)], ['permissions']);
  assert.deepEqual(
    [...cash.matchAll(/DROP CONSTRAINT "(\w+)"/g)].map((match) => match[1]),
    ['permissions_catalog_semantics'],
  );
  assert.doesNotMatch(all, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  // The shared helper functions of Phase 9 are reused, never redefined.
  assert.doesNotMatch(cash, /CREATE (OR REPLACE )?FUNCTION lucy_refuse_(delete|change)/);
});

test('the pay and cash codes have the agreed scope and class in the rewritten constraint; nobody is granted anything', () => {
  const constraint =
    cash.match(/ADD CONSTRAINT "permissions_catalog_semantics"[\s\S]*?\n {2}\);/)?.[0] ?? '';
  assert.ok(constraint.length > 0);
  // GLOBAL_ONLY lists (twice): the three payroll codes, never the cash codes.
  for (const code of ['MANAGE_PAY_RULES', 'MANAGE_PAYROLL', 'APPROVE_PAYROLL']) {
    assert.equal(constraint.match(new RegExp(`'${code}'`, 'g'))?.length, 4, code);
  }
  for (const code of ['VIEW_CASH', 'MANAGE_CASH']) {
    assert.equal(constraint.match(new RegExp(`'${code}'`, 'g'))?.length, 2, code);
  }
  const scopePart = constraint.slice(0, constraint.indexOf("'VIEW_EMPLOYEE_PAY'"));
  assert.doesNotMatch(scopePart, /VIEW_CASH|MANAGE_CASH/);
  assert.doesNotMatch(all, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(all, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(all, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(all, /role_permissions|GRANT\s/i);
});

test('every foreign key of the new tables restricts: nothing cascades into history', () => {
  const keys = [...cash.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.ok(keys.length >= 11, `foreign keys: ${keys.length}`);
  assert.deepEqual(
    keys.filter((key) => !/ON DELETE RESTRICT ON UPDATE RESTRICT/.test(key)),
    [],
  );
});

test('the book is history: entries and closings are immutable, the go-live never moves, funds are never deleted', () => {
  for (const table of ['fund_entries', 'cash_day_closings', 'finance_go_live', 'reauth_uses']) {
    assert.match(
      cash,
      new RegExp(
        `BEFORE UPDATE OR DELETE ON "${table}"\\s+FOR EACH ROW EXECUTE FUNCTION lucy_refuse_change`,
      ),
      `${table} is append-only`,
    );
  }
  assert.match(cash, /BEFORE UPDATE OR DELETE ON "cash_funds"/);
  assert.match(cash, /A fund is history and is never deleted/);
  assert.match(cash, /The kind, branch and opening balance of a fund never change/);
});

test('a closed day is locked and the closing arithmetic is a database rule', () => {
  assert.match(cash, /The day is closed: nothing can be added to it/);
  assert.match(cash, /After the closing the book must equal the next-day float/);
  assert.match(cash, /CONSTRAINT "cash_day_closings_expected" CHECK/);
  assert.match(cash, /CONSTRAINT "cash_day_closings_next_float" CHECK/);
  assert.match(cash, /CONSTRAINT "cash_day_closings_reason" CHECK/);
});

test('amounts are integer VND and always positive in the book', () => {
  assert.match(cash, /"amount_vnd" BIGINT NOT NULL/);
  assert.match(cash, /CONSTRAINT "fund_entries_amount_positive" CHECK \("amount_vnd" > 0\)/);
  assert.doesNotMatch(cash, /\b(NUMERIC|DECIMAL|REAL|DOUBLE PRECISION|FLOAT)\b/);
});

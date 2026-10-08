import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-12 follow-up (Owner, 2026-10-08): the Owner's window exception is purely additive. This guard needs no database. It pins
 * what the two migrations may touch: one enum value on its own, then three nullable columns on the return case table, one CHECK, one
 * unique index, the replaced guards of the return tables and one new constraint trigger; nothing else, no data, no permission.
 */
const read = (name: string) => {
  const raw = readFileSync(
    new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url),
    'utf8',
  );
  return raw
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
};
const kind = read('20261112000000_phase6_wave3_return_exception_kind');
const exception = read('20261112000001_phase6_wave3_return_window_exception');

test('the enum value is committed on its own, before anything uses it', () => {
  assert.match(kind, /ALTER TYPE "ProductReturnEventKind" ADD VALUE 'WINDOW_EXCEPTION';/);
  assert.doesNotMatch(kind, /\b(CREATE|DROP|UPDATE|INSERT|DELETE)\b/i);
  assert.equal(kind.match(/ADD VALUE/g)?.length, 1);
});

test('the exception migration alters only the return tables and adds three nullable columns', () => {
  const altered = new Set(
    [...exception.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
  );
  assert.deepEqual([...altered].sort(), ['product_return_cases', 'product_return_events']);
  const columns = [...exception.matchAll(/ADD COLUMN\s+"(\w+)"\s+([A-Z()0-9]+)/g)].map((match) => [
    match[1],
    match[2],
  ]);
  assert.deepEqual(columns, [
    ['window_exception_by_user_id', 'UUID'],
    ['window_exception_reason', 'TEXT'],
    ['window_exception_at', 'TIMESTAMPTZ(3)'],
  ]);
  assert.doesNotMatch(exception, /NOT NULL DEFAULT|ADD COLUMN[^;]*NOT NULL/);
  assert.doesNotMatch(exception, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  assert.doesNotMatch(exception, /\bTRUNCATE\b|\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(exception, /role_permissions|user_permission|PermissionCode/i);
});

test('only the Owner account may carry an exception, only after the window, and it needs its history line', () => {
  assert.match(exception, /u\.kind = 'OWNER'/);
  assert.match(exception, /Only the Owner may approve a return outside its window/);
  assert.match(exception, /An exception is only for a return after its window/);
  assert.match(exception, /"window_exception_by_user_id" = "opened_by_user_id"/);
  assert.match(exception, /btrim\("window_exception_reason"\) <> ''/);
  assert.match(exception, /A return window exception is recorded in the case history/);
  assert.match(exception, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(
    exception,
    /"product_return_events_exception_key"[^;]*WHERE "kind" = 'WINDOW_EXCEPTION'/,
  );
});

test('the rest of the return rules are kept as they were: the windows, the units, the photo rule and the immutability', () => {
  assert.match(exception, /The return window is over/);
  assert.match(exception, /The units claimed on a line cannot exceed the units sold/);
  assert.match(exception, /A product return case is history and is never deleted/);
  assert.match(exception, /A closed return case is immutable/);
  assert.match(exception, /A wrong or damaged product needs a photo taken within 48 hours/);
  assert.match(exception, /Return history is append-only/);
  assert.match(exception, /The facts of a return case never change/);
});

test('every replaced or new function gets a fixed search_path and no PUBLIC execute', () => {
  for (const name of [
    'lucy_guard_product_return_case',
    'lucy_guard_product_return_event',
    'lucy_check_return_exception_event',
  ]) {
    assert.match(exception, new RegExp(`'${name}'`));
  }
  assert.match(exception, /SET search_path TO pg_catalog, %I, pg_temp/);
  assert.match(exception, /REVOKE ALL ON FUNCTION %I\.%I\(\) FROM PUBLIC/);
});

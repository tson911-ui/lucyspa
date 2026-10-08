import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-12: the product return migration is purely additive. This guard needs no database. It pins what the migration may touch:
 * only three new tables, their enums, one sequence and their own functions and triggers, plus the re-added CHECKs of `notifications`;
 * no existing table of POS, invoices, payments, loyalty, stock or permissions changes, no row is written, and no permission is
 * granted (MANAGE_PRODUCT_RETURNS and REFUND_PRODUCTS stay held by nobody).
 */
const NAME = '20261111000000_phase6_wave3_product_returns';
const raw = readFileSync(
  new URL(`../prisma/migrations/${NAME}/migration.sql`, import.meta.url),
  'utf8',
);
const text = raw
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');
const NEW_TABLES = ['product_return_cases', 'product_return_events', 'product_return_photos'];

test('it creates exactly the three return tables and alters nothing but its own tables and notifications', () => {
  const created = [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(created.sort(), [...NEW_TABLES].sort());
  const altered = new Set(
    [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
  );
  assert.deepEqual([...altered].sort(), [...NEW_TABLES, 'notifications'].sort());
  const triggered = new Set(
    [...text.matchAll(/\bCREATE\s+TRIGGER\s+\w+\s+BEFORE[^;]*?\bON\s+"?(\w+)"?/gi)].map(
      (match) => match[1],
    ),
  );
  assert.deepEqual([...triggered].sort(), [
    'product_return_cases',
    'product_return_events',
    'product_return_photos',
  ]);
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
});

test('every foreign key restricts: nothing cascades into return history', () => {
  const keys = [...text.matchAll(/FOREIGN KEY[\s\S]*?;/gi)].map((match) => match[0]);
  assert.ok(keys.length >= 12);
  for (const key of keys) {
    assert.match(key, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
    assert.doesNotMatch(key, /CASCADE|SET NULL/i);
  }
});

test('it writes no data and grants no permission', () => {
  assert.doesNotMatch(text, /\bINSERT\s+INTO\b|\bTRUNCATE\b/i);
  assert.doesNotMatch(text, /role_permissions|user_permission|permissions|PermissionCode/i);
});

test('the notification checks are only widened: every earlier type and entity stays allowed', () => {
  const earlier = readFileSync(
    new URL(
      '../prisma/migrations/20261110000000_phase6_wave2_expired_lot_alert/migration.sql',
      import.meta.url,
    ),
    'utf8',
  );
  const types = (sql: string) =>
    new Set(
      [
        ...(
          /"notifications_type_check" CHECK \("type" IN \(([\s\S]*?)\)\)/.exec(sql)?.[1] ?? ''
        ).matchAll(/'(\w+)'/g),
      ].map((match) => match[1]!),
    );
  const before = types(earlier);
  const after = types(text);
  assert.ok(before.size > 20);
  for (const type of before) assert.ok(after.has(type), type);
  assert.deepEqual(
    [...after].filter((type) => !before.has(type)),
    ['PRODUCT_RETURN_OPENED'],
  );
  const entities = (sql: string) =>
    new Set(
      [
        ...(
          /"notifications_entity_type_check" CHECK \("entity_type" IN\s*\(([\s\S]*?)\)\)/.exec(
            sql,
          )?.[1] ?? ''
        ).matchAll(/'(\w+)'/g),
      ].map((match) => match[1]!),
    );
  const entitiesAfter = entities(text);
  for (const entity of [
    'Booking',
    'Visit',
    'LeaveRequest',
    'Invoice',
    'Branch',
    'ProductVariant',
  ]) {
    assert.ok(entitiesAfter.has(entity), entity);
  }
  assert.ok(entitiesAfter.has('ProductReturnCase'));
});

test('the database derives the window and refuses a case that is not the invoice’s own', () => {
  assert.match(text, /interval '168 hours'/);
  assert.match(text, /interval '48 hours'/);
  assert.doesNotMatch(text, /interval '7 days'/, 'a window is elapsed hours, never calendar days');
  assert.match(text, /"reason" <> 'PERSONAL_PREFERENCE' OR "seal_intact" IS TRUE/);
  assert.match(text, /FOR NO KEY UPDATE/);
  assert.match(text, /The units claimed on a line cannot exceed the units sold/);
  assert.match(text, /A product return case is history and is never deleted/);
  assert.match(text, /Return history is append-only/);
  assert.match(text, /Return evidence is history; a removal keeps a tombstone/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-13 follow-up (Owner, 2026-10-08): the migration is additive. This guard needs no database. It pins what it may touch: one new
 * table (the uses of password confirmations), its guards, one deferred check on the refund table, and the two widened CHECKs of the
 * notifications (a new notice type, never fewer). No existing row is written, no permission is added or granted.
 */
const read = (name: string) =>
  readFileSync(new URL(`../prisma/migrations/${name}/migration.sql`, import.meta.url), 'utf8')
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n');
const text = read('20261114000000_phase6_wave3_refund_password_notice');
const earlier = read('20261111000000_phase6_wave3_product_returns');

test('it creates exactly one table and alters only the one it creates and the notifications', () => {
  assert.deepEqual(
    [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
    ['refund_reauthentication_uses'],
  );
  assert.deepEqual(
    [
      ...new Set([...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1])),
    ].sort(),
    ['notifications', 'refund_reauthentication_uses'],
  );
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
  assert.doesNotMatch(text, /\b(UPDATE\s+\S+\s+SET|DELETE\s+FROM|INSERT\s+INTO)\b/i);
  assert.doesNotMatch(text, /permissions|role_permissions/i, 'no permission is added or granted');
});

test('a confirmation is the key: the person and the instant, once; history is never changed', () => {
  assert.match(text, /PRIMARY KEY \("actor_user_id", "reauthenticated_at"\)/);
  assert.match(text, /BEFORE INSERT OR UPDATE OR DELETE ON "refund_reauthentication_uses"/);
  assert.match(text, /BEFORE TRUNCATE ON "refund_reauthentication_uses"/);
  assert.match(text, /is history and is never changed or deleted/);
  assert.match(
    text,
    /CREATE CONSTRAINT TRIGGER lucy_product_refunds_reauthentication AFTER INSERT ON "product_refunds"/,
  );
  assert.match(text, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(text, /A refund uses its own password confirmation once/);
});

test('the notification checks are only widened: every earlier type and entity stays allowed', () => {
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
    ['PRODUCT_REFUND_MADE'],
  );
  // The pairing: the new notice is about a return case, like the one before it.
  assert.match(
    text,
    /"type" IN \('PRODUCT_RETURN_OPENED', 'PRODUCT_REFUND_MADE'\)\) = \("entity_type" = 'ProductReturnCase'\)/,
  );
  assert.doesNotMatch(text, /notifications_entity_type_check/, 'the entity list is untouched');
});

test('the new functions get the fixed search_path and no PUBLIC execute', () => {
  for (const name of [
    'lucy_guard_refund_reauthentication_use',
    'lucy_check_refund_reauthentication_use',
  ]) {
    assert.ok(text.includes(`'${name}'`), name);
  }
  assert.match(text, /SET search_path TO pg_catalog/);
  assert.match(text, /REVOKE ALL ON FUNCTION/);
});

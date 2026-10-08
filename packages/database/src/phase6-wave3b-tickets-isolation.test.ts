import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-16: the ticket migration is additive. It creates one table and one guard function, writes no data, grants no permission,
 * and stores no token: only the SHA-256 hex of one.
 */
const text = readFileSync(
  new URL(
    '../prisma/migrations/20261117000000_phase6_wave3b_order_tickets/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('it creates exactly one table and alters only that table', () => {
  assert.deepEqual(
    [...text.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]),
    ['product_order_tickets'],
  );
  assert.deepEqual(
    [...new Set([...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]))],
    ['product_order_tickets'],
  );
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|CONSTRAINT|TRIGGER|FUNCTION)\b/i);
});

test('it writes no data and grants no permission', () => {
  assert.doesNotMatch(text, /\b(INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(text, /role_permissions|GRANT\s/i);
});

test('only a hash is stored: 64 hex characters, one active link per order, history never deleted', () => {
  assert.match(text, /"token_hash" CHAR\(64\) NOT NULL/);
  assert.match(text, /"token_hash" ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(text, /CREATE UNIQUE INDEX "product_order_tickets_hash_key"/);
  assert.match(
    text,
    /CREATE UNIQUE INDEX "product_order_tickets_active_key"[^;]*WHERE "revoked_at" IS NULL/,
  );
  assert.match(text, /A ticket link is history and is never deleted/);
  assert.match(text, /A ticket link is revoked once/);
  assert.match(text, /BEFORE TRUNCATE ON "product_order_tickets"/);
  assert.doesNotMatch(text, /"token"\s/);
});

test('every foreign key restricts', () => {
  const keys = [...text.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.equal(keys.length, 3);
  for (const key of keys) assert.match(key, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
});

test('its function gets a fixed search_path and no PUBLIC execute', () => {
  assert.match(text, /SET search_path TO pg_catalog, %I, pg_temp/);
  assert.match(text, /REVOKE ALL ON FUNCTION %I\.lucy_guard_product_order_ticket\(\) FROM PUBLIC/);
});

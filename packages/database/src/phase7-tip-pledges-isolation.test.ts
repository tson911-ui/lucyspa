import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 7 P7-17: the tip-pledge migration is additive. This guard needs no database. It creates exactly one new table (empty), adds one
 * nullable column to `tips` and nothing else, writes no row, keeps a pledge immutable and tied to a new PayOS request of the invoice's own
 * KTV, and every foreign key restricts.
 */
const sql = readFileSync(
  new URL('../prisma/migrations/20261209000000_phase7_tip_pledges/migration.sql', import.meta.url),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('the migration creates one table, adds one nullable column to tips, and writes nothing', () => {
  const tables = [...sql.matchAll(/\bCREATE\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(tables, ['payment_tip_pledges']);
  const altered = [...sql.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)]
    .map((match) => match[1]!)
    .filter((table) => table !== 'payment_tip_pledges');
  assert.deepEqual([...new Set(altered)], ['tips']);
  assert.match(sql, /ALTER TABLE "tips" ADD COLUMN "payment_id" UUID;/);
  assert.doesNotMatch(sql, /\bDROP\s+/i);
  assert.doesNotMatch(sql, /\bINSERT\s+INTO\b/i);
  assert.doesNotMatch(sql, /\bUPDATE\s+\w+\s+SET\b/i);
  assert.doesNotMatch(sql, /\bDELETE\s+FROM\b/i);
  assert.doesNotMatch(sql, /ALTER TYPE/i);
  assert.doesNotMatch(sql, /NOT NULL;/);
});

test('a pledge is a whole number of thousands, frozen, for a KTV of the invoice, and one per person and payment', () => {
  assert.match(sql, /CONSTRAINT "payment_tip_pledges_amount" CHECK/);
  assert.match(sql, /"amount_vnd" % 1000 = 0/);
  assert.match(sql, /CREATE UNIQUE INDEX "payment_tip_pledges_person_key"/);
  assert.match(sql, /A tip pledge is history: it is never changed or deleted/);
  assert.match(sql, /A tip is pledged only with a new PayOS request that has no link yet/);
  assert.match(sql, /A tip can only be for a KTV who performed a service on the invoice/);
  assert.match(sql, /BEFORE INSERT OR UPDATE OR DELETE ON "payment_tip_pledges"/);
  assert.match(
    sql,
    /CREATE UNIQUE INDEX "tips_payment_person_key"[^;]*WHERE "payment_id" IS NOT NULL AND "reverses_id" IS NULL/,
  );
  const keys = [...sql.matchAll(/FOREIGN KEY[^;]*?;/gs)].map((match) => match[0]);
  assert.equal(keys.length, 3);
  for (const key of keys) assert.match(key, /ON DELETE RESTRICT ON UPDATE RESTRICT/);
});

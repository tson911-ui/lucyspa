import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 P6-11 (OQ-75 changed): the expired-lot alert adds ONE migration that only widens two CHECKs of `notifications`. This guard
 * pins exactly that (it needs no database): no drop of anything but the two constraints it re-adds at once, no data statement, no
 * other table, no function, no permission.
 */
const NAME = '20261110000000_phase6_wave2_expired_lot_alert';
const text = readFileSync(
  new URL(`../prisma/migrations/${NAME}/migration.sql`, import.meta.url),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('it alters only the notifications table and re-adds each constraint it drops', () => {
  const altered = [...text.matchAll(/\bALTER\s+TABLE\s+"?(\w+)"?/gi)].map((match) => match[1]);
  assert.deepEqual(altered, ['notifications']);
  const drops = [...text.matchAll(/\bDROP\s+CONSTRAINT\s+("[^"]+")/gi)].map((match) => match[1]!);
  assert.deepEqual(drops, ['"notifications_type_check"', '"notifications_type_entity"']);
  for (const name of drops) assert.match(text, new RegExp(`ADD CONSTRAINT ${name} CHECK`));
  assert.doesNotMatch(text, /\bDROP\s+(TABLE|COLUMN|TYPE|INDEX|SCHEMA|TRIGGER|FUNCTION)\b/i);
});

test('it writes no data, creates nothing and grants no permission', () => {
  assert.doesNotMatch(text, /\b(INSERT|UPDATE|DELETE|TRUNCATE|CREATE|RENAME)\b/i);
  assert.doesNotMatch(text, /PermissionCode|permissions/i);
});

test('it widens: every earlier type is still allowed and only EXPIRED_LOT_SOLD is new', () => {
  const earlier = readFileSync(
    new URL(
      '../prisma/migrations/20261106000008_phase6_notification_kinds/migration.sql',
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
    ['EXPIRED_LOT_SOLD'],
  );
});

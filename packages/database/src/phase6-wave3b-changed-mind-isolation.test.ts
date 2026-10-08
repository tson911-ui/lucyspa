import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

/**
 * Phase 6 Wave 3b follow-up (the Owner, 2026-10-09; OQ-32): the refund of a cancelled pre-order line may be a part of the share when the
 * customer changed their mind. The migration replaces ONE guard function and nothing else: no table, no column, no data, no permission.
 */
const text = readFileSync(
  new URL(
    '../prisma/migrations/20261120000000_phase6_wave3b_changed_mind_refund/migration.sql',
    import.meta.url,
  ),
  'utf8',
)
  .split('\n')
  .map((line) => line.replace(/--.*$/, ''))
  .join('\n');

test('it replaces one function and touches no table, column, row or permission', () => {
  assert.deepEqual(
    [...text.matchAll(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(\w+)\(/gi)].map((match) => match[1]),
    ['lucy_guard_product_refund'],
  );
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|TYPE|INDEX|TRIGGER|CONSTRAINT)\b/i);
  assert.doesNotMatch(text, /\bADD\s+COLUMN\b|\bDROP\s+COLUMN\b/i);
  assert.doesNotMatch(text, /\b(INSERT\s+INTO|DELETE\s+FROM)\b/i);
  assert.doesNotMatch(text, /\bUPDATE\s+"?\w+"?\s+SET\b/i);
  assert.doesNotMatch(text, /role_permissions|GRANT\s/i);
});

test('only the change of mind may be a part: 1 VND up to the whole share, every other refund is exactly the share', () => {
  assert.match(text, /oline\.cancel_cause = 'CUSTOMER_CHANGED_MIND'/);
  assert.match(text, /NEW\.amount_vnd < 1 OR NEW\.amount_vnd > after_share - before_share/);
  assert.match(text, /ELSIF NEW\.amount_vnd <> after_share - before_share THEN/);
});

test('the rest of the guard is kept: all the units, one claim, running totals, immutable history', () => {
  assert.match(text, /NEW\.quantity <> oline\.quantity/);
  assert.match(text, /prior_units <> 0/);
  assert.match(text, /NEW\.line_units_after <> prior_units \+ NEW\.quantity/);
  assert.match(text, /NEW\.invoice_refunded_after_vnd <> prior_invoice \+ NEW\.amount_vnd/);
  assert.match(text, /A product refund is history and is never changed or deleted/);
  assert.match(text, /A refund needs a paid invoice/);
});

test('the function keeps the Phase 1 convention: fixed search_path and no PUBLIC execute', () => {
  assert.match(
    text,
    /ALTER FUNCTION %I\.lucy_guard_product_refund\(\) SET search_path TO pg_catalog, %I, pg_temp/,
  );
  assert.match(text, /REVOKE ALL ON FUNCTION %I\.lucy_guard_product_refund\(\) FROM PUBLIC/);
});

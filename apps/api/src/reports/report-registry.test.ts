import { REPORT_DEFINITIONS, REPORT_LIMITS } from '@lucy-spa/contracts';
import { PERMISSION_CATALOG } from '@lucy-spa/database';
import assert from 'node:assert/strict';
import { test } from 'node:test';

/**
 * Phase 8 (P8-T7): the report catalogue is shared by the API, the web menu and the tests. A report with no permission, an unknown
 * permission, or a pay/profit report whose file does not ask for the password would be a leak, so each is a test failure.
 */
test('every report has a unique id, a known area and at least one known permission', () => {
  const known = new Set<string>(PERMISSION_CATALOG.map((entry) => entry.code));
  const ids = new Set<string>();
  for (const definition of REPORT_DEFINITIONS) {
    assert.ok(!ids.has(definition.id), `duplicate ${definition.id}`);
    ids.add(definition.id);
    assert.ok(definition.requires.length > 0, `${definition.id} has no permission`);
    for (const permission of [...definition.requires, ...(definition.columnPermissions ?? [])]) {
      assert.ok(known.has(permission), `${definition.id}: ${permission} is not in the catalogue`);
    }
  }
});

test('pay, profit and cost reports ask for the fresh password when a file is taken', () => {
  for (const definition of REPORT_DEFINITIONS) {
    const sensitive = [...definition.requires, ...(definition.columnPermissions ?? [])].some(
      (permission) => permission === 'VIEW_EMPLOYEE_PAY' || permission === 'VIEW_PROFIT',
    );
    if (sensitive) assert.equal(definition.exportReauth, true, definition.id);
  }
});

test('the profit report needs the Owner-only permission and the Owner decisions are the limits', () => {
  const profit = REPORT_DEFINITIONS.find((definition) => definition.id === 'profit');
  assert.deepEqual(profit?.requires, ['VIEW_PROFIT']);
  const catalog = PERMISSION_CATALOG.find((entry) => entry.code === 'VIEW_PROFIT');
  assert.equal(catalog?.scopeCapability, 'GLOBAL_ONLY');
  assert.equal(REPORT_LIMITS.maxExportRows, 100_000); // OQ-P8-6
  assert.equal(REPORT_LIMITS.maxDays, 366); // OQ-P8-9
});

test('the four new permissions are in the catalogue with the agreed scope', () => {
  const scope = (code: string) =>
    PERMISSION_CATALOG.find((entry) => entry.code === code)?.scopeCapability;
  assert.equal(scope('EXPORT_REPORTS'), 'BRANCH_CAPABLE');
  assert.equal(scope('VIEW_STAFF_REPORTS'), 'BRANCH_CAPABLE');
  assert.equal(scope('VIEW_PROFIT'), 'GLOBAL_ONLY');
  assert.equal(scope('VIEW_REVIEWS'), 'BRANCH_CAPABLE');
  assert.equal(PERMISSION_CATALOG.length, 77);
});

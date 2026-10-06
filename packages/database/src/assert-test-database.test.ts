import assert from 'node:assert/strict';
import { test } from 'node:test';

// The preload module judges the real environment on import, so the pure judge is exercised through a dynamic import
// with a safe DATABASE_URL in place.
process.env['DATABASE_URL'] = 'postgresql://u:p@127.0.0.1:5432/lucy_spa_unit_scratch_1';
const { judgeTestDatabase } = await import('./assert-test-database.js');

const url = (name: string, host = '127.0.0.1') => `postgresql://u:p@${host}:5432/${name}`;

test('scratch and test database names are accepted on this machine', () => {
  for (const name of [
    'lucy_spa_p5_6_scratch_20261005',
    'lucy_spa_uxaudit_20261001',
    'lucy_spa_p5_3_validation_20261004',
    'lucy_spa_authtest',
    'lucy_test',
  ]) {
    assert.equal(judgeTestDatabase(url(name), false).allowed, true, name);
  }
});

test('the development and a production database are refused, even with CI set elsewhere', () => {
  for (const name of ['lucy_spa_dev', 'lucy_spa', 'lucy_spa_prod', 'postgres']) {
    assert.equal(judgeTestDatabase(url(name), false).allowed, false, name);
  }
  assert.equal(judgeTestDatabase(url('lucy_spa_prod'), true).allowed, false);
  assert.equal(judgeTestDatabase(url('lucy_spa'), true).allowed, false);
});

test('only the CI job container database is accepted under CI=true', () => {
  assert.equal(judgeTestDatabase(url('lucy_spa_dev'), true).allowed, true);
  assert.equal(judgeTestDatabase(url('lucy_spa_dev'), false).allowed, false);
});

// CI failure of 39ad8d1: several database test files ran at the same time on one database. Their tests run `TRUNCATE ...`
// (to prove the history guards), which needs ACCESS EXCLUSIVE on the tables before any trigger can refuse it, so two
// files that have both written fixtures deadlock (SQLSTATE 40P01, "deadlock detected"). The files must run one at a time.
test('database integration files never run in parallel (TRUNCATE tests need the tables to themselves)', async () => {
  const { readFile } = await import('node:fs/promises');
  const manifest = JSON.parse(
    await readFile(new URL('../package.json', import.meta.url), 'utf8'),
  ) as {
    scripts: Record<string, string>;
  };
  const runs = (manifest.scripts['test:integration'] ?? '')
    .split('&&')
    .filter((part) => part.includes('--test '));
  assert.ok(runs.length >= 2, 'the integration script runs node --test');
  for (const run of runs) assert.match(run, /--test-concurrency=1\b/, run.trim().slice(0, 80));
});

test('a remote host, a missing or broken URL is refused', () => {
  assert.equal(judgeTestDatabase(url('lucy_spa_scratch', 'db.example.com'), false).allowed, false);
  assert.equal(judgeTestDatabase(undefined, false).allowed, false);
  assert.equal(judgeTestDatabase('not a url', false).allowed, false);
});

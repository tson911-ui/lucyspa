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

test('a remote host, a missing or broken URL is refused', () => {
  assert.equal(judgeTestDatabase(url('lucy_spa_scratch', 'db.example.com'), false).allowed, false);
  assert.equal(judgeTestDatabase(undefined, false).allowed, false);
  assert.equal(judgeTestDatabase('not a url', false).allowed, false);
});

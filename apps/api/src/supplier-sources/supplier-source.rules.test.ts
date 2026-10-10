import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AuthError } from '../auth/auth.error.js';
import { normalizeSourceUrl, shopToday, sourceGaps } from './supplier-source.rules.js';

const complete = {
  isEnabled: false,
  permissionGivenBy: 'Chị Hà',
  permissionMethod: 'Zalo',
  permissionDate: new Date('2026-10-01T00:00:00.000Z'),
  permitsText: true,
  permitsImages: false,
  permissionConfirmedAt: new Date('2026-10-02T03:00:00.000Z'),
};

test('the gate lists what is missing in the order a person fixes it', () => {
  assert.deepEqual(sourceGaps(complete), []);
  assert.deepEqual(
    sourceGaps({
      ...complete,
      permissionGivenBy: null,
      permissionMethod: null,
      permissionDate: null,
      permitsText: false,
      permissionConfirmedAt: null,
    }),
    ['PERMISSION_RECORD', 'PERMISSION_COVERAGE', 'PERMISSION_CONFIRMATION'],
  );
  assert.deepEqual(sourceGaps({ ...complete, permissionMethod: null }), ['PERMISSION_RECORD']);
  assert.deepEqual(sourceGaps({ ...complete, permissionDate: null }), ['PERMISSION_RECORD']);
  assert.deepEqual(sourceGaps({ ...complete, permitsText: false }), ['PERMISSION_COVERAGE']);
  assert.deepEqual(sourceGaps({ ...complete, permitsText: false, permitsImages: true }), []);
  assert.deepEqual(sourceGaps({ ...complete, permissionConfirmedAt: null }), [
    'PERMISSION_CONFIRMATION',
  ]);
});

test('permission to reuse prices is not part of the gate: text or images is enough', () => {
  // `permitsPrices` is not a gate input at all (Owner answer 2): source prices stay internal reference data.
  assert.deepEqual(sourceGaps({ ...complete, permitsText: false, permitsImages: false }), [
    'PERMISSION_COVERAGE',
  ]);
});

test('an enabled source has no gaps left to show', () => {
  assert.deepEqual(sourceGaps({ ...complete, isEnabled: true, permissionConfirmedAt: null }), []);
});

test('a source address is https, a real host name, with no port, credentials, query or fragment', () => {
  assert.equal(normalizeSourceUrl('https://haruohui.com/'), 'https://haruohui.com/');
  assert.equal(normalizeSourceUrl('  https://HaruOhui.com  '), 'https://haruohui.com/');
  assert.equal(
    normalizeSourceUrl('https://shop.example.com/danh-muc'),
    'https://shop.example.com/danh-muc/',
  );
  assert.equal(
    normalizeSourceUrl('https://shop.example.com/a/b/'),
    'https://shop.example.com/a/b/',
  );
  for (const bad of [
    'http://haruohui.com/',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://[::1]/',
    'https://[2001:db8::1]/',
    'https://localhost/',
    'https://printer.local/',
    'https://db.internal/',
    'https://intranet/',
    'https://shop.example.com./',
    'https://user@shop.example.com/',
    'https://user:pw@shop.example.com/',
    'https://shop.example.com:8443/',
    'https://shop.example.com/?x=1',
    'https://shop.example.com/#a',
    'https://shop example.com/',
    'https://shop.example.com/\nevil',
    'javascript:alert(1)',
    '//shop.example.com/',
    '',
    '   ',
    `https://shop.example.com/${'a'.repeat(500)}`,
  ]) {
    assert.throws(
      () => normalizeSourceUrl(bad),
      (error) => error instanceof AuthError && error.code === 'VALIDATION_FAILED',
      bad,
    );
  }
  assert.throws(() => normalizeSourceUrl(42), AuthError);
  assert.throws(() => normalizeSourceUrl(null), AuthError);
});

test('the shop calendar day is the Ho Chi Minh one, not UTC', () => {
  // 18:30 UTC on the 9th is already the 10th at 01:30 in Vietnam.
  assert.equal(shopToday(new Date('2026-10-09T18:30:00.000Z')), '2026-10-10');
  assert.equal(shopToday(new Date('2026-10-09T16:59:59.000Z')), '2026-10-09');
});

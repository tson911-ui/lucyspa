import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitTagline } from './tagline';

test('a tagline with a dash becomes two lines and the dash is not drawn', () => {
  assert.deepEqual(splitTagline('Thư Giãn Tận Tâm – Nâng Tầm Nhan Sắc'), [
    'Thư Giãn Tận Tâm',
    'Nâng Tầm Nhan Sắc',
  ]);
  assert.deepEqual(splitTagline('Thư giãn - Nâng tầm'), ['Thư giãn', 'Nâng tầm']);
  assert.deepEqual(splitTagline('A — B'), ['A', 'B']);
});

test('a tagline without a spaced dash stays one line; hyphenated words are not split', () => {
  assert.deepEqual(splitTagline('Lucy Spa'), ['Lucy Spa', null]);
  assert.deepEqual(splitTagline('  Spa thư-giãn  '), ['Spa thư-giãn', null]);
});

test('more than one dash keeps the first part as line one and joins the rest', () => {
  assert.deepEqual(splitTagline('Một – Hai – Ba'), ['Một', 'Hai – Ba']);
});

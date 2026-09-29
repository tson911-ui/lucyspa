import assert from 'node:assert/strict';
import test from 'node:test';
import { foldSearch, likeLiteral, searchTokens } from './employee-search.js';

test('folding is case- and diacritic-insensitive and IME-independent', () => {
  assert.equal(foldSearch('Trần Hoàng Anh Thư'), 'tran hoang anh thu');
  assert.equal(foldSearch('TRẦN H'), 'tran h');
  assert.equal(foldSearch('Đặng Văn Ơn'), 'dang van on');
  // Decomposed (NFD) input from another IME folds to the same text.
  assert.equal(foldSearch('Tra\u0302\u0300n H'.normalize('NFD')), 'tran h');
  assert.equal(foldSearch('LUCY01'), 'lucy01');
});

test('terms are whitespace-separated folded words', () => {
  assert.deepEqual(searchTokens('  trần   h '), ['tran', 'h']);
  assert.deepEqual(searchTokens('   '), []);
});

test('LIKE metacharacters in user input are escaped literally', () => {
  const backslash = String.fromCharCode(92);
  assert.equal(likeLiteral('100%_x'), `100${backslash}%${backslash}_x`);
  assert.equal(likeLiteral(backslash), backslash + backslash);
  assert.equal(likeLiteral('tran'), 'tran');
});

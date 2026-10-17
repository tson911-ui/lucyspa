import assert from 'node:assert/strict';
import { test } from 'node:test';
import { listFormat, metaLine, minutes, percentNumber, sentence, signedNumber } from './pos-format';

// Session 10 (Step 5): the counter screens build their fact lines through Intl, never with a hand-written " · " or "′".

test('a fact line is a comma list without the middle dot, and empty parts leave no stray separator', () => {
  assert.equal(metaLine('vi', ['Gội đầu', 'bản thân', 'Lan']), 'Gội đầu, bản thân, Lan');
  assert.equal(metaLine('vi', ['Gội đầu', null, '', false, undefined, 'Lan']), 'Gội đầu, Lan');
  assert.equal(metaLine('en', ['Massage']), 'Massage');
  assert.ok(!metaLine('vi', ['A', 'B']).includes('·'));
});

test('names are joined the way each language joins them', () => {
  assert.equal(listFormat('vi').format(['Lan', 'Mai', 'Hoa']), 'Lan, Mai và Hoa');
  assert.equal(listFormat('en').format(['Lan', 'Mai', 'Hoa']), 'Lan, Mai, and Hoa');
});

test('durations, signed differences and percentages come from Intl', () => {
  assert.equal(minutes('vi', 45), '45 phút');
  assert.equal(minutes('en', 45), '45 min');
  assert.equal(signedNumber('vi', 2), '+2');
  assert.equal(signedNumber('vi', -2), '-2');
  assert.equal(signedNumber('vi', 0), '0');
  assert.equal(percentNumber('vi', 550), '5,5');
  assert.equal(percentNumber('en', 550), '5.5');
  assert.equal(percentNumber('vi', 1000), '10');
});

test('a dictionary fragment becomes a sentence: a stop only where one is missing', () => {
  assert.equal(sentence('Giảm 50.000 ₫'), 'Giảm 50.000 ₫.');
  assert.equal(sentence('Ưu đãi duy nhất đủ điều kiện.'), 'Ưu đãi duy nhất đủ điều kiện.');
  assert.equal(sentence('Chủ combo: Lan '), 'Chủ combo: Lan.');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEntries, batches, sumResults } from './product-text-cleanup';

const item = (id: string, rowVersion = 1) => ({
  id,
  code: id,
  nameVi: id,
  rowVersion,
  textHash: id.repeat(64).slice(0, 64),
  removedEntries: 3,
  removedChars: 600,
});

test('only the products that are not skipped go to the server, with the numbers of the preview', () => {
  const entries = applyEntries([item('a', 2), item('b'), item('c', 5)], new Set(['b']));
  assert.deepEqual(
    entries.map((entry) => [entry.id, entry.rowVersion]),
    [
      ['a', 2],
      ['c', 5],
    ],
  );
  assert.equal(entries[0]!.textHash.length, 64);
});

test('calls hold at most 100 entries and keep the order', () => {
  const many = Array.from({ length: 250 }, (_, index) => index);
  const parts = batches(many);
  assert.deepEqual(
    parts.map((part) => part.length),
    [100, 100, 50],
  );
  assert.deepEqual(parts.flat(), many);
  assert.deepEqual(batches([]), []);
});

test('results of several calls add up', () => {
  assert.deepEqual(
    sumResults([
      { cleaned: 70, skipped: [] },
      { cleaned: 1, skipped: [{ id: 'x', reason: 'CHANGED' }] },
    ]),
    { cleaned: 71, skipped: 1 },
  );
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  bulkSelection,
  EMPTY_SELECTION,
  selected,
  selectionCount,
  selectPage,
  toggleMember,
  type MemberSelection,
} from './teams';

test('explicit checkbox selection toggles, pages and counts', () => {
  let selection: MemberSelection = EMPTY_SELECTION;
  selection = toggleMember(selection, 'a');
  selection = selectPage(selection, ['b', 'c', 'a']);
  assert.deepEqual(selection, { kind: 'explicit', ids: ['a', 'b', 'c'] });
  assert.equal(selectionCount(selection, 500), 3);
  selection = toggleMember(selection, 'b');
  assert.equal(selected(selection, 'b'), false);
  assert.deepEqual(bulkSelection(selection, {}), { userIds: ['a', 'c'] });
});

test('explicit selection is capped at one server batch', () => {
  const selection = selectPage(
    EMPTY_SELECTION,
    Array.from({ length: 150 }, (_, n) => `u${n}`),
  );
  assert.equal(selection.kind === 'explicit' && selection.ids.length, 100);
});

test('select-all-matching tracks exclusions and reports the remaining total', () => {
  let selection: MemberSelection = { kind: 'matching', excluded: [] };
  assert.equal(selected(selection, 'anyone'), true);
  selection = toggleMember(selection, 'x');
  assert.equal(selected(selection, 'x'), false);
  assert.equal(selectionCount(selection, 250), 249);
  selection = selectPage(selection, ['x']);
  assert.equal(selectionCount(selection, 250), 250);
  assert.deepEqual(bulkSelection(selection, { q: 'lan' }), {
    allMatching: true,
    filters: { q: 'lan' },
    excludedUserIds: [],
  });
});

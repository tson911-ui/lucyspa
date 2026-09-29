import assert from 'node:assert/strict';
import test from 'node:test';
import { TEAM_BATCH_SIZE, teamFilters, teamSelection } from './team.selection.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const many = () => Array.from({ length: TEAM_BATCH_SIZE + 1 }, (_, n) => id(n + 1));

test('explicit selection is deduplicated, sorted and bounded', () => {
  const selection = teamSelection({ userIds: [id(3), id(1), id(3)] });
  assert.deepEqual(selection.ids, [id(1), id(3)]);
  assert.throws(() => teamSelection({ userIds: [] }));
  assert.throws(() => teamSelection({ userIds: many() }));
  assert.throws(() => teamSelection({ userIds: ['not-a-uuid'] }));
});

test('all-matching selection carries normalized filters, exclusions and a cursor', () => {
  const selection = teamSelection({
    allMatching: true,
    filters: { q: '  Lan ', status: 'ACTIVE' },
    excludedUserIds: [id(2), id(2)],
    after: id(9),
  });
  assert.equal(selection.ids, null);
  assert.deepEqual(selection.filters, { q: 'Lan', status: 'ACTIVE' });
  assert.deepEqual(selection.excluded, [id(2)]);
  assert.equal(selection.after, id(9));
  assert.throws(() => teamSelection({ allMatching: false, filters: {} } as never));
  assert.throws(() => teamSelection({ allMatching: true, filters: {}, excludedUserIds: many() }));
});

test('filters reject blank, control-character and unknown values', () => {
  assert.throws(() => teamFilters({ q: '   ' }));
  assert.throws(() => teamFilters({ q: 'a\u0000b' }));
  assert.throws(() => teamFilters({ status: 'DELETED' } as never));
  assert.throws(() => teamFilters({ classification: 'ENDED' } as never));
  assert.throws(() => teamFilters({ membership: 'EVERYONE' } as never));
  assert.deepEqual(teamFilters({ membership: 'OTHER_TEAM', classification: 'TRAINEE' }), {
    classification: 'TRAINEE',
    membership: 'OTHER_TEAM',
  });
});

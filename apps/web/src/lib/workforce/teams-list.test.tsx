import assert from 'node:assert/strict';
import test from 'node:test';
import { TeamsScreen } from '../../components/workforce/screens/teams';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, render } from '../../test/support';
import { normalizeTeamList, TEAM_LIST_DEFAULTS, teamListQuery } from './teams-list';

const vi = getWorkforceDictionary('vi');

test('the teams list state is normalized and becomes the API query', () => {
  assert.deepEqual(normalizeTeamList({ ...TEAM_LIST_DEFAULTS, page: -2, pageSize: 7 }), {
    ...TEAM_LIST_DEFAULTS,
  });
  assert.equal(normalizeTeamList({ ...TEAM_LIST_DEFAULTS, pageSize: 50 }).pageSize, 50);
  assert.equal(normalizeTeamList({ ...TEAM_LIST_DEFAULTS, q: 'x'.repeat(300) }).q.length, 100);
  assert.deepEqual(teamListQuery({ q: 'a', branch: 'b1', page: 3, pageSize: 20 }), {
    branchId: 'b1',
    q: 'a',
    page: 3,
    limit: 20,
  });
});

test('the teams page: create is the one header action for managers; no legacy markup', () => {
  const manager = render(<TeamsScreen />, employee([['MANAGE_TEAMS']]));
  assert.ok(manager.includes('Tạo nhóm'));
  assert.equal((manager.match(/<h1/g) ?? []).length, 1);
  assert.doesNotMatch(manager, /<details|<fieldset|wf-table|wf-filters/);
  assert.ok(manager.includes('role="search"'), 'one list toolbar');
  const viewer = render(<TeamsScreen />, employee([['VIEW_TEAMS']]));
  assert.ok(!viewer.includes('>Tạo nhóm<'));
  const nobody = render(<TeamsScreen />, employee([]));
  assert.ok(nobody.includes('Bạn không có quyền xem nội dung này.'));
  assert.ok(vi.common.toastRegion.length > 0);
});

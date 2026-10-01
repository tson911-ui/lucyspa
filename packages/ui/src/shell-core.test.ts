import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SIDEBAR_COLLAPSED_KEY,
  SIDEBAR_GROUPS_KEY,
  arrangeNav,
  currentGroupId,
  initials,
  isPathActive,
  readNavGroupState,
  readSidebarCollapsed,
  writeNavGroupState,
  writeSidebarCollapsed,
  type ShellNavItem,
} from './shell-core';

const item = (id: string): ShellNavItem => ({ id, label: id, href: `/${id}`, icon: 'home' });

test('arrangeNav hides empty groups and renders a single-item group flat', () => {
  const groups = arrangeNav([
    { id: 'overview', label: 'Tổng quan', items: [item('dashboard')] },
    { id: 'sales', label: 'Thanh toán', items: [] },
    { id: 'people', label: 'Nhân sự', items: [item('employees'), item('teams')] },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.id, group.flat]),
    [
      ['overview', true],
      ['people', false],
    ],
  );
  assert.deepEqual(arrangeNav([]), []);
});

test('isPathActive matches the page and its children, never a sibling with a shared prefix', () => {
  assert.equal(isPathActive('/vi/workforce/employees', '/vi/workforce/employees'), true);
  assert.equal(isPathActive('/vi/workforce/employees/42', '/vi/workforce/employees'), true);
  assert.equal(isPathActive('/vi/workforce/employees-archive', '/vi/workforce/employees'), false);
  assert.equal(isPathActive('/vi/workforce/employees/', '/vi/workforce/employees'), true);
  // The dashboard is the parent of everything, so it only matches exactly.
  assert.equal(isPathActive('/vi/workforce/skills', '/vi/workforce', true), false);
  assert.equal(isPathActive('/vi/workforce', '/vi/workforce', true), true);
  assert.equal(isPathActive('/vi/workforce/', '/vi/workforce', true), true);
});

test('initials: first letter of the first and last word, Vietnamese letters intact', () => {
  assert.equal(initials('Nguyễn Văn An'), 'NA');
  assert.equal(initials('  Lan '), 'L');
  assert.equal(initials('đặng thu hà'), 'ĐH');
  assert.equal(initials('   '), '');
});

test('sidebar state is stored as a convenience and survives unusable storage', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
  assert.equal(readSidebarCollapsed(storage), false, 'expanded by default');
  writeSidebarCollapsed(true, storage);
  assert.equal(data.get(SIDEBAR_COLLAPSED_KEY), '1');
  assert.equal(readSidebarCollapsed(storage), true);
  writeSidebarCollapsed(false, storage);
  assert.equal(readSidebarCollapsed(storage), false);
  assert.equal(data.size, 0, 'expanded is the absence of the key');

  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
  assert.equal(readSidebarCollapsed(blocked), false);
  assert.doesNotThrow(() => writeSidebarCollapsed(true, blocked));
});

test('currentGroupId is the headed group holding the current page; a flat group never counts', () => {
  const groups = arrangeNav([
    { id: 'overview', label: 'Tổng quan', items: [{ ...item('dashboard'), current: true }] },
    {
      id: 'people',
      label: 'Nhân sự',
      items: [item('employees'), { ...item('teams'), current: true }],
    },
  ]);
  assert.equal(currentGroupId(groups), 'people');
  assert.equal(
    currentGroupId(arrangeNav([{ id: 'a', label: 'A', items: [item('x'), item('y')] }])),
    undefined,
  );
});

test('sidebar group state round-trips, ignores junk and survives unusable storage', () => {
  const data = new Map<string, string>();
  const storage = {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
  assert.deepEqual(readNavGroupState(storage), {});
  writeNavGroupState({ people: true, sales: false }, storage);
  assert.equal(data.has(SIDEBAR_GROUPS_KEY), true);
  assert.deepEqual(readNavGroupState(storage), { people: true, sales: false });
  data.set(SIDEBAR_GROUPS_KEY, '{"people":true,"x":"yes"}');
  assert.deepEqual(readNavGroupState(storage), { people: true }, 'non-boolean values are dropped');
  for (const junk of ['not json', '[1,2]', 'null', '7']) {
    data.set(SIDEBAR_GROUPS_KEY, junk);
    assert.deepEqual(readNavGroupState(storage), {}, junk);
  }
  const blocked = {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(readNavGroupState(blocked), {});
  assert.doesNotThrow(() => writeNavGroupState({ people: true }, blocked));
});

import type {
  OrganizationAppointment,
  OrganizationArea,
  OrganizationBranch,
  OrganizationRegion,
  OrganizationSnapshotResponse,
} from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { organizationDictionary } from '../../i18n/organization';
import {
  appointmentScope,
  filterAppointments,
  filterAreas,
  filterBranches,
  filterRegions,
  formatScope,
  normalizeOrgList,
  ORG_LIST_DEFAULTS,
} from './organization-list';

const regions: OrganizationRegion[] = [
  { id: 'r1', code: 'NORTH', name: 'Miền Bắc', version: 1, isActive: true },
  { id: 'r2', code: 'SOUTH', name: 'Miền Nam', version: 1, isActive: false },
];
const areas: OrganizationArea[] = [
  { id: 'a1', code: 'HN', name: 'Hà Nội', version: 1, isActive: true, regionId: 'r1' },
  { id: 'a2', code: 'SG', name: 'Sài Gòn', version: 1, isActive: true, regionId: 'r2' },
];
const branches: OrganizationBranch[] = [
  {
    id: 'b1',
    code: 'CN1',
    name: 'Chi nhánh 1',
    version: 1,
    isActive: true,
    areaId: 'a1',
    regionId: 'r1',
  },
  {
    id: 'b2',
    code: 'CN2',
    name: 'Chi nhánh 2',
    version: 1,
    isActive: true,
    areaId: null,
    regionId: null,
  },
];
const snapshot: OrganizationSnapshotResponse = { regions, areas, branches };

function appointment(overrides: Partial<OrganizationAppointment>): OrganizationAppointment {
  return {
    id: 'p',
    userId: 'u',
    fullName: 'Nguyễn Văn An',
    level: 'STORE_MANAGER',
    scope: { kind: 'BRANCH', branchId: 'b1' },
    teamId: null,
    version: 1,
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: null,
    ...overrides,
  };
}

const levels = organizationDictionary('vi').levels;

test('the address-bar state falls back to safe values and is per tab', () => {
  const state = normalizeOrgList({ ...ORG_LIST_DEFAULTS, tab: 'x', filter: 'active', page: 0 });
  assert.equal(state.tab, 'regions');
  assert.equal(state.filter, 'active');
  assert.equal(state.page, 1);
  // A filter of another tab is dropped, a level is valid on appointments only.
  assert.equal(
    normalizeOrgList({ ...ORG_LIST_DEFAULTS, tab: 'branches', filter: 'active' }).filter,
    '',
  );
  assert.equal(
    normalizeOrgList({ ...ORG_LIST_DEFAULTS, tab: 'appointments', filter: 'CEO' }).filter,
    'CEO',
  );
  assert.equal(normalizeOrgList({ ...ORG_LIST_DEFAULTS, q: 'x'.repeat(300) }).q.length, 100);
});

test('regions and areas search code, name and region ignoring accents, and filter by status', () => {
  assert.deepEqual(
    filterRegions(regions, { q: 'mien bac', filter: '' }).map((r) => r.id),
    ['r1'],
  );
  assert.deepEqual(
    filterRegions(regions, { q: '', filter: 'inactive' }).map((r) => r.id),
    ['r2'],
  );
  assert.deepEqual(
    filterAreas(areas, regions, { q: 'mien nam', filter: '' }).map((a) => a.id),
    ['a2'],
  );
  assert.deepEqual(
    filterAreas(areas, regions, { q: 'hn', filter: 'active' }).map((a) => a.id),
    ['a1'],
  );
});

test('branches filter by placement and search the area name', () => {
  assert.deepEqual(
    filterBranches(branches, areas, { q: '', filter: 'unplaced' }).map((b) => b.id),
    ['b2'],
  );
  assert.deepEqual(
    filterBranches(branches, areas, { q: 'ha noi', filter: '' }).map((b) => b.id),
    ['b1'],
  );
  assert.deepEqual(
    filterBranches(branches, areas, { q: '', filter: 'placed' }).map((b) => b.id),
    ['b1'],
  );
});

test('appointments search the person, level and scope name and filter by level', () => {
  const items = [
    appointment({ id: '1' }),
    appointment({ id: '2', fullName: 'Lê Thị Bích', level: 'CEO', scope: { kind: 'GLOBAL' } }),
  ];
  const run = (q: string, filter: string) =>
    filterAppointments(items, snapshot, levels, 'Toàn hệ thống', { q, filter }).map((i) => i.id);
  assert.deepEqual(run('bich', ''), ['2']);
  assert.deepEqual(run('toan he thong', ''), ['2']);
  assert.deepEqual(run('chi nhanh 1', ''), ['1']);
  assert.deepEqual(run('', 'STORE_MANAGER'), ['1']);
});

test('scope names and the scope an appointment level gets', () => {
  assert.equal(formatScope({ kind: 'GLOBAL' }, snapshot, 'Hệ thống'), 'Hệ thống');
  assert.equal(formatScope({ kind: 'REGION', regionId: 'r1' }, snapshot, ''), 'Miền Bắc');
  assert.equal(formatScope({ kind: 'AREA', areaId: 'zz' }, snapshot, ''), 'zz');
  assert.deepEqual(appointmentScope('CEO', ''), { kind: 'GLOBAL' });
  assert.deepEqual(appointmentScope('AREA_MANAGER', 'a1'), { kind: 'AREA', areaId: 'a1' });
  assert.deepEqual(appointmentScope('DEPUTY_STORE_MANAGER', 'b1'), {
    kind: 'BRANCH',
    branchId: 'b1',
  });
});

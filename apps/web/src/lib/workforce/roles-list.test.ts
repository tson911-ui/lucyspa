import type { RoleResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import test from 'node:test';
import { filterRoles, normalizeRoleList, ROLE_LIST_DEFAULTS, roleSortValue } from './roles-list';

const role = (overrides: Partial<RoleResponse>): RoleResponse => ({
  id: 'r1',
  code: 'TECHNICIAN',
  displayNameVi: 'Kỹ thuật viên',
  displayNameEn: 'Technician',
  isActive: true,
  isManagerGroup: false,
  permissions: ['VIEW_ATTENDANCE', 'APPROVE_LEAVE'],
  version: 1,
  ...overrides,
});
const roles = [
  role({}),
  role({
    id: 'r2',
    code: 'MANAGER_A',
    displayNameVi: 'Quản lý',
    displayNameEn: 'Manager',
    isActive: false,
  }),
];

test('the address bar state is normalized to known sort keys, status and page sizes', () => {
  assert.deepEqual(
    normalizeRoleList({ ...ROLE_LIST_DEFAULTS, sort: 'nope', status: 'x', page: 0 }),
    {
      ...ROLE_LIST_DEFAULTS,
    },
  );
  assert.equal(
    normalizeRoleList({ ...ROLE_LIST_DEFAULTS, sort: 'permissions' }).sort,
    'permissions',
  );
  assert.equal(normalizeRoleList({ ...ROLE_LIST_DEFAULTS, status: 'inactive' }).status, 'inactive');
  assert.equal(normalizeRoleList({ ...ROLE_LIST_DEFAULTS, q: 'x'.repeat(200) }).q.length, 100);
});

test('search ignores case and accents across code and both names; status narrows', () => {
  const only = (q: string, status = '') => filterRoles(roles, { q, status }).map((r) => r.id);
  assert.deepEqual(only(''), ['r1', 'r2']);
  assert.deepEqual(only('ky thuat'), ['r1']);
  assert.deepEqual(only('MANAGER'), ['r2']);
  assert.deepEqual(only('quan ly'), ['r2']);
  assert.deepEqual(only('', 'active'), ['r1']);
  assert.deepEqual(only('', 'inactive'), ['r2']);
  assert.deepEqual(only('manager', 'active'), []);
});

test('sort values follow the shown language, the permission count and the status', () => {
  const [technician] = roles;
  assert.equal(roleSortValue(technician!, 'name', 'vi'), 'Kỹ thuật viên');
  assert.equal(roleSortValue(technician!, 'name', 'en'), 'Technician');
  assert.equal(roleSortValue(technician!, 'permissions', 'vi'), 2);
  assert.equal(roleSortValue(technician!, 'code', 'vi'), 'TECHNICIAN');
  assert.equal(roleSortValue(technician!, 'status', 'vi'), 0);
  assert.equal(roleSortValue(roles[1]!, 'status', 'vi'), 1);
});

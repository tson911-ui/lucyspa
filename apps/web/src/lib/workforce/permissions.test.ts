import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customer, employee, owner } from '../../test/support';
import { canAcross, canAnywhere, canAt, canGlobal, navigationFor } from './permissions';

const keys = (account: Parameters<typeof navigationFor>[0]) =>
  navigationFor(account).map((item) => item.key);

test('navigation follows effective permissions, not hard-coded roles', () => {
  assert.deepEqual(
    keys(employee()),
    ['dashboard', 'myAccount', 'myIncome', 'attendance', 'leave'],
    'self-service only',
  );
  assert.deepEqual(keys(customer), [], 'customers get no workforce navigation');
  assert.deepEqual(keys(owner), [
    'dashboard',
    'myAccount',
    'myIncome',
    'attendance',
    'leave',
    'collaboratorSchedule',
    'branches',
    'services',
    'skills',
    'employees',
    'roles',
  ]);
  assert.deepEqual(
    keys(
      employee([
        ['VIEW_EMPLOYEES', 'A'],
        ['MANAGE_SKILLS', 'A'],
      ]),
    ),
    ['dashboard', 'myAccount', 'myIncome', 'attendance', 'leave', 'skills', 'employees'],
  );
  assert.ok(keys(employee([['MANAGE_SERVICE_PRICES']])).includes('services'));
  // Roles & permissions: MANAGE_PERMISSIONS in any scope (branch administrators read only).
  assert.ok(keys(employee([['MANAGE_PERMISSIONS', 'A']])).includes('roles'));
  assert.ok(!keys(employee([['VIEW_EMPLOYEES']])).includes('roles'));
  assert.ok(!keys(employee([['APPROVE_LEAVE', 'A']])).includes('employees'));
});

test('the Owner reaches operations pages through its permissions (it has no self-service)', () => {
  const owned = navigationFor(owner).find((item) => item.key === 'attendance');
  assert.ok(owned, 'Owner holds every permission, including VIEW_ATTENDANCE');
});

test('scope semantics: GLOBAL covers branches, branch grants never global, denies win', () => {
  const branchManager = employee([['MANAGE_BRANCHES', 'A']]);
  assert.equal(canAt(branchManager, 'MANAGE_BRANCHES', 'A'), true);
  assert.equal(canAt(branchManager, 'MANAGE_BRANCHES', 'B'), false);
  assert.equal(canGlobal(branchManager, 'MANAGE_BRANCHES'), false, 'cannot create branches');
  const global = employee([['VIEW_ATTENDANCE']], [['VIEW_ATTENDANCE', 'B']]);
  assert.equal(canAt(global, 'VIEW_ATTENDANCE', 'A'), true);
  assert.equal(canAt(global, 'VIEW_ATTENDANCE', 'B'), false, 'branch deny');
  const denied = employee([['APPROVE_LEAVE', 'A']], [['APPROVE_LEAVE']]);
  assert.equal(canAnywhere(denied, 'APPROVE_LEAVE'), false, 'global deny');
  assert.ok(!keys(denied).includes('employees'));
});

test('multi-branch actions need every branch; branchless targets need GLOBAL', () => {
  const managerA = employee([['MANAGE_SKILLS', 'A']]);
  assert.equal(canAcross(managerA, 'MANAGE_SKILLS', ['A']), true);
  assert.equal(canAcross(managerA, 'MANAGE_SKILLS', ['A', 'B']), false);
  assert.equal(canAcross(managerA, 'MANAGE_SKILLS', []), false);
  assert.equal(canAcross(employee([['MANAGE_SKILLS']]), 'MANAGE_SKILLS', []), true);
  assert.equal(canAcross(customer, 'MANAGE_SKILLS', ['A']), false);
});

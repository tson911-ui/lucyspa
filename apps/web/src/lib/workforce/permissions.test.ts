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
    // Phase 3 Step 5: the operational booking board (VIEW_BOOKINGS; the Owner holds all).
    'bookingBoard',
    // Phase 3 Step 8: explicit reassignment (REASSIGN_SERVICES).
    'reassignment',
    // Phase 3 Step 6: walk-in intake (MANAGE_BOOKINGS).
    'walkIn',
    // Phase 4 Step 5: Invoice / POS (VIEW_INVOICES).
    'pos',
    'collaboratorSchedule',
    'branches',
    'services',
    // Phase 6 P6-3: the product catalog (GLOBAL MANAGE_PRODUCTS / MANAGE_PRODUCT_PRICES; the Owner holds all).
    'products',
    // Phase 4 Step 6: discount programs and voucher codes (GLOBAL MANAGE_DISCOUNTS / CREATE_VOUCHERS).
    'discounts',
    // Phase 5 P5-3: loyalty points (VIEW_LOYALTY, the exceptions list or the Owner's switch; the Owner holds all).
    'loyalty',
    'skills',
    'employees',
    // Organization hierarchy + teams (VIEW/MANAGE_ORGANIZATION, VIEW/MANAGE_TEAMS; Owner holds all).
    'organization',
    'teams',
    'roles',
    // UX/UI Step 11: the website media library (GLOBAL MANAGE_WEBSITE_CONTENT; the Owner holds all).
    'websiteContent',
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
  // Website content is GLOBAL_ONLY: a global grant opens it; a branch grant or no grant never does.
  assert.ok(keys(employee([['MANAGE_WEBSITE_CONTENT']])).includes('websiteContent'));
  assert.ok(!keys(employee([['MANAGE_WEBSITE_CONTENT', 'A']])).includes('websiteContent'));
  assert.ok(!keys(employee([['VIEW_EMPLOYEES']])).includes('websiteContent'));
  assert.ok(!keys(customer).includes('websiteContent'));
  // The product catalog is GLOBAL_ONLY: either global permission opens it, a branch grant or the cost permission alone never does.
  assert.ok(keys(employee([['MANAGE_PRODUCTS']])).includes('products'));
  assert.ok(keys(employee([['MANAGE_PRODUCT_PRICES']])).includes('products'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS', 'A']])).includes('products'));
  assert.ok(!keys(employee([['VIEW_PRODUCT_COST']])).includes('products'));
  assert.ok(!keys(customer).includes('products'));
  assert.ok(keys(employee([['VIEW_ORGANIZATION', 'A']])).includes('organization'));
  assert.ok(keys(employee([['VIEW_TEAMS', 'A']])).includes('teams'));
  assert.ok(!keys(employee([['VIEW_TEAMS', 'A']])).includes('organization'));
  assert.ok(
    !keys(employee()).includes('teams'),
    'a role or title alone never opens team management',
  );
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

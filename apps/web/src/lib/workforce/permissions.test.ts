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
    // Phase 6 P6-23: promotion campaigns (GLOBAL MANAGE_PRODUCT_PRICES; the Owner holds all).
    'productCampaigns',
    // Phase 6 P6-19: the settings of online sales (GLOBAL MANAGE_PRODUCTS; the Owner holds all).
    'onlineSales',
    // Phase 6 P6-20: the carriers (GLOBAL MANAGE_PRODUCTS; the Owner holds all).
    'shippingCarriers',
    // Phase 9 P9-2: supplier sources (GLOBAL MANAGE_SUPPLIER_SOURCES / REVIEW_SUPPLIER_IMPORTS; the Owner holds all).
    'supplierSources',
    // Phase 6 P6-4: the inventory (branch VIEW_INVENTORY / MANAGE_STOCK_RECEIPTS / ADJUST_STOCK or global MANAGE_PRODUCTS).
    'inventory',
    // Phase 6 P6-5: the Excel/CSV import (GLOBAL IMPORT_PRODUCT_DATA; the Owner holds all).
    'import',
    // Phase 4 Step 6: discount programs and voucher codes (GLOBAL MANAGE_DISCOUNTS / CREATE_VOUCHERS).
    'discounts',
    // Phase 5 P5-3: loyalty points (VIEW_LOYALTY, the exceptions list or the Owner's switch; the Owner holds all).
    'loyalty',
    // Phase 6 P6-17: pre-ordered goods (branch MANAGE_PRODUCT_ORDERS / REFUND_PRODUCTS; the Owner holds all).
    'productOrders',
    // Phase 6 P6-20/P6-21: online orders (branch MANAGE_PRODUCT_ORDERS / REFUND_PRODUCTS; the Owner holds all).
    'onlineOrders',
    // Phase 6 P6-12: product return cases (branch MANAGE_PRODUCT_RETURNS / REFUND_PRODUCTS; the Owner holds all).
    'productReturns',
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
  // Campaigns are GLOBAL_ONLY MANAGE_PRODUCT_PRICES: managing products alone or a branch grant never opens them.
  assert.ok(keys(employee([['MANAGE_PRODUCT_PRICES']])).includes('productCampaigns'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS']])).includes('productCampaigns'));
  assert.ok(!keys(employee([['MANAGE_PRODUCT_PRICES', 'A']])).includes('productCampaigns'));
  assert.ok(!keys(customer).includes('productCampaigns'));
  // The online sales settings are GLOBAL_ONLY MANAGE_PRODUCTS: the prices permission alone and a branch grant never open them.
  assert.ok(keys(employee([['MANAGE_PRODUCTS']])).includes('onlineSales'));
  assert.ok(!keys(employee([['MANAGE_PRODUCT_PRICES']])).includes('onlineSales'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS', 'A']])).includes('onlineSales'));
  assert.ok(!keys(customer).includes('onlineSales'));
  // The carriers are GLOBAL_ONLY MANAGE_PRODUCTS as well.
  assert.ok(keys(employee([['MANAGE_PRODUCTS']])).includes('shippingCarriers'));
  assert.ok(!keys(employee([['MANAGE_PRODUCT_PRICES']])).includes('shippingCarriers'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS', 'A']])).includes('shippingCarriers'));
  assert.ok(!keys(customer).includes('shippingCarriers'));
  // Supplier sources are GLOBAL_ONLY: the manager and the reviewer both see the entry, nobody else, no branch grant, no customer.
  assert.ok(keys(employee([['MANAGE_SUPPLIER_SOURCES']])).includes('supplierSources'));
  assert.ok(keys(employee([['REVIEW_SUPPLIER_IMPORTS']])).includes('supplierSources'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS']])).includes('supplierSources'));
  assert.ok(!keys(employee([['MANAGE_SUPPLIER_SOURCES', 'A']])).includes('supplierSources'));
  assert.ok(!keys(customer).includes('supplierSources'));
  // Online orders open with the branch permission to pack or the branch permission to refund; nothing global-only and no customer.
  assert.ok(keys(employee([['MANAGE_PRODUCT_ORDERS', 'A']])).includes('onlineOrders'));
  assert.ok(keys(employee([['REFUND_PRODUCTS', 'A']])).includes('onlineOrders'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS']])).includes('onlineOrders'));
  assert.ok(!keys(employee()).includes('onlineOrders'));
  assert.ok(!keys(customer).includes('onlineOrders'));
  // The inventory opens with any of the three branch permissions at a branch, or the global product permission; nothing else.
  for (const code of ['VIEW_INVENTORY', 'MANAGE_STOCK_RECEIPTS', 'ADJUST_STOCK'] as const) {
    assert.ok(keys(employee([[code, 'A']])).includes('inventory'), code);
  }
  assert.ok(keys(employee([['MANAGE_PRODUCTS']])).includes('inventory'));
  assert.ok(!keys(employee([['MANAGE_PRODUCT_PRICES']])).includes('inventory'));
  assert.ok(!keys(employee([['VIEW_PRODUCT_COST']])).includes('inventory'));
  assert.ok(!keys(employee()).includes('inventory'));
  assert.ok(!keys(customer).includes('inventory'));
  // The import is GLOBAL_ONLY IMPORT_PRODUCT_DATA: no branch grant, no other product permission opens it.
  assert.ok(keys(employee([['IMPORT_PRODUCT_DATA']])).includes('import'));
  assert.ok(!keys(employee([['IMPORT_PRODUCT_DATA', 'A']])).includes('import'));
  assert.ok(!keys(employee([['MANAGE_PRODUCTS'], ['MANAGE_PRODUCT_PRICES']])).includes('import'));
  assert.ok(!keys(employee()).includes('import'));
  assert.ok(!keys(customer).includes('import'));
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

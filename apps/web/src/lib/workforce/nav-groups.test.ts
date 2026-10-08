import { arrangeNav, iconNames } from '@lucy-spa/ui';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { employee, owner } from '../../test/support';
import { isManagementItem, NAV_ICONS, personalEntries, sidebarGroups } from './nav-groups';
import { navigationFor, type NavKey } from './permissions';

const vi = getWorkforceDictionary('vi');
const en = getWorkforceDictionary('en');
const BASE = '/vi/workforce';

const sidebar = (account: Parameters<typeof navigationFor>[0], current = BASE) =>
  arrangeNav(
    sidebarGroups(navigationFor(account), vi, BASE, (href, exact) =>
      exact ? current === href : current === href || current.startsWith(`${href}/`),
    ),
  );
const shape = (account: Parameters<typeof navigationFor>[0]) =>
  Object.fromEntries(sidebar(account).map((group) => [group.id, group.items.map((i) => i.id)]));

test('regrouping never changes who sees what: sidebar + user menu hold exactly navigationFor', () => {
  const accounts = [
    owner,
    employee(),
    employee([
      ['VIEW_EMPLOYEES', 'A'],
      ['MANAGE_SKILLS', 'A'],
    ]),
    employee([['MANAGE_PERMISSIONS', 'A']]),
    employee([['MANAGE_SERVICE_PRICES']]),
  ];
  for (const account of accounts) {
    const items = navigationFor(account);
    const shown = [
      ...sidebar(account).flatMap((group) => group.items.map((item) => item.id)),
      ...personalEntries(items).map((item) => item.key),
    ];
    assert.equal(new Set(shown).size, shown.length, 'no entry appears twice');
    assert.deepEqual([...shown].sort(), items.map((item) => item.key).sort());
  }
});

test('the Owner sees the contract groups in the contract order', () => {
  assert.deepEqual(shape(owner), {
    overview: ['dashboard'],
    operations: ['bookingBoard', 'walkIn', 'reassignment', 'collaboratorSchedule'],
    sales: ['pos', 'discounts', 'loyalty', 'productReturns'],
    people: ['employees', 'attendance', 'leave', 'teams', 'organization', 'skills'],
    catalog: ['services', 'products', 'inventory', 'import', 'branches'],
    administration: ['roles', 'websiteContent'],
  });
  assert.deepEqual(
    personalEntries(navigationFor(owner)).map((item) => item.key),
    ['myAccount', 'myIncome'],
    'personal pages live in the user menu, not the sidebar',
  );
});

test('a self-service employee: flat overview, a two-item people group, nothing else', () => {
  const groups = sidebar(employee());
  assert.deepEqual(
    groups.map((group) => [group.id, group.flat]),
    [
      ['overview', true],
      ['people', false],
    ],
  );
  assert.deepEqual(shape(employee()).people, ['attendance', 'leave']);
});

test('a group with one visible item is rendered flat, an empty one disappears', () => {
  const account = employee([['MANAGE_PERMISSIONS', 'A']]);
  const groups = sidebar(account);
  const admin = groups.find((group) => group.id === 'administration');
  assert.ok(admin?.flat, 'roles alone is flat');
  assert.ok(!groups.some((group) => group.id === 'sales'), 'no invoices, no sales group');
});

test('the current page is marked; the dashboard only on its own path', () => {
  const onEmployee = sidebar(owner, `${BASE}/employees/42`);
  const current = onEmployee.flatMap((group) => group.items).filter((item) => item.current);
  assert.deepEqual(
    current.map((item) => item.id),
    ['employees'],
  );
  const onHome = sidebar(owner, BASE)
    .flatMap((group) => group.items)
    .filter((item) => item.current);
  assert.deepEqual(
    onHome.map((item) => item.id),
    ['dashboard'],
  );
  const hrefs = sidebar(owner).flatMap((group) => group.items.map((item) => item.href));
  assert.ok(hrefs.every((href) => href === BASE || href.startsWith(`${BASE}/`)));
});

test('every entry has an icon and a label, every group a label, in both languages', () => {
  const keys = Object.keys(NAV_ICONS) as NavKey[];
  const known = new Set<string>(iconNames);
  for (const key of keys) {
    assert.ok(known.has(NAV_ICONS[key]), `${key} icon exists`);
    for (const dictionary of [vi, en]) assert.ok(dictionary.nav[key].length > 0, key);
  }
  for (const dictionary of [vi, en]) {
    for (const [group, label] of Object.entries(dictionary.nav.groups)) {
      assert.ok(label.length > 0, group);
    }
  }
  assert.equal(vi.nav.groups.sales, 'Thanh toán');
  assert.equal(en.nav.groups.sales, 'Sales & payments');
});

test('the dashboard shortcut grid keeps listing the same management pages until Step 7', () => {
  const managed = navigationFor(owner)
    .filter(isManagementItem)
    .map((item) => item.key);
  assert.deepEqual(managed, [
    'branches',
    'services',
    'discounts',
    'skills',
    'employees',
    'organization',
    'teams',
    'roles',
  ]);
});

test('the workforce auth pages have a tagline in both languages', () => {
  assert.ok(vi.auth.tagline.length > 0 && en.auth.tagline.length > 0);
  assert.notEqual(vi.auth.tagline, en.auth.tagline);
});

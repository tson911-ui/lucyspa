import type { IconName, ShellNavGroup } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../i18n/workforce';
import type { NavGroupId, NavItem, NavKey } from './permissions';

// Presentation of `navigationFor` (docs/UXUI_REDESIGN_DESIGN.md 4.2). Which entries an account sees is
// decided in permissions.ts and never here; this file only orders, groups and decorates them.

/** Sidebar groups in display order, each with its items in the order of the contract table. */
const SIDEBAR_LAYOUT: ReadonlyArray<{ group: NavGroupId; order: readonly NavKey[] }> = [
  { group: 'overview', order: ['dashboard'] },
  {
    group: 'operations',
    order: ['bookingBoard', 'walkIn', 'myServices', 'reassignment', 'collaboratorSchedule'],
  },
  {
    group: 'sales',
    order: ['pos', 'discounts', 'loyalty', 'productOrders', 'onlineOrders', 'productReturns'],
  },
  {
    group: 'people',
    order: ['employees', 'attendance', 'leave', 'teams', 'organization', 'skills'],
  },
  {
    group: 'catalog',
    order: [
      'services',
      'products',
      'productCampaigns',
      'onlineSales',
      'shippingCarriers',
      'inventory',
      'import',
      'branches',
    ],
  },
  { group: 'administration', order: ['roles', 'websiteContent'] },
];

/** Personal pages live in the user menu, not in the sidebar (contract 4.2). */
const USER_MENU_ORDER: readonly NavKey[] = ['myAccount', 'myIncome'];

export const NAV_ICONS: Record<NavKey, IconName> = {
  dashboard: 'home',
  bookingBoard: 'calendar',
  walkIn: 'user-plus',
  myServices: 'clipboard',
  reassignment: 'swap',
  collaboratorSchedule: 'clock',
  pos: 'receipt',
  discounts: 'tag',
  loyalty: 'gem',
  productOrders: 'clipboard',
  onlineOrders: 'truck',
  productReturns: 'refresh',
  employees: 'users',
  attendance: 'calendar-check',
  leave: 'sun',
  teams: 'users',
  organization: 'building',
  skills: 'award',
  services: 'sparkles',
  products: 'gem',
  productCampaigns: 'tag',
  onlineSales: 'cart',
  shippingCarriers: 'map-pin',
  inventory: 'table',
  import: 'upload',
  branches: 'map-pin',
  roles: 'shield',
  websiteContent: 'image',
  myAccount: 'user',
  myIncome: 'wallet',
};

const inOrder = (items: readonly NavItem[], order: readonly NavKey[]): NavItem[] =>
  order.flatMap((key) => items.filter((item) => item.key === key));

/** The sidebar: permission-filtered items, grouped by task. Empty groups are dropped by the shell. */
export function sidebarGroups(
  items: readonly NavItem[],
  t: WorkforceDictionary,
  base: string,
  isCurrent: (href: string, exact: boolean) => boolean,
): ShellNavGroup[] {
  return SIDEBAR_LAYOUT.map(({ group, order }) => ({
    id: group,
    label: t.nav.groups[group],
    items: inOrder(
      items.filter((item) => item.group === group),
      order,
    ).map((item) => {
      const href = `${base}${item.path}`;
      return {
        id: item.key,
        label: t.nav[item.key],
        href,
        icon: NAV_ICONS[item.key],
        current: isCurrent(href, item.path === ''),
      };
    }),
  }));
}

/** Personal entries for the user menu. */
export function personalEntries(items: readonly NavItem[]): NavItem[] {
  return inOrder(
    items.filter((item) => item.group === 'personal'),
    USER_MENU_ORDER,
  );
}

/** Keys of the catalog/people/admin pages that the dashboard still lists as shortcuts until Step 7. */
const MANAGEMENT_KEYS: ReadonlySet<NavKey> = new Set([
  'branches',
  'services',
  'discounts',
  'skills',
  'employees',
  'organization',
  'teams',
  'roles',
]);

export const isManagementItem = (item: NavItem): boolean => MANAGEMENT_KEYS.has(item.key);

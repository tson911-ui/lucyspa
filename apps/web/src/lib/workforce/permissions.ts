import type { CurrentAccountResponse, PermissionCodeName } from '@lucy-spa/contracts';

/**
 * UX-only permission hints derived from `GET /api/v1/auth/me` (design section 10). They
 * decide what the UI offers; the API still authorizes every request, so a hint can never
 * grant anything. The evaluation mirrors the server's display summary: `grants` already
 * contain only effective grants, and any DENY on the same scope (or GLOBAL) wins.
 */
export type Account = CurrentAccountResponse;

export function isWorkforce(account: Account): boolean {
  return account.kind === 'EMPLOYEE' || account.kind === 'OWNER';
}

function isOwner(account: Account): boolean {
  return 'owner' in account.authorization;
}

function lists(account: Account) {
  const authorization = account.authorization;
  return 'grants' in authorization
    ? { grants: authorization.grants, denies: authorization.denies }
    : { grants: [], denies: [] };
}

function deniedAt(account: Account, permission: string, branchId: string | null): boolean {
  return lists(account).denies.some(
    (deny) =>
      deny.permission === permission &&
      (deny.scope.kind === 'GLOBAL' ||
        (branchId !== null && deny.scope.kind === 'BRANCH' && deny.scope.branchId === branchId)),
  );
}

/** GLOBAL authority for the permission (for example creating a branch). */
export function canGlobal(account: Account, permission: PermissionCodeName): boolean {
  if (!isWorkforce(account)) return false;
  if (isOwner(account)) return true;
  if (deniedAt(account, permission, null)) return false;
  return lists(account).grants.some(
    (grant) => grant.permission === permission && grant.scope.kind === 'GLOBAL',
  );
}

/** Authority for the permission at one branch (GLOBAL grants cover every branch). */
export function canAt(account: Account, permission: PermissionCodeName, branchId: string): boolean {
  if (!isWorkforce(account)) return false;
  if (isOwner(account)) return true;
  if (deniedAt(account, permission, branchId)) return false;
  return lists(account).grants.some(
    (grant) =>
      grant.permission === permission &&
      (grant.scope.kind === 'GLOBAL' || grant.scope.branchId === branchId),
  );
}

/** Authority somewhere: used to decide whether a page or action is worth offering. */
export function canAnywhere(account: Account, permission: PermissionCodeName): boolean {
  if (!isWorkforce(account)) return false;
  if (isOwner(account)) return true;
  return lists(account).grants.some(
    (grant) =>
      grant.permission === permission &&
      !deniedAt(account, permission, grant.scope.kind === 'GLOBAL' ? null : grant.scope.branchId),
  );
}

/** The same all-or-nothing rule the API applies to multi-branch employees. */
export function canAcross(
  account: Account,
  permission: PermissionCodeName,
  branchIds: readonly string[],
): boolean {
  return branchIds.length === 0
    ? canGlobal(account, permission)
    : branchIds.every((branchId) => canAt(account, permission, branchId));
}

export type NavKey =
  | 'dashboard'
  | 'myAccount'
  | 'attendance'
  | 'leave'
  | 'branches'
  | 'services'
  | 'skills'
  | 'employees'
  | 'roles';

export interface NavItem {
  key: NavKey;
  group: 'home' | 'operations' | 'management';
  path: string;
}

/**
 * Navigation offered to this account. Self-service pages need an employee profile (the
 * Owner has none). Management pages appear only with a permission that makes them useful;
 * branch, service and skill catalogs stay readable to every workforce member, but are
 * listed only for those who manage them.
 */
export function navigationFor(account: Account): NavItem[] {
  if (!isWorkforce(account)) return [];
  const employee = account.kind === 'EMPLOYEE';
  const items: (NavItem | false)[] = [
    { key: 'dashboard', group: 'home', path: '' },
    // Every workforce account (Owner included) has its own account page.
    { key: 'myAccount', group: 'home', path: '/account' },
    (employee || canAnywhere(account, 'VIEW_ATTENDANCE')) && {
      key: 'attendance',
      group: 'operations',
      path: '/attendance',
    },
    (employee || canAnywhere(account, 'APPROVE_LEAVE')) && {
      key: 'leave',
      group: 'operations',
      path: '/leave',
    },
    canAnywhere(account, 'MANAGE_BRANCHES') && {
      key: 'branches',
      group: 'management',
      path: '/branches',
    },
    (canAnywhere(account, 'MANAGE_SERVICES') || canAnywhere(account, 'MANAGE_SERVICE_PRICES')) && {
      key: 'services',
      group: 'management',
      path: '/services',
    },
    canAnywhere(account, 'MANAGE_SKILLS') && {
      key: 'skills',
      group: 'management',
      path: '/skills',
    },
    canAnywhere(account, 'VIEW_EMPLOYEES') && {
      key: 'employees',
      group: 'management',
      path: '/employees',
    },
    // Roles & permissions: readable with MANAGE_PERMISSIONS in some scope (the API rule).
    canAnywhere(account, 'MANAGE_PERMISSIONS') && {
      key: 'roles',
      group: 'management',
      path: '/roles',
    },
  ];
  return items.filter((item): item is NavItem => item !== false);
}

import type {
  AuthorizationScope,
  CurrentAccountResponse,
  PermissionCodeName,
} from '@lucy-spa/contracts';

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
        (branchId !== null && scopeContains(account, deny.scope, { kind: 'BRANCH', branchId }))),
  );
}

/** Tree containment only; hierarchy and team restrictions are rechecked by the API. */
export function scopeContains(
  account: Account,
  parent: AuthorizationScope,
  child: AuthorizationScope,
): boolean {
  if (parent.kind === 'GLOBAL') return true;
  if (parent.kind === 'REGION') {
    if (child.kind === 'REGION') return parent.regionId === child.regionId;
    if (child.kind === 'AREA')
      return (
        account.organization?.areas.some(
          (area) => area.id === child.areaId && area.regionId === parent.regionId,
        ) ?? false
      );
    if (child.kind === 'BRANCH')
      return (
        account.organization?.branches.some(
          (branch) => branch.id === child.branchId && branch.regionId === parent.regionId,
        ) ?? false
      );
  }
  if (parent.kind === 'AREA') {
    if (child.kind === 'AREA') return parent.areaId === child.areaId;
    if (child.kind === 'BRANCH')
      return (
        account.organization?.branches.some(
          (branch) => branch.id === child.branchId && branch.areaId === parent.areaId,
        ) ?? false
      );
  }
  return parent.kind === 'BRANCH' && child.kind === 'BRANCH' && parent.branchId === child.branchId;
}

/** Conservative grant hint for an entire scope, including descendant DENY overrides. */
export function canScope(
  account: Account,
  permission: PermissionCodeName,
  scope: AuthorizationScope,
): boolean {
  if (!isWorkforce(account)) return false;
  if (isOwner(account)) return true;
  const { grants, denies } = lists(account);
  if (
    denies.some(
      (deny) =>
        deny.permission === permission &&
        (scopeContains(account, deny.scope, scope) || scopeContains(account, scope, deny.scope)),
    )
  )
    return false;
  return grants.some(
    (grant) => grant.permission === permission && scopeContains(account, grant.scope, scope),
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
      scopeContains(account, grant.scope, { kind: 'BRANCH', branchId }),
  );
}

/** Authority somewhere: used to decide whether a page or action is worth offering. */
export function canAnywhere(account: Account, permission: PermissionCodeName): boolean {
  if (!isWorkforce(account)) return false;
  if (isOwner(account)) return true;
  return lists(account).grants.some(
    (grant) =>
      grant.permission === permission &&
      (!lists(account).denies.some(
        (deny) => deny.permission === permission && scopeContains(account, deny.scope, grant.scope),
      ) ||
        (account.organization?.branches.some(
          (branch) =>
            scopeContains(account, grant.scope, { kind: 'BRANCH', branchId: branch.id }) &&
            !deniedAt(account, permission, branch.id),
        ) ??
          false)),
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
  | 'myIncome'
  | 'attendance'
  | 'leave'
  | 'collaboratorSchedule'
  | 'bookingBoard'
  | 'walkIn'
  | 'myServices'
  | 'reassignment'
  | 'branches'
  | 'services'
  | 'skills'
  | 'employees'
  | 'roles'
  | 'organization'
  | 'teams';

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
    { key: 'myIncome', group: 'home', path: '/income' },
    ((employee && account.attendanceRequired !== false) ||
      canAnywhere(account, 'VIEW_ATTENDANCE')) && {
      key: 'attendance',
      group: 'operations',
      path: '/attendance',
    },
    (employee || canAnywhere(account, 'APPROVE_LEAVE')) && {
      key: 'leave',
      group: 'operations',
      path: '/leave',
    },
    canAnywhere(account, 'VIEW_BOOKINGS') && {
      key: 'bookingBoard',
      group: 'operations',
      path: '/booking-board',
    },
    employee &&
      canAnywhere(account, 'PERFORM_SERVICES') && {
        key: 'myServices',
        group: 'operations',
        path: '/my-services',
      },
    canAnywhere(account, 'REASSIGN_SERVICES') && {
      key: 'reassignment',
      group: 'operations',
      path: '/reassignment',
    },
    canAnywhere(account, 'MANAGE_BOOKINGS') && {
      key: 'walkIn',
      group: 'operations',
      path: '/walk-in',
    },
    (canAnywhere(account, 'VIEW_WORK_SCHEDULE') ||
      canAnywhere(account, 'MANAGE_WORK_SCHEDULE')) && {
      key: 'collaboratorSchedule',
      group: 'operations',
      path: '/collaborator-schedule',
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
    (canAnywhere(account, 'VIEW_ORGANIZATION') || canAnywhere(account, 'MANAGE_ORGANIZATION')) && {
      key: 'organization',
      group: 'management',
      path: '/organization',
    },
    (canAnywhere(account, 'VIEW_TEAMS') || canAnywhere(account, 'MANAGE_TEAMS')) && {
      key: 'teams',
      group: 'management',
      path: '/teams',
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

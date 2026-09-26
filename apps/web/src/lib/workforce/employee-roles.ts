import type {
  AuthorizationScope,
  BranchSummary,
  EmployeeAuthorizationResponse,
  EmployeeResponse,
  RoleAssignRequest,
  RoleListResponse,
  RoleResponse,
  RoleRevokeRequest,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { fill } from '../../i18n/workforce';
import type { Locale } from '../../i18n/locales';
import { ApiError, type WorkforceApi } from './api';
import { canAcross, canAt, canGlobal, type Account } from './permissions';
import { errorMessage } from './workflows';

/**
 * Role assignment on employee detail (Employee management Step 4). Roles are database
 * permission bundles (KTV, branch manager, …) assigned GLOBAL or per branch through the
 * existing role-admin API; they are never employment classifications and nothing here
 * checks role names. These helpers only decide what to offer — the API enforces
 * MANAGE_PERMISSIONS scope, containment (EXCEEDS_ACTOR), self-target and Owner protection.
 */

/** Reading and changing an employee's roles needs MANAGE_PERMISSIONS over all its branches. */
export function canManageRoles(account: Account, employee: EmployeeResponse): boolean {
  return canAcross(account, 'MANAGE_PERMISSIONS', employee.branchIds);
}

/** Non-Owners never change their own authority (the API refuses it). */
export function isSelf(account: Account, employee: EmployeeResponse): boolean {
  return account.kind !== 'OWNER' && account.id === employee.id;
}

/**
 * Scopes the actor may assign at: GLOBAL with GLOBAL MANAGE_PERMISSIONS, otherwise the
 * employee's active branches where the actor holds MANAGE_PERMISSIONS. Branches the member is
 * not assigned to are not offered (such a grant would stay dormant until assignment).
 */
export function scopeOptions(
  account: Account,
  employee: EmployeeResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): AuthorizationScope[] {
  const options: AuthorizationScope[] = [];
  if (canGlobal(account, 'MANAGE_PERMISSIONS')) options.push({ kind: 'GLOBAL' });
  for (const branchId of employee.branchIds) {
    const branch = branches?.get(branchId);
    if (branch?.isActive && canAt(account, 'MANAGE_PERMISSIONS', branchId)) {
      options.push({ kind: 'BRANCH', branchId });
    }
  }
  return options;
}

/**
 * UX hint of the containment rule: a non-Owner confers only permissions it holds at that
 * scope. The API's EXCEEDS_ACTOR check (with denies and dormant grants) is authoritative.
 */
export function grantable(
  account: Account,
  role: RoleResponse,
  scope: AuthorizationScope,
): boolean {
  if (account.kind === 'OWNER') return true;
  return role.permissions.every((permission) =>
    scope.kind === 'GLOBAL'
      ? canGlobal(account, permission)
      : canAt(account, permission, scope.branchId),
  );
}

/** Revoking needs MANAGE_PERMISSIONS at the assignment's scope (GLOBAL for a GLOBAL one). */
export function canRevokeAt(account: Account, scope: AuthorizationScope): boolean {
  return scope.kind === 'GLOBAL'
    ? canGlobal(account, 'MANAGE_PERMISSIONS')
    : canAt(account, 'MANAGE_PERMISSIONS', scope.branchId);
}

/** Roles that can be assigned: active ones only (an inactive role confers nothing). */
export function assignableRoles(catalog: RoleListResponse | null): RoleResponse[] {
  return (catalog?.roles ?? []).filter((role) => role.isActive);
}

export function scopeKey(scope: AuthorizationScope): string {
  return scope.kind === 'GLOBAL' ? 'GLOBAL' : `BRANCH:${scope.branchId}`;
}

export function scopeFromKey(key: string): AuthorizationScope | null {
  if (key === 'GLOBAL') return { kind: 'GLOBAL' };
  return key.startsWith('BRANCH:') ? { kind: 'BRANCH', branchId: key.slice(7) } : null;
}

export function scopeLabel(
  scope: AuthorizationScope,
  branches: ReadonlyMap<string, BranchSummary> | null,
  t: WorkforceDictionary,
): string {
  if (scope.kind === 'GLOBAL') return t.roles.global;
  const branch = branches?.get(scope.branchId);
  return fill(t.roles.atBranch, { branch: branch ? branch.name : t.common.unknownBranch });
}

export function roleName(
  assignment: { roleId: string; roleCode: string },
  catalog: RoleListResponse | null,
  locale: Locale,
): string {
  const role = catalog?.roles.find((entry) => entry.id === assignment.roleId);
  if (!role) return assignment.roleCode;
  return locale === 'vi' ? role.displayNameVi : role.displayNameEn;
}

export function assignRequest(
  version: number,
  roleId: string,
  scope: AuthorizationScope,
  reason: string,
): RoleAssignRequest {
  return { expectedVersion: version, roleId, scope, reason: reason.trim() };
}

export function revokeRequest(
  version: number,
  assignmentId: string,
  reason: string,
): RoleRevokeRequest {
  return { expectedVersion: version, assignmentId, reason: reason.trim() };
}

/** The existing role-admin endpoints; role and branch IDs always come from these reads. */
export const roleCommands = {
  catalog: (api: WorkforceApi) => api.get<RoleListResponse>('/api/v1/roles'),
  authorization: (api: WorkforceApi, id: string) =>
    api.get<EmployeeAuthorizationResponse>(`/api/v1/employees/${id}/authorization`),
  assign: (api: WorkforceApi, id: string, body: RoleAssignRequest) =>
    api.post<EmployeeAuthorizationResponse>(`/api/v1/employees/${id}/roles`, body),
  revoke: (api: WorkforceApi, id: string, body: RoleRevokeRequest) =>
    api.post<EmployeeAuthorizationResponse>(`/api/v1/employees/${id}/roles/revoke`, body),
};

export function roleErrorMessage(error: unknown, t: WorkforceDictionary): string {
  if (error instanceof ApiError) {
    if (error.code === 'CONFLICT' && error.field === 'employment') return t.roles.endedNoNewRoles;
    if (error.code === 'CONFLICT' && error.field === 'employmentClassification') {
      return t.roles.managerNeedsOfficial;
    }
    if (error.code === 'FORBIDDEN') return t.roles.forbidden;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'scope') return t.roles.badScope;
  }
  return errorMessage(error, t);
}

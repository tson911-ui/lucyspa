import type {
  PermissionCodeName,
  PermissionScopeCapability,
  RoleCreateRequest,
  RoleListResponse,
  RolePermissionsRequest,
  RoleResponse,
  RoleUpdateRequest,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type WorkforceApi } from './api';
import { canAnywhere, canGlobal, type Account } from './permissions';
import { errorMessage } from './workflows';

/**
 * Role management ("Vai trò & quyền", Employee management Step 4B). Roles are permission
 * bundles; where a bundle applies is decided per assignment (GLOBAL or one branch) on the
 * employee. Everything here uses the existing role-admin API and its permission catalog;
 * the API enforces GLOBAL MANAGE_PERMISSIONS and containment for every change.
 */

/** Reading roles: MANAGE_PERMISSIONS in some scope (the API's listRoles rule). */
export function canViewRoles(account: Account): boolean {
  return canAnywhere(account, 'MANAGE_PERMISSIONS');
}

/** Creating or changing a role: GLOBAL MANAGE_PERMISSIONS (roles are shared, global). */
export function canEditRoles(account: Account): boolean {
  return canGlobal(account, 'MANAGE_PERMISSIONS');
}

/**
 * UX hint of containment: a non-Owner may put in a role only permissions it holds with
 * unrestricted GLOBAL authority (no deny anywhere). The API is authoritative.
 */
export function canBundle(account: Account, permission: PermissionCodeName): boolean {
  if (account.kind === 'OWNER') return true;
  if (!canGlobal(account, permission)) return false;
  const authorization = account.authorization;
  return !(
    'denies' in authorization && authorization.denies.some((deny) => deny.permission === permission)
  );
}

const CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

/** The API's code rule (trimmed, upper-cased, `A-Z0-9_`, not OWNER); the code never changes. */
export function roleCodePreview(value: string): { code: string; valid: boolean } {
  const code = value.trim().toUpperCase();
  return { code, valid: CODE.test(code) && code !== 'OWNER' };
}

export type PermissionGroup = 'employees' | 'pay' | 'operations' | 'catalog' | 'admin' | 'other';

/** Display grouping of known codes; codes added later fall into "other" until labelled. */
const GROUP_OF: Readonly<Record<string, PermissionGroup>> = {
  VIEW_EMPLOYEES: 'employees',
  CREATE_EMPLOYEES: 'employees',
  UPDATE_EMPLOYEES: 'employees',
  MANAGE_EMPLOYEE_STATUS: 'employees',
  MANAGE_EMPLOYEE_ACCESS: 'employees',
  MANAGE_EMPLOYEE_SCOPE: 'employees',
  VIEW_EMPLOYEE_PAY: 'pay',
  MANAGE_EMPLOYEE_PAY: 'pay',
  VIEW_ATTENDANCE: 'operations',
  MANAGE_ATTENDANCE: 'operations',
  APPROVE_LEAVE: 'operations',
  MANAGE_BRANCHES: 'catalog',
  MANAGE_SERVICES: 'catalog',
  MANAGE_SERVICE_PRICES: 'catalog',
  MANAGE_SKILLS: 'catalog',
  MANAGE_PERMISSIONS: 'admin',
  VIEW_AUDIT_LOG: 'admin',
};
const GROUP_ORDER: PermissionGroup[] = [
  'employees',
  'pay',
  'operations',
  'catalog',
  'admin',
  'other',
];

export interface CatalogEntry {
  code: PermissionCodeName;
  scopeCapability: PermissionScopeCapability;
}

/** The loaded catalog (the API's source of truth) grouped for display, in catalog order. */
export function groupedCatalog(
  catalog: RoleListResponse | null,
): { group: PermissionGroup; entries: CatalogEntry[] }[] {
  const entries = catalog?.permissionCatalog ?? [];
  return GROUP_ORDER.map((group) => ({
    group,
    entries: entries.filter((entry) => (GROUP_OF[entry.code] ?? 'other') === group),
  })).filter((section) => section.entries.length > 0);
}

/** Human label for a code; unknown codes show the code itself (never hidden). */
export function permissionLabel(code: string, t: WorkforceDictionary): string {
  return (t.roleAdmin.permissionLabels as Record<string, string>)[code] ?? code;
}

export function roleDisplayName(role: RoleResponse, locale: 'vi' | 'en'): string {
  return locale === 'vi' ? role.displayNameVi : role.displayNameEn;
}

export function createRequest(input: {
  code: string;
  displayNameVi: string;
  displayNameEn: string;
  permissions: readonly PermissionCodeName[];
  isManagerGroup?: boolean;
  reason: string;
}): RoleCreateRequest {
  return {
    code: roleCodePreview(input.code).code,
    displayNameVi: input.displayNameVi.trim(),
    displayNameEn: input.displayNameEn.trim(),
    permissions: [...input.permissions].sort(),
    isManagerGroup: input.isManagerGroup === true,
    reason: input.reason.trim(),
  };
}

/**
 * Names and the manager-group flag, only when changed (the code is immutable); null when
 * nothing changed. The flag is directory grouping only and grants nothing.
 */
export function namesRequest(
  role: RoleResponse,
  names: { displayNameVi: string; displayNameEn: string; isManagerGroup?: boolean },
  reason: string,
): RoleUpdateRequest | null {
  const vi = names.displayNameVi.trim();
  const en = names.displayNameEn.trim();
  const request: RoleUpdateRequest = { expectedVersion: role.version, reason: reason.trim() };
  if (vi !== role.displayNameVi) request.displayNameVi = vi;
  if (en !== role.displayNameEn) request.displayNameEn = en;
  if (names.isManagerGroup !== undefined && names.isManagerGroup !== role.isManagerGroup) {
    request.isManagerGroup = names.isManagerGroup;
  }
  return request.displayNameVi === undefined &&
    request.displayNameEn === undefined &&
    request.isManagerGroup === undefined
    ? null
    : request;
}

export function samePermissions(
  left: readonly PermissionCodeName[],
  right: readonly PermissionCodeName[],
): boolean {
  return left.length === right.length && [...left].sort().join() === [...right].sort().join();
}

/** The complete resulting set, as the API expects; null when unchanged. */
export function permissionsRequest(
  role: RoleResponse,
  permissions: readonly PermissionCodeName[],
  reason: string,
  version = role.version,
): RolePermissionsRequest | null {
  if (samePermissions(role.permissions, permissions)) return null;
  return { expectedVersion: version, permissions: [...permissions].sort(), reason: reason.trim() };
}

export function activationRequest(role: RoleResponse, reason: string): RoleUpdateRequest {
  return { expectedVersion: role.version, isActive: !role.isActive, reason: reason.trim() };
}

export const roleAdminCommands = {
  list: (api: WorkforceApi) => api.get<RoleListResponse>('/api/v1/roles'),
  create: (api: WorkforceApi, body: RoleCreateRequest) =>
    api.post<RoleResponse>('/api/v1/roles', body),
  update: (api: WorkforceApi, id: string, body: RoleUpdateRequest) =>
    api.post<RoleResponse>(`/api/v1/roles/${id}`, body),
  setPermissions: (api: WorkforceApi, id: string, body: RolePermissionsRequest) =>
    api.post<RoleResponse>(`/api/v1/roles/${id}/permissions`, body),
};

export function roleAdminErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.roleAdmin;
  if (error instanceof ApiError) {
    if (error.code === 'CONFLICT' && error.field === 'code') return texts.duplicateCode;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'code') return texts.invalidCode;
    if (error.code === 'VALIDATION_FAILED' && error.field === 'permissions') {
      return texts.invalidPermissions;
    }
    if (error.code === 'FORBIDDEN') return texts.forbidden;
  }
  return errorMessage(error, t);
}

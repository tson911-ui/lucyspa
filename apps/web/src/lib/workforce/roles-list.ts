import type { RoleResponse } from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch, type SortValue } from '@lucy-spa/ui';
import { normalizePage, normalizePageSize } from './list-view';
import { roleDisplayName } from './role-admin';

/**
 * Roles list state. The API returns every role, so the list searches, filters, sorts and pages in the
 * browser (client mode, decision Q-D3); the state lives in the address bar.
 */

export const ROLE_SORT_KEYS = ['name', 'code', 'permissions', 'status'] as const;

export const ROLE_LIST_DEFAULTS = {
  q: '',
  status: '',
  sort: 'name',
  dir: 'asc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};
export type RoleListState = typeof ROLE_LIST_DEFAULTS;

/** Keys that return to page 1 when the search, filter, sort or page size changes. */
export const ROLE_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeRoleList(state: RoleListState): RoleListState {
  return {
    q: state.q.slice(0, 100),
    status: state.status === 'active' || state.status === 'inactive' ? state.status : '',
    sort: (ROLE_SORT_KEYS as readonly string[]).includes(state.sort) ? state.sort : 'name',
    dir: state.dir === 'desc' ? 'desc' : 'asc',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
  };
}

/** Roles matching the search (code or either name, ignoring case and accents) and the status filter. */
export function filterRoles(
  roles: readonly RoleResponse[],
  state: Pick<RoleListState, 'q' | 'status'>,
): RoleResponse[] {
  const query = normalizeSearch(state.q);
  return roles.filter((role) => {
    if (state.status === 'active' && !role.isActive) return false;
    if (state.status === 'inactive' && role.isActive) return false;
    if (query === '') return true;
    return [role.code, role.displayNameVi, role.displayNameEn].some((field) =>
      normalizeSearch(field).includes(query),
    );
  });
}

export function roleSortValue(role: RoleResponse, key: string, locale: 'vi' | 'en'): SortValue {
  if (key === 'code') return role.code;
  if (key === 'permissions') return role.permissions.length;
  if (key === 'status') return role.isActive ? 0 : 1;
  return roleDisplayName(role, locale);
}

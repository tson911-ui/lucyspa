import type { EmployeeDirectoryGroup, EmployeeDirectoryResponse } from '@lucy-spa/contracts';
import type { WorkforceApi } from './api';

/**
 * Employee directory sections (Quản lý / Nhân viên / CTV / Học viên) with numbered pages.
 * Each section comes from the API (`group`) and is paginated on the server (`page` +
 * total), independently of the others. Titles are server-derived.
 */

export const DIRECTORY_PAGE_SIZE = 20;

export interface DirectoryFilters {
  q: string;
  branchId: string;
  status: string;
}

export function totalPages(total: number, size: number = DIRECTORY_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

// Page links and pager state are shared with every list (packages/ui paging-core).
export { pageItems, pagerState, type PageItem } from '@lucy-spa/ui';

/** One group's page, filtered exactly like the toolbar (blank filters are omitted). */
export function directoryPage(
  api: WorkforceApi,
  group: EmployeeDirectoryGroup,
  filters: DirectoryFilters,
  page: number,
  pageSize: number = DIRECTORY_PAGE_SIZE,
): Promise<EmployeeDirectoryResponse> {
  return api.get<EmployeeDirectoryResponse>('/api/v1/employees', {
    group,
    page,
    limit: pageSize,
    q: filters.q.trim() || undefined,
    branchId: filters.branchId || undefined,
    status: filters.status || undefined,
  });
}

export function filtersActive(filters: DirectoryFilters): boolean {
  return filters.q.trim() !== '' || filters.branchId !== '' || filters.status !== '';
}

/**
 * The directory's address-bar state: search, filters, one shared page size and one page number per
 * group (the four tables page independently). Filters and page size reset every page to 1.
 */
export const EMPLOYEE_LIST_DEFAULTS = {
  q: '',
  branch: '',
  status: '',
  pageSize: DIRECTORY_PAGE_SIZE,
  pageManagers: 1,
  pageEmployees: 1,
  pageCollaborators: 1,
  pageTrainees: 1,
};
export type EmployeeListState = typeof EMPLOYEE_LIST_DEFAULTS;

export const GROUP_PAGE_KEY = {
  MANAGERS: 'pageManagers',
  EMPLOYEES: 'pageEmployees',
  COLLABORATORS: 'pageCollaborators',
  TRAINEES: 'pageTrainees',
} as const satisfies Record<EmployeeDirectoryGroup, keyof EmployeeListState>;

export const EMPLOYEE_PAGE_KEYS: readonly string[] = Object.values(GROUP_PAGE_KEY);

const STATUS_VALUES = ['ACTIVE', 'PENDING_SETUP', 'INACTIVE'];

/** Corrects a state read from a hand-edited URL: bad pages, sizes and statuses fall back to defaults. */
export function normalizeEmployeeList(state: EmployeeListState): EmployeeListState {
  const page = (value: number) => (Number.isInteger(value) && value >= 1 ? value : 1);
  return {
    q: state.q.slice(0, 100),
    branch: state.branch,
    status: STATUS_VALUES.includes(state.status) ? state.status : '',
    pageSize: [10, 20, 50].includes(state.pageSize) ? state.pageSize : DIRECTORY_PAGE_SIZE,
    pageManagers: page(state.pageManagers),
    pageEmployees: page(state.pageEmployees),
    pageCollaborators: page(state.pageCollaborators),
    pageTrainees: page(state.pageTrainees),
  };
}

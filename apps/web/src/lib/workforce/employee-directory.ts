import type { EmployeeDirectoryGroup, EmployeeDirectoryResponse } from '@lucy-spa/contracts';
import type { WorkforceApi } from './api';

/**
 * Employee directory groups (Quản lý / Nhân viên) with numbered pages. Grouping comes from
 * the API (`group`: an active manager-group role assignment) and each group is paginated on
 * the server (`page` + total), independently of the other.
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

export type PageItem = number | 'gap';

/**
 * Page links: always the first and last page, the current page with one neighbour on each
 * side, and "…" for skipped ranges. E.g. page 5 of 8 → 1 … 4 5 6 7 8 (no gap for one page).
 */
export function pageItems(current: number, pages: number): PageItem[] {
  if (pages <= 1) return [];
  const wanted = new Set([1, pages, current - 1, current, current + 1]);
  const numbers = [...wanted].filter((page) => page >= 1 && page <= pages).sort((a, b) => a - b);
  const items: PageItem[] = [];
  let previous = 0;
  for (const page of numbers) {
    if (page - previous === 2) items.push(page - 1);
    else if (page - previous > 2) items.push('gap');
    items.push(page);
    previous = page;
  }
  return items;
}

/** One group's page, filtered exactly like the search form (blank filters are omitted). */
export function directoryPage(
  api: WorkforceApi,
  group: EmployeeDirectoryGroup,
  filters: DirectoryFilters,
  page: number,
): Promise<EmployeeDirectoryResponse> {
  return api.get<EmployeeDirectoryResponse>('/api/v1/employees', {
    group,
    page,
    limit: DIRECTORY_PAGE_SIZE,
    q: filters.q.trim() || undefined,
    branchId: filters.branchId || undefined,
    status: filters.status || undefined,
  });
}

export function filtersActive(filters: DirectoryFilters): boolean {
  return filters.q.trim() !== '' || filters.branchId !== '' || filters.status !== '';
}

/** Each group's current page, kept together but changed one group at a time. */
export type GroupPages = Readonly<Record<EmployeeDirectoryGroup, number>>;

export const FIRST_PAGES: GroupPages = { MANAGERS: 1, EMPLOYEES: 1 };

/** Changes only `group`'s page; the other group's page is untouched. */
export function withGroupPage(
  pages: GroupPages,
  group: EmployeeDirectoryGroup,
  page: number,
): GroupPages {
  return { ...pages, [group]: Math.max(1, Math.floor(page)) };
}

/** What the pager shows: hidden for one page; previous/next disabled at the ends. */
export function pagerState(page: number, pages: number) {
  return {
    visible: pages > 1,
    previousDisabled: page <= 1,
    nextDisabled: page >= pages,
    items: pageItems(page, pages),
  };
}

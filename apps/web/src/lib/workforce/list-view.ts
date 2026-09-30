import {
  DEFAULT_PAGE_SIZE,
  PAGE_SIZES,
  type CursorPaginationLabels,
  type DataTableSortLabels,
  type ListToolbarLabels,
  type PaginationLabels,
} from '@lucy-spa/ui';
import { fill, type WorkforceDictionary } from '../../i18n/workforce';

/**
 * Glue between the workforce dictionary and the shared list components in `packages/ui`, which
 * take every string as a prop. Nothing here knows about a specific screen.
 */

/** Text of the pager under a table; `list` is the visible name of the list (e.g. "Nhân viên"). */
export function paginationLabels(t: WorkforceDictionary, list: string): PaginationLabels {
  const text = t.common.list;
  return {
    nav: fill(text.pagesOf, { list }),
    first: text.firstPage,
    previous: text.previousPage,
    next: text.nextPage,
    last: text.lastPage,
    pageNumber: text.pageNumber,
    summary: text.summary,
    pageSize: text.pageSize,
    pageSizeOption: text.pageSizeOption,
  };
}

/** Text of the "Load more" / previous-next pager for keyset (cursor) lists. */
export function cursorLabels(t: WorkforceDictionary, list: string): CursorPaginationLabels {
  return {
    nav: fill(t.common.list.pagesOf, { list }),
    loadMore: t.common.loadMore,
    previous: t.common.list.previousPage,
    next: t.common.list.nextPage,
    loading: t.common.loading,
  };
}

export function toolbarLabels(t: WorkforceDictionary): ListToolbarLabels {
  const text = t.common.list;
  return {
    toolbar: text.toolbar,
    filters: text.filters,
    reset: text.reset,
    close: t.common.close,
    apply: text.apply,
  };
}

/** Text of the phone "Sort by" select of a sortable `DataTable`. */
export function sortLabels(t: WorkforceDictionary): DataTableSortLabels {
  const text = t.common.list;
  return { label: text.sortBy, ascending: text.sortAsc, descending: text.sortDesc };
}

/** "12 results" for the toolbar's live region. */
export function resultsText(t: WorkforceDictionary, count: number): string {
  return fill(t.common.list.results, { count });
}

/** A page number from the address bar: a whole number of at least 1. */
export function normalizePage(page: number): number {
  return Number.isInteger(page) && page >= 1 ? page : 1;
}

/** A page size from the address bar: one of the offered sizes, else the default. */
export function normalizePageSize(size: number): number {
  return (PAGE_SIZES as readonly number[]).includes(size) ? size : DEFAULT_PAGE_SIZE;
}

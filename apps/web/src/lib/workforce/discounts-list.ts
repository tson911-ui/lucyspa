import type { DiscountStatusName, DiscountSummaryResponse } from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch, type SortValue } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Discount programs list state. The API returns every program, so search, the status filter,
 * sorting and paging run in the browser (client mode, decision Q-D3); the state lives in the address bar.
 */

export const DISCOUNT_STATUSES: readonly DiscountStatusName[] = [
  'ACTIVE',
  'SCHEDULED',
  'PAUSED',
  'EXPIRED',
  'TERMINATED',
];

export const DISCOUNT_SORT_KEYS = ['name', 'window', 'status', 'used'] as const;

export const DISCOUNT_LIST_DEFAULTS = {
  q: '',
  status: '',
  sort: 'window',
  dir: 'desc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};
export type DiscountListState = typeof DISCOUNT_LIST_DEFAULTS;

/** Keys that return to page 1 when the search, the filter, the sort or the page size changes. */
export const DISCOUNT_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeDiscountList(state: DiscountListState): DiscountListState {
  return {
    q: state.q.slice(0, 100),
    status: (DISCOUNT_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    sort: (DISCOUNT_SORT_KEYS as readonly string[]).includes(state.sort) ? state.sort : 'window',
    dir: state.dir === 'asc' ? 'asc' : 'desc',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
  };
}

export function discountName(
  program: Pick<DiscountSummaryResponse, 'nameVi' | 'nameEn'>,
  locale: Locale,
) {
  return locale === 'vi' ? program.nameVi : program.nameEn;
}

/** Programs matching the search (code or either name, ignoring case and accents) and the status. */
export function filterDiscounts(
  programs: readonly DiscountSummaryResponse[],
  state: Pick<DiscountListState, 'q' | 'status'>,
): DiscountSummaryResponse[] {
  const query = normalizeSearch(state.q);
  return programs.filter((program) => {
    if (state.status !== '' && program.status !== state.status) return false;
    if (query === '') return true;
    return [program.code, program.nameVi, program.nameEn].some((field) =>
      normalizeSearch(field).includes(query),
    );
  });
}

/** What a column sorts by: the localized name, the start of the current window, the status, the use count. */
export function discountSortValue(
  program: DiscountSummaryResponse,
  key: string,
  locale: Locale,
): SortValue {
  if (key === 'name') return discountName(program, locale);
  if (key === 'status') return DISCOUNT_STATUSES.indexOf(program.status);
  if (key === 'used') return program.redemptions;
  return program.current.validFrom;
}

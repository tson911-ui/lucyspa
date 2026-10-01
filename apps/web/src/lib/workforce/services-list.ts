import type { ServiceCategoryResponse, ServiceResponse } from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch, type SortValue } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Services screen state. The API returns every service and category, so search, filters, sorting
 * and paging run in the browser (client mode, decision Q-D3); the state lives in the address bar.
 */

export const SERVICE_TABS = ['services', 'categories'] as const;
export type ServiceTab = (typeof SERVICE_TABS)[number];

export const SERVICE_SORT_KEYS = ['code', 'name', 'category', 'price'] as const;

export const SERVICE_LIST_DEFAULTS = {
  tab: 'services',
  q: '',
  category: '',
  status: '',
  sort: 'code',
  dir: 'asc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  /** Page and page size of the categories tab. */
  cpage: 1,
  cpageSize: DEFAULT_PAGE_SIZE,
};
export type ServiceListState = typeof SERVICE_LIST_DEFAULTS;

/** Keys that return to page 1 when the search, a filter, the sort or a page size changes. */
export const SERVICE_PAGE_KEYS: readonly string[] = ['page', 'cpage'];

export function normalizeServiceList(state: ServiceListState): ServiceListState {
  return {
    tab: state.tab === 'categories' ? 'categories' : 'services',
    q: state.q.slice(0, 100),
    category: state.category.slice(0, 64),
    status: state.status === 'active' || state.status === 'inactive' ? state.status : '',
    sort: (SERVICE_SORT_KEYS as readonly string[]).includes(state.sort) ? state.sort : 'code',
    dir: state.dir === 'desc' ? 'desc' : 'asc',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
    cpage: normalizePage(state.cpage),
    cpageSize: normalizePageSize(state.cpageSize),
  };
}

export function localizedName(entry: { nameVi: string; nameEn: string }, locale: Locale): string {
  return locale === 'vi' ? entry.nameVi : entry.nameEn;
}

/** Services matching the search (code or either name, ignoring case and accents) and both filters. */
export function filterServices(
  services: readonly ServiceResponse[],
  state: Pick<ServiceListState, 'q' | 'category' | 'status'>,
): ServiceResponse[] {
  const query = normalizeSearch(state.q);
  return services.filter((service) => {
    if (state.status === 'active' && !service.isActive) return false;
    if (state.status === 'inactive' && service.isActive) return false;
    if (state.category !== '' && service.categoryId !== state.category) return false;
    if (query === '') return true;
    return [service.code, service.nameVi, service.nameEn].some((field) =>
      normalizeSearch(field).includes(query),
    );
  });
}

/** What a service column sorts by. Price sorts by its minimum (whole VND). */
export function serviceSortValue(
  service: ServiceResponse,
  key: string,
  locale: Locale,
  categoryName: (id: string) => string,
): SortValue {
  if (key === 'name') return localizedName(service, locale);
  if (key === 'category') return categoryName(service.categoryId);
  if (key === 'price') return Number(service.priceVnd);
  return service.code;
}

/** Category order on the categories tab: the configured sort order, then the code. */
export function orderCategories(
  categories: readonly ServiceCategoryResponse[],
): ServiceCategoryResponse[] {
  return [...categories].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code),
  );
}

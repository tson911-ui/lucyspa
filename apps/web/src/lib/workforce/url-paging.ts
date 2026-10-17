import type { DataTablePaging } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { paginationLabels } from './list-view';

/**
 * The pager of a client-paged `DataTable` whose page and page size live in the address bar (session 10: Back/Forward and a
 * shared link restore the view). The screen keeps the two numbers in its own `useUrlState` (next to its filters, so a filter
 * change returns to page 1 through `resetOnChange`) and passes the writer here; changing the size returns to page 1 as well.
 */
export function urlPaging(
  page: number,
  pageSize: number,
  write: (patch: { page?: number; pageSize?: number }) => void,
  t: WorkforceDictionary,
  list: string,
): DataTablePaging {
  return {
    page,
    pageSize,
    onPageChange: (next) => write({ page: next }),
    onPageSizeChange: (next) => write({ page: 1, pageSize: next }),
    labels: paginationLabels(t, list),
  };
}

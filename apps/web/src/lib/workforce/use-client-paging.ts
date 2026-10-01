import type { DataTablePaging } from '@lucy-spa/ui';
import { useState } from 'react';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { paginationLabels } from './list-view';

/**
 * Pager state for a `DataTable mode="client"` that is not tied to the address bar (short lists inside
 * a page: 20 per page, back to page 1 when the size changes). `list` is the visible name of the list.
 */
export function useClientPaging(t: WorkforceDictionary, list: string): DataTablePaging {
  const [state, setState] = useState({ page: 1, pageSize: 20 });
  return {
    ...state,
    onPageChange: (page) => setState((current) => ({ ...current, page })),
    onPageSizeChange: (pageSize) => setState({ page: 1, pageSize }),
    labels: paginationLabels(t, list),
  };
}

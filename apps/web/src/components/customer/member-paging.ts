import { useUrlState, type DataTablePaging } from '@lucy-spa/ui';
import { useMemo } from 'react';
import type { CustomerDictionary } from '../../i18n/customer';
import { memberPagingLabels } from './member-format';

/** The member lists show 20 rows a page (DESIGN.md 8.8). */
export const MEMBER_PAGE_SIZE = 20;

const atLeastOne = (value: number) =>
  Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;

/**
 * The page of one member list, kept in the address bar under `param` (wig: list state in the URL): Back from a booking returns to the
 * same page, and a reload or a shared link opens it. Two lists on one screen use two names ("upcomingPage", "historyPage").
 */
export function useUrlPage(param: string): [number, (page: number, replace?: boolean) => void] {
  const defaults = useMemo(() => ({ [param]: 1 }), [param]);
  const options = useMemo(
    () => ({
      normalize: (state: Record<string, number>) => ({
        ...state,
        [param]: atLeastOne(state[param] ?? 1),
      }),
    }),
    [param],
  );
  const [state, update] = useUrlState<Record<string, number>>(defaults, options);
  return [
    state[param] ?? 1,
    (page: number, replace = false) => update({ [param]: atLeastOne(page) }, { replace }),
  ];
}

/** Pager of a client-side member list: 20 rows a page, the page in the address bar under `param`. */
export function useMemberPaging(
  t: CustomerDictionary,
  list: string,
  param = 'page',
): DataTablePaging {
  const [page, setPage] = useUrlPage(param);
  return {
    page,
    pageSize: MEMBER_PAGE_SIZE,
    onPageChange: setPage,
    labels: memberPagingLabels(t, list),
  };
}

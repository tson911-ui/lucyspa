'use client';

import { useUrlState } from '@lucy-spa/ui';

// The page of a list kept in the address (wig Navigation & State): Back/Forward and a shared link show the same page. One stable
// defaults object per key, as useUrlState asks; 20 rows a page and no page-size choice (DESIGN 8.8).

export const PAGE_SIZE = 20;
const defaultsByKey = new Map<string, Record<string, number>>();

function defaultsOf(key: string): Record<string, number> {
  let defaults = defaultsByKey.get(key);
  if (!defaults) {
    defaults = { [key]: 1 };
    defaultsByKey.set(key, defaults);
  }
  return defaults;
}

const BACK_DEFAULTS: { back: string } = { back: '' };
// The view keys of the POS lists (board: date/status/apage/ipage; returns: status/reason; stock counts tab: cpage/cpageSize).
const BACK_KEYS = [
  'branch',
  'tab',
  'q',
  'page',
  'date',
  'status',
  'reason',
  'apage',
  'ipage',
  'cpage',
  'cpageSize',
] as const;

/**
 * `?back=…` for a record link of a list: the list's own view (branch, tab, search, filters, page) travels with the link, so the
 * record's breadcrumb returns to the same tab, filters and page (wig product-orders.tsx:931, online-orders.tsx:721; HIG C70).
 * Defaults are left out.
 */
export function backParam(
  view: Record<string, string | number>,
  defaults: Record<string, string | number>,
): string {
  const query = new URLSearchParams();
  for (const key of BACK_KEYS) {
    const value = view[key];
    if (value !== undefined && value !== defaults[key] && value !== '')
      query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `?back=${encodeURIComponent(text)}` : '';
}

/** The list query a record page was opened from (only the known list keys, so nothing else can be injected), or ''. */
export function useBackQuery(): string {
  const [{ back }] = useUrlState(BACK_DEFAULTS);
  const source = new URLSearchParams(back);
  const query = new URLSearchParams();
  for (const key of BACK_KEYS) {
    const value = source.get(key);
    if (value) query.set(key, value);
  }
  return query.toString();
}

/** `{ page, pageSize, onPageChange }` for a DataTable, with the page in the query parameter `key`. */
export function useUrlPage(key: string) {
  const [state, update] = useUrlState(defaultsOf(key));
  return {
    page: state[key] ?? 1,
    pageSize: PAGE_SIZE,
    onPageChange: (page: number) => update({ [key]: page }),
  };
}

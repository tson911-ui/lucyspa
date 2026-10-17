import { DEFAULT_PAGE_SIZE, useUrlState, type DataTablePaging } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../../i18n/workforce';
import { normalizePage, normalizePageSize } from '../../../lib/workforce/list-view';
import { urlPaging } from '../../../lib/workforce/url-paging';

// The search text and the pager of a client-filtered list kept in the address bar (session 10, wig "URL reflects state"): Back/Forward and
// a shared link restore the same search and page. Keys are `<prefix>q`, `<prefix>p` and `<prefix>s` so two lists on one page never clash;
// a new search returns to page 1 (`resetOnChange`). Used by the admin-b list screens (pay, payroll, imports, supplier sources, audit).

type ListState = Record<string, string | number>;
interface ListConfig {
  defaults: ListState;
  options: { normalize: (state: ListState) => ListState; resetOnChange: readonly string[] };
}

const configs = new Map<string, ListConfig>();

function configFor(prefix: string): ListConfig {
  let config = configs.get(prefix);
  if (!config) {
    const [q, p, s] = [`${prefix}q`, `${prefix}p`, `${prefix}s`];
    config = {
      defaults: { [q]: '', [p]: 1, [s]: DEFAULT_PAGE_SIZE },
      options: {
        normalize: (state) => ({
          [q]: String(state[q] ?? ''),
          [p]: normalizePage(Number(state[p] ?? 1)),
          [s]: normalizePageSize(Number(state[s] ?? DEFAULT_PAGE_SIZE)),
        }),
        resetOnChange: [p],
      },
    };
    configs.set(prefix, config);
  }
  return config;
}

export function useUrlList(
  prefix: string,
  t: WorkforceDictionary,
  list: string,
): { query: string; setQuery: (query: string) => void; paging: DataTablePaging } {
  const { defaults, options } = configFor(prefix);
  const [state, update] = useUrlState(defaults, options);
  const [q, p, s] = [`${prefix}q`, `${prefix}p`, `${prefix}s`];
  return {
    query: String(state[q] ?? ''),
    // Typing replaces the entry instead of stacking one per keystroke.
    setQuery: (query) => update({ [q]: query }, { replace: true }),
    paging: urlPaging(
      Number(state[p] ?? 1),
      Number(state[s] ?? DEFAULT_PAGE_SIZE),
      (patch) =>
        update({
          ...(patch.page !== undefined ? { [p]: patch.page } : {}),
          ...(patch.pageSize !== undefined ? { [s]: patch.pageSize } : {}),
        }),
      t,
      list,
    ),
  };
}

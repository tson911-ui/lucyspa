import { DEFAULT_PAGE_SIZE, useUrlState, type DataTablePaging } from '@lucy-spa/ui';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { normalizePage, normalizePageSize, paginationLabels } from './list-view';

/**
 * The pager of a list that sits inside a page with other lists (a loyalty section, a profile's sub-list), kept in the address
 * bar under its own short keys (`<key>` = page, `<key>s` = page size), so Back/Forward and a shared link restore the same page.
 * The keys must be unique on the page. `useUrlState` needs stable options, so they are made once per key.
 */
type PagingState = Record<string, number>;
interface PagingConfig {
  defaults: PagingState;
  options: { normalize: (state: PagingState) => PagingState; resetOnChange: readonly string[] };
}

const configs = new Map<string, PagingConfig>();

function configFor(key: string): PagingConfig {
  let config = configs.get(key);
  if (!config) {
    const sizeKey = `${key}s`;
    config = {
      defaults: { [key]: 1, [sizeKey]: DEFAULT_PAGE_SIZE },
      options: {
        normalize: (state) => ({
          [key]: normalizePage(state[key] ?? 1),
          [sizeKey]: normalizePageSize(state[sizeKey] ?? DEFAULT_PAGE_SIZE),
        }),
        resetOnChange: [key],
      },
    };
    configs.set(key, config);
  }
  return config;
}

const pageConfigs = new Map<string, PagingConfig>();

/** A server-paged list at a fixed page size: only the page number lives in the address bar, under `key`. */
export function useUrlPage(key: string): [number, (page: number) => void] {
  let config = pageConfigs.get(key);
  if (!config) {
    config = {
      defaults: { [key]: 1 },
      options: {
        normalize: (state) => ({ [key]: normalizePage(state[key] ?? 1) }),
        resetOnChange: [],
      },
    };
    pageConfigs.set(key, config);
  }
  const [state, update] = useUrlState(config.defaults, config.options);
  return [state[key] ?? 1, (page) => update({ [key]: page })];
}

export function useUrlPaging(key: string, t: WorkforceDictionary, list: string): DataTablePaging {
  const { defaults, options } = configFor(key);
  const [state, update] = useUrlState(defaults, options);
  const sizeKey = `${key}s`;
  return {
    page: state[key] ?? 1,
    pageSize: state[sizeKey] ?? DEFAULT_PAGE_SIZE,
    onPageChange: (page) => update({ [key]: page }),
    onPageSizeChange: (pageSize) => update({ [sizeKey]: pageSize, [key]: 1 }),
    labels: paginationLabels(t, list),
  };
}

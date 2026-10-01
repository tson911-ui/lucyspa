import { DEFAULT_PAGE_SIZE } from '@lucy-spa/ui';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Teams list state. The API pages and searches (`GET /teams?branchId&q&page&limit`), so the table
 * runs in server mode; the state lives in the address bar and the 20/page default is the contract's.
 */

export const TEAM_LIST_DEFAULTS = {
  q: '',
  branch: '',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};
export type TeamListState = typeof TEAM_LIST_DEFAULTS;

/** Keys that return to page 1 when the search, the branch or the page size changes. */
export const TEAM_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeTeamList(state: TeamListState): TeamListState {
  return {
    q: state.q.slice(0, 100),
    branch: state.branch,
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
  };
}

/** The query of `GET /api/v1/teams` for this list state. */
export function teamListQuery(state: TeamListState) {
  return { branchId: state.branch, q: state.q, page: state.page, limit: state.pageSize };
}

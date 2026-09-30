import type { SkillResponse } from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch, type SortValue } from '@lucy-spa/ui';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Skills list state. The API returns every skill, so the list searches, filters, sorts and pages
 * in the browser (client mode, decision Q-D3); the state lives in the address bar.
 */

export const SKILL_SORT_KEYS = ['code', 'nameVi', 'nameEn', 'status'] as const;
export type SkillSortKey = (typeof SKILL_SORT_KEYS)[number];

export const SKILL_LIST_DEFAULTS = {
  q: '',
  status: '',
  sort: 'code',
  dir: 'asc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};
export type SkillListState = typeof SKILL_LIST_DEFAULTS;

/** Keys that return to page 1 when the search, filter, sort or page size changes. */
export const SKILL_PAGE_KEYS: readonly string[] = ['page'];

export function normalizeSkillList(state: SkillListState): SkillListState {
  return {
    q: state.q.slice(0, 100),
    status: state.status === 'active' || state.status === 'inactive' ? state.status : '',
    sort: (SKILL_SORT_KEYS as readonly string[]).includes(state.sort) ? state.sort : 'code',
    dir: state.dir === 'desc' ? 'desc' : 'asc',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
  };
}

/** Skills matching the search (code or either name, ignoring case and accents) and the status filter. */
export function filterSkills(
  skills: readonly SkillResponse[],
  state: Pick<SkillListState, 'q' | 'status'>,
): SkillResponse[] {
  const query = normalizeSearch(state.q);
  return skills.filter((skill) => {
    if (state.status === 'active' && !skill.isActive) return false;
    if (state.status === 'inactive' && skill.isActive) return false;
    if (query === '') return true;
    return [skill.code, skill.nameVi, skill.nameEn].some((field) =>
      normalizeSearch(field).includes(query),
    );
  });
}

export function skillSortValue(skill: SkillResponse, key: string): SortValue {
  if (key === 'nameVi') return skill.nameVi;
  if (key === 'nameEn') return skill.nameEn;
  if (key === 'status') return skill.isActive ? 0 : 1;
  return skill.code;
}

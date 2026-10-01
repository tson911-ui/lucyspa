import type {
  AuthorizationScope,
  OrganizationAppointment,
  OrganizationArea,
  OrganizationBranch,
  OrganizationLevel,
  OrganizationRegion,
  OrganizationSnapshotResponse,
} from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch } from '@lucy-spa/ui';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Organization screen state. The API returns the whole hierarchy and every active appointment, so
 * search, the one filter of each tab and paging run in the browser (client mode, decision Q-D3);
 * the state lives in the address bar.
 */

export const ORG_TABS = ['regions', 'areas', 'branches', 'appointments'] as const;
export type OrgTab = (typeof ORG_TABS)[number];

export const ORG_LEVELS: readonly OrganizationLevel[] = [
  'CEO',
  'REGIONAL_MANAGER',
  'AREA_MANAGER',
  'STORE_MANAGER',
  'DEPUTY_STORE_MANAGER',
  'TEAM_LEADER',
];

export const ORG_LIST_DEFAULTS = {
  tab: 'regions',
  q: '',
  /** Regions/areas: `active` | `inactive`. Branches: `placed` | `unplaced`. Appointments: a level. */
  filter: '',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
};
export type OrgListState = typeof ORG_LIST_DEFAULTS;

/** Keys that return to page 1 when the search, the filter or the page size changes. */
export const ORG_PAGE_KEYS: readonly string[] = ['page'];

/** Values the filter of a tab accepts. */
export function filterValues(tab: string): readonly string[] {
  if (tab === 'branches') return ['placed', 'unplaced'];
  if (tab === 'appointments') return ORG_LEVELS;
  return ['active', 'inactive'];
}

export function normalizeOrgList(state: OrgListState): OrgListState {
  const tab = (ORG_TABS as readonly string[]).includes(state.tab) ? state.tab : 'regions';
  return {
    tab,
    q: state.q.slice(0, 100),
    filter: filterValues(tab).includes(state.filter) ? state.filter : '',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
  };
}

/** The same search text means a different thing on another tab, so changing tab clears it. */
export const ORG_TAB_RESET = { q: '', filter: '', page: 1 } as const;

function matches(query: string, fields: readonly string[]): boolean {
  return query === '' || fields.some((field) => normalizeSearch(field).includes(query));
}

function activeFilter(isActive: boolean, filter: string): boolean {
  return !((filter === 'active' && !isActive) || (filter === 'inactive' && isActive));
}

export function filterRegions(
  regions: readonly OrganizationRegion[],
  state: Pick<OrgListState, 'q' | 'filter'>,
): OrganizationRegion[] {
  const query = normalizeSearch(state.q);
  return regions.filter(
    (region) =>
      activeFilter(region.isActive, state.filter) && matches(query, [region.code, region.name]),
  );
}

export function filterAreas(
  areas: readonly OrganizationArea[],
  regions: readonly OrganizationRegion[],
  state: Pick<OrgListState, 'q' | 'filter'>,
): OrganizationArea[] {
  const query = normalizeSearch(state.q);
  return areas.filter(
    (area) =>
      activeFilter(area.isActive, state.filter) &&
      matches(query, [area.code, area.name, regionName(regions, area.regionId)]),
  );
}

export function filterBranches(
  branches: readonly OrganizationBranch[],
  areas: readonly OrganizationArea[],
  state: Pick<OrgListState, 'q' | 'filter'>,
): OrganizationBranch[] {
  const query = normalizeSearch(state.q);
  return branches.filter((branch) => {
    if (state.filter === 'placed' && !branch.areaId) return false;
    if (state.filter === 'unplaced' && branch.areaId) return false;
    const area = areas.find((entry) => entry.id === branch.areaId);
    return matches(query, [branch.code, branch.name, area?.name ?? '']);
  });
}

export function filterAppointments(
  items: readonly OrganizationAppointment[],
  snapshot: OrganizationSnapshotResponse,
  levelLabels: Readonly<Record<OrganizationLevel, string>>,
  systemText: string,
  state: Pick<OrgListState, 'q' | 'filter'>,
): OrganizationAppointment[] {
  const query = normalizeSearch(state.q);
  return items.filter((item) => {
    if (state.filter !== '' && item.level !== state.filter) return false;
    return matches(query, [
      item.fullName,
      levelLabels[item.level],
      formatScope(item.scope, snapshot, systemText),
    ]);
  });
}

export function regionName(regions: readonly OrganizationRegion[], id: string): string {
  return regions.find((region) => region.id === id)?.name ?? id;
}

/** The name of what an appointment covers: the whole system, or a region, area or branch. */
export function formatScope(
  scope: AuthorizationScope,
  snapshot: OrganizationSnapshotResponse,
  systemText: string,
): string {
  if (scope.kind === 'GLOBAL') return systemText;
  if (scope.kind === 'REGION') {
    return snapshot.regions.find((region) => region.id === scope.regionId)?.name ?? scope.regionId;
  }
  if (scope.kind === 'AREA') {
    return snapshot.areas.find((area) => area.id === scope.areaId)?.name ?? scope.areaId;
  }
  return snapshot.branches.find((branch) => branch.id === scope.branchId)?.name ?? scope.branchId;
}

/** The scope an appointment of `level` gets from the chosen region, area or branch id. */
export function appointmentScope(level: OrganizationLevel, scopeId: string): AuthorizationScope {
  if (level === 'CEO') return { kind: 'GLOBAL' };
  if (level === 'REGIONAL_MANAGER') return { kind: 'REGION', regionId: scopeId };
  if (level === 'AREA_MANAGER') return { kind: 'AREA', areaId: scopeId };
  return { kind: 'BRANCH', branchId: scopeId };
}

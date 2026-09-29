import type {
  TeamBulkSelection,
  TeamEmployeeFilters,
  TeamEmployeesResponse,
  TeamMembersRequest,
  TeamMembersResponse,
} from '@lucy-spa/contracts';
import type { WorkforceApi } from './api';

export type MemberSelection =
  { kind: 'explicit'; ids: readonly string[] } | { kind: 'matching'; excluded: readonly string[] };
export const EMPTY_SELECTION: MemberSelection = { kind: 'explicit', ids: [] };
export function selected(selection: MemberSelection, id: string): boolean {
  return selection.kind === 'explicit'
    ? selection.ids.includes(id)
    : !selection.excluded.includes(id);
}
export function toggleMember(selection: MemberSelection, id: string): MemberSelection {
  if (selection.kind === 'matching')
    return {
      kind: 'matching',
      excluded: selection.excluded.includes(id)
        ? selection.excluded.filter((entry) => entry !== id)
        : [...selection.excluded, id].slice(0, 100),
    };
  return {
    kind: 'explicit',
    ids: selection.ids.includes(id)
      ? selection.ids.filter((entry) => entry !== id)
      : [...selection.ids, id].slice(0, 100),
  };
}
export function selectPage(selection: MemberSelection, ids: readonly string[]): MemberSelection {
  return selection.kind === 'matching'
    ? { kind: 'matching', excluded: selection.excluded.filter((id) => !ids.includes(id)) }
    : { kind: 'explicit', ids: [...new Set([...selection.ids, ...ids])].slice(0, 100) };
}
export function selectionCount(selection: MemberSelection, total: number): number {
  return selection.kind === 'explicit'
    ? selection.ids.length
    : Math.max(0, total - selection.excluded.length);
}
export function bulkSelection(
  selection: MemberSelection,
  filters: TeamEmployeeFilters,
): TeamBulkSelection {
  return selection.kind === 'explicit'
    ? { userIds: [...selection.ids] }
    : { allMatching: true, filters, excludedUserIds: [...selection.excluded] };
}
export function teamEmployees(
  api: WorkforceApi,
  id: string,
  filters: TeamEmployeeFilters,
  page: number,
) {
  return api.get<TeamEmployeesResponse>(`/api/v1/teams/${id}/employees`, {
    ...filters,
    page,
    limit: 50,
  });
}
/** Process bounded server batches; version/cursor advance only after a committed response. */
export async function changeTeamMembers(
  api: WorkforceApi,
  id: string,
  input: TeamMembersRequest,
  progress: (value: { processed: number; changed: number }) => void,
): Promise<void> {
  let body = input;
  let processed = 0;
  let changed = 0;
  for (;;) {
    const result = await api.post<TeamMembersResponse>(`/api/v1/teams/${id}/members`, body);
    processed += result.processed;
    changed += result.changed;
    progress({ processed, changed });
    if (!result.hasMore || !result.nextAfter || !('allMatching' in body.selection)) return;
    body = {
      ...body,
      expectedVersion: result.version,
      selection: { ...body.selection, after: result.nextAfter },
    };
  }
}

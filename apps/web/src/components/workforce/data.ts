'use client';

import type {
  BranchListResponse,
  BranchSummary,
  EmployeeDirectoryEntry,
  EmployeeDirectoryResponse,
} from '@lucy-spa/contracts';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { fill } from '../../i18n/workforce';
import type { WorkforceApi } from '../../lib/workforce/api';
import { canAnywhere, type Account } from '../../lib/workforce/permissions';
import { STAFF_READ_PREFIX, useResource, type Resource } from './ui';

/** Branches visible to the caller (the API decides which). */
export function useBranches(api: WorkforceApi): Resource<Map<string, BranchSummary>> {
  // Reference data: shared and reused for 30 s across the screens and widgets that show branch names (rbp client-swr-dedup).
  return useResource(
    async () => {
      const response = await api.get<BranchListResponse>('/api/v1/branches');
      return new Map(response.branches.map((branch) => [branch.id, branch]));
    },
    [api],
    { cacheKey: `${STAFF_READ_PREFIX}branches` },
  );
}

/** At most this many directory entries are loaded for name display (5 pages of 100). */
const NAME_PAGES = 5;

/**
 * Names for employee IDs shown in attendance and leave views. They come only from the
 * employee directory, which enforces VIEW_EMPLOYEES containment. Without that permission
 * no names are loaded and the UI shows a neutral fallback: visibility is never widened.
 *
 * The directory is a keyset (cursor) list: each page names the next one, so the pages are read one after another by design
 * (the API has no page numbers to fetch in parallel). The names are shared and reused for 30 s, so a second screen or a
 * return to the list does not walk the pages again (rbp client-swr-dedup).
 */
export function useEmployeeNames(
  api: WorkforceApi,
  account: Account,
): Resource<Map<string, EmployeeDirectoryEntry>> {
  const allowed = canAnywhere(account, 'VIEW_EMPLOYEES');
  return useResource(
    async () => {
      const names = new Map<string, EmployeeDirectoryEntry>();
      if (!allowed) return names;
      let cursor: string | undefined;
      for (let page = 0; page < NAME_PAGES; page += 1) {
        const response = await api.get<EmployeeDirectoryResponse>('/api/v1/employees', {
          limit: 100,
          cursor,
        });
        for (const entry of response.items) names.set(entry.id, entry);
        if (!response.nextCursor) break;
        cursor = response.nextCursor;
      }
      return names;
    },
    [api, allowed],
    { cacheKey: allowed ? `${STAFF_READ_PREFIX}employee-names:${account.id}` : null },
  );
}

// One page-return signal for the staff area (rbp client-event-listeners): a single `focus` + `visibilitychange` pair however many
// parts want to know (the session check, the dashboard's stale refresh), and one call per return (both events fire together).
const returnListeners = new Set<() => void>();
let returnQueued = false;

function onReturn() {
  if (document.visibilityState === 'hidden' || returnQueued) return;
  returnQueued = true;
  queueMicrotask(() => {
    returnQueued = false;
    for (const listener of returnListeners) listener();
  });
}

/** Calls `listener` once each time the page comes back into view or regains focus. Returns the cleanup. */
export function onPageReturn(listener: () => void): () => void {
  if (returnListeners.size === 0) {
    window.addEventListener('focus', onReturn);
    document.addEventListener('visibilitychange', onReturn);
  }
  returnListeners.add(listener);
  return () => {
    returnListeners.delete(listener);
    if (returnListeners.size > 0) return;
    window.removeEventListener('focus', onReturn);
    document.removeEventListener('visibilitychange', onReturn);
  };
}

export function employeeLabel(
  id: string,
  names: Map<string, EmployeeDirectoryEntry> | null,
  account: Account,
  t: WorkforceDictionary,
): string {
  if (id === account.id) return account.displayName;
  const entry = names?.get(id);
  return entry
    ? `${entry.fullName} (${entry.employeeId})`
    : fill(t.employees.noName, { id: id.slice(0, 8) });
}

export function branchLabel(
  id: string,
  branches: Map<string, BranchSummary> | null,
  t: WorkforceDictionary,
): string {
  const branch = branches?.get(id);
  return branch ? branch.name : t.common.unknownBranch;
}

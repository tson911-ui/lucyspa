'use client';

import type {
  BranchListResponse,
  BranchSummary,
  OperationalTodayResponse,
  PosBoardResponse,
} from '@lucy-spa/contracts';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { IDLE, SharedResources, type Loader } from '../../../lib/workforce/dashboard/shared-data';
import { useWorkforce } from '../session';
import type { Resource } from '../ui';

// Keyed, de-duplicated data for the dashboard's widgets (see `lib/workforce/dashboard/shared-data.ts`).

const StoreContext = createContext<SharedResources | null>(null);

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const store = useMemo(() => new SharedResources(), []);
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'hidden') store.refreshStale();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [store]);
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

/**
 * One shared resource. A `null` key means "nothing to load" (no branch chosen): the result is empty and
 * not loading. Widgets read through this so N widgets on one endpoint cost one request.
 */
export function useShared<T>(key: string | null, loader: Loader<T>): Resource<T> {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useShared outside DashboardDataProvider');
  const latest = useRef(loader);
  latest.current = loader;
  const subscribe = useCallback(
    (notify: () => void) =>
      key ? store.subscribe(key, (passive) => latest.current(passive), notify) : () => undefined,
    [store, key],
  );
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (key ? store.snapshot<T>(key) : IDLE),
    () => IDLE,
  );
  const reload = useCallback(() => (key ? store.reload(key) : Promise.resolve()), [store, key]);
  return {
    data: snapshot.data as T | null,
    error: snapshot.error,
    // Before the first response (including the first render, before the subscription starts).
    loading: key !== null && snapshot.data === null && snapshot.error === null,
    reload,
  };
}

/** Both resources as one: loading until both have data, the first error wins, reload reloads both. */
export function combine<A, B>(a: Resource<A>, b: Resource<B>): Resource<{ a: A; b: B }> {
  return {
    data: a.data !== null && b.data !== null ? { a: a.data, b: b.data } : null,
    error: a.error ?? b.error,
    loading: (a.loading || b.loading) && !(a.error ?? b.error),
    reload: async () => {
      await Promise.all([a.reload(), b.reload()]);
    },
  };
}

/** Branches visible to the caller, keyed by id (the scope selector and the attendance widget share it). */
export function useBranchMap(): Resource<Map<string, BranchSummary>> {
  const { api } = useWorkforce();
  return useShared('branches', async (passive) => {
    const response = await api.get<BranchListResponse>('/api/v1/branches', {}, { passive });
    return new Map(response.branches.map((branch) => [branch.id, branch]));
  });
}

/** A resource that is already loaded (widgets built from data the page holds, such as quick links). */
export function loaded<T>(data: T): Resource<T> {
  return { data, error: null, loading: false, reload: () => Promise.resolve() };
}

/** The branch "today" board: bookings, queue, active visits (three widgets read it). */
export function useTodayBoard(branchId: string | null): Resource<OperationalTodayResponse> {
  const { api } = useWorkforce();
  return useShared(branchId ? `today:${branchId}` : null, (passive) =>
    api.get<OperationalTodayResponse>(
      `/api/v1/operations/branches/${branchId}/today`,
      {},
      { passive },
    ),
  );
}

/** The POS board: today's window, or the window ending on `date` (the comparison period). */
export function usePosBoard(
  branchId: string | null,
  date: string | null = null,
): Resource<PosBoardResponse> {
  const { api } = useWorkforce();
  return useShared(branchId ? `pos:${branchId}:${date ?? 'now'}` : null, (passive) =>
    api.get<PosBoardResponse>(`/api/v1/pos/branches/${branchId}/board`, date ? { date } : {}, {
      passive,
    }),
  );
}

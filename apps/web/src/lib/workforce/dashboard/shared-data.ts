// Data shared by the dashboard's widgets (docs/UXUI_REDESIGN_DESIGN.md 14.1). Several widgets read the same
// endpoint (three of them the branch "today" board), so requests are keyed and de-duplicated: one request
// per key, however many widgets show it. Widgets still own what they show; this owns only the fetching.
// Refresh: when the window regains focus and every 5 minutes, never more often (no websockets), and always
// passively so the dashboard never keeps an idle session alive.

export const DASHBOARD_REFRESH_MS = 5 * 60_000;

export interface Snapshot<T> {
  data: T | null;
  error: unknown;
  loading: boolean;
  /** When `data` was last loaded (ms since the epoch), or null before the first success. */
  updatedAt: number | null;
}

/** `passive` is true for background refreshes. */
export type Loader<T> = (passive: boolean) => Promise<T>;

export interface Timers {
  setInterval(handler: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
  now(): number;
}

const realTimers: Timers = {
  setInterval: (handler, ms) => globalThis.setInterval(handler, ms),
  clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof setInterval>),
  now: () => Date.now(),
};

interface Entry {
  loader: Loader<unknown>;
  listeners: Set<() => void>;
  snapshot: Snapshot<unknown>;
  generation: number;
}

export const IDLE: Snapshot<never> = Object.freeze({
  data: null,
  error: null,
  loading: false,
  updatedAt: null,
});

export class SharedResources {
  private readonly entries = new Map<string, Entry>();
  private timer: unknown = null;

  constructor(private readonly options: { refreshMs?: number; timers?: Timers } = {}) {}

  private get timers(): Timers {
    return this.options.timers ?? realTimers;
  }

  private get refreshMs(): number {
    return this.options.refreshMs ?? DASHBOARD_REFRESH_MS;
  }

  /** Stable between changes (required by `useSyncExternalStore`). */
  snapshot<T>(key: string): Snapshot<T> {
    return (this.entries.get(key)?.snapshot as Snapshot<T> | undefined) ?? (IDLE as Snapshot<T>);
  }

  subscribe<T>(key: string, loader: Loader<T>, listener: () => void): () => void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        loader: loader as Loader<unknown>,
        listeners: new Set(),
        snapshot: IDLE,
        generation: 0,
      };
      this.entries.set(key, entry);
    }
    entry.loader = loader as Loader<unknown>;
    entry.listeners.add(listener);
    this.startTimer();
    // First subscriber, or cached data that went stale while nobody showed it.
    if (entry.snapshot.updatedAt === null && !entry.snapshot.loading) void this.load(key, false);
    else if (this.isStale(entry)) void this.load(key, true);
    return () => {
      entry.listeners.delete(listener);
      if (entry.listeners.size === 0) this.stopTimerIfIdle();
    };
  }

  /** Reloads one key now (retry button, or after a change). Concurrent loads: the latest wins. */
  reload(key: string, passive = false): Promise<void> {
    return this.load(key, passive);
  }

  /** Window focus: reload what is older than one refresh period. */
  refreshStale(): void {
    for (const [key, entry] of this.entries) {
      if (entry.listeners.size > 0 && this.isStale(entry)) void this.load(key, true);
    }
  }

  dispose(): void {
    this.stopTimer();
    this.entries.clear();
  }

  private isStale(entry: Entry): boolean {
    const at = entry.snapshot.updatedAt;
    return at !== null && this.timers.now() - at >= this.refreshMs;
  }

  private async load(key: string, passive: boolean): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry) return;
    const current = ++entry.generation;
    // Background refreshes keep showing the data they already have.
    this.set(entry, { ...entry.snapshot, loading: !passive || entry.snapshot.data === null });
    try {
      const data = await entry.loader(passive);
      if (current === entry.generation) {
        this.set(entry, { data, error: null, loading: false, updatedAt: this.timers.now() });
      }
    } catch (error) {
      if (current === entry.generation) {
        this.set(entry, { ...entry.snapshot, error, loading: false });
      }
    }
  }

  private set(entry: Entry, snapshot: Snapshot<unknown>): void {
    entry.snapshot = snapshot;
    for (const listener of [...entry.listeners]) listener();
  }

  private startTimer(): void {
    if (this.timer !== null) return;
    this.timer = this.timers.setInterval(() => {
      for (const [key, entry] of this.entries) {
        if (entry.listeners.size > 0) void this.load(key, true);
      }
    }, this.refreshMs);
  }

  private stopTimerIfIdle(): void {
    for (const entry of this.entries.values()) if (entry.listeners.size > 0) return;
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer === null) return;
    this.timers.clearInterval(this.timer);
    this.timer = null;
  }
}

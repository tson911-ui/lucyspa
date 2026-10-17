/**
 * A small request cache for the member area (rbp client-swr-dedup, no new dependency): reads with the same key share one request
 * while it is in flight, and a settled answer is reused for a short while (the account home and the bookings list both read
 * `/api/v1/me/bookings`; going back to a list does not read it again at once). A failed read is never kept. A change of session
 * clears everything (`clearCachedReads`), and a write clears the reads it changes (`invalidateCachedReads`). Pure module state:
 * client only, per tab.
 */

/** How long a settled answer is reused. */
export const CACHED_READ_MS = 30_000;

interface Entry {
  promise: Promise<unknown>;
  /** When the answer arrived (or the request started, while in flight). */
  at: number;
  settled: boolean;
  data?: unknown;
}

const entries = new Map<string, Entry>();

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  return entry !== undefined && (!entry.settled || now - entry.at < CACHED_READ_MS);
}

/** The read for `key`: the one in flight, a recent answer, or a new request from `load`. */
export function cachedRead<T>(key: string, load: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = entries.get(key);
  if (fresh(hit, now)) return hit.promise as Promise<T>;
  const entry: Entry = { promise: load(), at: now, settled: false };
  entries.set(key, entry);
  entry.promise.then(
    (data) => {
      entry.settled = true;
      entry.at = Date.now();
      entry.data = data;
    },
    () => {
      if (entries.get(key) === entry) entries.delete(key);
    },
  );
  return entry.promise as Promise<T>;
}

/** A recent settled answer for `key`, to paint at once without a loading flash; `undefined` when there is none. */
export function peekCachedRead<T>(key: string, now = Date.now()): T | undefined {
  const hit = entries.get(key);
  return hit && hit.settled && now - hit.at < CACHED_READ_MS ? (hit.data as T) : undefined;
}

/** Forgets every read whose key starts with `prefix` (after a write that changes them, or before a retry). */
export function invalidateCachedReads(prefix: string): void {
  for (const key of [...entries.keys()]) if (key.startsWith(prefix)) entries.delete(key);
}

/** Forgets everything (sign-in, sign-out, a changed account). */
export function clearCachedReads(): void {
  entries.clear();
}

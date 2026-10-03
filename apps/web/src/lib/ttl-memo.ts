/**
 * A tiny in-process cache for the public reads the server layouts and pages make on every request (the season, the
 * shop profile, the catalogue, the slides). It replaces Next's fetch cache for these reads on purpose: that cache only
 * stores 200 answers, so when the API starts answering 204 ("no season now") or an error, the last 200 stayed in it as
 * "stale" and kept being served. Here every answer, "nothing" included, is remembered for `ttlMs`; a failure only for
 * `failureTtlMs`, so a blip is retried soon and does not hammer a struggling API.
 */
export interface Answer<T> {
  value: T;
  /** False for a timeout, a transport error or a non-success status: remembered only briefly. */
  ok: boolean;
}

export const DEFAULT_TTL_MS = 60_000;
export const DEFAULT_FAILURE_TTL_MS = 5_000;
const MAX_ENTRIES = 200;

const entries = new Map<string, { until: number; answer: Answer<unknown> }>();
const flights = new Map<string, Promise<Answer<unknown>>>();

export async function ttlMemo<T>(
  key: string,
  load: () => Promise<Answer<T>>,
  options: { ttlMs?: number; failureTtlMs?: number; now?: () => number } = {},
): Promise<T> {
  const now = options.now ?? Date.now;
  const hit = entries.get(key);
  if (hit && hit.until > now()) return hit.answer.value as T;
  // One request in flight per key: a burst of visitors shares the same read.
  let flight = flights.get(key) as Promise<Answer<T>> | undefined;
  if (!flight) {
    flight = load()
      .catch((): Answer<T> => ({ value: null as T, ok: false }))
      .then((answer) => {
        if (entries.size >= MAX_ENTRIES) entries.clear();
        entries.set(key, {
          until:
            now() +
            (answer.ok
              ? (options.ttlMs ?? DEFAULT_TTL_MS)
              : (options.failureTtlMs ?? DEFAULT_FAILURE_TTL_MS)),
          answer,
        });
        return answer;
      })
      .finally(() => flights.delete(key));
    flights.set(key, flight);
  }
  return (await flight).value;
}

/** For tests. */
export function clearTtlMemo(): void {
  entries.clear();
  flights.clear();
}

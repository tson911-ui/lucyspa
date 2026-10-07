/**
 * A very short, in-process memory for anonymous public reads (Phase 6 P6-7). Two things make it safe and useful:
 *
 * - **It only ever delays a change by `ttlMs`** (a few seconds) and holds nothing private; it is never used for a session, a
 *   permission or a payment. Each API process has its own, so it needs no coordination: more processes later simply mean more
 *   independent copies, each at most `ttlMs` old.
 * - **Identical requests that arrive together share one read** (`inFlight`), so a burst of visitors asking for the same page costs
 *   one database query, not hundreds.
 *
 * Failures are never remembered, and the number of entries is capped (the oldest goes first).
 */
export class ShortCache<T> {
  private readonly values = new Map<string, { at: number; value: T }>();
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.values.get(key);
    if (hit && this.now() - hit.at < this.ttlMs) return hit.value;
    const pending = this.inFlight.get(key);
    if (pending) return pending;
    const started = load()
      .then((value) => {
        this.remember(key, value);
        return value;
      })
      .finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, started);
    return started;
  }

  private remember(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, { at: this.now(), value });
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }
}

/*
 * Test fixtures: the auth throttle counts in fixed windows aligned to the clock (`floor(now / window) * window`; the login
 * and OTP windows are 15 minutes and one hour, and every hour boundary is also a quarter-hour boundary). A test that makes
 * ten failures and then expects the eleventh refusal fails when those failures straddle a boundary (two counters of four
 * and six instead of one of ten): about once in 300 runs, always at hh:00, hh:15, hh:30 or hh:45. The throttle is correct;
 * the test waits for a window with room before it starts counting.
 */
const QUARTER_HOUR_MS = 900_000;

/** Milliseconds from `now` to the end of the current 15-minute window. */
export function msToWindowEnd(now: number, windowMs: number = QUARTER_HOUR_MS): number {
  return windowMs - (now % windowMs);
}

/**
 * Resolves once the current 15-minute window has at least `roomMs` left (at once when it already has). Returns how long it
 * waited. Call it first in any test that counts failures against the login, OTP or reauthentication budget.
 */
export async function awaitThrottleWindowRoom(
  roomMs = 45_000,
  clock: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((done) => setTimeout(done, ms)),
): Promise<number> {
  const left = msToWindowEnd(clock());
  if (left >= roomMs) return 0;
  const wait = left + 1_000;
  await sleep(wait);
  return wait;
}

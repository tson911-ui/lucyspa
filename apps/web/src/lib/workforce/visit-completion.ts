import type { CancelServiceLineRequest, ResolveServiceExecutionRequest } from '@lucy-spa/contracts';

/** How the management-resolved end time is chosen: never a free timestamp editor. */
export type ResolveEndMode = 'NOW' | 'EXPECTED' | 'MINUTES';

const MAX_REASON = 500;

/** A required reason, trimmed and NFC-normalized, at most 500 characters (the API rule). */
export function reasonBody(reason: string): CancelServiceLineRequest | null {
  const trimmed = reason.normalize('NFC').trim();
  return trimmed && [...trimmed].length <= MAX_REASON ? { reason: trimmed } : null;
}

/**
 * The request for "resolve forgotten END". The end time is constrained to what the API accepts
 * (start <= end <= server clock):
 * - NOW: omitted, the server clock is used;
 * - EXPECTED: the planned end, offered only once it has passed;
 * - MINUTES: the start plus a whole number of minutes that does not pass the server time.
 * The server re-validates every case; a stale page can only produce a refused request.
 */
export function resolveEndBody(input: {
  reason: string;
  mode: ResolveEndMode;
  minutes: string;
  startedAt: string;
  expectedEndAt: string;
  now: string;
}): ResolveServiceExecutionRequest | null {
  const base = reasonBody(input.reason);
  if (!base) return null;
  const started = Date.parse(input.startedAt);
  const now = Date.parse(input.now);
  if (input.mode === 'NOW') return base;
  if (input.mode === 'EXPECTED') {
    const expected = Date.parse(input.expectedEndAt);
    return expected >= started && expected <= now
      ? { ...base, endedAt: new Date(expected).toISOString() }
      : null;
  }
  if (!/^[1-9][0-9]{0,4}$/.test(input.minutes)) return null;
  const end = started + Number(input.minutes) * 60_000;
  return end <= now ? { ...base, endedAt: new Date(end).toISOString() } : null;
}

/** Whole minutes elapsed since the start, according to the board's server instant. */
export function elapsedMinutes(startedAt: string, now: string): number {
  return Math.max(0, Math.floor((Date.parse(now) - Date.parse(startedAt)) / 60_000));
}

import { ApiError, type WorkforceApi } from './api';
import { sessionEndReason, type SessionEndReason } from './expiry';

/**
 * A role or scope change ends the person's sessions on the server. Nothing in the live page
 * would notice, so the shell checks `GET /auth/me` passively (it never extends the idle
 * timeout): when the window regains focus and every few minutes while it is visible.
 * Permissions are not refreshed inside a living session; the person signs in again.
 */
export const SESSION_WATCH_INTERVAL_MS = 180_000;
/** Focus and visibility events can burst; one check per this gap is enough. */
export const SESSION_WATCH_MIN_GAP_MS = 15_000;

export interface SessionCheckOptions {
  readonly api: Pick<WorkforceApi, 'get'>;
  /** Called once, when the API answers 401. */
  readonly onEnded: (reason: SessionEndReason) => void;
  readonly now?: () => number;
}

/** Returns `check()`: a throttled, single-flight probe that stops after the session has ended. */
export function createSessionCheck({ api, onEnded, now = Date.now }: SessionCheckOptions) {
  let last = Number.NEGATIVE_INFINITY;
  let busy = false;
  let ended = false;
  return async function check(): Promise<void> {
    if (ended || busy || now() - last < SESSION_WATCH_MIN_GAP_MS) return;
    busy = true;
    last = now();
    try {
      await api.get('/api/v1/auth/me', {}, { passive: true, skipExpiryHook: true });
    } catch (error) {
      // Network and server errors are not a verdict on the session; the next check retries.
      if (error instanceof ApiError && error.status === 401) {
        ended = true;
        onEnded(sessionEndReason(error.reason));
      }
    } finally {
      busy = false;
    }
  };
}

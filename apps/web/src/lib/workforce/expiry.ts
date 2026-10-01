/**
 * What the workforce shell does when the API reports an expired session (401).
 *
 * - A failed command (`POST`) keeps the page: the form's entries stay in memory, nothing
 *   was saved (authentication is checked before any write), and the user can sign in again
 *   in a new tab and then resubmit. Nothing is written to web storage.
 * - A failed read (`GET`) goes to the login page with the current page as the return path,
 *   so the user comes back to the same page after signing in.
 *
 * A 401 can also carry `reason: AUTHORIZATION_CHANGED`: the session ended because the
 * person's roles or scopes changed. The flow is the same; only the wording differs.
 */
export function expiryAction(method: 'GET' | 'POST'): 'keep' | 'redirect' {
  return method === 'POST' ? 'keep' : 'redirect';
}

/** Why a session ended, as far as the web needs to tell the person. */
export type SessionEndReason = 'AUTHORIZATION_CHANGED' | null;

/** The only 401 reason the API sends today; anything else is a plain expiry. */
export function sessionEndReason(reason: string | null | undefined): SessionEndReason {
  return reason === 'AUTHORIZATION_CHANGED' ? 'AUTHORIZATION_CHANGED' : null;
}

/** Value of the login page's `reason` parameter for a permission change. */
export const PERMISSIONS_CHANGED_PARAM = 'permissions';

/** Login URL for an expired session that returns to `current` (path and query). */
export function expiredLoginPath(
  base: string,
  current: string,
  reason: SessionEndReason = null,
): string {
  const params = new URLSearchParams({ expired: '1', next: current });
  if (reason === 'AUTHORIZATION_CHANGED') params.set('reason', PERMISSIONS_CHANGED_PARAM);
  return `${base}/login?${params.toString()}`;
}

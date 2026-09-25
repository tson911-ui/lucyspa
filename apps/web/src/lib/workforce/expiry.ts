/**
 * What the workforce shell does when the API reports an expired session (401).
 *
 * - A failed command (`POST`) keeps the page: the form's entries stay in memory, nothing
 *   was saved (authentication is checked before any write), and the user can sign in again
 *   in a new tab and then resubmit. Nothing is written to web storage.
 * - A failed read (`GET`) goes to the login page with the current page as the return path,
 *   so the user comes back to the same page after signing in.
 */
export function expiryAction(method: 'GET' | 'POST'): 'keep' | 'redirect' {
  return method === 'POST' ? 'keep' : 'redirect';
}

/** Login URL for an expired session that returns to `current` (path and query). */
export function expiredLoginPath(base: string, current: string): string {
  const params = new URLSearchParams({ expired: '1', next: current });
  return `${base}/login?${params.toString()}`;
}

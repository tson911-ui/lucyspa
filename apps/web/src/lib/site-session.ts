/**
 * The header's account menu lives outside the member area's own session guard, so a sign-in or sign-out announces
 * itself on the window and the menu reads the session again (the same pattern as the notification count).
 */
export const SITE_SESSION_CHANGED = 'lucy-site-session-changed';

export function announceSessionChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(SITE_SESSION_CHANGED));
}

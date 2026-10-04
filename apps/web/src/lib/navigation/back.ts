// The "Back" button (Owner, 2026-10-04): every page except the staff dashboard and the public home has one. It returns to
// the page the person came from (the browser restores its filters, search and scroll position), and only when there is
// no such page (the page was opened directly or in a new tab) goes to the logical parent computed here. Pure logic.

/** In-app navigations seen by this tab since it loaded. Zero means nothing in this tab's own history belongs to the app. */
let navigations = 0;
let lastPath: string | null = null;

/** Called with the current pathname on every render of the root tracker; counts only real changes. */
export function trackRoute(pathname: string): void {
  if (lastPath !== null && lastPath !== pathname) navigations += 1;
  lastPath = pathname;
}

/** Test helper. */
export function resetRouteHistory(): void {
  navigations = 0;
  lastPath = null;
}

/** The page opened by clicking through the app (not a deep link): going back stays inside the app. */
export function hasAppHistory(referrer: string, origin: string): boolean {
  return navigations > 0 || (referrer !== '' && referrer.startsWith(`${origin}/`));
}

/** A subtree whose children have no page of their own: its entries return to one tab of the settings page. */
const TAB_PARENTS: Readonly<Record<string, string>> = {
  'website/seasons': 'website?tab=season',
  'website/popups': 'website?tab=popup',
};

/**
 * Where "Back" goes without history. `root` is the area's home (`/vi/workforce`, `/vi/account`):
 * the staff dashboard has no Back button (null), the member home returns to the public home.
 * A detail page returns to its list, a list to the area's home, a form or version page to its detail.
 */
export function parentPath(
  pathname: string,
  root: string,
  publicHome: string | null,
): string | null {
  const clean = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (clean === root) return publicHome;
  if (!clean.startsWith(`${root}/`)) return null;
  const rest = clean.slice(root.length + 1).split('/');
  for (const [prefix, target] of Object.entries(TAB_PARENTS)) {
    if (rest.join('/').startsWith(`${prefix}/`) || rest.join('/') === prefix) {
      return `${root}/${target}`;
    }
  }
  // A version form has no list of its own: it returns to the program it belongs to.
  const versions = rest.indexOf('versions');
  if (versions > 0) rest.length = versions + 1;
  rest.pop();
  return rest.length === 0 ? root : `${root}/${rest.join('/')}`;
}

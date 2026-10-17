// HIG C70: a link back to a list (a breadcrumb, the Back button without history) returns to the list as the person left it,
// with its filters, search, sort and page. The root tracker remembers the last full URL (path and query) of every path this tab
// has shown, in sessionStorage (per tab, gone with the tab); a back link whose target has no query of its own takes that URL.
// A link that already carries a query (the POS `?back=` list state) is used as given.

const KEY = 'ls:list-urls';
/** Enough for every list a person moves between in one sitting; the oldest path is dropped first. */
const LIMIT = 40;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function session(): Store | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    // Storage blocked (private mode, site data off): links stay plain.
    return null;
  }
}

function read(store: Store | null): Record<string, string> {
  if (!store) return {};
  try {
    const parsed: unknown = JSON.parse(store.getItem(KEY) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {};
  } catch {
    return {};
  }
}

/** Called with the current path and query on every route or query change. */
export function rememberListUrl(
  pathname: string,
  search: string,
  store: Store | null = session(),
): void {
  if (!store) return;
  const urls = read(store);
  delete urls[pathname];
  urls[pathname] = search ? `${pathname}?${search}` : pathname;
  const paths = Object.keys(urls);
  for (const old of paths.slice(0, Math.max(0, paths.length - LIMIT))) delete urls[old];
  try {
    store.setItem(KEY, JSON.stringify(urls));
  } catch {
    // Quota or blocked storage: nothing is remembered, links stay plain.
  }
}

/** The URL a back link to `href` should open: the list as it was left, or `href` itself. */
export function listUrl(href: string, store: Store | null = session()): string {
  if (href === '' || href.includes('?') || href.includes('#')) return href;
  const remembered = read(store)[href];
  return typeof remembered === 'string' && remembered.startsWith(`${href}?`) ? remembered : href;
}

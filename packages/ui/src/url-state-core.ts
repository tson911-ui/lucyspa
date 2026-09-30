// URL query state for lists (docs/UXUI_REDESIGN_DESIGN.md 10.2): `q`, filters, `page` and `pageSize`
// live in the query string so a filtered or paged view can be reloaded and shared. Pure functions,
// no DOM; `use-url-state.ts` connects them to the address bar.

export type UrlValue = string | number;
/** The state of one list: every key has a default whose type (string or number) fixes how it parses. */
export type UrlState = Record<string, UrlValue>;

/**
 * Reads `search` (with or without the leading "?") over `defaults`. Unknown parameters are ignored,
 * and a number that does not parse as a whole number falls back to its default.
 */
export function parseUrlState<T extends UrlState>(
  search: string,
  defaults: T,
  normalize?: (state: T) => T,
): T {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const state: UrlState = { ...defaults };
  for (const key of Object.keys(defaults)) {
    const raw = params.get(key);
    if (raw === null) continue;
    const fallback = defaults[key];
    if (typeof fallback === 'number') {
      state[key] = /^-?\d{1,9}$/.test(raw) ? Number(raw) : fallback;
    } else {
      state[key] = raw;
    }
  }
  return normalize ? normalize(state as T) : (state as T);
}

/**
 * The query string for `state`. Values equal to their default are left out so a fresh list has a
 * clean URL; parameters this list does not own (`base`) are kept as they were.
 */
export function serializeUrlState<T extends UrlState>(
  state: T,
  defaults: T,
  base: string = '',
): string {
  const params = new URLSearchParams(base.startsWith('?') ? base.slice(1) : base);
  for (const key of Object.keys(defaults)) {
    params.delete(key);
    const value = state[key];
    if (value !== undefined && value !== defaults[key]) params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

/**
 * Applies a change. Keys in `resetOnChange` (the page numbers) go back to their default whenever
 * any other key in the patch actually changes, unless the patch sets them itself: changing a
 * filter or the page size returns to page 1.
 */
export function applyUrlPatch<T extends UrlState>(
  state: T,
  patch: Partial<T>,
  defaults: T,
  resetOnChange: readonly string[] = [],
): T {
  const next: UrlState = { ...state };
  let othersChanged = false;
  for (const key of Object.keys(patch)) {
    const value = patch[key];
    if (value === undefined) continue;
    if (value !== state[key] && !resetOnChange.includes(key)) othersChanged = true;
    next[key] = value;
  }
  if (othersChanged) {
    for (const key of resetOnChange) if (!(key in patch)) next[key] = defaults[key] as UrlValue;
  }
  return next as T;
}

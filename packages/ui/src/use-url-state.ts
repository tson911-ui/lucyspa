'use client';

import { useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import { applyUrlPatch, parseUrlState, serializeUrlState, type UrlState } from './url-state-core';

// Address-bar state for lists. Framework-only: it reads `window.location` and writes through the
// History API (the Next.js App Router observes `pushState`/`replaceState`), so `packages/ui` needs
// no `next/*` import. On the server the state is the defaults, so the first paint is the unfiltered view.

const CHANGE_EVENT = 'ls:urlstate';

function subscribe(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

const clientSearch = () => window.location.search;
const serverSearch = () => '';

export interface UrlStateOptions<T extends UrlState> {
  /** Corrects parsed values, e.g. a page below 1 or a page size that is not offered. */
  normalize?: ((state: T) => T) | undefined;
  /** Keys (page numbers) that return to their default when any other key changes. */
  resetOnChange?: readonly string[] | undefined;
}

export interface UrlStateChange {
  /** Replace the history entry instead of adding one (typing in a search box). */
  replace?: boolean | undefined;
}

/**
 * List state kept in the query string: `[state, update]`. `update(patch)` writes only the keys in
 * the patch, drops values equal to their default and keeps unrelated parameters. Keep `defaults`
 * and `options` stable (module constants).
 */
export function useUrlState<T extends UrlState>(
  defaults: T,
  options: UrlStateOptions<T> = {},
): [T, (patch: Partial<T>, change?: UrlStateChange) => void] {
  const search = useSyncExternalStore(subscribe, clientSearch, serverSearch);
  const config = useRef({ defaults, options });
  config.current = { defaults, options };
  const state = useMemo(
    () => parseUrlState(search, config.current.defaults, config.current.options.normalize),
    [search],
  );
  const stateRef = useRef(state);
  stateRef.current = state;

  const update = useCallback((patch: Partial<T>, change: UrlStateChange = {}) => {
    const { defaults: base, options: current } = config.current;
    const next = applyUrlPatch(stateRef.current, patch, base, current.resetOnChange);
    const normalized = current.normalize ? current.normalize(next) : next;
    const query = serializeUrlState(normalized, base, window.location.search);
    const url = `${window.location.pathname}${query}${window.location.hash}`;
    if (query === window.location.search) return;
    if (change.replace) window.history.replaceState(window.history.state, '', url);
    else window.history.pushState(window.history.state, '', url);
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [state, update];
}

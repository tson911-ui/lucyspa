'use client';

import { useSyncExternalStore } from 'react';

/** Breakpoints of docs/UXUI_REDESIGN_DESIGN.md section 13. */
export const PHONE_QUERY = '(max-width: 639px)';

interface QueryStore {
  list: MediaQueryList;
  subscribe: (onChange: () => void) => () => void;
  snapshot: () => boolean;
}

// One MediaQueryList and one stable subscribe/snapshot pair per query (rbp client-event-listeners): a new `subscribe` each render
// made React unsubscribe and subscribe again on every render of every caller. Rebuilt if `window.matchMedia` itself is replaced
// (tests swap it).
const stores = new Map<string, QueryStore>();
let owner: typeof window.matchMedia | null = null;

function storeFor(query: string): QueryStore {
  if (owner !== window.matchMedia) {
    stores.clear();
    owner = window.matchMedia;
  }
  let store = stores.get(query);
  if (!store) {
    const list = window.matchMedia(query);
    store = {
      list,
      subscribe: (onChange) => {
        list.addEventListener('change', onChange);
        return () => list.removeEventListener('change', onChange);
      },
      snapshot: () => list.matches,
    };
    stores.set(query, store);
  }
  return store;
}

const serverSnapshot = () => false;
const noSubscription = () => () => undefined;

/**
 * Whether a media query matches. False on the server and during hydration, so the first paint is the
 * larger layout; the phone layout follows on the client.
 */
export function useMediaQuery(query: string): boolean {
  const store = typeof window === 'undefined' ? null : storeFor(query);
  return useSyncExternalStore(
    store ? store.subscribe : noSubscription,
    store ? store.snapshot : serverSnapshot,
    serverSnapshot,
  );
}

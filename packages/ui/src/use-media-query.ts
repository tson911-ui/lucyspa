'use client';

import { useSyncExternalStore } from 'react';

/** Breakpoints of docs/UXUI_REDESIGN_DESIGN.md section 13. */
export const PHONE_QUERY = '(max-width: 639px)';

/**
 * Whether a media query matches. False on the server and during hydration, so the first paint is the
 * larger layout; the phone layout follows on the client.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

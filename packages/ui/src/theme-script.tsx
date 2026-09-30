'use client';

import { useSyncExternalStore } from 'react';
import { themeInitScript } from './theme-core';

const subscribe = () => () => undefined;

/**
 * The pre-paint theme script (docs/UXUI_REDESIGN_DESIGN.md 6.1) for the root layout.
 *
 * It is in the server HTML and hydrates normally, so it runs before first paint. It is never
 * *created* on the client: React logs "Encountered a script tag while rendering React component"
 * whenever it creates a script element, and Next's dev overlay counts that as an issue. That happened
 * on every client navigation that re-renders the root layout (for example a language switch).
 * `useSyncExternalStore` returns the server snapshot (true) while hydrating and the client snapshot
 * (false) for every later render, so after hydration the already-executed script is simply dropped.
 */
export function ThemeInitScript() {
  const render = useSyncExternalStore(
    subscribe,
    () => false,
    () => true,
  );
  return render ? (
    <script suppressHydrationWarning dangerouslySetInnerHTML={{ __html: themeInitScript }} />
  ) : null;
}

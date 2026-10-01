'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  parseThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  type ResolvedTheme,
  type ThemePreference,
} from './theme-core';

const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  // The pre-paint script flips `data-theme` at the 06:00 / 18:00 boundary; follow it live.
  const observer = new MutationObserver(listener);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    listeners.delete(listener);
    observer.disconnect();
  };
}

const readPreference = () => parseThemeCookie(document.cookie);
const readResolved = (): ResolvedTheme =>
  document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';

export interface ThemeState {
  /** What the user chose; "auto" (by local time) until they pick Light or Dark. */
  preference: ThemePreference;
  /** What is actually shown. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

/** Client hook behind the theme toggle. The server render assumes "auto" and light. */
export function useTheme(): ThemeState {
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'auto' as const);
  const resolved = useSyncExternalStore(subscribe, readResolved, () => 'light' as const);

  const setPreference = useCallback((next: ThemePreference) => {
    document.cookie = serializeThemeCookie(next);
    document.documentElement.setAttribute('data-theme', resolveTheme(next, new Date()));
    listeners.forEach((listener) => listener());
  }, []);

  return { preference, resolved, setPreference };
}

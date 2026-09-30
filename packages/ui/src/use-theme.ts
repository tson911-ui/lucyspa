'use client';

import { useCallback, useSyncExternalStore } from 'react';
import {
  parseThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  type ResolvedTheme,
  type ThemePreference,
} from './theme-core';

const DARK_QUERY = '(prefers-color-scheme: dark)';
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  const media = window.matchMedia(DARK_QUERY);
  media.addEventListener('change', listener);
  return () => {
    listeners.delete(listener);
    media.removeEventListener('change', listener);
  };
}

const readPreference = () => parseThemeCookie(document.cookie);
const readSystemDark = () => window.matchMedia(DARK_QUERY).matches;

export interface ThemeState {
  /** What the user chose; "system" until they toggle. */
  preference: ThemePreference;
  /** What is actually shown. */
  resolved: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

/** Client hook behind the theme toggle. The server render assumes "system" and light. */
export function useTheme(): ThemeState {
  const preference = useSyncExternalStore(subscribe, readPreference, () => 'system' as const);
  const systemDark = useSyncExternalStore(subscribe, readSystemDark, () => false);

  const setPreference = useCallback((next: ThemePreference) => {
    document.cookie = serializeThemeCookie(next);
    if (next === 'system') document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', next);
    listeners.forEach((listener) => listener());
  }, []);

  return { preference, resolved: resolveTheme(preference, systemDark), setPreference };
}

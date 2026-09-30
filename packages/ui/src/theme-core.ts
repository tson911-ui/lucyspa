// Theme contract (docs/UXUI_REDESIGN_DESIGN.md 6.1). Pure and server-safe: the root layout inlines
// `themeInitScript` so the attribute is set before first paint, from the `ls-theme` cookie.
export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'ls-theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Reads the preference from a `document.cookie` string. Anything unknown means "system". */
export function parseThemeCookie(cookie: string): ThemePreference {
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)`).exec(cookie);
  return match?.[1] === 'light' || match?.[1] === 'dark' ? match[1] : 'system';
}

/** Cookie for the toggle: 1 year, SameSite=Lax, readable by script, no personal data. "system" clears it. */
export function serializeThemeCookie(preference: ThemePreference): string {
  const attributes = 'Path=/; SameSite=Lax';
  return preference === 'system'
    ? `${THEME_COOKIE}=; Max-Age=0; ${attributes}`
    : `${THEME_COOKIE}=${preference}; Max-Age=${THEME_COOKIE_MAX_AGE}; ${attributes}`;
}

export function resolveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (preference === 'system') return systemPrefersDark ? 'dark' : 'light';
  return preference;
}

/** Runs before paint. With no cookie the attribute stays absent and CSS follows the system. */
export const themeInitScript = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)/);if(m)document.documentElement.setAttribute('data-theme',m[1]);}catch(e){}})();`;

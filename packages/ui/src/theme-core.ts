// Theme contract (docs/UXUI_REDESIGN_DESIGN.md 6.1). Pure and server-safe: the root layout inlines
// `themeInitScript` so the attribute is set before first paint, from the `ls-theme` cookie or, with no
// cookie ("auto"), from the viewer's local time.
export type ThemePreference = 'auto' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_COOKIE = 'ls-theme';
export const THEME_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Auto mode: light from 06:00 to 17:59, dark from 18:00 to 05:59 (local device time). */
export const AUTO_LIGHT_FROM_HOUR = 6;
export const AUTO_DARK_FROM_HOUR = 18;

/** Reads the preference from a `document.cookie` string. Anything unknown means "auto". */
export function parseThemeCookie(cookie: string): ThemePreference {
  const match = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)`).exec(cookie);
  return match?.[1] === 'light' || match?.[1] === 'dark' ? match[1] : 'auto';
}

/** Cookie for the toggle: 1 year, SameSite=Lax, readable by script, no personal data. "auto" clears it. */
export function serializeThemeCookie(preference: ThemePreference): string {
  const attributes = 'Path=/; SameSite=Lax';
  return preference === 'auto'
    ? `${THEME_COOKIE}=; Max-Age=0; ${attributes}`
    : `${THEME_COOKIE}=${preference}; Max-Age=${THEME_COOKIE_MAX_AGE}; ${attributes}`;
}

/** The theme auto mode shows at a local hour (0-23). */
export function themeForHour(hour: number): ResolvedTheme {
  return hour >= AUTO_LIGHT_FROM_HOUR && hour < AUTO_DARK_FROM_HOUR ? 'light' : 'dark';
}

export function resolveTheme(preference: ThemePreference, now: Date): ResolvedTheme {
  return preference === 'auto' ? themeForHour(now.getHours()) : preference;
}

/**
 * Applies the theme to `<html>` now and keeps it right: re-evaluates at the next 06:00 / 18:00 boundary
 * and when the tab becomes visible again. Returns a cleanup. This is the client twin of `themeInitScript`:
 * the root layout is keyed by the locale, so a locale switch remounts `<html>`, React clears the attributes
 * the script set (`data-theme`), and the script is never created again after hydration. The component
 * that renders the script therefore runs this on every mount.
 */
export function startThemeSync(doc: Document, clock: () => Date = () => new Date()): () => void {
  const root = doc.documentElement;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const apply = () =>
    root.setAttribute('data-theme', resolveTheme(parseThemeCookie(doc.cookie), clock()));
  const schedule = () => {
    apply();
    const now = clock();
    const nextHour =
      themeForHour(now.getHours()) === 'light' ? AUTO_DARK_FROM_HOUR : AUTO_LIGHT_FROM_HOUR;
    const boundary = new Date(now.getFullYear(), now.getMonth(), now.getDate(), nextHour, 0, 0, 0);
    if (boundary.getTime() <= now.getTime()) boundary.setDate(boundary.getDate() + 1);
    timer = setTimeout(schedule, boundary.getTime() - now.getTime() + 500);
  };
  schedule();
  doc.addEventListener('visibilitychange', apply);
  return () => {
    clearTimeout(timer);
    doc.removeEventListener('visibilitychange', apply);
  };
}

/**
 * Runs before paint and keeps running: sets `data-theme` from the cookie, or from the local hour with
 * no cookie, then re-evaluates at the next 06:00 / 18:00 boundary and when the tab becomes visible
 * again (a sleeping device can miss the timer). No `<` character: the script sits in the HTML.
 */
const DAY = `h>=${AUTO_LIGHT_FROM_HOUR}&&!(h>=${AUTO_DARK_FROM_HOUR})`;
export const themeInitScript = `(function(){try{var d=document,r=d.documentElement,c=/(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)/;function a(){try{var m=c.exec(d.cookie),h=new Date().getHours();r.setAttribute('data-theme',m?m[1]:${DAY}?'light':'dark');}catch(e){}}function s(){a();var n=new Date(),h=n.getHours(),t=new Date(n.getFullYear(),n.getMonth(),n.getDate(),${DAY}?${AUTO_DARK_FROM_HOUR}:${AUTO_LIGHT_FROM_HOUR},0,0,0);if(!(t.getTime()-n.getTime()>0))t.setDate(t.getDate()+1);setTimeout(s,t.getTime()-n.getTime()+500);}s();d.addEventListener('visibilitychange',a);}catch(e){}})();`;

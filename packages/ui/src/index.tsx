// Single wordmark used by every shell and auth page. Same look in light and dark (color is inherited
// from the surrounding link, which uses the brand token). Replace the body with the logo image when
// the Owner supplies it; callers stay unchanged.
export function BrandWordmark() {
  return (
    <span
      style={{
        fontFamily: 'var(--ls-font-sans)',
        fontSize: '1.25rem',
        fontWeight: 600,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      Lucy Spa
    </span>
  );
}

export { Icon, iconNames } from './icons';
export type { IconName, IconProps } from './icons';
export {
  THEME_COOKIE,
  THEME_COOKIE_MAX_AGE,
  parseThemeCookie,
  resolveTheme,
  serializeThemeCookie,
  themeInitScript,
} from './theme-core';
export type { ResolvedTheme, ThemePreference } from './theme-core';
export { useTheme } from './use-theme';
export type { ThemeState } from './use-theme';

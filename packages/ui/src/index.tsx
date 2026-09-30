// Temporary text wordmark; final brand assets can replace this component.
export function BrandWordmark() {
  return (
    <span
      style={{
        fontFamily: 'var(--lucy-font-display)',
        fontSize: '1.75rem',
        letterSpacing: '-0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      Lucy <span style={{ fontStyle: 'italic' }}>Spa</span>
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

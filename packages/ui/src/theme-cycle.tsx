'use client';

import { cx } from './cx';
import { Icon, type IconName } from './icons';
import { fillTemplate } from './paging-core';
import type { ThemePreference } from './theme-core';
import type { ThemeToggleLabels } from './theme-toggle';
import { useTheme } from './use-theme';

export interface ThemeCycleLabels extends ThemeToggleLabels {
  /** With {name}: "Chuyển sang {name}". */
  switchTo: string;
}

/** Light, then Dark, then Auto (by time of day), then Light again: the same three states as the staff area's toggle. */
const NEXT: Record<ThemePreference, ThemePreference> = {
  light: 'dark',
  dark: 'auto',
  auto: 'light',
};
const ICON: Record<ThemePreference, IconName> = { light: 'sun', dark: 'moon', auto: 'clock' };

/**
 * A single round button for the public header (three segments do not fit a 360 px phone) that cycles the three theme
 * states of the staff area: Light (sun), Dark (moon), Auto (clock; light 06:00-17:59, dark 18:00-05:59, the rule
 * `resolveTheme` applies). The icon shows the state chosen, not the colours in use, so Auto is recognisable. Same stored
 * choice as `ThemeToggle` (the `ls-theme` cookie). The name states the current choice and the one a press switches to.
 */
export function ThemeCycle({
  labels,
  className,
}: {
  labels: ThemeCycleLabels;
  className?: string | undefined;
}) {
  const { preference, setPreference } = useTheme();
  const next = NEXT[preference];
  return (
    <button
      type="button"
      className={cx('ls-theme-cycle', className)}
      data-preference={preference}
      aria-label={`${labels.group}: ${labels[preference]}. ${fillTemplate(labels.switchTo, { name: labels[next] })}`}
      title={`${labels.group}: ${labels[preference]}`}
      onClick={() => setPreference(next)}
    >
      <Icon name={ICON[preference]} />
    </button>
  );
}

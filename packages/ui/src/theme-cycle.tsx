'use client';

import { cx } from './cx';
import { Icon } from './icons';
import { fillTemplate } from './paging-core';
import type { ThemeToggleLabels } from './theme-toggle';
import { useTheme } from './use-theme';

export interface ThemeCycleLabels extends ThemeToggleLabels {
  /** With {name}: "Chuyển sang {name}". */
  switchTo: string;
}

/**
 * A single round button for the public header (three segments do not fit a 360 px phone): it shows the theme in use
 * (sun in light, moon in dark) and switches to the other one. Until the visitor presses it the page follows the time
 * of day (the stored choice is "auto"), so there is no separate clock state to cycle through; the staff area keeps the
 * three-way toggle. Same stored choice as `ThemeToggle` (the `ls-theme` cookie). The name states the theme and the switch.
 */
export function ThemeCycle({
  labels,
  className,
}: {
  labels: ThemeCycleLabels;
  className?: string | undefined;
}) {
  const { resolved, setPreference } = useTheme();
  const names = { light: labels.light, dark: labels.dark };
  const next = resolved === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className={cx('ls-theme-cycle', className)}
      aria-label={`${labels.group}: ${names[resolved]}. ${fillTemplate(labels.switchTo, { name: names[next] })}`}
      title={`${labels.group}: ${names[resolved]}`}
      onClick={() => setPreference(next)}
    >
      <Icon name={resolved === 'dark' ? 'moon' : 'sun'} />
    </button>
  );
}

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

const ORDER: readonly ThemePreference[] = ['light', 'dark', 'auto'];
const ICON: Record<ThemePreference, IconName> = { light: 'sun', dark: 'moon', auto: 'clock' };

/**
 * A single round button that cycles Light, Dark, Auto by time (the public header, where three segments do not fit
 * a 360 px phone). Same stored choice as `ThemeToggle` (the `ls-theme` cookie). The name states the current choice.
 */
export function ThemeCycle({
  labels,
  className,
}: {
  labels: ThemeCycleLabels;
  className?: string | undefined;
}) {
  const { preference, setPreference } = useTheme();
  const next = ORDER[(ORDER.indexOf(preference) + 1) % ORDER.length] ?? 'light';
  const names: Record<ThemePreference, string> = {
    light: labels.light,
    dark: labels.dark,
    auto: labels.auto,
  };
  return (
    <button
      type="button"
      className={cx('ls-theme-cycle', className)}
      aria-label={`${labels.group}: ${names[preference]}. ${fillTemplate(labels.switchTo, { name: names[next] })}`}
      title={`${labels.group}: ${names[preference]}`}
      onClick={() => setPreference(next)}
    >
      <Icon name={ICON[preference]} />
    </button>
  );
}

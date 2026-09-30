'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import type { ThemePreference } from './theme-core';
import { useTheme } from './use-theme';

export interface ThemeToggleLabels {
  /** Name of the group, for example "Giao diện" / "Appearance". */
  group: string;
  light: string;
  dark: string;
  system: string;
}

const OPTIONS: ReadonlyArray<{ value: ThemePreference; icon: IconName }> = [
  { value: 'light', icon: 'sun' },
  { value: 'dark', icon: 'moon' },
  { value: 'system', icon: 'monitor' },
];

/**
 * Light / Dark / System as a radio group (contract 4.1): one tab stop, arrow keys move and select.
 * The choice is stored by `useTheme` in the `ls-theme` cookie, so the next page loads in it.
 */
export function ThemeToggle({
  labels,
  withLabels = false,
  className,
}: {
  labels: ThemeToggleLabels;
  /** Show the text next to each icon (used inside the user menu). */
  withLabels?: boolean | undefined;
  className?: string | undefined;
}) {
  const { preference, setPreference } = useTheme();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (step === 0) return;
    event.preventDefault();
    const next = (index + step + OPTIONS.length) % OPTIONS.length;
    setPreference(OPTIONS[next]!.value);
    refs.current[next]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={labels.group}
      className={cx('ls-theme-toggle', withLabels && 'ls-theme-toggle-labeled', className)}
    >
      {OPTIONS.map((option, index) => {
        const checked = preference === option.value;
        const text = labels[option.value];
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={withLabels ? undefined : text}
            title={withLabels ? undefined : text}
            tabIndex={checked ? 0 : -1}
            className={cx('ls-theme-option', checked && 'ls-theme-option-active')}
            onClick={() => setPreference(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            <Icon name={option.icon} size={18} />
            {withLabels ? <span>{text}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

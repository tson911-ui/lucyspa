'use client';

import { useRef, type KeyboardEvent } from 'react';
import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

/** Key that moves the selection: arrows step (wrapping), Home and End jump. `null` for other keys. */
export function segmentedTarget(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  if (key === 'ArrowRight' || key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

/**
 * Two or more mutually exclusive choices shown as one joined control (for example "Employee ID |
 * Email"). A radio group: one tab stop, arrows move and select, Home/End jump. Options share the
 * width equally and their labels wrap, so the longest Vietnamese label still fits.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  className,
}: {
  /** Accessible name of the group; not drawn. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string | undefined;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = segmentedTarget(event.key, index, options.length);
    if (target === null) return;
    event.preventDefault();
    onChange(options[target]!.value);
    refs.current[target]?.focus();
  }

  return (
    <div role="radiogroup" aria-label={label} className={cx('ls-segmented', className)}>
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={cx('ls-segment', checked && 'ls-segment-active')}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

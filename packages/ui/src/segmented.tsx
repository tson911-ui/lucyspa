'use client';

import { useId, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { cx } from './cx';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  /** The option cannot be chosen now: it is skipped by the arrows, takes no click and shows no hover or pressed state (HIG C47). */
  disabled?: boolean | undefined;
  /** Why it cannot be chosen; the option's accessible description (visually hidden, the label stays the only visible text). */
  disabledReason?: string | undefined;
}

/**
 * Key that moves the selection: arrows step (wrapping), Home and End jump, always to an option that is not disabled (`isDisabled`).
 * `null` for other keys, or when no option can be chosen.
 */
export function segmentedTarget(
  key: string,
  index: number,
  count: number,
  isDisabled: (index: number) => boolean = () => false,
): number | null {
  if (count === 0) return null;
  // The first option that is not disabled, walking from `from` in `step` direction (wrapping, `from` itself last).
  const walk = (from: number, step: 1 | -1): number | null => {
    for (let distance = 1; distance <= count; distance += 1) {
      const candidate = (((from + step * distance) % count) + count) % count;
      if (!isDisabled(candidate)) return candidate;
    }
    return null;
  };
  if (key === 'ArrowRight' || key === 'ArrowDown') return walk(index, 1);
  if (key === 'ArrowLeft' || key === 'ArrowUp') return walk(index, -1);
  if (key === 'Home') return walk(-1, 1);
  if (key === 'End') return walk(count, -1);
  return null;
}

/**
 * Two or more mutually exclusive choices shown as one joined control (for example "Employee ID |
 * Email"). A radio group: one tab stop, arrows move and select, Home/End jump. Options share the
 * width equally and their labels wrap, so the longest Vietnamese label still fits. `disabled`
 * blocks the whole group (a save in progress); an option's own `disabled` blocks only that one.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className,
}: {
  /** Accessible name of the group; not drawn. */
  label: string;
  options: readonly SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Every option is unavailable (for example while the screen saves). */
  disabled?: boolean | undefined;
  className?: string | undefined;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const reasonId = useId();
  const selected = options.findIndex((option) => option.value === value);
  const isDisabled = (index: number) => disabled || Boolean(options[index]?.disabled);
  // The one tab stop: the chosen option, or the first one that can be chosen.
  const tabStop =
    selected >= 0 && !isDisabled(selected) ? selected : options.findIndex((_, i) => !isDisabled(i));

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const target = segmentedTarget(event.key, index, options.length, isDisabled);
    if (target === null) return;
    event.preventDefault();
    onChange(options[target]!.value);
    refs.current[target]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-disabled={disabled || undefined}
      className={cx('ls-segmented', className)}
      style={
        {
          '--seg-count': options.length,
          '--seg-index': Math.max(0, selected),
        } as CSSProperties
      }
    >
      {/* With nothing chosen yet (a rating not given) no thumb is drawn, so no option looks pre-selected. */}
      <span
        className={cx('ls-segmented-thumb', selected < 0 && 'ls-segmented-thumb-none')}
        aria-hidden
      />
      {options.map((option, index) => {
        const checked = option.value === value;
        const blocked = isDisabled(index);
        const reason = blocked && option.disabledReason ? option.disabledReason : null;
        return (
          <button
            key={option.value}
            ref={(element) => {
              refs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-describedby={reason ? `${reasonId}-${index}` : undefined}
            tabIndex={index === tabStop ? 0 : -1}
            disabled={blocked || undefined}
            className={cx('ls-segment', checked && 'ls-segment-active')}
            onClick={() => {
              if (!blocked) onChange(option.value);
            }}
            onKeyDown={(event) => onKeyDown(event, index)}
          >
            {option.label}
          </button>
        );
      })}
      {/* The reasons sit outside the buttons, so they describe an option without joining its name. */}
      {options.map((option, index) =>
        isDisabled(index) && option.disabledReason ? (
          <span key={option.value} id={`${reasonId}-${index}`} className="ls-visually-hidden">
            {option.disabledReason}
          </span>
        ) : null,
      )}
    </div>
  );
}

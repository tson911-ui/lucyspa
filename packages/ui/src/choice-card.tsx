import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';

/**
 * A selectable card row (Part 2 contract 5.5): a service in the booking list, a time slot, a person. A real
 * `input` (checkbox or radio) lives inside a `label`, visually hidden but focusable, so keyboard, screen reader
 * and form behaviour are the platform's; the card draws the state (brand border and soft fill, a tick). Text
 * wraps (no fixed widths); the row is at least the 44 px target.
 */
export function ChoiceCard({
  type = 'checkbox',
  name,
  value,
  checked,
  onChange,
  disabled,
  title,
  meta,
  price,
  extra,
  describedBy,
}: {
  type?: 'checkbox' | 'radio' | undefined;
  name?: string | undefined;
  value?: string | undefined;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean | undefined;
  title: ReactNode;
  /** A secondary line (duration, description). */
  meta?: ReactNode | undefined;
  /** The trailing value (already formatted). */
  price?: ReactNode | undefined;
  /** Content shown below the row while selected or always (a note); not part of the label text of the control. */
  extra?: ReactNode | undefined;
  describedBy?: string | undefined;
}) {
  return (
    <label
      className={cx('ls-choice', disabled && 'ls-choice-disabled')}
      data-checked={checked || undefined}
    >
      <input
        className="ls-choice-input"
        type={type}
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={cx('ls-choice-tick', type === 'radio' && 'ls-choice-tick-round')}
        aria-hidden="true"
      >
        <Icon name="check" size={16} />
      </span>
      <span className="ls-choice-body">
        <span className="ls-choice-title">{title}</span>
        {meta ? <span className="ls-choice-meta">{meta}</span> : null}
      </span>
      {price ? <span className="ls-choice-price">{price}</span> : null}
      {extra ? <span className="ls-choice-extra">{extra}</span> : null}
    </label>
  );
}

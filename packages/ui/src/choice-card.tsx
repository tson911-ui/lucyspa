import { useId, type ReactNode } from 'react';
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
  /**
   * A note shown in the card (text only, never a link or button: it sits inside the label). It is the control's description, not
   * part of its name: the name is the title, meta and price (`aria-labelledby`), so a screen reader reads the note after them.
   */
  extra?: ReactNode | undefined;
  describedBy?: string | undefined;
}) {
  const id = useId();
  const ids = {
    title: `${id}-title`,
    meta: `${id}-meta`,
    price: `${id}-price`,
    extra: `${id}-extra`,
  };
  const labelledBy = [ids.title, meta ? ids.meta : null, price ? ids.price : null]
    .filter(Boolean)
    .join(' ');
  const description =
    [describedBy, extra ? ids.extra : null].filter(Boolean).join(' ') || undefined;
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
        aria-labelledby={labelledBy}
        aria-describedby={description}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        className={cx('ls-choice-tick', type === 'radio' && 'ls-choice-tick-round')}
        aria-hidden="true"
      >
        <Icon name="check" size={16} />
      </span>
      <span className="ls-choice-body">
        <span className="ls-choice-title" id={ids.title}>
          {title}
        </span>
        {meta ? (
          <span className="ls-choice-meta" id={ids.meta}>
            {meta}
          </span>
        ) : null}
      </span>
      {price ? (
        <span className="ls-choice-price" id={ids.price}>
          {price}
        </span>
      ) : null}
      {extra ? (
        <span className="ls-choice-extra" id={ids.extra}>
          {extra}
        </span>
      ) : null}
    </label>
  );
}

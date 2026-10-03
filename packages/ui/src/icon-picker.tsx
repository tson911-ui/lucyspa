import { useId } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

export interface IconPickerOption {
  value: string;
  /** The icon's name for assistive technology and the hover title, in the page language. */
  label: string;
  icon: IconName;
}

/**
 * Picks one icon of a small built-in set (the facts strip and the "why choose us" cards). A radio group of icon
 * buttons: native radios underneath, so the arrow keys and the form behave as the browser's own. The icons are drawn in
 * `currentColor` from the theme tokens, so the picker (and what it picks) follows light and dark mode.
 */
export function IconPicker({
  label,
  value,
  options,
  onChange,
  className,
}: {
  /** The group's visible label and accessible name, for example "Icon". */
  label: string;
  value: string;
  options: readonly IconPickerOption[];
  onChange: (value: string) => void;
  className?: string | undefined;
}) {
  const name = useId();
  const labelId = `${name}-label`;
  return (
    <div className={cx('ls-field', className)}>
      <span className="ls-label" id={labelId}>
        {label}
      </span>
      <div role="radiogroup" aria-labelledby={labelId} className="ls-icon-picker">
        {options.map((option) => (
          <label key={option.value} className="ls-icon-pick" title={option.label}>
            <input
              type="radio"
              name={name}
              className="ls-icon-pick-input"
              value={option.value}
              checked={option.value === value}
              aria-label={option.label}
              onChange={() => onChange(option.value)}
            />
            <Icon name={option.icon} />
          </label>
        ))}
      </div>
    </div>
  );
}

'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from './button';
import { cx } from './cx';
import { Popover } from './popover';

export interface FacetOption {
  value: string;
  label: string;
  /** How many results the option would give; shown at the end of the row. */
  count?: number | undefined;
}

/**
 * A toolbar filter button that opens a panel of options (checkboxes, or radios when `multiple` is
 * off). The button is its own label ("Status"); chosen values show next to it, so the toolbar needs
 * no label above any control. `selected` and `onChange` use option values; with `multiple` off the
 * array holds at most one value. "Clear" appears only while something is chosen.
 */
export function FacetedFilter({
  label,
  options,
  selected,
  onChange,
  multiple = false,
  clearLabel,
  countLabel,
  className,
}: {
  /** Button text and accessible name of the panel, e.g. "Status". */
  label: string;
  options: readonly FacetOption[];
  selected: readonly string[];
  onChange: (selected: string[]) => void;
  multiple?: boolean | undefined;
  clearLabel: string;
  /** With several chosen, the button shows how many, e.g. "{count} selected". Omitted: the number only. */
  countLabel?: ((count: number) => string) | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const group = useId();
  const chosen = options.filter((option) => selected.includes(option.value));
  const summary =
    chosen.length === 0
      ? null
      : chosen.length === 1
        ? chosen[0]!.label
        : (countLabel?.(chosen.length) ?? String(chosen.length));

  useEffect(() => {
    if (!open) return;
    const handle = requestAnimationFrame(() =>
      panelRef.current?.querySelector<HTMLElement>('input:checked, input, button')?.focus(),
    );
    return () => cancelAnimationFrame(handle);
  }, [open]);

  function toggle(value: string) {
    if (!multiple) {
      onChange(selected.includes(value) ? [] : [value]);
      setOpen(false);
      buttonRef.current?.focus();
      return;
    }
    onChange(
      selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value],
    );
  }

  return (
    <span className={cx('ls-facet', className)}>
      <Button
        ref={buttonRef}
        variant="secondary"
        icon="filter"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {label}
        {summary ? (
          <span className="ls-facet-summary" title={summary}>
            {summary}
          </span>
        ) : null}
      </Button>
      <Popover
        open={open}
        onClose={() => setOpen(false)}
        anchorRef={buttonRef}
        align="start"
        role="dialog"
        label={label}
        className="ls-facet-panel"
        ref={panelRef}
      >
        <div
          className="ls-facet-options"
          role={multiple ? 'group' : 'radiogroup'}
          aria-label={label}
        >
          {options.map((option) => (
            <label key={option.value} className="ls-check ls-facet-option">
              <input
                type={multiple ? 'checkbox' : 'radio'}
                name={group}
                checked={selected.includes(option.value)}
                onChange={() => toggle(option.value)}
              />
              <span className="ls-check-text">{option.label}</span>
              {option.count !== undefined ? (
                <span className="ls-facet-count">{option.count}</span>
              ) : null}
            </label>
          ))}
        </div>
        {selected.length > 0 ? (
          <div className="ls-facet-footer">
            <Button
              variant="ghost"
              onClick={() => {
                onChange([]);
                setOpen(false);
                buttonRef.current?.focus();
              }}
            >
              {clearLabel}
            </Button>
          </div>
        ) : null}
      </Popover>
    </span>
  );
}

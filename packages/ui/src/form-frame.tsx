'use client';

import { useId, useState, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { cx } from './cx';
import { describedBy } from './form-core';
import { Icon } from './icons';

// Form frame (docs/UXUI_REDESIGN_DESIGN.md 21.4 FR9): the grid fields sit in, the row-wide choice
// control and the one disclosure pattern. Gaps come from the container, never from a child margin.

/** Fields in one column (two from 640 px with `cols={2}`); a `Field full` spans both. */
export function FormGrid({
  cols = 1,
  className,
  children,
}: {
  cols?: 1 | 2 | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className={cx('ls-form-grid', cols === 2 && 'ls-form-grid-2', className)}>{children}</div>
  );
}

/**
 * Checkbox or radio with its label as one row-wide target (40 px desktop, 44 px touch). Use it for
 * pickers and permission lists; a radio set still needs `RadioGroup` for grouping and arrow keys.
 */
export function CheckField({
  type = 'checkbox',
  label,
  hint,
  invalid,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & {
  type?: 'checkbox' | 'radio' | undefined;
  /** Text, or text with a badge or a code; hide it with `VisuallyHidden` for a bare cell checkbox. */
  label: ReactNode;
  hint?: string | undefined;
  invalid?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLInputElement> | undefined;
}) {
  const hintId = useId();
  return (
    <label className={cx('ls-check', 'ls-check-field', className)}>
      <input
        {...rest}
        type={type}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy(rest['aria-describedby'], hint && hintId)}
      />
      <span className="ls-check-text">
        {label}
        {hint ? (
          <span className="ls-hint" id={hintId}>
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

/**
 * Optional or advanced content behind one button; replaces a bare `<details>`. The chevron turns
 * with the motion tokens. Never a create form: those open in `FormDialog` or `FormDrawer`.
 */
export function Disclosure({
  title,
  defaultOpen = false,
  className,
  children,
}: {
  title: string;
  defaultOpen?: boolean | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return (
    <div className={cx('ls-disclosure', open && 'ls-disclosure-open', className)}>
      <button
        type="button"
        className="ls-disclosure-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name="chevron-down" className="ls-disclosure-chevron" />
        <span className="ls-disclosure-title">{title}</span>
      </button>
      <div id={panelId} className="ls-disclosure-panel" hidden={!open}>
        {children}
      </div>
    </div>
  );
}

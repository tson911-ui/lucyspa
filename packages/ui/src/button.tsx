'use client';

import {
  useId,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type MouseEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { buttonClass, type ButtonSize, type ButtonVariant } from './button-class';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import { Spinner } from './spinner';
import { Tooltip } from './tooltip';

// Action components (docs/UXUI_REDESIGN_DESIGN.md 9.1). No fixed widths: labels wrap, so the longest
// Vietnamese label still fits (contract section 5).

interface CommonProps {
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  /** Leading icon. */
  icon?: IconName | undefined;
  className?: string | undefined;
}

export type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
    /** Disables the button, shows a spinner and sets `aria-busy`. The label stays. */
    loading?: boolean | undefined;
    /** Why the button is unavailable. Shown as visible text and linked with `aria-describedby`. */
    disabledReason?: string | undefined;
    fullWidth?: boolean | undefined;
    ref?: Ref<HTMLButtonElement> | undefined;
  };

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  loading = false,
  disabled,
  disabledReason,
  fullWidth,
  className,
  type = 'button',
  onClick,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const reasonId = useId();
  // A state-blocked action stays focusable (aria-disabled) so keyboard users can read the reason.
  const blocked = Boolean(disabled && disabledReason);
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={buttonClass(variant, size, cx(fullWidth && 'ls-btn-block', className))}
      disabled={loading || (disabled && !blocked) || undefined}
      aria-disabled={blocked ? true : rest['aria-disabled']}
      aria-busy={loading || undefined}
      aria-describedby={cx(rest['aria-describedby'], blocked && reasonId) || undefined}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (blocked || loading) {
          event.preventDefault();
          return;
        }
        onClick?.(event);
      }}
    >
      {loading ? <Spinner /> : icon ? <Icon name={icon} /> : null}
      {children ? <span className="ls-btn-label">{children}</span> : null}
    </button>
  );
  if (!blocked) return button;
  return (
    <span className="ls-btn-with-reason">
      {button}
      <span className="ls-btn-reason" id={reasonId}>
        {disabledReason}
      </span>
    </span>
  );
}

export type IconButtonProps = Omit<ButtonProps, 'children' | 'icon' | 'fullWidth'> & {
  icon: IconName;
  /** Accessible name and tooltip text. Required: an icon alone is not a label. */
  label: string;
};

/** Icon-only button with a 44 px hit area, `aria-label` and a tooltip. */
export function IconButton({
  icon,
  label,
  variant = 'ghost',
  size = 'md',
  className,
  ...rest
}: IconButtonProps) {
  return (
    <Tooltip content={label} describes={false}>
      <Button
        {...rest}
        variant={variant}
        size={size}
        className={cx('ls-btn-icon', className)}
        aria-label={label}
      >
        <Icon name={icon} />
      </Button>
    </Tooltip>
  );
}

export type ButtonLinkProps = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & {
    href: string;
    ref?: Ref<HTMLAnchorElement> | undefined;
  };

/** An anchor styled as a button, for navigation actions. */
export function ButtonLink({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ref,
  ...rest
}: ButtonLinkProps) {
  return (
    <a {...rest} ref={ref} className={buttonClass(variant, size, className)}>
      {icon ? <Icon name={icon} /> : null}
      <span className="ls-btn-label">{children}</span>
    </a>
  );
}

/** Visually hidden text that stays available to assistive technology. */
export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="ls-visually-hidden">{children}</span>;
}

'use client';

import { useId, type ButtonHTMLAttributes, type MouseEvent, type Ref } from 'react';
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
  /** The compact density (DESIGN.md 8.1): 14 px label, 8 x 16 padding, 40 px high on a fine pointer. Inside `data-density='compact'` it is automatic. */
  compact?: boolean | undefined;
}

export type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & {
    /**
     * Disables the button, shows a spinner and sets `aria-busy`. A plain-text label gains "…" while pending (HIG C38), unless the
     * caller already swapped it for a busy label ending in "…" ("Đang lưu…").
     */
    loading?: boolean | undefined;
    /** Why the button is unavailable. Shown as visible text and linked with `aria-describedby`. */
    disabledReason?: string | undefined;
    /**
     * `false` when the screen already shows the reason (a notice beside a header action): it then stays only the button's
     * accessible description (visually hidden), never a second visible copy. Default `true`.
     */
    reasonVisible?: boolean | undefined;
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
  reasonVisible = true,
  fullWidth,
  compact,
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
  const label = loading ? pendingLabel(children) : children;
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={buttonClass(variant, size, cx(fullWidth && 'ls-btn-block', className), compact)}
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
      {label ? <span className="ls-btn-label">{label}</span> : null}
    </button>
  );
  if (!blocked) return button;
  return (
    <span className="ls-btn-with-reason">
      {button}
      <span className={reasonVisible ? 'ls-btn-reason' : 'ls-visually-hidden'} id={reasonId}>
        {disabledReason}
      </span>
    </span>
  );
}

/** HIG C38: a pending text label ends with "…" ("Lưu" -> "Lưu…"); a label that already ends with one is kept. */
function pendingLabel(children: ButtonProps['children']): ButtonProps['children'] {
  if (typeof children !== 'string') return children;
  const text = children.trimEnd();
  return text === '' || text.endsWith('…') || text.endsWith('...') ? children : `${text}…`;
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
        {/* While pending the spinner takes the icon's place (C38), never both side by side. */}
        {rest.loading ? null : <Icon name={icon} />}
      </Button>
    </Tooltip>
  );
}

// ButtonLink and VisuallyHidden are stateless and live in `button-link.tsx` (no 'use client').

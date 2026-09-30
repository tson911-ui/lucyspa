'use client';

import type { ReactNode } from 'react';
import { Button } from './button';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

export { Spinner } from './spinner';
export { Tooltip } from './tooltip';

// Feedback components (docs/UXUI_REDESIGN_DESIGN.md 9.2). Text always comes from props; status is
// never color-only (a text label is required and an icon is added where space allows).

export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';
export type BadgeTone = Tone | 'brand';

const toneIcon: Record<Exclude<Tone, 'neutral'>, IconName> = {
  success: 'check-circle',
  warning: 'alert-triangle',
  danger: 'x-circle',
  info: 'info',
};

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone | undefined;
  icon?: IconName | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  return (
    <span className={cx('ls-badge', `ls-badge-${tone}`, className)}>
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  );
}

export function Notice({
  tone = 'info',
  icon,
  onDismiss,
  dismissLabel,
  children,
  className,
}: {
  tone?: Exclude<Tone, 'neutral'> | undefined;
  /** Overrides the default tone icon; pass `false` to hide it. */
  icon?: IconName | false | undefined;
  onDismiss?: (() => void) | undefined;
  /** Required with `onDismiss`: the accessible name of the close button. */
  dismissLabel?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
}) {
  const iconName = icon === false ? null : (icon ?? toneIcon[tone]);
  return (
    <div
      className={cx('ls-notice', `ls-notice-${tone}`, className)}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      {iconName ? <Icon name={iconName} className="ls-notice-icon" /> : null}
      <div className="ls-notice-body">{children}</div>
      {onDismiss ? (
        <button
          type="button"
          className="ls-notice-close"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          <Icon name="close" size={16} />
        </button>
      ) : null}
    </div>
  );
}

/** Decorative placeholder shaped like the final content; the caller announces loading. */
export function Skeleton({
  lines = 1,
  height,
  width,
  className,
}: {
  lines?: number | undefined;
  height?: string | undefined;
  width?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <span className={cx('ls-skeleton-group', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="ls-skeleton"
          style={{
            height,
            width: width ?? (lines > 1 && index === lines - 1 ? '60%' : undefined),
          }}
        />
      ))}
    </span>
  );
}

export function EmptyState({
  icon = 'info',
  title,
  children,
  action,
  className,
}: {
  icon?: IconName | false | undefined;
  title?: string | undefined;
  /** One sentence. */
  children: ReactNode;
  /** The primary action, only when the user may create. */
  action?: ReactNode | undefined;
  className?: string | undefined;
}) {
  return (
    <div className={cx('ls-empty', className)}>
      {icon ? <Icon name={icon} size={28} className="ls-empty-icon" /> : null}
      {title ? <p className="ls-empty-title">{title}</p> : null}
      <p className="ls-empty-text">{children}</p>
      {action ? <div className="ls-empty-action">{action}</div> : null}
    </div>
  );
}

/** Blocking error: message, request reference (support code) and an optional retry. */
export function ErrorState({
  message,
  reference,
  referenceLabel,
  onRetry,
  retryLabel,
  className,
}: {
  message: string;
  reference?: string | null | undefined;
  /** Text placed before the reference, e.g. "Request reference". */
  referenceLabel?: string | undefined;
  onRetry?: (() => void) | undefined;
  retryLabel?: string | undefined;
  className?: string | undefined;
}) {
  return (
    <Notice tone="danger" className={className}>
      <p className="ls-notice-text">{message}</p>
      {reference ? (
        <p className="ls-notice-meta">
          {referenceLabel ? `${referenceLabel}: ` : ''}
          {reference}
        </p>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </Notice>
  );
}

export function ProgressBar({
  value,
  label,
  className,
}: {
  /** 0-100. Omit for an indeterminate bar. */
  value?: number | undefined;
  label: string;
  className?: string | undefined;
}) {
  const known = typeof value === 'number';
  const clamped = known ? Math.min(100, Math.max(0, value)) : undefined;
  return (
    <div
      className={cx('ls-progress', !known && 'ls-progress-indeterminate', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === undefined ? undefined : Math.round(clamped)}
    >
      <span className="ls-progress-fill" style={known ? { width: `${clamped}%` } : undefined} />
    </div>
  );
}

import { Badge, buttonClass, EmptyState, type IconName } from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import type { ReactNode } from 'react';

/** The tones the member screens' helpers answer (`error` is the booking helpers' word for danger). */
export type MemberTone = 'success' | 'info' | 'warning' | 'neutral' | 'error' | 'danger';

/**
 * A status badge of the member area (B18, C5): the kit badge with its icon and the word, so a status is never told by colour alone.
 * A status tone brings its own icon; a neutral state (completed, cancelled, used up) names one, `info` when the screen gives none.
 */
export function StatusBadge({
  tone,
  icon,
  children,
}: {
  tone: MemberTone;
  icon?: IconName | undefined;
  children: ReactNode;
}) {
  const kitTone = tone === 'error' ? 'danger' : tone;
  return (
    <Badge tone={kitTone} icon={icon ?? (kitTone === 'neutral' ? 'info' : undefined)}>
      {children}
    </Badge>
  );
}

/**
 * An empty list of the member area (DESIGN.md 8.4): an icon, a heading, one sentence and one next step. The step is the secondary
 * (outline) button: the header already carries the booking action, and a view has at most one filled button (Owner answer 2).
 */
export function MemberEmpty({
  icon,
  title,
  children,
  actionHref,
  actionLabel,
}: {
  icon: IconName;
  title: string;
  children: ReactNode;
  actionHref?: string | undefined;
  actionLabel?: string | undefined;
}) {
  return (
    <EmptyState
      icon={icon}
      title={title}
      className="ls-mem-empty"
      action={
        actionHref && actionLabel ? (
          <Link
            href={actionHref}
            className={buttonClass('secondary')}
            transitionTypes={NAV_TRANSITION}
          >
            {actionLabel}
          </Link>
        ) : undefined
      }
    >
      {children}
    </EmptyState>
  );
}

/**
 * The link that makes a whole table row one target (the stretched-link pattern, Owner answer 2): the visible text is the row's name in
 * ink, and its `::after` covers the row (s10-member.css `.ls-mem-rows`). The row has no menu while its only item would repeat this link.
 */
export function RowLink({
  href,
  label,
  children,
}: {
  href: string;
  /** The row's accessible name when the visible text alone is not enough (e.g. every service of a booking). */
  label?: string | undefined;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      className="ls-mem-row-link"
      aria-label={label}
      transitionTypes={NAV_TRANSITION}
    >
      {children}
    </Link>
  );
}

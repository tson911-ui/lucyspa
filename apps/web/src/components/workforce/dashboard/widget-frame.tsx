'use client';

import { Card, CardHeader, EmptyState, IconButton, Skeleton, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { Component, useId, type ErrorInfo, type ReactNode } from 'react';
import type { WidgetSize } from '../../../lib/workforce/dashboard/widgets';
import { ApiError } from '../../../lib/workforce/api';
import { useWorkforce } from '../session';
import { ErrorState, type Resource } from '../ui';

// The card every widget renders in, with its states (docs/UXUI_REDESIGN_DESIGN.md 14.1, 15): loading skeleton
// that reserves the widget's height, empty, error with retry, compact "no access" (a 403 from the API), and
// an optional "View all" link to the screen that holds the details.

export interface WidgetFrameProps<T> {
  title: string;
  size: WidgetSize;
  resource: Resource<T>;
  /** The widget has nothing to show for this data (an empty list); shows `emptyText` instead. */
  isEmpty?: ((data: T) => boolean) | undefined;
  emptyText?: string | undefined;
  /** Path below the workforce base (for example `/pos`) and its label. */
  link?: { path: string; label: string } | undefined;
  /** Explanation shown in a tooltip button next to the title. */
  info?: string | undefined;
  children: (data: T) => ReactNode;
}

export function WidgetSkeleton({ title, size }: { title: string; size: WidgetSize }) {
  const { t } = useWorkforce();
  return (
    <Card as="section" className="ls-widget" data-size={size} aria-busy="true">
      <CardHeader title={title} />
      <div role="status">
        <span className="ls-visually-hidden">{t.dashboard.widgetLoading}</span>
        <Skeleton lines={3} />
      </div>
    </Card>
  );
}

export function WidgetFrame<T>({
  title,
  size,
  resource,
  isEmpty,
  emptyText,
  link,
  info,
  children,
}: WidgetFrameProps<T>) {
  const { t, base } = useWorkforce();
  const headingId = useId();
  const { data, error, loading, reload } = resource;
  let body: ReactNode;
  if (data === null && loading) {
    return <WidgetSkeleton title={title} size={size} />;
  } else if (data === null) {
    body =
      error instanceof ApiError && error.status === 403 ? (
        <EmptyState icon="shield">{t.dashboard.noAccess}</EmptyState>
      ) : (
        <ErrorState error={error} t={t} onRetry={() => void reload()} />
      );
  } else if (isEmpty?.(data)) {
    body = <EmptyState icon="info">{emptyText ?? t.common.empty}</EmptyState>;
  } else {
    body = <div className="ls-widget-body">{children(data)}</div>;
  }
  return (
    <Card as="section" className="ls-widget" data-size={size} aria-labelledby={headingId}>
      <CardHeader
        title={title}
        id={headingId}
        actions={info ? <IconButton icon="info" label={info} /> : undefined}
      />
      {body}
      {link && data !== null ? (
        <div className="ls-widget-footer">
          <Link className={buttonClass('secondary', 'md')} href={`${base}${link.path}`}>
            {link.label}
          </Link>
        </div>
      ) : null}
    </Card>
  );
}

/** A widget that cannot show data at all (no branch, or no access at the selected one): a compact card. */
export function WidgetMessage({
  title,
  size,
  message,
  icon,
}: {
  title: string;
  size: WidgetSize;
  message: string;
  icon: 'shield' | 'info';
}) {
  return (
    <Card as="section" className="ls-widget" data-size={size}>
      <CardHeader title={title} />
      <EmptyState icon={icon}>{message}</EmptyState>
    </Card>
  );
}

/** A widget that fails while rendering must not take the dashboard down (contract 15). */
export class WidgetBoundary extends Component<
  { title: string; size: WidgetSize; children: ReactNode },
  { error: unknown }
> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown) {
    return { error: error ?? new Error('widget') };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Dashboard widget failed', error, info.componentStack);
  }

  override render() {
    if (this.state.error === null) return this.props.children;
    return <BoundaryFallback {...this.props} onRetry={() => this.setState({ error: null })} />;
  }
}

function BoundaryFallback({
  title,
  size,
  onRetry,
}: {
  title: string;
  size: WidgetSize;
  onRetry: () => void;
}) {
  const { t } = useWorkforce();
  return (
    <Card as="section" className="ls-widget" data-size={size}>
      <CardHeader title={title} />
      <ErrorState error={new Error('widget')} t={t} onRetry={onRetry} />
    </Card>
  );
}

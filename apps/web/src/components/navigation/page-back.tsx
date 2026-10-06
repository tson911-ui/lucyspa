'use client';

import { Icon, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type MouseEvent } from 'react';
import { hasAppHistory, parentPath, trackRoute } from '../../lib/navigation/back';
import { NAV_TRANSITION } from '../../lib/nav-transition';

/** Mounted once in the locale layout: counts in-app navigations so "Back" knows whether the app has a previous page. */
export function RouteHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => trackRoute(pathname), [pathname]);
  return null;
}

/**
 * The "← Back" button at the top-left of a page, above its title and breadcrumbs (same place and look on every page).
 * It goes back to the page the person came from, so filters, search and scroll position come back with it; with no
 * such page (opened directly or in a new tab) it is a plain link to the logical parent. Renders nothing where there is
 * no parent (the staff dashboard).
 */
export function PageBack({
  root,
  publicHome = null,
  label,
}: {
  /** The area's home: `/vi/workforce` or `/vi/account`. */
  root: string;
  /** Where the area's home goes back to (the member area returns to the public home); none for the staff area. */
  publicHome?: string | null | undefined;
  label: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Outside the router (a component test renders the screen alone) there is no path and so no parent.
  const parent = pathname ? parentPath(pathname, root, publicHome) : null;
  if (parent === null) return null;

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // A new-tab click (modifier keys, middle button) keeps its normal link behaviour.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!hasAppHistory(document.referrer, window.location.origin)) return;
    event.preventDefault();
    router.back();
  }

  return (
    <div className="ls-back-row">
      <Link
        href={parent}
        className={buttonClass('ghost', 'md', 'ls-back')}
        onClick={onClick}
        transitionTypes={NAV_TRANSITION}
      >
        <Icon name="arrow-left" />
        <span className="ls-btn-label">{label}</span>
      </Link>
    </div>
  );
}

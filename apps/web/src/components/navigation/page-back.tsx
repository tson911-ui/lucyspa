'use client';

import { Icon, buttonClass } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, type MouseEvent } from 'react';
import { hasAppHistory, hasParent, parentPath, trackRoute } from '../../lib/navigation/back';
import { NAV_TRANSITION } from '../../lib/nav-transition';

/** Mounted once in the locale layout: counts in-app navigations so "Back" knows whether the app has a previous page. */
export function RouteHistoryTracker() {
  const pathname = usePathname();
  const first = useRef(true);
  useEffect(() => {
    trackRoute(pathname);
    // Every later pathname is a route change: the motion wrapper kills every running tween (Owner G4, 2026-10-16).
    if (first.current) first.current = false;
    else window.dispatchEvent(new Event('ls:route'));
  }, [pathname]);
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
  menuRoot = false,
  label,
}: {
  /** The area's home: `/vi/workforce` or `/vi/account`. */
  root: string;
  /** Where the area's home goes back to (the member area returns to the public home); none for the staff area. */
  publicHome?: string | null | undefined;
  /** The area has its own menu (staff sidebar, member tabs): the pages it opens are top-level and show no Back. */
  menuRoot?: boolean | undefined;
  /** The accessible name of the chevron, e.g. "Quay lại". */
  label: string;
}) {
  const pathname = usePathname();
  const router = useRouter();
  // Outside the router (a component test renders the screen alone) there is no path and so no parent. A top-level destination (the
  // area's home, or a page its own menu opens) shows no Back at all (Owner B7, C40).
  const parent =
    pathname && hasParent(pathname, root, menuRoot) ? parentPath(pathname, root, publicHome) : null;
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
      {/* The standard back chevron, icon only, with its name for assistive technology (C40). */}
      <Link
        href={parent}
        className={buttonClass('ghost', 'md', 'ls-back ls-btn-icon')}
        onClick={onClick}
        transitionTypes={NAV_TRANSITION}
        aria-label={label}
        title={label}
      >
        <Icon name="chevron-left" />
      </Link>
    </div>
  );
}

'use client';

import { useEffect, useLayoutEffect, useRef } from 'react';
import { cx } from './cx';
import { PlainLink, type SiteLinkComponent, type SiteNavItem } from './site-link';

// The route menus of the customer side. The current entry's pill is one element that slides to the next entry when the
// route changes (pattern M8), instead of the highlight blinking off one link and on another. Without scripts, or while
// the pill is not placed yet, the current link keeps its own highlight (site.css); the pill never carries content.

/** The browser has no layout effect on the server; the pill is only placed in the browser. */
const useBrowserLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

type PillMode = 'none' | 'still' | 'slide';

/**
 * Places the pill under the current link. `data-pill` on the menu is `none` (no current entry, or the menu is hidden),
 * `still` (placed without a transition: first paint, a resize, a font arriving) or `slide` (the route changed, the
 * pill moves with a transition). The geometry goes in custom properties on the menu, so React never re-renders.
 */
function useSlidingPill(signature: string) {
  const nav = useRef<HTMLElement | null>(null);
  const placed = useRef(false);
  /** The box the pill was last given, so a resize that changes nothing never cancels a slide in progress. */
  const lastBox = useRef('');

  const place = (animate: boolean) => {
    const element = nav.current;
    if (!element) return;
    const current = element.querySelector<HTMLElement>('a[aria-current]');
    if (!current || current.offsetWidth === 0) {
      placed.current = false;
      lastBox.current = '';
      element.dataset['pill'] = 'none' satisfies PillMode;
      return;
    }
    const box = [current.offsetLeft, current.offsetTop, current.offsetWidth, current.offsetHeight];
    if (!animate && placed.current && box.join() === lastBox.current) return;
    lastBox.current = box.join();
    element.style.setProperty('--ls-pill-x', `${box[0]}px`);
    element.style.setProperty('--ls-pill-y', `${box[1]}px`);
    element.style.setProperty('--ls-pill-w', `${box[2]}px`);
    element.style.setProperty('--ls-pill-h', `${box[3]}px`);
    element.dataset['pill'] = (animate && placed.current ? 'slide' : 'still') satisfies PillMode;
    placed.current = true;
  };

  // A route change (the current entry or the entries themselves changed): slide.
  useBrowserLayoutEffect(() => {
    place(true);
    // `place` only reads refs; the signature is what says the menu changed.
  }, [signature]);

  // A menu that was hidden (a phone), grew (member entries arriving) or changed width (web font): jump, never slide.
  useEffect(() => {
    const element = nav.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    // An observer reports once when it starts watching; that is not a change, and must not cancel a slide in progress.
    let started = false;
    const observer = new ResizeObserver(() => {
      if (!started) {
        started = true;
        return;
      }
      place(false);
    });
    observer.observe(element);
    element.querySelectorAll('a').forEach((link) => observer.observe(link));
    return () => observer.disconnect();
  }, [signature]);

  return nav;
}

function signatureOf(items: readonly SiteNavItem[]): string {
  return items.map((item) => `${item.key}${item.current ? '*' : ''}`).join('|');
}

function RouteLinks({
  items,
  LinkComponent,
}: {
  items: readonly SiteNavItem[];
  LinkComponent: SiteLinkComponent;
}) {
  const Link = LinkComponent;
  return (
    <>
      <span className="ls-nav-pill" aria-hidden="true" />
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.current ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </>
  );
}

/** The main menu (desktop header, and the footer's discovery column). */
export function SiteNav({
  label,
  items,
  LinkComponent = PlainLink,
  className,
}: {
  label: string;
  items: readonly SiteNavItem[];
  LinkComponent?: SiteLinkComponent | undefined;
  className?: string | undefined;
}) {
  const nav = useSlidingPill(signatureOf(items));
  return (
    <nav ref={nav} aria-label={label} className={cx('ls-site-nav', className)}>
      <RouteLinks items={items} LinkComponent={LinkComponent} />
    </nav>
  );
}

/**
 * The in-page row of the member area (overview, bookings, invoices, notifications): route based pills that scroll
 * sideways inside their own strip on a narrow screen, never the page.
 */
export function SiteSubNav({
  label,
  items,
  LinkComponent = PlainLink,
  className,
}: {
  label: string;
  items: readonly SiteNavItem[];
  LinkComponent?: SiteLinkComponent | undefined;
  className?: string | undefined;
}) {
  const nav = useSlidingPill(signatureOf(items));
  return (
    <nav ref={nav} aria-label={label} className={cx('ls-subnav', className)}>
      <RouteLinks items={items} LinkComponent={LinkComponent} />
    </nav>
  );
}

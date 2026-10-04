'use client';

import { cx } from './cx';
import { useSlidingPill } from './sliding-pill';
import { PlainLink, type SiteLinkComponent, type SiteNavItem } from './site-link';

// The route menus of the customer side. The current entry's pill is one element that slides to the next entry when the
// route changes (pattern M8), instead of the highlight blinking off one link and on another. Without scripts, or while
// the pill is not placed yet, the current link keeps its own highlight (site.css); the pill never carries content.

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

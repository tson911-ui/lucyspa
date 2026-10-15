import { cx } from './cx';
import { PlainLink, type SiteLinkComponent, type SiteNavItem } from './site-link';

// The route menus of the customer side. Plain links: the current entry carries its own highlight (site.css, chrome-v2.css) and hover
// fills the hovered link itself; no highlight slides between entries (Owner, session 9).

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
  return (
    <nav aria-label={label} className={cx('ls-site-nav', className)}>
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
  return (
    <nav aria-label={label} className={cx('ls-subnav', className)}>
      <RouteLinks items={items} LinkComponent={LinkComponent} />
    </nav>
  );
}

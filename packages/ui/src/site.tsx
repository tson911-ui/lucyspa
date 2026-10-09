import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';
import { PlainLink, type SiteLinkComponent } from './site-link';

// Public site and member-area frame (docs/UXUI_REDESIGN_PART2_DESIGN.md section 3-5). Text always comes from
// props; the styles are in `site.css` under `.ls-site`. Router links are injected (`LinkComponent`), as in the Slider.
// The route menus (SiteNav, SiteSubNav) are client components in `site-nav.tsx`: their pill slides between entries.

export type { SiteLinkComponent, SiteNavItem } from './site-link';

export interface TabBarItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  current: boolean;
  /** The one tab that is the call to action (the booking tab): brand colour and weight even when not current. */
  emphasis?: boolean | undefined;
}

/** The phone tab bar (below 1024 px): at most five destinations, 44 px targets, the current one marked. */
export function TabBar({
  label,
  items,
  LinkComponent = PlainLink,
}: {
  label: string;
  items: readonly TabBarItem[];
  LinkComponent?: SiteLinkComponent | undefined;
}) {
  const Link = LinkComponent;
  return (
    <nav aria-label={label} className="ls-tab-bar">
      {items.slice(0, 5).map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.current ? 'page' : undefined}
          data-emphasis={item.emphasis ? 'true' : undefined}
        >
          <Icon name={item.icon} />
          <span>{item.label}</span>
        </Link>
      ))}
    </nav>
  );
}

export interface FooterColumn {
  key: string;
  title: string;
  items: readonly ReactNode[];
}

/** One block of the brand column: the Owner's order, a stable key, the drawn content. */
export interface FooterBlockItem {
  key: string;
  node: ReactNode;
}

/**
 * The public footer: the brand column (the logo, then the Owner's blocks; the logo alone when there are none), the
 * columns, and the base line.
 */
export function SiteFooter({
  brand,
  blocks = [],
  columns,
  base,
}: {
  brand: ReactNode;
  blocks?: readonly FooterBlockItem[] | undefined;
  columns: readonly FooterColumn[];
  base: ReactNode;
}) {
  return (
    <footer className="ls-site-footer">
      <div className="ls-container ls-site-footer-grid">
        <div className="ls-site-footer-brand">
          {brand}
          {blocks.length > 0 ? (
            <div className="ls-site-footer-blocks">
              {blocks.map((block) => (
                <div key={block.key} className="ls-site-footer-block">
                  {block.node}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {columns.map((column) => (
          <div key={column.key} data-column={column.key}>
            <h2 className="ls-site-footer-title">{column.title}</h2>
            <ul className="ls-site-footer-list">
              {column.items.map((item, position) => (
                <li key={position}>{item}</li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="ls-site-footer-baseline">
        <div className="ls-container ls-site-footer-base">{base}</div>
      </div>
    </footer>
  );
}

/** The `main` landmark of a public page. */
export function PublicMain({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main id="main-content" tabIndex={-1} className={cx('ls-site-main', className)}>
      {children}
    </main>
  );
}

/**
 * A full-width band of the page with its own surface (`page` is the warm page colour, `surface` is white/raised),
 * content held in the site container. Bands alternate so the page reads in sections without borders.
 */
export function Band({
  tone = 'page',
  labelledBy,
  label,
  className,
  children,
}: {
  tone?: 'page' | 'surface' | undefined;
  labelledBy?: string | undefined;
  /** An accessible name for a band that has no visible heading. */
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section
      className={cx('ls-band', `ls-band-${tone}`, className)}
      aria-labelledby={labelledBy}
      aria-label={label}
    >
      <div className="ls-container">{children}</div>
    </section>
  );
}

/** A public page with one h1: the `main` landmark, a title block and the content in the site container. */
export function PublicPage({
  title,
  lead,
  width = 'default',
  back,
  centered = false,
  children,
}: {
  title: string;
  lead?: string | undefined;
  width?: 'default' | 'narrow' | undefined;
  /** A notice (not found, failed): centred under a soft ring, one way on below. */
  centered?: boolean | undefined;
  /** The "← Back" row, drawn at the top-left above the title. */
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PublicMain>
      <div
        className={cx(
          'ls-container',
          width === 'narrow' && 'ls-container-narrow',
          centered && 'ls-public-centered',
        )}
      >
        {back}
        <div className="ls-public-title">
          <h1 className="ls-h1-display">{title}</h1>
          {lead ? <p className="ls-lead">{lead}</p> : null}
        </div>
        {children}
      </div>
    </PublicMain>
  );
}

export interface PriceListItem {
  key: string;
  name: string;
  /** Already formatted, for example "5.000-30.000 ₫/ngón". */
  price: string;
  /** The row is a link to this address (the whole row is the target). */
  href?: string | undefined;
}

/**
 * The home page's menu rows, like a printed spa menu: the name, a dotted leader and the price on one line. A name longer
 * than two lines is cut with an ellipsis (its full text is the tooltip), the price stays whole in its own right-aligned
 * column, and the leader fills what is left. A row with an `href` is one link.
 */
export function PriceList({
  items,
  LinkComponent = PlainLink,
}: {
  items: readonly PriceListItem[];
  LinkComponent?: SiteLinkComponent | undefined;
}) {
  const Link = LinkComponent;
  return (
    <ul className="ls-price-list">
      {items.map((item) => {
        const cells = (
          <>
            <span className="ls-price-name" title={item.name}>
              {item.name}
            </span>
            <span className="ls-price-dots" aria-hidden="true" />
            <span className="ls-price">{item.price}</span>
          </>
        );
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className="ls-price-row">
                {cells}
              </Link>
            ) : (
              <div className="ls-price-row">{cells}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface StepItem {
  key: string;
  label: string;
  /** Phones show this shorter label. */
  shortLabel: string;
}

/** The booking stepper: a segmented progress bar with labels; the current step is marked `aria-current="step"`. */
export function Steps({
  label,
  steps,
  current,
}: {
  label: string;
  steps: readonly StepItem[];
  current: string;
}) {
  const at = steps.findIndex((step) => step.key === current);
  return (
    <ol className="ls-steps" aria-label={label}>
      {steps.map((step, position) => (
        <li
          key={step.key}
          aria-current={step.key === current ? 'step' : undefined}
          data-done={position < at ? 'true' : undefined}
        >
          <span className="ls-steps-long">{`${position + 1}. ${step.label}`}</span>
          <span className="ls-steps-short">{step.shortLabel}</span>
        </li>
      ))}
    </ol>
  );
}

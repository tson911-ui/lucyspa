import type { ComponentType, ReactNode } from 'react';
import { cx } from './cx';
import { Icon, type IconName } from './icons';

// Public site and member-area frame (docs/UXUI_REDESIGN_PART2_DESIGN.md section 3-5). Text always comes from
// props; the styles are in `site.css` under `.ls-site`. Router links are injected (`LinkComponent`), as in the Slider.

export type SiteLinkComponent = ComponentType<{
  href: string;
  className?: string | undefined;
  'aria-current'?: 'page' | undefined;
  'aria-label'?: string | undefined;
  hrefLang?: string | undefined;
  lang?: string | undefined;
  children: ReactNode;
}>;

const PlainLink: SiteLinkComponent = ({ children, ...rest }) => <a {...rest}>{children}</a>;

export interface SiteNavItem {
  key: string;
  label: string;
  href: string;
  current: boolean;
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
  const Link = LinkComponent;
  return (
    <nav aria-label={label} className={cx('ls-site-nav', className)}>
      {items.map((item) => (
        <Link key={item.key} href={item.href} aria-current={item.current ? 'page' : undefined}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export interface TabBarItem {
  key: string;
  label: string;
  href: string;
  icon: IconName;
  current: boolean;
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
        <Link key={item.key} href={item.href} aria-current={item.current ? 'page' : undefined}>
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

export function SiteFooter({
  brand,
  tagline,
  columns,
  base,
}: {
  brand: ReactNode;
  tagline?: string | null | undefined;
  columns: readonly FooterColumn[];
  base: ReactNode;
}) {
  return (
    <footer className="ls-site-footer">
      <div className="ls-container ls-site-footer-grid">
        <div className="ls-site-footer-brand">
          {brand}
          {tagline ? <p>{tagline}</p> : null}
        </div>
        {columns.map((column) => (
          <div key={column.key}>
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
  children,
}: {
  title: string;
  lead?: string | undefined;
  width?: 'default' | 'narrow' | undefined;
  children: ReactNode;
}) {
  return (
    <PublicMain>
      <div className={cx('ls-container', width === 'narrow' && 'ls-container-narrow')}>
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
}

/** Name and price rows (home group cards, service lists). A long price wraps under its name instead of squeezing it. */
export function PriceList({ items }: { items: readonly PriceListItem[] }) {
  return (
    <ul className="ls-price-list">
      {items.map((item) => (
        <li key={item.key}>
          <span>{item.name}</span>
          <span className="ls-price">{item.price}</span>
        </li>
      ))}
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

import type { CSSProperties, ReactNode } from 'react';
import { BrandIcon, type BrandIconName } from './brand-icons';
import { PlainLink, type SiteLinkComponent } from './site-link';

// The blocks of the public footer's brand column (Owner request 2026-10-04): social icons, store badges, a link list,
// a picture and a paragraph. Text and addresses always come from props; the styles are in `site.css` under `.ls-site`.
// Links that leave the site open in a new tab with `rel="noopener noreferrer"`, and their accessible name says so
// (the caller writes it: the kit has no wording of its own).

export interface SocialLinkItem {
  key: string;
  /** The accessible name, for example "Facebook (opens in a new tab)". */
  label: string;
  href: string;
  icon: BrandIconName;
}

/** One row of round icon buttons, one per link (the caller leaves out a network that has none). */
export function SocialLinks({ label, items }: { label: string; items: readonly SocialLinkItem[] }) {
  return (
    <ul className="ls-social" aria-label={label}>
      {items.map((item) => (
        <li key={item.key}>
          <a
            className="ls-social-btn"
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.label}
            title={item.label}
          >
            <BrandIcon name={item.icon} />
          </a>
        </li>
      ))}
    </ul>
  );
}

export interface StoreBadgeItem {
  key: string;
  /** The accessible name: the badge's own wording, for example "Get it on Google Play (opens in a new tab)". */
  label: string;
  href: string;
  /** The official badge file, unmodified. */
  src: string;
  /** The badge file's own size, for layout stability. */
  width: number;
  height: number;
  /**
   * How much taller than the badge's artwork the file is (transparent clear space is part of the official Google
   * file): the file is drawn this many times the badge height, so every badge shows its artwork at one height.
   */
  fileScale?: number | undefined;
  /**
   * How far the artwork is inset from the file's left and right edges, as a share of the file's height (the official
   * English Google file has 41 of 250). The transparent margin is drawn, never cropped, but it does not push the
   * badge in from the column edge or widen the gap to the next badge.
   */
  fileInset?: number | undefined;
}

/** The official store badges, never recoloured or restyled: each is drawn at one artwork height. */
export function StoreBadges({ items }: { items: readonly StoreBadgeItem[] }) {
  return (
    <ul className="ls-store-badges">
      {items.map((item) => (
        <li
          key={item.key}
          style={
            {
              '--ls-badge-file-scale': item.fileScale ?? 1,
              '--ls-badge-file-inset': item.fileInset ?? 0,
            } as CSSProperties
          }
        >
          <a
            className="ls-store-badge"
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={item.label}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- an official badge file, drawn as delivered */}
            <img
              src={item.src}
              width={item.width}
              height={item.height}
              alt=""
              loading="lazy"
              decoding="async"
            />
          </a>
        </li>
      ))}
    </ul>
  );
}

/** A short list of links with an optional title; the list is a navigation landmark named by the title. */
export function FooterLinkList({
  title,
  items,
}: {
  title?: string | null | undefined;
  items: readonly ReactNode[];
}) {
  const list = (
    <ul className="ls-site-footer-list">
      {items.map((item, position) => (
        <li key={position}>{item}</li>
      ))}
    </ul>
  );
  if (!title) return list;
  return (
    <nav aria-label={title} className="ls-footer-links">
      <p className="ls-footer-links-title" aria-hidden="true">
        {title}
      </p>
      {list}
    </nav>
  );
}

/** A picture of the footer, optionally a link (a site path stays in this tab, an address opens a new one). */
export function FooterPicture({
  href,
  label,
  children,
  LinkComponent = PlainLink,
}: {
  href?: string | null | undefined;
  /** The link's accessible name when the picture is a link (the picture's own alt text may be empty). */
  label?: string | undefined;
  children: ReactNode;
  LinkComponent?: SiteLinkComponent | undefined;
}) {
  if (!href) return <div className="ls-footer-picture">{children}</div>;
  const external = href.startsWith('https://');
  const Link = LinkComponent;
  return (
    <div className="ls-footer-picture">
      {external ? (
        <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
          {children}
        </a>
      ) : (
        <Link href={href} aria-label={label}>
          {children}
        </Link>
      )}
    </div>
  );
}

/** A paragraph of plain text; line breaks the Owner typed are kept. */
export function FooterText({ children }: { children: string }) {
  return <p className="ls-footer-text">{children}</p>;
}

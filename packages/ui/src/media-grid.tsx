'use client';

import type { ReactNode } from 'react';
import { cx } from './cx';

/**
 * Responsive grid of image tiles for a media library (docs/UXUI_REDESIGN_DESIGN.md 16.3). The grid sits on
 * the page like a list: it has no outer card. Every tile has the same rows (thumbnail, one-line title, one
 * line of meta, optional badge row), so tiles in a row are the same height.
 */
export function MediaGrid({
  label,
  className,
  children,
}: {
  /** Accessible name of the list, e.g. "Images". */
  label: string;
  className?: string | undefined;
  children: ReactNode;
}) {
  return (
    <ul className={cx('ls-media-grid', className)} aria-label={label}>
      {children}
    </ul>
  );
}

/** A large preview of one image (detail drawer): contained, never cropped, on a sunken surface. */
export function MediaPreview({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="ls-media-preview">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} decoding="async" />
    </div>
  );
}

/**
 * One image. The title is the button that opens the detail, and it covers the whole tile (a 40/44px
 * target at least); the thumbnail is decorative because the title is text next to it. Library images are already resized, and this package cannot use
 * next/image.
 */
export function MediaTile({
  src,
  title,
  meta,
  badge,
  actions,
  actionLabel,
  onSelect,
}: {
  /** The thumbnail rendition. */
  src: string;
  title: string;
  /** One short line, e.g. "1.2 MB · 1920 × 800". */
  meta: string;
  /** Optional status (e.g. a "Missing alt text" badge). */
  badge?: ReactNode;
  /** The tile's `⋮` menu (a `RowActions`), shown over the thumbnail's top corner; a sibling of the button. */
  actions?: ReactNode;
  /** Accessible name of the button, e.g. "Open banner.png". */
  actionLabel: string;
  onSelect: () => void;
}) {
  return (
    <li className="ls-media-item">
      <div className="ls-media-tile">
        <span className="ls-media-thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" loading="lazy" decoding="async" />
        </span>
        {/* The name is the button (as a table's name cell is the link); its pseudo-element stretches the
            click area over the whole tile. */}
        <button
          type="button"
          className="ls-media-title"
          title={title}
          aria-label={actionLabel}
          onClick={onSelect}
        >
          {title}
        </button>
        <span className="ls-media-meta">{meta}</span>
        <span className="ls-media-badges">{badge}</span>
      </div>
      {actions ? <div className="ls-media-actions">{actions}</div> : null}
    </li>
  );
}

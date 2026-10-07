'use client';

import type { ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';
import { FallbackImage } from './image-fallback';

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

/**
 * A small square picture at the start of a table row (a `leading` DataTable column). It is decorative (the name next to it is
 * the text); without a picture a muted placeholder icon holds the same square, so rows keep one height.
 */
export function MediaThumb({ src }: { src: string | null }) {
  return (
    <span className="ls-thumb">
      {src ? (
        <FallbackImage src={src} loading="lazy" decoding="async" fallback={<Icon name="image" />} />
      ) : (
        <Icon name="image" />
      )}
    </span>
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

/** What stands in for a picture that cannot be loaded: the same muted placeholder icon a missing picture shows. */
function ImageGone() {
  return (
    <span className="ls-img-fallback" aria-hidden="true">
      <Icon name="image" />
    </span>
  );
}

/**
 * One image as a row of a list the order of which matters (the homepage slider, design 16.6): a wide
 * thumbnail, the title as the button that opens the item, one meta line, badges, and the row's `⋮` menu at
 * the trailing edge. It draws no frame of its own: the sortable list item around it is the frame. On a phone
 * the thumbnail takes its own line above the text.
 */
export function MediaRow({
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
  /** One short line, e.g. "Position 2 · Always shown". */
  meta: string;
  /** Optional status badge(s). */
  badge?: ReactNode;
  /** The row's `⋮` menu (a `RowActions`). */
  actions?: ReactNode;
  /** Accessible name of the title button, e.g. "Edit Tet offer". */
  actionLabel: string;
  onSelect: () => void;
}) {
  return (
    <div className="ls-media-row">
      <span className="ls-media-row-thumb">
        <FallbackImage src={src} loading="lazy" decoding="async" fallback={<ImageGone />} />
      </span>
      <div className="ls-media-row-text">
        <button
          type="button"
          className="ls-media-row-title"
          title={title}
          aria-label={actionLabel}
          onClick={onSelect}
        >
          {title}
        </button>
        <span className="ls-media-meta">{meta}</span>
        <span className="ls-media-badges">{badge}</span>
      </div>
      {actions ? <div className="ls-media-row-actions">{actions}</div> : null}
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
          <FallbackImage src={src} loading="lazy" decoding="async" fallback={<ImageGone />} />
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

/**
 * One entry of an ordered list that has no picture (the facts strip, the featured groups): an optional icon, the title,
 * one meta line, optional badges and the row's `⋮` menu at the trailing edge. The sortable item around it is the frame,
 * exactly like `MediaRow`.
 */
export function ListRow({
  icon,
  title,
  meta,
  badge,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  /** One short line under the title (cut with an ellipsis, the full text is the tooltip): every row has the same height. */
  meta?: string | undefined;
  badge?: ReactNode;
  /** The row's `⋮` menu (a `RowActions`). */
  actions?: ReactNode;
}) {
  return (
    <div className={cx('ls-list-row', icon ? 'ls-list-row-icon' : undefined)}>
      {icon ? (
        <span className="ls-list-row-mark" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <div className="ls-media-row-text">
        <span className="ls-list-row-head">
          <span className="ls-list-row-title" title={title}>
            {title}
          </span>
          {badge}
        </span>
        <span className="ls-media-meta" title={meta}>
          {meta ?? '\u00a0'}
        </span>
      </div>
      {actions ? <div className="ls-media-row-actions">{actions}</div> : null}
    </div>
  );
}

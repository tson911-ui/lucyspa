'use client';

import type { ComponentType, ReactNode } from 'react';
import { IconButton } from './button';
import { buttonClass } from './button-class';
import { cx } from './cx';
import { Icon } from './icons';

// The promotional popup (docs/UXUI_REDESIGN_DESIGN.md 16.5). One presentational card is used twice: live in
// `PromoDialog` on the public site and, as a static copy, in the admin preview frames, so what the Owner
// previews is the component visitors get.

export interface PromoImage {
  src: string;
  /** `url 960w, url 1920w`; omit when there is one rendition. */
  srcSet?: string | undefined;
  sizes?: string | undefined;
  /** Required: the description that screen readers read. */
  alt: string;
  /** The file's own size, so the browser reserves the space before the image arrives (no layout shift). */
  width: number;
  height: number;
}

export interface PromoContent {
  title: string | null;
  body: string | null;
  image: PromoImage | null;
  cta: { label: string; href: string } | null;
}

/** What a router link looks like to the card (for example `next/link`). */
export type PromoLink = ComponentType<{
  href: string;
  className?: string | undefined;
  onClick?: (() => void) | undefined;
  children: ReactNode;
}>;

/**
 * The popup's surface. `live` has real controls (close button, link); `preview` is a picture of it: the
 * close icon and the button are drawn but are not controls, so the preview never steals focus or navigates.
 */
export function PromoCard({
  content,
  mode = 'live',
  titleId,
  closeLabel,
  onClose,
  LinkComponent,
  onNavigate,
}: {
  content: PromoContent;
  mode?: 'live' | 'preview' | undefined;
  /** The id the dialog's `aria-labelledby` points at. */
  titleId?: string | undefined;
  closeLabel?: string | undefined;
  onClose?: (() => void) | undefined;
  LinkComponent?: PromoLink | undefined;
  /** Called when the link is followed, so the popup can close behind the navigation. */
  onNavigate?: (() => void) | undefined;
}) {
  const { title, body, image, cta } = content;
  const Link = LinkComponent;
  const ctaClass = buttonClass('primary', 'lg');
  return (
    <article className="ls-promo">
      {/* First in the DOM so it is the first stop of the focus trap; drawn at the card's corner. */}
      {mode === 'live' && onClose && closeLabel ? (
        <span className="ls-promo-close">
          <IconButton icon="close" label={closeLabel} onClick={onClose} />
        </span>
      ) : mode === 'preview' ? (
        <span className="ls-promo-close" aria-hidden="true">
          <span className={buttonClass('ghost', 'md', 'ls-btn-icon')}>
            <Icon name="close" />
          </span>
        </span>
      ) : null}
      {image ? (
        <div className="ls-promo-media">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image.src}
            srcSet={image.srcSet}
            sizes={image.sizes}
            alt={image.alt}
            width={image.width}
            height={image.height}
            decoding="async"
          />
        </div>
      ) : null}
      <div className="ls-promo-body">
        {title ? (
          <h2 className="ls-promo-title" id={titleId}>
            {title}
          </h2>
        ) : null}
        {body ? <p className="ls-promo-text">{body}</p> : null}
        {cta ? (
          mode === 'preview' ? (
            <span className={ctaClass}>{cta.label}</span>
          ) : Link ? (
            <Link href={cta.href} className={ctaClass} onClick={onNavigate}>
              {cta.label}
            </Link>
          ) : (
            <a href={cta.href} className={ctaClass} onClick={onNavigate}>
              {cta.label}
            </a>
          )
        ) : null}
      </div>
    </article>
  );
}

/** Admin preview: the same card in a desktop-width and a phone-width frame. */
export function PromoPreview({
  content,
  desktopLabel,
  phoneLabel,
}: {
  content: PromoContent;
  desktopLabel: string;
  phoneLabel: string;
}) {
  return (
    <div className="ls-promo-previews">
      {(
        [
          ['desktop', desktopLabel],
          ['phone', phoneLabel],
        ] as const
      ).map(([device, label]) => (
        <figure key={device} className={cx('ls-promo-frame', `ls-promo-frame-${device}`)}>
          <figcaption className="ls-promo-caption">{label}</figcaption>
          <div className="ls-promo-stage">
            <PromoCard content={content} mode="preview" />
          </div>
        </figure>
      ))}
    </div>
  );
}

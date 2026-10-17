import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { Icon } from '@lucy-spa/ui';
import type { CSSProperties } from 'react';

/**
 * A place for one of the shop's own photos (DESIGN.md 8.9 image frame): the 18 px frame at its final ratio. With the picture the shop chose
 * it draws it (`priority` for the one above the fold, lazy otherwise); without one it is the flat placeholder, one grey step from its band,
 * with the image icon and no words (a caption on a placeholder read as a photo credit; the photo list for the Owner lives in
 * docs/CUSTOMER_SITE_C.md). Never a stock or made-up photo. A placeholder is decoration, so it is hidden from assistive technology.
 */
export function PhotoSlot({
  className,
  image,
  priority = false,
  style,
}: {
  className?: string;
  image?: PublicSiteResponse['heroImage'];
  /** The picture is the page's largest paint (a detail page's photo): fetched first, never lazy. */
  priority?: boolean;
  style?: CSSProperties;
}) {
  const widest = image?.sources[image.sources.length - 1];
  const classes = `ls-slot${className ? ` ${className}` : ''}`;
  if (!image || !widest) {
    return (
      <div className={classes} style={style} data-empty="true" aria-hidden="true">
        <Icon name="image" size={24} />
      </div>
    );
  }
  return (
    <figure className={classes} style={style}>
      {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions */}
      <img
        className="ls-slot-img"
        src={widest.url}
        srcSet={image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')}
        sizes="(min-width: 1024px) 50vw, 100vw"
        width={image.width}
        height={image.height}
        alt={image.alt}
        decoding="async"
        {...(priority ? { fetchPriority: 'high' as const } : { loading: 'lazy' as const })}
      />
    </figure>
  );
}

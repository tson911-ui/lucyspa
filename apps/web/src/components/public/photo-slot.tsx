import type { PublicSiteResponse } from '@lucy-spa/contracts';
import type { CSSProperties } from 'react';

/**
 * A place for one of the shop's own photos (DESIGN.md 9: a flat placeholder, no gradient). It is drawn to be swapped: the frame and ratio
 * are final, and the caption says which photo belongs here (the list for the Owner is in docs/CUSTOMER_SITE_C.md and the Step report).
 * Never a stock or made-up photo. When the shop already chose a picture for the slot, `image` draws it instead.
 */
export function PhotoSlot({
  className,
  caption,
  image,
  style,
}: {
  className?: string;
  /** What to photograph, in the visitor's language: "Ảnh của tiệm: phòng massage". */
  caption: string;
  image?: PublicSiteResponse['heroImage'];
  style?: CSSProperties;
}) {
  const widest = image?.sources[image.sources.length - 1];
  return (
    <figure className={`ls-slot${className ? ` ${className}` : ''}`} style={style}>
      {image && widest ? (
        // eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions
        <img
          className="ls-slot-img"
          src={widest.url}
          srcSet={image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')}
          sizes="(min-width: 1024px) 50vw, 100vw"
          width={image.width}
          height={image.height}
          alt={image.alt}
          decoding="async"
        />
      ) : (
        <figcaption className="ls-slot-caption">{caption}</figcaption>
      )}
    </figure>
  );
}

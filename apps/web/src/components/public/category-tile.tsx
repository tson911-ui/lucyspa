'use client';

import type { PublicSlideImage } from '@lucy-spa/contracts';
import { useImageFailure } from '@lucy-spa/ui';
import Link from 'next/link';
import { frameImage } from '../../lib/public-image';

/**
 * One tile of the home category grid (DESIGN.md 9.1, item 6): the whole tile is one link with the name at the bottom-left. With a photo the
 * Owner chose, the picture fills the tile under one flat scrim and the name is white; without one, or when the file cannot be loaded, the
 * tile is the flat placeholder with the normal text color (so the name never turns white on a light tile).
 */
export function CategoryTile({
  name,
  href,
  image,
}: {
  name: string;
  href: string;
  image: PublicSlideImage | null;
}) {
  const picture = frameImage(image, '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw');
  const { failed, ref, onError } = useImageFailure(picture.src ?? undefined);
  const shown = picture.src !== null && !failed;
  return (
    <Link className="ls-home-cat" href={href} {...(shown ? { 'data-media': 'photo' } : {})}>
      {shown && picture.src !== null ? (
        // eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions
        <img
          ref={ref}
          onError={onError}
          className="ls-home-cat-img"
          src={picture.src}
          srcSet={'srcSet' in picture ? picture.srcSet : undefined}
          sizes={'sizes' in picture ? picture.sizes : undefined}
          width={'width' in picture ? picture.width : undefined}
          height={'height' in picture ? picture.height : undefined}
          alt=""
          loading="lazy"
          decoding="async"
        />
      ) : null}
      <span className="ls-home-cat-name">{name}</span>
    </Link>
  );
}

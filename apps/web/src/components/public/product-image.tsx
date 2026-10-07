'use client';

import type { PublicSlideImage } from '@lucy-spa/contracts';
import { Icon, useImageFailure } from '@lucy-spa/ui';

/**
 * One picture of the public catalog: the narrowest rendition is the fallback `src`, all renditions are the `srcSet`, and the
 * frame (the caller's CSS) decides the crop. The public media route already serves sized WebP, so the image is a plain `img`.
 * When the picture cannot be loaded (the file is gone, the network dropped) the frame shows the same neutral placeholder as a
 * product that never had a picture, never the browser's broken-image icon.
 */
export function ProductImage({
  image,
  sizes,
  priority = false,
  placeholderSize = 40,
}: {
  image: PublicSlideImage;
  sizes: string;
  priority?: boolean;
  /** Size of the placeholder icon (the card's 40, the large gallery's 48). */
  placeholderSize?: number;
}) {
  const first = image.sources[0];
  const { failed, ref, onError } = useImageFailure(first?.url);
  if (!first) return null;
  if (failed) return <Icon name="droplet" size={placeholderSize} aria-hidden="true" />;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions
    <img
      ref={ref}
      onError={onError}
      src={first.url}
      srcSet={image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')}
      sizes={sizes}
      width={image.width}
      height={image.height}
      alt={image.alt}
      loading={priority ? 'eager' : 'lazy'}
      {...(priority ? { fetchPriority: 'high' as const } : {})}
      decoding="async"
    />
  );
}

import type { PublicSlideImage } from '@lucy-spa/contracts';

/**
 * One picture of the public catalog: the narrowest rendition is the fallback `src`, all renditions are the `srcSet`, and the
 * frame (the caller's CSS) decides the crop. The public media route already serves sized WebP, so the image is a plain `img`.
 */
export function ProductImage({
  image,
  sizes,
  priority = false,
}: {
  image: PublicSlideImage;
  sizes: string;
  priority?: boolean;
}) {
  const first = image.sources[0];
  if (!first) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions
    <img
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

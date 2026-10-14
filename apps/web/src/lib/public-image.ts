import type { PublicSlideImage } from '@lucy-spa/contracts';

/**
 * The attributes that draw one public picture inside a kit `ImageFrame` (or a plain `img`): the narrowest rendition is the fallback `src`,
 * every rendition is in the `srcSet`, and the size hints let the browser take the smallest that fits. `src: null` (no picture chosen)
 * makes the frame draw its flat placeholder. The caller decides `alt`: a card whose name sits beside the picture passes `''`.
 */
export function frameImage(
  image: PublicSlideImage | null | undefined,
  sizes: string,
): { src: null } | { src: string; srcSet: string; sizes: string; width: number; height: number } {
  const first = image?.sources[0];
  if (!image || !first) return { src: null };
  return {
    src: first.url,
    srcSet: image.sources.map((source) => `${source.url} ${source.width}w`).join(', '),
    sizes,
    width: image.width,
    height: image.height,
  };
}

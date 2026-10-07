'use client';

import { useCallback, useState, type ImgHTMLAttributes, type ReactNode } from 'react';

/**
 * Whether the picture at `src` failed to load, so a neutral placeholder can take its place instead of the browser's broken-image
 * icon. It listens to `error` and also checks a picture that had already failed before React took over the page (a server-drawn
 * page whose image answered 404 before hydration never fires the event again). A new `src` starts fresh.
 */
export function useImageFailure(src: string | null | undefined) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = src != null && failedSrc === src;
  const ref = useCallback(
    (image: HTMLImageElement | null) => {
      if (image && src != null && image.complete && image.naturalWidth === 0) setFailedSrc(src);
    },
    [src],
  );
  const onError = useCallback(() => {
    if (src != null) setFailedSrc(src);
  }, [src]);
  return { failed, ref, onError };
}

/**
 * A decorative picture that is replaced by `fallback` when it cannot be loaded. The caller's frame (its size, background and
 * centring) is unchanged, so a broken picture looks exactly like one that was never set.
 */
export function FallbackImage({
  src,
  fallback,
  alt = '',
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'onError' | 'ref'> & {
  src: string;
  fallback: ReactNode;
}) {
  const { failed, ref, onError } = useImageFailure(src);
  if (failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element -- this package cannot use next/image
  return <img ref={ref} src={src} alt={alt} onError={onError} {...rest} />;
}

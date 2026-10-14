'use client';

import type { ImgHTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';
import { Icon } from './icons';
import { FallbackImage } from './image-fallback';

export type ImageFrameRatio = '1/1' | '4/5' | '4/3' | '3/2' | '16/9';

/**
 * A picture in its frame (DESIGN.md 8.9): 18 px radius, `object-fit: cover`, a fixed ratio so nothing shifts while it loads, and a
 * flat placeholder when there is no picture or it cannot be loaded (never a broken-image icon). `alt` is required: pass `''` only
 * for a picture that repeats the text beside it. A placeholder that stands for a missing photo is announced with the same `alt`.
 */
export function ImageFrame({
  src,
  alt,
  ratio = '4/3',
  placeholder,
  className,
  ...rest
}: Omit<ImgHTMLAttributes<HTMLImageElement>, 'src' | 'alt' | 'className'> & {
  src: string | null | undefined;
  alt: string;
  ratio?: ImageFrameRatio | undefined;
  /** What stands in for a missing picture: an icon or the wordmark. Defaults to the picture icon. */
  placeholder?: ReactNode | undefined;
  className?: string | undefined;
}) {
  const fallback = (
    <span
      className="ls-image-frame-fallback"
      {...(alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
    >
      {placeholder ?? <Icon name="image" size={24} />}
    </span>
  );
  return (
    <span className={cx('ls-image-frame', className)} data-ratio={ratio}>
      {src ? <FallbackImage {...rest} src={src} alt={alt} fallback={fallback} /> : fallback}
    </span>
  );
}

'use client';

import type { PublicSlideImage } from '@lucy-spa/contracts';
import { Icon } from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { ProductImage } from './product-image';

/**
 * The pictures of a product: one frame you can swipe (or scroll with the arrow keys once it has focus) and a row of small
 * pictures that jump to one. A product with no picture shows a quiet placeholder, never a made-up photo. With one picture
 * there is no row.
 */
export function ProductGallery({
  images,
  label,
  thumbLabel,
}: {
  images: readonly PublicSlideImage[];
  /** The frame's accessible name, e.g. "Ảnh sản phẩm". */
  label: string;
  /** With {n}: the name of the thumbnail that shows picture n. */
  thumbLabel: string;
}) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [current, setCurrent] = useState(0);

  const show = (index: number) => {
    const element = viewport.current;
    if (!element) return;
    element.scrollTo({ left: index * element.clientWidth, behavior: 'smooth' });
    setCurrent(index);
  };

  return (
    <div className="ls-prod-gallery">
      <div
        ref={viewport}
        className="ls-prod-viewport"
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={images.length > 1 ? 0 : -1}
        onScroll={(event) => {
          const element = event.currentTarget;
          const index = Math.round(element.scrollLeft / Math.max(1, element.clientWidth));
          if (index !== current) setCurrent(index);
        }}
      >
        {images.length === 0 ? (
          <div className="ls-prod-slide" aria-hidden="true">
            <Icon name="droplet" size={48} />
          </div>
        ) : (
          images.map((image, index) => (
            <figure key={image.sources[0]?.url ?? index} className="ls-prod-slide">
              <ProductImage
                image={image}
                sizes="(min-width: 1024px) 50vw, 100vw"
                priority={index === 0}
              />
            </figure>
          ))
        )}
      </div>
      {images.length > 1 ? (
        <div className="ls-prod-thumbs">
          {images.map((image, index) => (
            <button
              key={image.sources[0]?.url ?? index}
              type="button"
              className="ls-prod-thumb"
              aria-label={thumbLabel.replace('{n}', String(index + 1))}
              aria-current={index === current ? 'true' : undefined}
              onClick={() => show(index)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions */}
              <img src={image.sources[0]?.url} alt="" width={image.width} height={image.height} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

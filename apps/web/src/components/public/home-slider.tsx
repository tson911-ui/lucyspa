'use client';

import type { PublicSlide } from '@lucy-spa/contracts';
import { Slider, type PromoLink, type SliderLabels } from '@lucy-spa/ui';
import Link from 'next/link';
import { useMemo, type ReactNode } from 'react';
import { getDictionary } from '../../i18n/dictionaries';
import type { Locale } from '../../i18n/locales';
import { sliderSlidesOf } from '../../lib/slider-core';

const RouterLink: PromoLink = ({ href, className, onClick, children }) => (
  <Link href={href} {...(className ? { className } : {})} {...(onClick ? { onClick } : {})}>
    {children}
  </Link>
);

/**
 * The homepage slider (design 16.6), mounted by the public home page only. The page reads the slides that are
 * visible now on the server (anonymous, cached 60 s) and hands them over, so the hero is complete in the first
 * paint and nothing moves when it arrives. With no slide it draws the fallback (nothing by default).
 */
export function HomeSlider({
  locale,
  slides,
  fallback = null,
  className,
}: {
  locale: Locale;
  slides: readonly PublicSlide[];
  /** Drawn when there is no slide to show. */
  fallback?: ReactNode;
  /** A frame class of the page (the full-bleed hero fills its stage with the slider). */
  className?: string;
}) {
  const text = getDictionary(locale);
  const items = useMemo(() => sliderSlidesOf([...slides]), [slides]);
  const labels: SliderLabels = {
    region: text.sliderLabel,
    previous: text.sliderPrevious,
    next: text.sliderNext,
    pause: text.sliderPause,
    play: text.sliderPlay,
    slide: text.sliderSlide,
    goTo: text.sliderGoTo,
  };
  if (items.length === 0) return fallback;
  return (
    <Slider
      slides={items}
      labels={labels}
      LinkComponent={RouterLink}
      {...(className ? { className } : {})}
    />
  );
}

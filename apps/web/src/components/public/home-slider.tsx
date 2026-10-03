'use client';

import type { PublicSlide } from '@lucy-spa/contracts';
import { Slider, type PromoLink, type SliderLabels } from '@lucy-spa/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { getDictionary } from '../../i18n/dictionaries';
import type { Locale } from '../../i18n/locales';
import { loadPublicSlides, sliderSlidesOf } from '../../lib/slider-core';

const RouterLink: PromoLink = ({ href, className, onClick, children }) => (
  <Link href={href} {...(className ? { className } : {})} {...(onClick ? { onClick } : {})}>
    {children}
  </Link>
);

/**
 * The homepage slider (design 16.6), mounted by the public home page only. It asks the API for the slides
 * that are visible now after the page has painted and draws the fallback (nothing by default) when there are none. The request is anonymous (no cookie) and any failure means "no slides".
 */
export function HomeSlider({
  locale,
  fallback = null,
}: {
  locale: Locale;
  /** Drawn while there is no slide to show (and before the slides arrive). */
  fallback?: ReactNode;
}) {
  const [slides, setSlides] = useState<PublicSlide[]>([]);
  const text = getDictionary(locale);

  useEffect(() => {
    let cancelled = false;
    // After first paint: the page's own content never waits for the slider.
    const timer = window.setTimeout(() => {
      void loadPublicSlides((url, init) => fetch(url, init), locale).then((found) => {
        if (!cancelled) setSlides(found);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [locale]);

  const items = useMemo(() => sliderSlidesOf(slides), [slides]);
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
  return <Slider slides={items} labels={labels} LinkComponent={RouterLink} />;
}

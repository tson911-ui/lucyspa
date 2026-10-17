'use client';

import type { PublicSlide } from '@lucy-spa/contracts';
import { Slider, type PromoLink, type SliderLabels } from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { useMemo, type ReactNode } from 'react';
import { getDictionary } from '../../i18n/dictionaries';
import type { Locale } from '../../i18n/locales';
import { sliderSlidesOf } from '../../lib/slider-core';

const RouterLink: PromoLink = ({ href, className, onClick, children }) => (
  <Link
    href={href}
    transitionTypes={NAV_TRANSITION}
    {...(className ? { className } : {})}
    {...(onClick ? { onClick } : {})}
  >
    {children}
  </Link>
);

/** The service list itself (any language prefix or none, with or without a trailing slash), not a group or a service page. */
export function isServiceList(href: string, locale: Locale): boolean {
  const path = href.replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  return path === '/services' || path === `/${locale}/services`;
}

/**
 * The homepage slider (design 16.6), mounted by the public home page only. The page reads the slides that are
 * visible now on the server (anonymous, cached 60 s) and hands them over, so the hero is complete in the first
 * paint and nothing moves when it arrives. With no slide it draws the fallback (nothing by default).
 */
export function HomeSlider({
  locale,
  slides,
  fallback = null,
}: {
  locale: Locale;
  slides: readonly PublicSlide[];
  /** Drawn when there is no slide to show. */
  fallback?: ReactNode;
}) {
  const text = getDictionary(locale);
  // The slider sits in the price-list band, whose own link already opens the service list: a slide button to that same list would be a
  // second "Xem dịch vụ" in one band (brief B4), so only that one button is left out. The slide and its words stay as the Owner set them.
  const items = useMemo(
    () =>
      sliderSlidesOf([...slides]).map((slide) =>
        slide.cta && isServiceList(slide.cta.href, locale) ? { ...slide, cta: null } : slide,
      ),
    [slides, locale],
  );
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
    <Slider slides={items} labels={labels} LinkComponent={RouterLink} ctaVariant="secondary" />
  );
}

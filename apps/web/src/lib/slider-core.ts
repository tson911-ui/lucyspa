import type { PublicSlide } from '@lucy-spa/contracts';
import type { PromoImage, SliderSlide } from '@lucy-spa/ui';
import type { Locale } from '../i18n/locales';
import { asPublicImage, validPopupUrl, type PopupFetchResponse } from './popup-core';

/**
 * The homepage slider rules both sides share (docs/UXUI_REDESIGN_DESIGN.md 16.6): the limits, the link rule
 * (the popup's) and what the public site does with the API's answer. Nothing here knows about the workforce
 * app.
 */

export const SLIDE_LIMITS = Object.freeze({
  title: 120,
  subtitle: 200,
  linkLabel: 40,
  linkUrl: 500,
  alt: 300,
});

/** Q-CM7: at most this many slides are visible at once. */
export const MAX_VISIBLE_SLIDES = 8;

/** The same link rule as the server and the database. */
export const validSlideUrl = validPopupUrl;

/** The public slides request: anonymous, no cookie, cached for a minute by the API. */
export const publicSlidesUrl = (locale: Locale) => `/api/v1/public/website/slides?locale=${locale}`;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** Narrow an untrusted JSON body to the slides the page may show; anything else is "no slides". */
export function asPublicSlides(value: unknown): PublicSlide[] {
  if (typeof value !== 'object' || value === null) return [];
  const items = (value as { items?: unknown }).items;
  if (!Array.isArray(items)) return [];
  const slides: PublicSlide[] = [];
  for (const raw of items as unknown[]) {
    if (typeof raw !== 'object' || raw === null) continue;
    const v = raw as Record<string, unknown>;
    const id = text(v['id']);
    const image = asPublicImage(v['image']);
    // A slide is its picture: without one there is nothing to show.
    if (id === null || image === null) continue;
    const linkUrl = text(v['linkUrl']);
    const linkLabel = text(v['linkLabel']);
    const link = linkUrl !== null && linkLabel !== null && validSlideUrl(linkUrl);
    slides.push({
      id,
      title: text(v['title']),
      subtitle: text(v['subtitle']),
      linkLabel: link ? linkLabel : null,
      linkUrl: link ? linkUrl : null,
      image,
      mobileImage: asPublicImage(v['mobileImage']),
    });
    if (slides.length === MAX_VISIBLE_SLIDES) break;
  }
  return slides;
}

type PublicImage = PublicSlide['image'];

/** One picture with its renditions as a `srcset` (the slider is as wide as the page). */
function imageOf(image: PublicImage, alt: string): PromoImage {
  const first = image.sources[0];
  const many = image.sources.length > 1;
  return {
    src: first?.url ?? '',
    srcSet: many
      ? image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')
      : undefined,
    sizes: many ? '100vw' : undefined,
    alt,
    width: image.width,
    height: image.height,
  };
}

/** What the kit slider draws for the API's slides. The phone picture shares the slide's description. */
export function sliderSlidesOf(slides: readonly PublicSlide[]): SliderSlide[] {
  return slides.map((slide) => ({
    id: slide.id,
    title: slide.title,
    subtitle: slide.subtitle,
    image: imageOf(slide.image, slide.image.alt),
    mobileImage: slide.mobileImage ? imageOf(slide.mobileImage, slide.image.alt) : null,
    cta:
      slide.linkLabel !== null && slide.linkUrl !== null
        ? { label: slide.linkLabel, href: slide.linkUrl }
        : null,
  }));
}

/**
 * What the foot of a full-bleed hero must make room for: a slide's caption (title, text or link; the controls come
 * with it when there are several slides), only the controls, or nothing (one plain picture).
 */
export function heroFoot(slides: readonly PublicSlide[]): 'caption' | 'controls' | 'none' {
  const captioned = slides.some(
    (slide) =>
      slide.title || slide.subtitle || (slide.linkLabel !== null && slide.linkUrl !== null),
  );
  if (captioned) return 'caption';
  return slides.length > 1 ? 'controls' : 'none';
}

/** The slides to show now; none on any failure (the page itself is never blocked or changed). */
export async function loadPublicSlides(
  fetcher: (
    url: string,
    init: { credentials: 'omit'; headers: Record<string, string> },
  ) => Promise<PopupFetchResponse>,
  locale: Locale,
): Promise<PublicSlide[]> {
  try {
    const response = await fetcher(publicSlidesUrl(locale), {
      credentials: 'omit',
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return [];
    return asPublicSlides(await response.json());
  } catch {
    return [];
  }
}

import type { PublicProductBrand, PublicSlideImage } from '@lucy-spa/contracts';
import { MotionPause } from '@lucy-spa/ui';
import Link from 'next/link';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import type { CSSProperties } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';

/** A logo set is repeated until it holds at least this many logos, so one loop of the track is always wider than the screen. */
const MIN_LOGOS = 10;
/** Seconds the track needs per logo: a slow, constant speed whatever the number of brands. */
const SECONDS_PER_LOGO = 6;

type BandBrand = PublicProductBrand & { logo: PublicSlideImage };

/** The logos of one loop: the list repeated until it holds the minimum. */
export function loopOf<T>(brands: readonly T[]): T[] {
  if (brands.length === 0) return [];
  const repeats = Math.max(1, Math.ceil(MIN_LOGOS / brands.length));
  return Array.from({ length: repeats }, () => brands).flat();
}

function LogoSet({
  locale,
  loop,
  unique,
  hidden,
}: {
  locale: Locale;
  loop: readonly BandBrand[];
  /** How many logos at the start of `loop` are the real list; the rest only fill the loop. */
  unique: number;
  /** The second copy of the track: it only makes the loop seamless, so it is out of the reading order and the tab order. */
  hidden: boolean;
}) {
  const text = getSiteText(locale);
  return (
    <ul className="ls-brand-set" aria-hidden={hidden || undefined} inert={hidden || undefined}>
      {loop.map((brand, index) => {
        const source = brand.logo.sources[brand.logo.sources.length - 1];
        const filler = hidden || index >= unique;
        return (
          <li
            key={`${brand.code}-${index}`}
            className="ls-brand-item"
            aria-hidden={filler || undefined}
            inert={filler || undefined}
          >
            <Link
              className="ls-brand-link"
              href={`/${locale}/products?brand=${encodeURIComponent(brand.code)}`}
              aria-label={text.home.brandLink.replace('{name}', brand.name)}
              transitionTypes={NAV_TRANSITION}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized renditions with their alpha channel */}
              <img
                className="ls-brand-logo"
                src={source?.url ?? ''}
                width={brand.logo.width}
                height={brand.logo.height}
                alt={filler ? '' : brand.logo.alt}
                decoding="async"
                // The copy that only closes the loop starts off screen: it may wait.
                loading={filler ? 'lazy' : undefined}
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The brand band under the home hero (R16, DESIGN.md 17.2): a light band of the logos of the cosmetics brands the shop sells, drawn in ink at
 * one height, evenly spaced, no boxes, each linking to that brand's product list. Server markup and CSS only (no script): the track moves
 * slowly and endlessly (a continuous marquee, one of the page's allowed motions), pauses while the pointer is over it, a link has focus or a
 * finger is down, has a pause checkbox, and under reduced motion, data saver or the off switch it is a still, wrapped row of the first set.
 * The band takes its place in the home page's alternation (`tone`). Nothing is drawn when no brand is switched on.
 */
export function BrandBand({
  locale,
  brands,
  tone = 'base',
}: {
  locale: Locale;
  brands: readonly BandBrand[];
  tone?: 'base' | 'alt';
}) {
  if (brands.length === 0) return null;
  const text = getSiteText(locale);
  const loop = loopOf(brands);
  return (
    <section
      className={`ls-brand-band ls-band--${tone}`}
      aria-label={text.home.brandBandLabel}
      style={{ '--ls-brand-seconds': loop.length * SECONDS_PER_LOGO } as CSSProperties}
    >
      <div className="ls-brand-view">
        <div className="ls-brand-track">
          <LogoSet locale={locale} loop={loop} unique={brands.length} hidden={false} />
          <LogoSet locale={locale} loop={loop} unique={brands.length} hidden />
        </div>
      </div>
      {/* The pause control for moving content (WCAG 2.2.2): a checkbox drawn as a round button, no script; checked = paused. */}
      <MotionPause label={text.home.brandPause} />
    </section>
  );
}

import type { PublicProductBrand, PublicSlideImage } from '@lucy-spa/contracts';
import Link from 'next/link';
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
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized renditions with their alpha channel */}
              <img
                className="ls-brand-logo"
                src={source?.url ?? ''}
                width={brand.logo.width}
                height={brand.logo.height}
                alt={filler ? '' : brand.logo.alt}
                loading="lazy"
                decoding="async"
              />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The brand band under the home hero (session 9, DESIGN.md 9.1): the logos of the cosmetics brands the shop sells, white on the burgundy
 * solid, one uniform height, each linking to that brand's product list. Server markup and CSS only (no script): the track moves slowly
 * and endlessly, pauses on hover, focus and touch, and under reduced motion or the off switch it is a still, wrapped row of the first set.
 * Nothing is drawn when no brand is switched on.
 */
export function BrandBand({ locale, brands }: { locale: Locale; brands: readonly BandBrand[] }) {
  if (brands.length === 0) return null;
  const text = getSiteText(locale);
  const loop = loopOf(brands);
  return (
    <section
      className="ls-brand-band"
      aria-label={text.home.brandBandLabel}
      style={{ '--ls-brand-seconds': loop.length * SECONDS_PER_LOGO } as CSSProperties}
    >
      <div className="ls-brand-track">
        <LogoSet locale={locale} loop={loop} unique={brands.length} hidden={false} />
        <LogoSet locale={locale} loop={loop} unique={brands.length} hidden />
      </div>
    </section>
  );
}

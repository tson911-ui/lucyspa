import { Band, buttonClass, Icon, PublicMain, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  homeFeaturedProducts,
  homeGroups,
  homeProductCategories,
  serviceGroupHref,
  topServiceColumns,
  type HomeData,
} from '../../lib/public-site-core';
import { HomeOffer } from './campaign-views';
import {
  categoryItems,
  CategoryGrid,
  FactsStrip,
  HomeProductCard,
  LoadNotice,
  TopServices,
  WhyCards,
} from './home-sections';
import { HomeSlider } from './home-slider';
import { PhotoSlot } from './photo-slot';
import { PromoPopup } from './promo-popup';
import { ScrollRow } from './scroll-row';

/**
 * The public home page's content (DESIGN.md 9.1; the order is fixed): hero, trust band, split intro and top services, the product row,
 * the category grid, then the Owner's optional "why choose us" cards and the running offer. It only draws what it is given: the page
 * reads the shop profile, the catalogue and the slides on the server, and the admin's season preview reads them in the browser.
 * A part that could not be read shows a notice (or is left out) and the rest still renders. There is no reviews band (Q5: reviews are
 * private until the Owner decides to publish them). The preview leaves the promotional popup out (it is not part of a season's look
 * and would cover the page). Bands alternate the base and the alternate color from the hero down, whichever bands are present.
 */
export function HomeContent({
  locale,
  data,
  popup = true,
}: {
  locale: Locale;
  data: HomeData;
  popup?: boolean;
}) {
  const text = getSiteText(locale);
  const { site, services, slides, campaigns, onlineOpen, products } = data;
  const heroImage = site?.heroImage ?? null;
  const heroWidest = heroImage?.sources[heroImage.sources.length - 1];

  // The hero is the alternate color (or a photo); each band after it takes the other color.
  let position = 1;
  const nextTone = (): 'base' | 'alt' => (position++ % 2 === 0 ? 'alt' : 'base');

  const groups = services && services.groups.length > 0 ? homeGroups(services, site) : [];
  const columns = topServiceColumns(groups);
  const featured = homeFeaturedProducts(products);
  const productCategories = homeProductCategories(products);

  return (
    <PublicMain>
      <section
        className="ls-home-hero ls-band--alt"
        data-media={heroImage && heroWidest ? 'photo' : 'flat'}
        aria-labelledby="home-title"
      >
        {heroImage && heroWidest ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions */}
            <img
              className="ls-home-hero-img"
              src={heroWidest.url}
              srcSet={heroImage.sources
                .map((source) => `${source.url} ${source.width}w`)
                .join(', ')}
              sizes="100vw"
              width={heroImage.width}
              height={heroImage.height}
              alt={heroImage.alt}
              fetchPriority="high"
              decoding="async"
            />
            <span className="ls-home-hero-scrim" aria-hidden="true" />
          </>
        ) : (
          <span className="ls-home-hero-caption" aria-hidden="true">
            {text.home.photoSpace}
          </span>
        )}
        <div className="ls-container ls-home-hero-copy">
          <h1 className="ls-site-display ls-hero-title" id="home-title">
            {site?.tagline ?? 'Lucy Spa'}
          </h1>
          <p className="ls-lead">{site?.intro ?? text.home.lead}</p>
          <div className="ls-hero-actions">
            <Link
              className={buttonClass('primary', 'lg')}
              href={`/${locale}/account/book`}
              prefetch
            >
              {text.home.bookNow}
            </Link>
            <Link
              className={buttonClass('secondary', 'lg', 'ls-btn-on-photo')}
              href={`/${locale}/services`}
              prefetch
            >
              {text.home.viewServices}
            </Link>
          </div>
        </div>
      </section>

      {site && site.facts.length > 0 ? (
        <Band
          tone="page"
          label={text.home.factsLabel}
          className={`ls-band--${nextTone()} ls-band-facts`}
        >
          <FactsStrip locale={locale} site={site} />
        </Band>
      ) : null}

      <Band tone="page" labelledBy="intro-title" className={`ls-band--${nextTone()}`}>
        <div className="ls-home-split">
          <Reveal>
            <div className="ls-home-split-copy">
              <h2 className="ls-site-h2" id="intro-title">
                {text.home.groupsTitle}
              </h2>
              <p>{text.home.groupsLead}</p>
              <div className="ls-hero-actions">
                <Link className={buttonClass('secondary')} href={`/${locale}/account/book`}>
                  {text.home.bookNow}
                </Link>
                <Link className="ls-site-link" href={`/${locale}/services`}>
                  {text.home.viewAllServices}
                  <Icon name="chevron-right" size={16} aria-hidden="true" />
                </Link>
              </div>
            </div>
          </Reveal>
          {slides.length > 0 ? (
            <div className="ls-home-split-media" data-kind="slider">
              <HomeSlider locale={locale} slides={slides} />
            </div>
          ) : (
            <div className="ls-home-split-media" data-kind="slot">
              <PhotoSlot className="ls-home-split-slot" caption={text.home.photoIntro} />
            </div>
          )}
        </div>
        {services === null ? (
          <LoadNotice locale={locale} section={text.home.sectionServices} />
        ) : columns.length === 0 ? (
          <p className="ls-home-empty">{text.home.noServices}</p>
        ) : (
          <TopServices locale={locale} columns={columns} />
        )}
      </Band>

      {featured.length > 0 ? (
        <Band tone="page" labelledBy="products-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <div className="ls-home-band-head">
              <h2 className="ls-site-h2" id="products-title">
                {text.home.productsTitle}
              </h2>
              <Link className="ls-site-link" href={`/${locale}/products`}>
                {text.home.viewAllProducts}
                <Icon name="chevron-right" size={16} aria-hidden="true" />
              </Link>
            </div>
          </Reveal>
          <ScrollRow
            label={text.home.productsTitle}
            previous={text.home.rowPrevious}
            next={text.home.rowNext}
          >
            {featured.map((card, index) => (
              <HomeProductCard key={card.code} locale={locale} card={card} priority={index < 2} />
            ))}
          </ScrollRow>
        </Band>
      ) : null}

      {groups.length > 0 || productCategories.length > 0 ? (
        <Band tone="page" labelledBy="categories-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <div className="ls-home-band-head">
              <div className="ls-home-band-title">
                <h2 className="ls-site-h2" id="categories-title">
                  {text.home.categoriesTitle}
                </h2>
                <p>{text.home.categoriesLead}</p>
              </div>
            </div>
          </Reveal>
          {groups.length > 0 ? (
            <CategoryGrid
              title={text.home.categoryServices}
              items={groups.map(({ group }) => ({
                key: group.code,
                name: group.name,
                href: serviceGroupHref(locale, group.code),
              }))}
            />
          ) : null}
          {productCategories.length > 0 ? (
            <CategoryGrid
              title={text.home.categoryProducts}
              items={categoryItems(locale, productCategories)}
            />
          ) : null}
        </Band>
      ) : null}

      {site?.why ? (
        <Band tone="page" labelledBy="why-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <div className="ls-home-band-head">
              <h2 className="ls-site-h2" id="why-title">
                {site.why.title}
              </h2>
            </div>
          </Reveal>
          <WhyCards why={site.why} />
        </Band>
      ) : null}

      <HomeOffer
        locale={locale}
        campaigns={campaigns}
        onlineOpen={onlineOpen === true}
        tone={nextTone()}
      />
      {popup ? <PromoPopup locale={locale} /> : null}
    </PublicMain>
  );
}

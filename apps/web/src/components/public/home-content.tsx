import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { Band, buttonClass, PublicMain, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { homeGroups, type HomeData } from '../../lib/public-site-core';
import { HomeOffer } from './campaign-views';
import { FactsStrip, LoadNotice, ServiceGroups, WhyCards } from './home-sections';
import { HomeSlider } from './home-slider';
import { PromoPopup } from './promo-popup';

/** The hero picture the Owner chose in Shop info (same frame as the slider, so nothing moves). */
function HeroImage({ image }: { image: NonNullable<PublicSiteResponse['heroImage']> }) {
  const widest = image.sources[image.sources.length - 1];
  if (!widest) return null;
  return (
    <div className="ls-photo">
      {/* eslint-disable-next-line @next/next/no-img-element -- the media route already serves sized WebP renditions */}
      <img
        className="ls-hero-image"
        src={widest.url}
        srcSet={image.sources.map((source) => `${source.url} ${source.width}w`).join(', ')}
        sizes="(min-width: 1024px) 50vw, 100vw"
        width={image.width}
        height={image.height}
        alt={image.alt}
        fetchPriority="high"
        decoding="async"
      />
    </div>
  );
}

/** A brand panel when there is neither a slide nor a chosen picture: never a made-up photo. */
function BrandPanel() {
  return (
    <div className="ls-brand-panel" aria-hidden="true">
      <span className="ls-brand-panel-mark">Lucy Spa</span>
    </div>
  );
}

/**
 * The public home page's content (Part 2 contract 5.2). It only draws what it is given: the page reads the shop
 * profile, the catalogue and the slides on the server, and the admin's season preview reads them in the browser.
 * A part that could not be read shows a notice and the rest still renders. The preview leaves the promotional popup
 * out (it is not part of a season's look and would cover the page).
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
  const { site, services, slides, campaigns } = data;
  const media =
    slides.length > 0 ? null : site?.heroImage ? (
      <HeroImage image={site.heroImage} />
    ) : (
      <BrandPanel />
    );
  return (
    <PublicMain>
      <Band tone="page" labelledBy="home-title" className="ls-hero">
        <HomeOffer locale={locale} campaigns={campaigns} />
        <div className="ls-hero-grid">
          <div className="ls-hero-copy">
            <h1 className="ls-site-display" id="home-title">
              {site?.tagline ?? 'Lucy Spa'}
            </h1>
            <p className="ls-lead">{site?.intro ?? text.home.lead}</p>
            <div className="ls-hero-actions">
              <Link
                className={buttonClass('primary', 'lg', 'ls-btn-sheen')}
                href={`/${locale}/account/book`}
                prefetch
              >
                {text.home.bookNow}
              </Link>
              <Link
                className={buttonClass('secondary', 'lg')}
                href={`/${locale}/services`}
                prefetch
              >
                {text.home.viewServices}
              </Link>
            </div>
          </div>
          {slides.length > 0 ? <HomeSlider locale={locale} slides={slides} /> : media}
        </div>
      </Band>

      {site && site.facts.length > 0 ? (
        <Band tone="page" label={text.home.factsLabel} className="ls-band-flush ls-band-facts">
          <FactsStrip locale={locale} site={site} />
        </Band>
      ) : null}

      <Band tone="surface" labelledBy="groups-title">
        <Reveal>
          <div className="ls-section-head">
            <h2 className="ls-site-h2" id="groups-title">
              {text.home.groupsTitle}
            </h2>
            <p>{text.home.groupsLead}</p>
          </div>
        </Reveal>
        {services === null ? (
          <LoadNotice locale={locale} section={text.home.sectionServices} />
        ) : services.groups.length === 0 ? (
          <p className="ls-group-count">{text.home.noServices}</p>
        ) : (
          <ServiceGroups locale={locale} groups={homeGroups(services, site)} />
        )}
      </Band>

      {site?.why ? (
        <Band tone="page" labelledBy="why-title">
          <Reveal>
            <div className="ls-section-head">
              <h2 className="ls-site-h2" id="why-title">
                {site.why.title}
              </h2>
            </div>
          </Reveal>
          <WhyCards why={site.why} />
        </Band>
      ) : null}
      {popup ? <PromoPopup locale={locale} /> : null}
    </PublicMain>
  );
}

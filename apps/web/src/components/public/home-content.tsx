import type { PublicSiteResponse } from '@lucy-spa/contracts';
import { Band, buttonClass, PublicMain, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { homeGroups, type HomeData } from '../../lib/public-site-core';
import { splitTagline } from '../../lib/tagline';
import { HomeOffer } from './campaign-views';
import { FactsStrip, LoadNotice, ServiceGroups, WhyCards } from './home-sections';
import { HomeSlider } from './home-slider';
import { PhotoSlot } from './photo-slot';
import { PromoPopup } from './promo-popup';

/**
 * The picture of the hero (direction C): the Owner's slider when there are slides, else the hero picture chosen in Admin > Website >
 * Shop info as one large circle, else a set of designed photo placeholders (a circle, a small circle and a tall pill) waiting for the
 * shop's own photos. Never a made-up photo. A ring behind it breathes very slowly (still under reduced motion).
 */
function HeroMedia({
  locale,
  site,
  slides,
}: {
  locale: Locale;
  site: PublicSiteResponse | null;
  slides: Parameters<typeof HomeSlider>[0]['slides'];
}) {
  const text = getSiteText(locale).home;
  const image = site?.heroImage ?? null;
  if (slides.length > 0) {
    return (
      <div className="ls-hero-media" data-kind="slider">
        <span className="ls-hero-ring" aria-hidden="true" />
        <HomeSlider locale={locale} slides={slides} />
      </div>
    );
  }
  if (image) {
    return (
      <div className="ls-hero-media" data-kind="photo">
        <span className="ls-hero-ring" aria-hidden="true" />
        <PhotoSlot className="ls-hero-big" image={image} caption={text.photoSpace} />
      </div>
    );
  }
  return (
    <div className="ls-hero-media" data-kind="slots" aria-hidden="true">
      <span className="ls-hero-ring" />
      <PhotoSlot className="ls-hero-big" caption={text.photoSpace} />
      <PhotoSlot className="ls-hero-small" caption={text.photoNails} />
      <PhotoSlot className="ls-hero-pill" caption={text.photoHeadSpa} />
    </div>
  );
}

/**
 * The public home page's content (Part 2 contract 5.2, direction C since 2026-10-10). It only draws what it is given: the page reads
 * the shop profile, the catalogue and the slides on the server, and the admin's season preview reads them in the browser.
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
  const { site, services, slides, campaigns, onlineOpen } = data;
  const [first, second] = splitTagline(site?.tagline ?? 'Lucy Spa');
  return (
    <PublicMain>
      <Band tone="page" labelledBy="home-title" className="ls-hero">
        <div className="ls-hero-grid">
          <div className="ls-hero-copy">
            <h1 className="ls-site-display ls-hero-title" id="home-title">
              <span>{first}</span>
              {second ? <span className="ls-hero-title-2">{second}</span> : null}
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
          <HeroMedia locale={locale} site={site} slides={slides} />
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

      <HomeOffer locale={locale} campaigns={campaigns} onlineOpen={onlineOpen === true} />
      {popup ? <PromoPopup locale={locale} /> : null}
    </PublicMain>
  );
}

import type { PublicServiceDetailResponse, PublicServicesResponse } from '@lucy-spa/contracts';
import { Accordion, Band, buttonClass, EmptyState, Icon, PublicMain, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  bookServiceHref,
  serviceEstimate,
  servicePrice,
  cardPrice,
} from '../../lib/public-site-core';
import { PageBack } from '../navigation/page-back';
import { LoadNotice } from './home-sections';
import { PhotoSlot } from './photo-slot';
import { PublicBreadcrumbs } from './public-breadcrumbs';
import { ScrollRow } from './scroll-row';
import { ServiceBookBar } from './service-book-bar';
import { ServiceCard, ServicesList } from './services-list';
import { SharedPhoto } from './shared-photo';

/** The "← Back" button of the service pages: back to where the visitor came from, else the list (detail) or the home (list). */
function ServicesBack({ locale }: { locale: Locale }) {
  return (
    <PageBack
      root={`/${locale}/services`}
      publicHome={`/${locale}`}
      label={getSiteText(locale).services.backLabel}
    />
  );
}

/** The title band's content: the Back button, the page's one h1 and its sentence (DESIGN.md 9.2). */
function ServicesIntro({ locale }: { locale: Locale }) {
  const text = getSiteText(locale).services;
  return (
    <div className="ls-svc-intro">
      <ServicesBack locale={locale} />
      <h1 className="ls-h1-display" id="services-title">
        {text.title}
      </h1>
      <p className="ls-lead">{text.lead}</p>
    </div>
  );
}

/**
 * The service list (DESIGN.md 9.2): the title band with the search, the group chips (links, so it works without scripts and can be shared)
 * kept at the top while the page scrolls, then one band for each group, or just the chosen one. The page is the catalogue as the Owner keeps it.
 */
export function ServicesView({
  locale,
  data,
  group,
}: {
  locale: Locale;
  data: PublicServicesResponse | null;
  /** The chosen group code, or '' for all. */
  group: string;
}) {
  const text = getSiteText(locale);
  const base = `/${locale}/services`;
  if (data === null || data.groups.length === 0) {
    return (
      <PublicMain>
        <Band tone="page" labelledBy="services-title" className="ls-band--alt ls-svc-title">
          <ServicesIntro locale={locale} />
        </Band>
        <Band tone="page" className="ls-band--base">
          {data === null ? (
            <LoadNotice locale={locale} section={text.home.sectionServices} />
          ) : (
            <EmptyState icon="info">{text.services.empty}</EmptyState>
          )}
        </Band>
      </PublicMain>
    );
  }
  const shown = data.groups.filter((entry) => group === '' || entry.code === group);
  return (
    <PublicMain>
      <ServicesList
        locale={locale}
        groups={shown}
        intro={<ServicesIntro locale={locale} />}
        chips={
          <nav className="ls-pills" aria-label={text.services.groupsLabel}>
            <Link href={base} aria-current={group === '' ? 'true' : undefined}>
              {text.services.all}
            </Link>
            {data.groups.map((entry) => (
              <Link
                key={entry.code}
                href={`${base}?group=${encodeURIComponent(entry.code)}`}
                aria-current={group === entry.code ? 'true' : undefined}
              >
                {entry.name}
              </Link>
            ))}
          </nav>
        }
      />
    </PublicMain>
  );
}

/**
 * One service on its own page (DESIGN.md 9.2): a split hero with the photo (a flat placeholder) on the left and the name, time, price, the
 * Owner's description and the "Đặt lịch" primary on the right; then the optional bands the Owner fills in the service form (what is
 * included, the steps, the FAQ: each is drawn only when it has content), the other services of the group as a row, and a booking band. On
 * a phone a bar with the price and the button stays at the bottom while the page's own buttons are out of view.
 */
export function ServiceDetailView({
  locale,
  detail,
}: {
  locale: Locale;
  detail: PublicServiceDetailResponse | null;
}) {
  const text = getSiteText(locale);
  if (detail === null) {
    return (
      <PublicMain>
        <Band tone="page" className="ls-band--alt ls-svc-title">
          <ServicesBack locale={locale} />
        </Band>
        <Band tone="page" className="ls-band--base">
          <LoadNotice locale={locale} section={text.home.sectionServices} />
        </Band>
      </PublicMain>
    );
  }
  const { service, group, related, content } = detail;
  const book = bookServiceHref(locale, service.code);
  // The hero band is the alternate color; the bands after it alternate down the page.
  let tone: 'alt' | 'base' = 'alt';
  const nextTone = () => (tone = tone === 'alt' ? 'base' : 'alt');
  return (
    <PublicMain>
      <Band tone="page" labelledBy="service-title" className="ls-band--alt ls-svd-hero">
        <ServicesBack locale={locale} />
        <PublicBreadcrumbs
          label={text.services.breadcrumbs}
          items={[
            { label: text.services.title, href: `/${locale}/services` },
            {
              label: group.name,
              href: `/${locale}/services?group=${encodeURIComponent(group.code)}`,
            },
            { label: service.name },
          ]}
        />
        <div className="ls-svd-grid">
          <SharedPhoto name={`ls-photo-svc-${service.code}`}>
            <PhotoSlot
              className="ls-svd-slot"
              caption={text.services.photoService}
              image={service.image}
            />
          </SharedPhoto>
          <div className="ls-svd-copy">
            <h1 className="ls-h1-display" id="service-title">
              {service.name}
            </h1>
            <dl className="ls-svd-facts">
              <div>
                <dt>{text.services.estimate}</dt>
                <dd>{serviceEstimate(service, locale)}</dd>
              </div>
              <div>
                <dt>{text.services.price}</dt>
                <dd className="ls-svd-price">{servicePrice(service, locale)}</dd>
              </div>
            </dl>
            {service.description ? <p className="ls-svd-desc">{service.description}</p> : null}
            <p className="ls-svd-note">
              {service.pricingUnit === 'PER_NAIL'
                ? text.services.perNailNote
                : text.services.priceNote}
            </p>
            <div className="ls-hero-actions" data-book-cta="hero">
              <Link className={buttonClass('primary', 'lg')} href={book}>
                {text.services.book}
              </Link>
              <Link className={buttonClass('secondary', 'lg')} href={`/${locale}/services`}>
                {text.services.back}
              </Link>
            </div>
          </div>
        </div>
      </Band>
      {content.included.length > 0 ? (
        <Band tone="page" labelledBy="included-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <div className="ls-svd-block">
              <h2 className="ls-site-h2" id="included-title">
                {text.services.included}
              </h2>
              <ul className="ls-svd-list">
                {content.included.map((item, index) => (
                  <li key={index}>
                    <span className="ls-svd-check">
                      <Icon name="check" size={20} aria-hidden="true" />
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </Reveal>
        </Band>
      ) : null}
      {content.steps.length > 0 ? (
        <Band tone="page" labelledBy="steps-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <div className="ls-svd-block">
              <h2 className="ls-site-h2" id="steps-title">
                {text.services.steps}
              </h2>
              <ol className="ls-svd-steps">
                {content.steps.map((item, index) => (
                  <li key={index}>{item}</li>
                ))}
              </ol>
            </div>
          </Reveal>
        </Band>
      ) : null}
      {content.faq.length > 0 ? (
        <Band tone="page" labelledBy="faq-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <div className="ls-svd-block">
              <h2 className="ls-site-h2" id="faq-title">
                {text.services.faq}
              </h2>
              <Accordion
                headingLevel={3}
                items={content.faq.map((entry, index) => ({
                  id: `faq-${index}`,
                  title: entry.question,
                  content: <p className="ls-svd-answer">{entry.answer}</p>,
                }))}
              />
            </div>
          </Reveal>
        </Band>
      ) : null}
      {related.length > 0 ? (
        <Band tone="page" labelledBy="related-title" className={`ls-band--${nextTone()}`}>
          <Reveal>
            <h2 className="ls-site-h2" id="related-title">
              {text.services.related}
            </h2>
          </Reveal>
          <ScrollRow
            label={text.services.related}
            previous={text.home.rowPrevious}
            next={text.home.rowNext}
          >
            {related.map((entry) => (
              <ServiceCard
                key={entry.code}
                locale={locale}
                service={entry}
                className="ls-snap-item"
              />
            ))}
          </ScrollRow>
        </Band>
      ) : null}
      <Band tone="page" labelledBy="cta-title" className={`ls-band--${nextTone()} ls-svd-cta`}>
        <Reveal>
          <div className="ls-svd-cta-copy">
            <h2 className="ls-site-h2" id="cta-title">
              {text.services.ctaTitle}
            </h2>
            <p>{text.services.ctaLead}</p>
            <div className="ls-hero-actions" data-book-cta="band">
              <Link className={buttonClass('primary', 'lg')} href={book}>
                {text.services.book}
              </Link>
            </div>
          </div>
        </Reveal>
      </Band>
      <ServiceBookBar
        href={book}
        price={cardPrice(service, locale)}
        label={text.services.bookBar}
        action={text.services.book}
      />
    </PublicMain>
  );
}

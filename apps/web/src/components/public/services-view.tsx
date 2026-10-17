import type { PublicServiceDetailResponse, PublicServicesResponse } from '@lucy-spa/contracts';
import {
  Accordion,
  Band,
  buttonClass,
  EmptyState,
  Icon,
  PublicMain,
  VisuallyHidden,
} from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import {
  bookServiceHref,
  serviceEstimate,
  servicePrice,
  cardPrice,
} from '../../lib/public-site-core';
import { PageBack } from '../navigation/page-back';
import { LoadNotice } from './home-sections';
import { PhotoSlot } from './photo-slot';
import { ScrollRow } from './scroll-row';
import { ServiceBookBar } from './service-book-bar';
import { ServiceCard } from './service-card';
import { ServicesList, type ServiceListGroup } from './services-list';
import { SharedPhoto } from './shared-photo';

/**
 * The back chevron of a service page (C40, B7): icon only, named for its parent ("Quay lại Dịch vụ"); it renders nothing on the list,
 * which is a top-level destination.
 */
function ServicesBack({ locale }: { locale: Locale }) {
  return (
    <PageBack
      root={`/${locale}/services`}
      publicHome={`/${locale}`}
      label={getSiteText(locale).services.backLabel}
    />
  );
}

/** The title band's content: the page's one h1 and its sentence (DESIGN.md 9.2). The list has no Back (a top-level page). */
function ServicesIntro({ locale }: { locale: Locale }) {
  const text = getSiteText(locale).services;
  return (
    <div className="ls-svc-intro">
      <h1 className="ls-h1-display" id="services-title">
        {text.title}
      </h1>
      <p className="ls-lead">{text.lead}</p>
    </div>
  );
}

/**
 * The service list (DESIGN.md 9.2): the title band with the search, the group chips (links, so it works without scripts and can be shared;
 * the chosen one is the accent fill with a check) kept at the top while the page scrolls, then one band for each group, or just the chosen
 * one. The cards are drawn here, on the server; the client list only filters them by the search.
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
            <EmptyState
              icon="info"
              title={text.services.emptyTitle}
              action={
                <Link
                  className={buttonClass('secondary')}
                  href={`/${locale}/contact`}
                  transitionTypes={NAV_TRANSITION}
                >
                  {text.contactPage.title}
                </Link>
              }
            >
              {text.services.empty}
            </EmptyState>
          )}
        </Band>
      </PublicMain>
    );
  }
  const groups: ServiceListGroup[] = data.groups
    .filter((entry) => group === '' || entry.code === group)
    .map((entry) => ({
      code: entry.code,
      name: entry.name,
      items: entry.services.map((service) => ({
        code: service.code,
        text: `${service.name} ${service.description ?? ''}`,
        card: <ServiceCard locale={locale} service={service} sharePhoto />,
      })),
    }));
  const chip = (key: string, label: string, href: string, current: boolean) => (
    <Link key={key} href={href} aria-current={current ? 'true' : undefined}>
      {current ? <Icon name="check" size={16} aria-hidden="true" /> : null}
      {label}
    </Link>
  );
  return (
    <PublicMain>
      <ServicesList
        locale={locale}
        groups={groups}
        intro={<ServicesIntro locale={locale} />}
        chips={
          <nav className="ls-pills" aria-label={text.services.groupsLabel}>
            {chip('all', text.services.all, base, group === '')}
            {data.groups.map((entry) =>
              chip(
                entry.code,
                entry.name,
                `${base}?group=${encodeURIComponent(entry.code)}`,
                group === entry.code,
              ),
            )}
          </nav>
        }
      />
    </PublicMain>
  );
}

/**
 * One service on its own page (DESIGN.md 9.2): a split hero with the photo on the left (it arrives from the list card: the page's one
 * moment) and, on the right, the name, the price, the time, the Owner's description and the one "Đặt lịch" primary with a quiet link to all
 * services; then the optional bands the Owner fills in the service form (what is included, the steps, the FAQ: each is drawn only when it
 * has content), the other services of the group as a row (outline "Đặt lịch" on each card), and a booking band. On a phone a bar with the
 * price and the button stays at the bottom while the page's own buttons are out of view, so one filled button is on screen at a time.
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
        <Band tone="page" labelledBy="service-title" className="ls-band--alt ls-svd-hero">
          <ServicesBack locale={locale} />
          <h1 className="ls-h1-display" id="service-title">
            {text.services.title}
          </h1>
        </Band>
        <Band tone="page" className="ls-band--base">
          <LoadNotice locale={locale} section={text.home.sectionServices} />
        </Band>
      </PublicMain>
    );
  }
  const { service, related, content } = detail;
  const book = bookServiceHref(locale, service.code);
  // The hero band is the alternate color; the bands after it alternate down the page.
  let tone: 'alt' | 'base' = 'alt';
  const nextTone = () => (tone = tone === 'alt' ? 'base' : 'alt');
  return (
    <PublicMain>
      <Band tone="page" labelledBy="service-title" className="ls-band--alt ls-svd-hero">
        <ServicesBack locale={locale} />
        <div className="ls-svd-grid">
          <SharedPhoto name={`ls-photo-svc-${service.code}`}>
            <PhotoSlot className="ls-svd-slot" image={service.image} priority />
          </SharedPhoto>
          <div className="ls-svd-copy">
            <h1 className="ls-h1-display" id="service-title">
              {service.name}
            </h1>
            <p className="ls-svd-price">
              <VisuallyHidden>{text.services.price}: </VisuallyHidden>
              {servicePrice(service, locale)}
            </p>
            <p className="ls-svd-time">
              <Icon name="clock" size={20} aria-hidden="true" />
              <VisuallyHidden>{text.services.estimate}: </VisuallyHidden>
              {serviceEstimate(service, locale)}
            </p>
            {service.description ? <p className="ls-svd-desc">{service.description}</p> : null}
            <p className="ls-svd-note">
              {service.pricingUnit === 'PER_NAIL'
                ? text.services.perNailNote
                : text.services.priceNote}
            </p>
            <div className="ls-hero-actions" data-book-cta="hero">
              <Link
                className={buttonClass('primary', 'lg')}
                href={book}
                transitionTypes={NAV_TRANSITION}
              >
                {text.services.book}
              </Link>
              <Link
                className="ls-site-link"
                href={`/${locale}/services`}
                transitionTypes={NAV_TRANSITION}
              >
                {text.services.back}
                <Icon name="chevron-right" size={16} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </div>
      </Band>
      {content.included.length > 0 ? (
        <Band tone="page" labelledBy="included-title" className={`ls-band--${nextTone()}`}>
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
        </Band>
      ) : null}
      {content.steps.length > 0 ? (
        <Band tone="page" labelledBy="steps-title" className={`ls-band--${nextTone()}`}>
          <div className="ls-svd-block">
            <h2 className="ls-site-h2" id="steps-title">
              {text.services.steps}
            </h2>
            {/* A real sequence, so the steps are numbered (the numbers do work here). */}
            <ol className="ls-svd-steps">
              {content.steps.map((item, index) => (
                <li key={index}>{item}</li>
              ))}
            </ol>
          </div>
        </Band>
      ) : null}
      {content.faq.length > 0 ? (
        <Band tone="page" labelledBy="faq-title" className={`ls-band--${nextTone()}`}>
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
        </Band>
      ) : null}
      {related.length > 0 ? (
        <Band tone="page" labelledBy="related-title" className={`ls-band--${nextTone()}`}>
          <h2 className="ls-site-h2" id="related-title">
            {text.services.related}
          </h2>
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
        <div className="ls-svd-cta-copy">
          <h2 className="ls-site-h2" id="cta-title">
            {text.services.ctaTitle}
          </h2>
          <p>{text.services.ctaLead}</p>
          {/* The page's one filled button is the hero's (Owner answer 2: once per view; on a short page both are on screen). */}
          <div className="ls-hero-actions" data-book-cta="band">
            <Link
              className={buttonClass('secondary', 'lg')}
              href={book}
              transitionTypes={NAV_TRANSITION}
            >
              {text.services.book}
            </Link>
          </div>
        </div>
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

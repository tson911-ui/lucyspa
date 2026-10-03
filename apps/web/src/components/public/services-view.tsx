import type {
  PublicService,
  PublicServiceDetailResponse,
  PublicServicesResponse,
} from '@lucy-spa/contracts';
import { buttonClass, Icon, Notice, PublicPage, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  bookServiceHref,
  serviceEstimate,
  serviceHref,
  servicePrice,
} from '../../lib/public-site-core';
import { LoadNotice } from './home-sections';
import { PublicBreadcrumbs } from './public-breadcrumbs';

/** One service as a card: name (a link to its page), estimated time, price, a short description and the booking action. */
export function ServiceCard({
  locale,
  service,
  level = 3,
}: {
  locale: Locale;
  service: PublicService;
  level?: 2 | 3;
}) {
  const text = getSiteText(locale).services;
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <article className="ls-service-card">
      <Heading className="ls-site-h3">
        <Link href={serviceHref(locale, service.code)}>{service.name}</Link>
      </Heading>
      <p className="ls-service-meta">
        <Icon name="clock" />
        <span>
          {text.estimate}: {serviceEstimate(service, locale)}
        </span>
      </p>
      <p className="ls-service-price">{servicePrice(service, locale)}</p>
      {service.description ? <p className="ls-service-text">{service.description}</p> : null}
      <Link className={buttonClass('primary')} href={bookServiceHref(locale, service.code)}>
        {text.book}
      </Link>
    </article>
  );
}

/**
 * The service list (Part 2 contract 5.3): a filter by group (links, so it works without scripts and can be shared),
 * then one section per group, or just the chosen one. The page is the catalogue as the Owner keeps it.
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
  const shown = data ? data.groups.filter((entry) => group === '' || entry.code === group) : [];
  return (
    <PublicPage title={text.services.title} lead={text.services.lead}>
      {data === null ? (
        <LoadNotice locale={locale} section={text.home.sectionServices} />
      ) : data.groups.length === 0 ? (
        <Notice tone="info">{text.services.empty}</Notice>
      ) : (
        <>
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
          {shown.map((entry) => (
            <section
              key={entry.code}
              className="ls-service-section"
              aria-labelledby={`group-${entry.code}`}
            >
              <h2 className="ls-site-h2" id={`group-${entry.code}`}>
                {entry.name}
              </h2>
              <div className="ls-service-grid">
                {entry.services.map((service, index) => (
                  <Reveal key={service.code} index={index}>
                    <ServiceCard locale={locale} service={service} />
                  </Reveal>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </PublicPage>
  );
}

/** One service on its own page: facts, description, the booking action and the other services of its group. */
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
      <PublicPage title={text.services.title}>
        <LoadNotice locale={locale} section={text.home.sectionServices} />
      </PublicPage>
    );
  }
  const { service, group, related } = detail;
  return (
    <PublicPage title={service.name} lead={text.services.detailLead} width="narrow">
      <div className="ls-detail">
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
        <article className="ls-site-card">
          <dl className="ls-detail-facts">
            <div>
              <dt>{text.services.groupsLabel}</dt>
              <dd>{group.name}</dd>
            </div>
            <div>
              <dt>{text.services.estimate}</dt>
              <dd>{serviceEstimate(service, locale)}</dd>
            </div>
            <div>
              <dt>{text.services.price}</dt>
              <dd>{servicePrice(service, locale)}</dd>
            </div>
          </dl>
          {service.description ? <p className="ls-detail-copy">{service.description}</p> : null}
          <p className="ls-detail-note">
            {service.pricingUnit === 'PER_NAIL'
              ? text.services.perNailNote
              : text.services.priceNote}
          </p>
          <div className="ls-site-actions">
            <Link
              className={buttonClass('primary', 'lg')}
              href={bookServiceHref(locale, service.code)}
            >
              {text.services.book}
            </Link>
            <Link className={buttonClass('secondary', 'lg')} href={`/${locale}/services`}>
              {text.services.back}
            </Link>
          </div>
        </article>
        {related.length > 0 ? (
          <section aria-labelledby="related-title">
            <h2 className="ls-site-h2" id="related-title">
              {text.services.related}
            </h2>
            <div className="ls-service-grid">
              {related.map((entry) => (
                <ServiceCard key={entry.code} locale={locale} service={entry} />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </PublicPage>
  );
}

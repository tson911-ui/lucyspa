import type { PublicServiceDetailResponse, PublicServicesResponse } from '@lucy-spa/contracts';
import { buttonClass, Notice, PublicPage } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { bookServiceHref, serviceEstimate, servicePrice } from '../../lib/public-site-core';
import { PageBack } from '../navigation/page-back';
import { LoadNotice } from './home-sections';
import { ServiceRow, ServicesList } from './services-list';
import { PublicBreadcrumbs } from './public-breadcrumbs';

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
    <PublicPage
      title={text.services.title}
      lead={text.services.lead}
      back={<ServicesBack locale={locale} />}
    >
      {data === null ? (
        <LoadNotice locale={locale} section={text.home.sectionServices} />
      ) : data.groups.length === 0 ? (
        <Notice tone="info">{text.services.empty}</Notice>
      ) : (
        <>
          <ServicesList locale={locale} groups={shown}>
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
          </ServicesList>
        </>
      )}
    </PublicPage>
  );
}

/**
 * One service on its own page: its facts (time and price), the description, the booking action, and the other services of its
 * group beside it (under it on a phone). The page uses the site's full width like every other page; the text keeps its own
 * measure.
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
      <PublicPage title={text.services.title} back={<ServicesBack locale={locale} />}>
        <LoadNotice locale={locale} section={text.home.sectionServices} />
      </PublicPage>
    );
  }
  const { service, group, related } = detail;
  return (
    <PublicPage
      title={service.name}
      lead={text.services.detailLead}
      back={<ServicesBack locale={locale} />}
    >
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
        <div className="ls-detail-grid">
          <article className="ls-site-card ls-detail-main">
            <dl className="ls-detail-facts">
              <div>
                <dt>{text.services.estimate}</dt>
                <dd>{serviceEstimate(service, locale)}</dd>
              </div>
              <div>
                <dt>{text.services.price}</dt>
                <dd className="ls-detail-price">{servicePrice(service, locale)}</dd>
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
            <section className="ls-detail-related" aria-labelledby="related-title">
              <h2 className="ls-site-h2-sub" id="related-title">
                {text.services.related}
              </h2>
              <ul className="ls-svc-list">
                {related.map((entry) => (
                  <ServiceRow key={entry.code} locale={locale} service={entry} />
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </PublicPage>
  );
}

import type { PublicServicesResponse, PublicSiteResponse } from '@lucy-spa/contracts';
import { buttonClass, Icon, Notice, PriceList, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import { hoursLines } from '../../lib/hours';
import {
  directionsUrl,
  featuredServices,
  hoursHeadline,
  servicePrice,
  telHref,
} from '../../lib/public-site-core';

/** A section that could not be read: a notice with a way to try again; the rest of the page still renders. */
export function LoadNotice({ locale, section }: { locale: Locale; section: string }) {
  const text = getSiteText(locale).home;
  return (
    <div className="ls-page-notice">
      <Notice tone="warning">{fill(text.loadError, { section })}</Notice>
      <div className="ls-site-actions">
        <Link className={buttonClass('secondary')} href={`/${locale}`} prefetch={false}>
          {text.reload}
        </Link>
      </div>
    </div>
  );
}

/** The three facts every visitor looks for: when we are open, where we are, how to call. */
export function FactsStrip({ locale, site }: { locale: Locale; site: PublicSiteResponse }) {
  const text = getSiteText(locale).home;
  const headline = hoursHeadline(site.hours, locale, text.closed);
  return (
    <div className="ls-site-facts">
      {headline ? (
        <p className="ls-site-fact">
          <Icon className="ls-icon-lead" name="clock" />
          <span>
            <strong>{headline.value}</strong> · {headline.label}
          </span>
        </p>
      ) : null}
      <p className="ls-site-fact">
        <Icon className="ls-icon-lead" name="map-pin" />
        <strong>{site.address}</strong>
      </p>
      <p className="ls-site-fact">
        <Icon className="ls-icon-lead" name="phone" />
        <span>
          {text.hotline}{' '}
          <a href={telHref(site)}>
            <strong>{site.hotline}</strong>
          </a>
        </span>
      </p>
    </div>
  );
}

/** One card per live group of the catalogue: its first services with their prices and a link to all of them. */
export function ServiceGroups({
  locale,
  services,
}: {
  locale: Locale;
  services: PublicServicesResponse;
}) {
  const text = getSiteText(locale).home;
  return (
    <div className="ls-site-grid ls-site-grid-groups">
      {services.groups.map((group, index) => (
        <Reveal key={group.code} index={index}>
          <article className="ls-site-card">
            <div>
              <h3 className="ls-site-h3">{group.name}</h3>
              <p className="ls-group-count">
                {fill(text.serviceCount, { count: group.services.length })}
              </p>
            </div>
            <PriceList
              items={featuredServices(group).map((service) => ({
                key: service.code,
                name: service.name,
                price: servicePrice(service, locale),
              }))}
            />
            <Link
              className="ls-site-link"
              href={`/${locale}/services?group=${encodeURIComponent(group.code)}`}
              aria-label={fill(text.viewAllOf, { group: group.name })}
            >
              {text.viewAll}
              <Icon name="chevron-right" />
            </Link>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

/** "Ghé thăm": the opening hours (grouped as the Owner set them) and the address with the hotline and directions. */
export function VisitCards({ locale, site }: { locale: Locale; site: PublicSiteResponse }) {
  const text = getSiteText(locale).home;
  const lines = hoursLines(site.hours, locale, text.closed);
  return (
    <div className="ls-visit">
      <Reveal index={0}>
        <article className="ls-site-card">
          <span className="ls-icon-bubble">
            <Icon name="clock" />
          </span>
          <h3 className="ls-site-h3">{text.hoursTitle}</h3>
          {lines.length > 0 ? (
            <dl className="ls-hours">
              {lines.map((line) => (
                <div key={line.label}>
                  <dt>{line.label}</dt>
                  <dd>{line.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="ls-group-count">{text.noHours}</p>
          )}
        </article>
      </Reveal>
      <Reveal index={1}>
        <article className="ls-site-card">
          <span className="ls-icon-bubble">
            <Icon name="map-pin" />
          </span>
          <h3 className="ls-site-h3">{text.contactTitle}</h3>
          <p className="ls-contact-lines">
            <strong>{site.address}</strong>
            <span>
              {text.hotline}: <a href={telHref(site)}>{site.hotline}</a>
            </span>
          </p>
          <div className="ls-site-actions">
            <Link className={buttonClass('primary')} href={`/${locale}/account/book`}>
              {getSiteText(locale).header.bookNow}
            </Link>
            <a
              className={buttonClass('secondary')}
              href={directionsUrl(site)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Icon name="map-pin" />
              <span className="ls-btn-label">{text.directions}</span>
            </a>
          </div>
        </article>
      </Reveal>
    </div>
  );
}

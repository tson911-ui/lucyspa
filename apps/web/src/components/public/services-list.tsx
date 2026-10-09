'use client';

import type { PublicService, PublicServiceGroup } from '@lucy-spa/contracts';
import { buttonClass, Icon, Notice, Reveal, SearchInput } from '@lucy-spa/ui';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import { matchesQuery } from '../../lib/search-core';
import {
  bookServiceHref,
  serviceEstimate,
  serviceHref,
  servicePrice,
} from '../../lib/public-site-core';

/**
 * One service as a row of the price list: the name, a dotted leader and the price on the first line, the estimated time under
 * them, and the booking button at the end. The row is a link to the service's own page; the button is a separate link (two
 * actions, so the list is not one column of identical solid buttons).
 */
export function ServiceRow({ locale, service }: { locale: Locale; service: PublicService }) {
  const text = getSiteText(locale).services;
  return (
    <li className="ls-svc-row">
      <Link className="ls-svc-main" href={serviceHref(locale, service.code)}>
        <span className="ls-svc-name" title={service.name}>
          {service.name}
        </span>
        <span className="ls-svc-dots" aria-hidden="true" />
        <span className="ls-svc-price">{servicePrice(service, locale)}</span>
        <span className="ls-svc-meta">
          <Icon name="clock" size={16} aria-hidden="true" />
          {serviceEstimate(service, locale)}
        </span>
      </Link>
      <Link
        className={buttonClass('secondary', 'md', 'ls-svc-book')}
        href={bookServiceHref(locale, service.code)}
        aria-label={`${text.book}: ${service.name}`}
      >
        {text.book}
      </Link>
    </li>
  );
}

/**
 * The service list: a search box (accents and case ignored, on the name and the description) and one section per group.
 * The group filter is the server's (links), so the groups arrive already narrowed; the search narrows what is shown.
 */
export function ServicesList({
  locale,
  groups,
  children,
}: {
  locale: Locale;
  groups: readonly PublicServiceGroup[];
  /** The group filter (links, drawn by the server page), shown with the search in one toolbar. */
  children?: ReactNode;
}) {
  const text = getSiteText(locale).services;
  const [query, setQuery] = useState('');
  const shown = useMemo(
    () =>
      groups
        .map((group) => ({
          ...group,
          services: group.services.filter((service) =>
            matchesQuery(`${service.name} ${service.description ?? ''}`, query),
          ),
        }))
        .filter((group) => group.services.length > 0),
    [groups, query],
  );
  return (
    <>
      <div className="ls-svc-toolbar">
        {children}
        <div role="search" aria-label={text.searchLabel}>
          <SearchInput
            label={text.searchLabel}
            clearLabel={text.searchClear}
            placeholder={text.searchLabel}
            debounceMs={150}
            onSearch={setQuery}
          />
        </div>
      </div>
      {shown.length === 0 ? (
        <div className="ls-page-notice">
          <Notice tone="info">{fill(text.noMatch, { query })}</Notice>
        </div>
      ) : (
        shown.map((group) => (
          <section
            key={group.code}
            className="ls-svc-section"
            aria-labelledby={`group-${group.code}`}
          >
            <Reveal>
              <h2 className="ls-site-h2-sub" id={`group-${group.code}`}>
                {group.name}
              </h2>
            </Reveal>
            <ul className="ls-svc-list">
              {group.services.map((service) => (
                <ServiceRow key={service.code} locale={locale} service={service} />
              ))}
            </ul>
          </section>
        ))
      )}
    </>
  );
}

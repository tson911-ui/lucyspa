'use client';

import type { PublicService, PublicServiceGroup } from '@lucy-spa/contracts';
import { Band, buttonClass, EmptyState, Icon, ImageFrame, Reveal, SearchInput } from '@lucy-spa/ui';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import { frameImage } from '../../lib/public-image';
import { matchesQuery } from '../../lib/search-core';
import { SharedPhoto } from './shared-photo';
import {
  bookServiceHref,
  cardPrice,
  serviceEstimate,
  serviceHref,
} from '../../lib/public-site-core';

/**
 * One service as a card (DESIGN.md 9.2): the photo the Owner chose (the flat placeholder while there is none), the name (the card's one link,
 * stretched over the card), the estimated time, the price ("from" for a per-nail price) and the "Đặt lịch" pill, which keeps its own target
 * above the stretched link. A card is a list item; `className` lets a row of cards (the related services) add its snap item class.
 */
export function ServiceCard({
  locale,
  service,
  className,
  index,
  sharePhoto = false,
}: {
  locale: Locale;
  service: PublicService;
  className?: string;
  /** Position in its grid: the card then reveals on scroll with the stagger of its place (C17). */
  index?: number;
  /** The photo travels to the service's page (the list page only: the name must be unique on a page). */
  sharePhoto?: boolean;
}) {
  const text = getSiteText(locale).services;
  const photo = (
    <ImageFrame
      {...frameImage(service.image, '(min-width: 1024px) 320px, (min-width: 640px) 50vw, 100vw')}
      alt=""
      ratio="4/3"
      className="ls-svc-media"
    />
  );
  const card = (
    <article className="ls-svc-card">
      {sharePhoto ? (
        <SharedPhoto name={`ls-photo-svc-${service.code}`}>{photo}</SharedPhoto>
      ) : (
        photo
      )}
      <div className="ls-svc-card-body">
        <h3 className="ls-svc-card-name">
          <Link href={serviceHref(locale, service.code)} title={service.name}>
            {service.name}
          </Link>
        </h3>
        <p className="ls-svc-card-meta">
          <Icon name="clock" size={16} aria-hidden="true" />
          {serviceEstimate(service, locale)}
        </p>
        <p className="ls-svc-card-price">{cardPrice(service, locale)}</p>
      </div>
      <Link
        className={buttonClass('secondary', 'md', 'ls-svc-card-book')}
        href={bookServiceHref(locale, service.code)}
        aria-label={`${text.book}: ${service.name}`}
      >
        {text.book}
      </Link>
    </article>
  );
  return (
    <li className={className ? `ls-svc-item ${className}` : 'ls-svc-item'}>
      {index === undefined ? card : <Reveal index={index}>{card}</Reveal>}
    </li>
  );
}

/**
 * The service list page below the server's header (DESIGN.md 9.2): the title band (the server's `intro`: back, h1 and the sentence) with the
 * search, the sticky chips row (the server's group links), then one band for each group with a heading and the cards. The bands alternate
 * from the base color after the title band. The group filter is the server's (links), so the groups arrive already narrowed; the search
 * narrows what is shown (accents and case ignored, on the name and the description).
 */
export function ServicesList({
  locale,
  groups,
  intro,
  chips,
}: {
  locale: Locale;
  groups: readonly PublicServiceGroup[];
  /** The title band's content: the Back button, the page's one h1 (id `services-title`) and its sentence. */
  intro: ReactNode;
  /** The group filter (links, drawn by the server page), kept at the top while the page scrolls. */
  chips: ReactNode;
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
      <Band tone="page" labelledBy="services-title" className="ls-band--alt ls-svc-title">
        {intro}
        <div className="ls-svc-search" role="search" aria-label={text.searchLabel}>
          <SearchInput
            label={text.searchLabel}
            clearLabel={text.searchClear}
            placeholder={text.searchLabel}
            debounceMs={150}
            onSearch={setQuery}
          />
        </div>
      </Band>
      <div className="ls-svc-chips">
        <div className="ls-container">{chips}</div>
      </div>
      {shown.length === 0 ? (
        <Band tone="page" className="ls-band--base">
          <EmptyState icon="search">{fill(text.noMatch, { query })}</EmptyState>
        </Band>
      ) : (
        shown.map((group, index) => (
          <Band
            key={group.code}
            tone="page"
            labelledBy={`group-${group.code}`}
            className={`ls-band--${index % 2 === 0 ? 'base' : 'alt'}`}
          >
            <Reveal>
              <h2 className="ls-site-h2" id={`group-${group.code}`}>
                {group.name}
              </h2>
            </Reveal>
            <ul className="ls-svc-grid">
              {group.services.map((service, position) => (
                <ServiceCard
                  key={service.code}
                  locale={locale}
                  service={service}
                  index={position % 6}
                  sharePhoto
                />
              ))}
            </ul>
          </Band>
        ))
      )}
    </>
  );
}

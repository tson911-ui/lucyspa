import type {
  PublicProductCategory,
  PublicSiteResponse,
  PublicSlideImage,
  PublicWhy,
} from '@lucy-spa/contracts';
import { buttonClass, Icon, Notice, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import {
  cardPrice,
  directionsUrl,
  hoursHeadline,
  serviceHref,
  telHref,
  type HomeGroup,
} from '../../lib/public-site-core';
import { CategoryTile } from './category-tile';

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

/**
 * The trust band (DESIGN.md 9.1, item 2): the facts every visitor looks for, as the Owner arranged them in Shop info (the built-in
 * opening hours, address and hotline, each can be hidden, and any custom lines, in the Owner's order), each as a `title` figure with a
 * small caption. The address opens the map link, the hotline dials. No number is made up: a figure is the Owner's own text. Nothing at
 * all when the Owner hid the strip or every item.
 */
export function FactsStrip({ locale, site }: { locale: Locale; site: PublicSiteResponse }) {
  const text = getSiteText(locale).home;
  const headline = hoursHeadline(site.hours, locale, text.closed);
  const items = site.facts.flatMap((fact) => {
    const icon = <Icon className="ls-icon-lead" name={fact.icon} size={16} aria-hidden="true" />;
    if (fact.kind === 'HOURS') {
      return headline
        ? [
            <div key="hours" className="ls-home-fact" data-fact="hours">
              <p className="ls-home-fact-figure">{headline.value}</p>
              <p className="ls-home-fact-caption">
                {icon}
                {headline.label}
              </p>
            </div>,
          ]
        : [];
    }
    if (fact.kind === 'ADDRESS') {
      return [
        <div key="address" className="ls-home-fact" data-fact="address">
          <p className="ls-home-fact-figure">
            <a href={directionsUrl(site)} target="_blank" rel="noopener noreferrer">
              {site.address}
            </a>
          </p>
          <p className="ls-home-fact-caption">
            {icon}
            {text.factAddress}
          </p>
        </div>,
      ];
    }
    if (fact.kind === 'HOTLINE') {
      return [
        <div key="hotline" className="ls-home-fact" data-fact="hotline">
          <p className="ls-home-fact-figure">
            <a href={telHref(site)}>{site.hotline}</a>
          </p>
          <p className="ls-home-fact-caption">
            {icon}
            {text.hotline}
          </p>
        </div>,
      ];
    }
    return [
      <div key={`custom-${fact.text}`} className="ls-home-fact" data-fact="custom">
        <p className="ls-home-fact-figure">{fact.text}</p>
        <p className="ls-home-fact-caption">{icon}</p>
      </div>,
    ];
  });
  if (items.length === 0) return null;
  // A phone stacks the facts with a hairline between; from 768 px they share one row with a hairline between the columns.
  return <div className="ls-home-facts">{items}</div>;
}

/**
 * The top services (DESIGN.md 9.1, item 3): one column for each of the first groups in the Owner's order, with the Owner's short
 * description when there is one, and the group's first services as text, price and an arrow. Each row opens the service.
 */
export function TopServices({ locale, columns }: { locale: Locale; columns: HomeGroup[] }) {
  return (
    <div className="ls-home-top">
      {columns.map(({ group, description }, index) => (
        <Reveal key={group.code} index={index}>
          <section className="ls-home-top-col" aria-labelledby={`top-${group.code}`}>
            <h3 className="ls-home-top-title" id={`top-${group.code}`}>
              {group.name}
            </h3>
            {description ? <p className="ls-home-top-desc">{description}</p> : null}
            <ul className="ls-home-top-list">
              {group.services.map((service) => (
                <li key={service.code}>
                  <Link className="ls-home-top-row" href={serviceHref(locale, service.code)}>
                    <span className="ls-home-top-name">{service.name}</span>
                    <span className="ls-home-top-price">{cardPrice(service, locale)}</span>
                    <Icon name="chevron-right" size={16} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      ))}
    </div>
  );
}

/**
 * The category grid (DESIGN.md 9.1, item 6): one tile for each group, the name at the bottom-left and the whole tile one link. No count
 * or badge beside a name. A tile with a photo the Owner chose draws it under one flat scrim with the name in white; without one the tile
 * is the flat placeholder.
 */
export function CategoryGrid({
  title,
  items,
}: {
  title: string;
  items: readonly { key: string; name: string; href: string; image?: PublicSlideImage | null }[];
}) {
  return (
    <section className="ls-home-cats-group" aria-label={title}>
      <h3 className="ls-home-cats-title">{title}</h3>
      <ul className="ls-home-cats">
        {items.map((item, index) => (
          <li key={item.key}>
            <Reveal index={index}>
              <CategoryTile name={item.name} href={item.href} image={item.image ?? null} />
            </Reveal>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The cosmetics categories as grid items: each opens the catalog filtered to it. */
export const categoryItems = (
  locale: Locale,
  categories: readonly PublicProductCategory[],
): { key: string; name: string; href: string; image: PublicSlideImage | null }[] =>
  categories.map((category) => ({
    key: category.code,
    name: category.name,
    href: `/${locale}/products?category=${encodeURIComponent(category.code)}`,
    image: category.image,
  }));

/**
 * The optional "why choose us" cards, written by the Owner in Shop info: an icon, a heading and a short description on the card step
 * (no border, no shadow). Drawn only when the page has a section.
 */
export function WhyCards({ why }: { why: PublicWhy }) {
  return (
    <ul className="ls-home-why">
      {why.cards.map((card, index) => (
        <li key={`${card.heading}-${index}`}>
          <Reveal index={index}>
            <article className="ls-home-why-card">
              <Icon name={card.icon} size={24} aria-hidden="true" />
              <h3 className="ls-home-why-title">{card.heading}</h3>
              <p className="ls-home-why-text">{card.description}</p>
            </article>
          </Reveal>
        </li>
      ))}
    </ul>
  );
}

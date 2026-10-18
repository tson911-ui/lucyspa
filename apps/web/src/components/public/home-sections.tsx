import type {
  PublicProductCategory,
  PublicSiteResponse,
  PublicSlideImage,
  PublicWhy,
} from '@lucy-spa/contracts';
import { Icon, Notice } from '@lucy-spa/ui';
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
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { CategoryTile } from './category-tile';
import { ScrollRow } from './scroll-row';
import { ReloadButton } from './reload-button';

/** A section that could not be read: a notice with a way to try again; the rest of the page still renders. */
export function LoadNotice({ locale, section }: { locale: Locale; section: string }) {
  const text = getSiteText(locale).home;
  return (
    <div className="ls-page-notice">
      <Notice tone="warning">{fill(text.loadError, { section })}</Notice>
      <div className="ls-site-actions">
        <ReloadButton label={text.reload} />
      </div>
    </div>
  );
}

/**
 * The trust band (DESIGN.md 9.1, item 2; brief B3): the facts every visitor looks for, as the Owner arranged them in Shop info (the
 * built-in opening hours, address and phone, each can be hidden, and any custom lines, in the Owner's order). Each fact is its value
 * with a 14 px caption under it (icon + word), never a label above it. The hours and the phone are `title` figures; the address is
 * long, so it is set one step smaller and wraps by word, and its caption is the "Chỉ đường" link (a new tab). The phone dials. No
 * number is made up: a figure is the Owner's own text. Nothing at all when the Owner hid the strip or every item.
 */
export function FactsStrip({ locale, site }: { locale: Locale; site: PublicSiteResponse }) {
  const text = getSiteText(locale);
  const home = text.home;
  const headline = hoursHeadline(site.hours, locale, home.closed);
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
          <p className="ls-home-fact-figure" data-size="long">
            {site.address}
          </p>
          <p className="ls-home-fact-caption">
            {icon}
            <a
              className="ls-link ls-home-fact-link"
              href={directionsUrl(site)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${home.directions} (${text.infoPage.newTab})`}
            >
              {home.directions}
            </a>
          </p>
        </div>,
      ];
    }
    if (fact.kind === 'HOTLINE') {
      return [
        <div key="hotline" className="ls-home-fact" data-fact="hotline">
          <p className="ls-home-fact-figure">
            <a className="ls-home-fact-tel" href={telHref(site)} translate="no">
              {site.hotline}
            </a>
          </p>
          <p className="ls-home-fact-caption">
            {icon}
            {home.hotline}
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
 * The price list (DESIGN.md 9.1, item 3): one column for each of the first groups in the Owner's order, with the Owner's short
 * description when there is one, and the group's first services as name and price. Each row is one link to the service; its hover is
 * the neutral grey step inside the row's own box (B5: never black, nothing drawn outside the column).
 */
export function TopServices({ locale, columns }: { locale: Locale; columns: HomeGroup[] }) {
  return (
    <div className="ls-home-top">
      {columns.map(({ group, description }) => (
        <section key={group.code} className="ls-home-top-col" aria-labelledby={`top-${group.code}`}>
          <h3 className="ls-home-top-title" id={`top-${group.code}`}>
            {group.name}
          </h3>
          {description ? <p className="ls-home-top-desc">{description}</p> : null}
          <ul className="ls-home-top-list">
            {group.services.map((service) => (
              <li key={service.code}>
                <Link
                  className="ls-home-top-row"
                  href={serviceHref(locale, service.code)}
                  transitionTypes={NAV_TRANSITION}
                >
                  <span className="ls-home-top-name">{service.name}</span>
                  <span className="ls-home-top-price">{cardPrice(service, locale)}</span>
                  <Icon name="chevron-right" size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/**
 * The category rows (DESIGN.md 9.1, item 6; R15; one row per group since the Owner's 2026-10-18 fix): one tile for each group, the whole
 * tile one link, the name at the bottom leading corner over one flat scrim when the Owner chose a photo (the photo fills the tile), else
 * the flat placeholder with ink text. No count or badge beside a name. Every tile has the same size (three across from 1024 px, two from
 * 640, one below); the row scrolls sideways inside itself with the round arrow buttons of the product row.
 */
export function CategoryGrid({
  title,
  items,
  previous,
  next,
}: {
  title: string;
  items: readonly { key: string; name: string; href: string; image?: PublicSlideImage | null }[];
  /** The accessible names of the row's two arrow buttons. */
  previous: string;
  next: string;
}) {
  return (
    <section className="ls-home-cats-group" aria-label={title}>
      <h3 className="ls-home-cats-title">{title}</h3>
      <ScrollRow label={title} previous={previous} next={next} variant="tiles">
        {items.map((item) => (
          <li key={item.key} className="ls-snap-item ls-snap-tile">
            <CategoryTile name={item.name} href={item.href} image={item.image ?? null} />
          </li>
        ))}
      </ScrollRow>
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
          <article className="ls-home-why-card">
            <Icon name={card.icon} size={24} aria-hidden="true" />
            <h3 className="ls-home-why-title">{card.heading}</h3>
            <p className="ls-home-why-text">{card.description}</p>
          </article>
        </li>
      ))}
    </ul>
  );
}

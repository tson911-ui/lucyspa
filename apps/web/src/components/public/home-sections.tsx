import type {
  PublicProductCard,
  PublicProductCategory,
  PublicSiteResponse,
  PublicWhy,
} from '@lucy-spa/contracts';
import { Badge, buttonClass, Icon, Notice, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import {
  cardPriceText,
  discountText,
  productHref,
  stockLabel,
} from '../../lib/public-products-core';
import {
  cardPrice,
  directionsUrl,
  hoursHeadline,
  serviceHref,
  telHref,
  type HomeGroup,
} from '../../lib/public-site-core';
import { PriceCampaignLine } from './campaign-views';
import { ProductImage } from './product-image';
import { SalePrice } from './sale-price';

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

const CARD_SIZES = '(min-width: 1024px) 22vw, (min-width: 640px) 34vw, 62vw';

/**
 * One product in the home row (DESIGN.md 8.3): the picture on the sunken step (a droplet when there is none), the labels over its top-left
 * corner (Mới = accent outline, the sale percent = ink fill, Hết hàng), then the name (the card's one link, stretched over the card), the
 * price with the struck list price, and the campaign line. The percent is drawn once, as the label; the price block does not repeat it.
 */
export function HomeProductCard({
  locale,
  card,
  priority = false,
}: {
  locale: Locale;
  card: PublicProductCard;
  priority?: boolean;
}) {
  const text = getSiteText(locale).products;
  const percent = discountText(card.price);
  const stock = stockLabel(card.stock, text);
  const outOfStock = card.stock.state === 'OUT_OF_STOCK';
  return (
    <li className="ls-snap-item">
      <article className="ls-home-prod">
        <div className="ls-home-prod-media">
          {card.image ? (
            <ProductImage image={card.image} sizes={CARD_SIZES} priority={priority} />
          ) : (
            <Icon name="droplet" size={40} aria-hidden="true" />
          )}
          {card.isNew || percent || outOfStock ? (
            <div className="ls-home-prod-labels">
              {card.isNew ? <Badge tone="outline">{text.badgeNew}</Badge> : null}
              {percent ? <Badge tone="ink">{percent}</Badge> : null}
              {outOfStock ? <Badge tone="neutral">{text.outOfStock}</Badge> : null}
            </div>
          ) : null}
        </div>
        <div className="ls-home-prod-body">
          {card.category || card.brand ? (
            <span className="ls-home-prod-meta">{card.category?.name ?? card.brand}</span>
          ) : null}
          <h3 className="ls-home-prod-name">
            <Link href={productHref(locale, card.code)} title={card.name}>
              {card.name}
            </Link>
          </h3>
          {stock && card.stock.state === 'PRE_ORDER' ? (
            <p className="ls-prod-stock" data-state={card.stock.state}>
              {stock}
            </p>
          ) : null}
          <SalePrice
            locale={locale}
            price={card.price}
            nowText={cardPriceText(card, locale)}
            percent={false}
          />
          <PriceCampaignLine locale={locale} price={card.price} />
        </div>
      </article>
    </li>
  );
}

/**
 * The category grid (DESIGN.md 9.1, item 6): one tile for each group, the name at the bottom-left and the whole tile one link. No count
 * or badge beside a name. The shop has no photo for a group yet (no field holds one), so a tile is the flat placeholder; a real photo
 * will sit under a flat scrim with the name in white.
 */
export function CategoryGrid({
  title,
  items,
}: {
  title: string;
  items: readonly { key: string; name: string; href: string }[];
}) {
  return (
    <section className="ls-home-cats-group" aria-label={title}>
      <h3 className="ls-home-cats-title">{title}</h3>
      <ul className="ls-home-cats">
        {items.map((item, index) => (
          <li key={item.key}>
            <Reveal index={index}>
              <Link className="ls-home-cat" href={item.href}>
                <span className="ls-home-cat-name">{item.name}</span>
              </Link>
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
): { key: string; name: string; href: string }[] =>
  categories.map((category) => ({
    key: category.code,
    name: category.name,
    href: `/${locale}/products?category=${encodeURIComponent(category.code)}`,
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

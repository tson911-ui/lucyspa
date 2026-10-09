import type { PublicSiteResponse, PublicWhy } from '@lucy-spa/contracts';
import { buttonClass, Icon, Notice, PriceList, Reveal } from '@lucy-spa/ui';
import Link from 'next/link';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import { fill } from '../../lib/fill';
import {
  cardPrice,
  directionsUrl,
  featuredServices,
  hoursHeadline,
  serviceHref,
  telHref,
  type HomeGroup,
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

/**
 * The facts every visitor looks for, as the Owner arranged them in Shop info: the built-in opening hours, address and
 * hotline (each can be hidden) and any custom lines, in the Owner's order. The address opens the map link, the hotline
 * dials. Nothing at all when the Owner hid the strip or every item.
 */
export function FactsStrip({ locale, site }: { locale: Locale; site: PublicSiteResponse }) {
  const text = getSiteText(locale).home;
  const headline = hoursHeadline(site.hours, locale, text.closed);
  const items = site.facts.flatMap((fact) => {
    const icon = <Icon className="ls-icon-lead" name={fact.icon} />;
    if (fact.kind === 'HOURS') {
      return headline
        ? [
            <p key="hours" className="ls-site-fact" data-fact="hours">
              {icon}
              <span>
                <strong>{headline.value}</strong> · {headline.label}
              </span>
            </p>,
          ]
        : [];
    }
    if (fact.kind === 'ADDRESS') {
      return [
        <p key="address" className="ls-site-fact" data-fact="address" title={site.address}>
          {icon}
          <a href={directionsUrl(site)} target="_blank" rel="noopener noreferrer">
            <strong>{site.address}</strong>
          </a>
        </p>,
      ];
    }
    if (fact.kind === 'HOTLINE') {
      return [
        <p key="hotline" className="ls-site-fact" data-fact="hotline">
          {icon}
          <span>
            {text.hotline}{' '}
            <a href={telHref(site)}>
              <strong>{site.hotline}</strong>
            </a>
          </span>
        </p>,
      ];
    }
    return [
      <p
        key={`custom-${fact.text}`}
        className="ls-site-fact"
        data-fact="custom"
        title={fact.text ?? undefined}
      >
        {icon}
        <strong>{fact.text}</strong>
      </p>,
    ];
  });
  if (items.length === 0) return null;
  return (
    // A phone stacks the items (a long address wraps in its line); a tablet and up shares one row (site.css).
    <div className="ls-site-facts">{items}</div>
  );
}

const TONES = ['rose', 'sage', 'blush', 'sand'] as const;

/** The group's lowest price as one short line ("từ 15.000 ₫"), or null when it has no service. */
function groupFrom(group: HomeGroup['group'], locale: Locale): string | null {
  let best: (typeof group.services)[number] | null = null;
  for (const service of group.services) {
    if (best === null || BigInt(service.priceMinVnd) < BigInt(best.priceMinVnd)) best = service;
  }
  return best ? cardPrice(best, locale) : null;
}

/**
 * The price list as soft "pebbles" (direction C): one rounded card for each featured group (the Owner's choice and order, else every
 * live group), each with its own tone. A pebble is the group's name, how many services it holds and the lowest price, the Owner's
 * short description, its first three services as rows (name and price; each row opens the service) and "Xem tất cả".
 */
export function ServiceGroups({ locale, groups }: { locale: Locale; groups: HomeGroup[] }) {
  const text = getSiteText(locale).home;
  return (
    <div className="ls-pebbles">
      {groups.map(({ group, description }, index) => {
        const from = groupFrom(group, locale);
        return (
          <Reveal key={group.code} index={index}>
            <article className="ls-pebble" data-tone={TONES[index % TONES.length]}>
              <div className="ls-group-head">
                <h3 className="ls-site-h2-sub">{group.name}</h3>
                <p className="ls-pebble-meta">
                  {from
                    ? fill(text.groupMeta, { count: String(group.services.length), price: from })
                    : fill(text.groupCount, { count: String(group.services.length) })}
                </p>
                {description ? <p className="ls-group-desc">{description}</p> : null}
              </div>
              <PriceList
                LinkComponent={Link}
                items={featuredServices(group).map((service) => ({
                  key: service.code,
                  name: service.name,
                  price: cardPrice(service, locale),
                  href: serviceHref(locale, service.code),
                }))}
              />
              <Link
                className="ls-site-link"
                href={`/${locale}/services?group=${encodeURIComponent(group.code)}`}
                aria-label={fill(text.viewAllOf, { group: group.name })}
              >
                {text.viewAll}
                <span aria-hidden="true" className="ls-link-arrow">
                  →
                </span>
              </Link>
            </article>
          </Reveal>
        );
      })}
    </div>
  );
}

/**
 * The optional "why choose us" cards, written by the Owner in Shop info: an icon in a soft round badge (the brand
 * colours of the current theme), a serif heading and a short description. Drawn only when the page has a section.
 */
export function WhyCards({ why }: { why: PublicWhy }) {
  return (
    <div className="ls-site-grid ls-site-grid-groups ls-site-grid-why">
      {why.cards.map((card, index) => (
        <Reveal key={`${card.heading}-${index}`} index={index}>
          <article className="ls-site-card">
            <span className="ls-icon-bubble">
              <Icon name={card.icon} />
            </span>
            <h3 className="ls-site-h3">{card.heading}</h3>
            <p className="ls-group-desc">{card.description}</p>
          </article>
        </Reveal>
      ))}
    </div>
  );
}

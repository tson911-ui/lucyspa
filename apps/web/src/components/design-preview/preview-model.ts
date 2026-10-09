import type { PublicCampaign, PublicSiteResponse } from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { getSiteText } from '../../i18n/site';
import {
  cardPrice,
  directionsUrl,
  homeGroups,
  hoursHeadline,
  serviceEstimate,
  serviceHref,
  telHref,
  type HomeData,
} from '../../lib/public-site-core';

/** What a home-page direction draws, all read from the shop's own data (Shop info, the catalogue, the running campaign). */
export interface PreviewModel {
  locale: Locale;
  tagline: string;
  intro: string;
  hours: { value: string; label: string } | null;
  address: string | null;
  directions: string | null;
  hotline: string | null;
  tel: string | null;
  heroImage: PublicSiteResponse['heroImage'];
  groups: {
    code: string;
    name: string;
    description: string | null;
    count: number;
    /** The lowest price of the group, one short line ("từ 15.000 ₫"), or null when there is none. */
    from: string | null;
    services: { code: string; name: string; price: string; estimate: string; href: string }[];
  }[];
  campaign: {
    name: string;
    message: string;
    href: string;
    cta: string;
    badge: string | null;
  } | null;
  links: { book: string; services: string; products: string; home: string };
  words: {
    book: string;
    viewServices: string;
    groupsTitle: string;
    groupsLead: string;
    hotline: string;
    services: string;
    products: string;
  };
}

function lowest(group: { services: { priceMinVnd: string }[] }): bigint | null {
  let best: bigint | null = null;
  for (const service of group.services) {
    const value = BigInt(service.priceMinVnd);
    if (best === null || value < best) best = value;
  }
  return best;
}

/** The text of one campaign for a banner (only the Owner's words; the button says "Xem ưu đãi" while online sales are closed). */
function campaignOf(
  campaigns: readonly PublicCampaign[] | null | undefined,
  locale: Locale,
  onlineOpen: boolean,
): PreviewModel['campaign'] {
  const first = campaigns?.[0];
  if (!first) return null;
  return {
    name: first.name,
    message: first.message ?? '',
    href: `/${locale}/products?campaign=${encodeURIComponent(first.slug)}`,
    cta: onlineOpen
      ? (first.ctaLabel ?? 'Xem ưu đãi')
      : locale === 'vi'
        ? 'Xem ưu đãi'
        : 'See the offer',
    badge: first.badge ?? null,
  };
}

export function previewModel(locale: Locale, data: HomeData): PreviewModel {
  const text = getSiteText(locale);
  const { site, services } = data;
  const hours = site ? hoursHeadline(site.hours, locale, text.home.closed) : null;
  const groups = services ? homeGroups(services, site) : [];
  return {
    locale,
    tagline: site?.tagline ?? 'Lucy Spa',
    intro: site?.intro ?? text.home.lead,
    hours: hours ? { value: hours.value, label: hours.label } : null,
    address: site?.address ?? null,
    directions: site ? directionsUrl(site) : null,
    hotline: site?.hotline ?? null,
    tel: site ? telHref(site) : null,
    heroImage: site?.heroImage ?? null,
    groups: groups.map(({ group, description }) => {
      const cheapest = lowest(group);
      const sample = group.services.find((service) => BigInt(service.priceMinVnd) === cheapest);
      return {
        code: group.code,
        name: group.name,
        description,
        count: group.services.length,
        from: sample ? cardPrice(sample, locale) : null,
        services: group.services.slice(0, 5).map((service) => ({
          code: service.code,
          name: service.name,
          price: cardPrice(service, locale),
          estimate: serviceEstimate(service, locale),
          href: serviceHref(locale, service.code),
        })),
      };
    }),
    campaign: campaignOf(data.campaigns, locale, data.onlineOpen === true),
    links: {
      book: `/${locale}/account/book`,
      services: `/${locale}/services`,
      products: `/${locale}/products`,
      home: `/${locale}`,
    },
    words: {
      book: text.home.bookNow,
      viewServices: text.home.viewServices,
      groupsTitle: text.home.groupsTitle,
      groupsLead: text.home.groupsLead,
      hotline: text.home.hotline,
      services: text.nav.services,
      products: text.nav.products,
    },
  };
}

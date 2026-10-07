import type {
  PublicHoursGroup,
  PublicProductDetail,
  PublicServiceDetailResponse,
  PublicSiteResponse,
} from '@lucy-spa/contracts';
import type { Locale } from '../i18n/locales';
import { moneyText } from './public-products-core';
import { servicePrice } from './public-site-core';

// Search-engine data of the public pages (Part 2 contract 9, decision Q-P2-4): the address a crawler should use, the
// language alternates, the LocalBusiness data, the sitemap and the robots rules. Pure, so every rule is unit-tested.
// Only the home page, the service list and a service's page are indexable; the member area, the sign-in pages and the
// staff area never are.

export const SEO_LOCALES: readonly Locale[] = ['vi', 'en'];

/** Paths a crawler must not fetch (the pages also say `noindex` themselves). */
export const ROBOTS_DISALLOW: readonly string[] = [
  '/vi/account',
  '/en/account',
  '/vi/workforce',
  '/en/workforce',
  '/vi/season-preview',
  '/en/season-preview',
  '/api/',
];

const HOST = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/i;

/**
 * The public address of the site as the visitor reached it (no setting to keep in step with the deployment).
 * Behind the reverse proxy the forwarded host and protocol are the visitor's; a value that is not a plain host name is
 * ignored, so a crafted header cannot put markup or another scheme into a page. `null` when nothing usable arrives.
 */
export function siteOrigin(read: (name: string) => string | null | undefined): string | null {
  const first = (value: string | null | undefined) => value?.split(',')[0]?.trim() ?? '';
  const host = first(read('x-forwarded-host')) || first(read('host'));
  if (!HOST.test(host)) return null;
  const forwarded = first(read('x-forwarded-proto')).toLowerCase();
  const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  const protocol =
    forwarded === 'http' || forwarded === 'https' ? forwarded : local ? 'http' : 'https';
  return `${protocol}://${host}`;
}

/** The same page in both languages plus the default, for `<link rel="alternate" hreflang>` and the sitemap. */
export function languageAlternates(origin: string, path: string): Record<string, string> {
  return {
    vi: `${origin}/vi${path}`,
    en: `${origin}/en${path}`,
    'x-default': `${origin}/vi${path}`,
  };
}

export const ogLocale = (locale: Locale): string => (locale === 'vi' ? 'vi_VN' : 'en_US');

/** At most `max` characters, cut at a word and closed with an ellipsis. */
export function clip(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export function serviceDescription(
  detail: PublicServiceDetailResponse,
  locale: Locale,
  siteName: string,
): string {
  const { service } = detail;
  const price = servicePrice(service, locale);
  const lead =
    service.description?.trim() ||
    (locale === 'vi'
      ? `${service.name} tại ${siteName}, nhóm ${detail.group.name}.`
      : `${service.name} at ${siteName}, in ${detail.group.name}.`);
  return clip(`${lead} ${locale === 'vi' ? 'Giá' : 'Price'} ${price}.`);
}

/** The description of a product's page: its own text, else its name and category; always with the price ("from" when sizes differ). */
export function productDescription(
  product: PublicProductDetail,
  locale: Locale,
  siteName: string,
  address: string | null,
): string {
  const cheapest = product.variants.reduce<string>(
    (min, variant) => (BigInt(variant.price.priceVnd) < BigInt(min) ? variant.price.priceVnd : min),
    product.variants[0]?.price.priceVnd ?? '0',
  );
  const price =
    cheapest === product.priceMaxVnd
      ? moneyText(cheapest, locale)
      : `${locale === 'vi' ? 'từ' : 'from'} ${moneyText(cheapest, locale)}`;
  const category = product.category?.name ?? null;
  const lead =
    product.description?.trim() ||
    (locale === 'vi'
      ? `${product.name} tại ${siteName}${category ? `, danh mục ${category}` : ''}.`
      : `${product.name} at ${siteName}${category ? `, in ${category}` : ''}.`);
  const where = address ? ` ${locale === 'vi' ? 'Mua tại' : 'Buy at'} ${address}.` : '';
  return clip(`${lead} ${locale === 'vi' ? 'Giá' : 'Price'} ${price}.${where}`);
}

const DAY = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;

/** schema.org times are `HH:MM`; a closing time of 24:00 is the last minute of the day. */
const clock = (value: string) => (value === '24:00' ? '23:59' : value);

export function openingHoursSpecification(hours: readonly PublicHoursGroup[]) {
  return hours.flatMap((group) => {
    if (group.closed || !group.opensAt || !group.closesAt) return [];
    const dayOfWeek = group.weekdays.flatMap((weekday) => {
      const name = DAY[weekday - 1];
      return name ? [name] : [];
    });
    if (dayOfWeek.length === 0) return [];
    return [
      {
        '@type': 'OpeningHoursSpecification',
        dayOfWeek,
        opens: clock(group.opensAt),
        closes: clock(group.closesAt),
      },
    ];
  });
}

/** The shop as a LocalBusiness (a day spa), only from what the Owner entered in Shop info. */
export function localBusinessJsonLd(
  site: PublicSiteResponse,
  origin: string,
  locale: Locale,
  image: string | null,
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'DaySpa',
    name: 'Lucy Spa',
    slogan: site.tagline,
    url: `${origin}/${locale}`,
    telephone: site.hotlineTel,
    address: { '@type': 'PostalAddress', streetAddress: site.address, addressCountry: 'VN' },
    ...(image ? { image } : {}),
    ...(site.mapUrl ? { hasMap: site.mapUrl } : {}),
    openingHoursSpecification: openingHoursSpecification(site.hours),
  };
}

/** JSON for a `<script type="application/ld+json">`: `<`, `>` and `&` are escaped so the data can never close the tag. */
export function jsonLdString(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026');
}

export interface SitemapEntry {
  url: string;
  alternates: Record<string, string>;
}

/** Every indexable page in both languages, each with its alternates: home, the service list and each service's page, the cosmetics list and each product's page. */
export function sitemapEntries(
  origin: string,
  serviceCodes: readonly string[],
  productCodes: readonly string[] = [],
): SitemapEntry[] {
  const paths = [
    '',
    '/services',
    ...serviceCodes.map((code) => `/services/${encodeURIComponent(code)}`),
    '/products',
    ...productCodes.map((code) => `/products/${encodeURIComponent(code)}`),
  ];
  return paths.flatMap((path) =>
    SEO_LOCALES.map((locale) => ({
      url: `${origin}/${locale}${path}`,
      alternates: languageAlternates(origin, path),
    })),
  );
}

/** The absolute address of one of the site's own relative image paths, or null for anything that is not one. */
export function absoluteImage(origin: string, url: string | undefined): string | null {
  if (!url) return null;
  if (url.startsWith('/') && !url.startsWith('//')) return `${origin}${url}`;
  return /^https:\/\//.test(url) ? url : null;
}

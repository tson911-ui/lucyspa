import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { Locale } from '../i18n/locales';
import { getSiteText } from '../i18n/site';
import { isPlainList, type ProductsState } from './public-products-core';
import {
  fetchPublicProduct,
  fetchPublicProductCodes,
  fetchPublicProducts,
  fetchPublicService,
  fetchPublicServices,
  fetchPublicSite,
} from './public-site';
import {
  absoluteImage,
  clip,
  languageAlternates,
  ogLocale,
  productDescription,
  serviceDescription,
  siteOrigin,
} from './seo-core';

// Titles, descriptions, canonical and language links, Open Graph and Twitter data of the three indexable pages
// (home, service list, a service). The text comes from the shop profile and the live catalogue, never from here.

const SITE_NAME = 'Lucy Spa';

/** The address the visitor (or crawler) used to reach the site; null when the request names no usable host. */
export async function requestOrigin(): Promise<string | null> {
  const incoming = await headers();
  return siteOrigin((name) => incoming.get(name));
}

function indexable(input: {
  locale: Locale;
  origin: string | null;
  path: string;
  title: string;
  description: string;
  image: string | null;
}): Metadata {
  const { locale, origin, path, title, description, image } = input;
  const url = origin ? `${origin}/${locale}${path}` : undefined;
  return {
    title,
    description,
    robots: { index: true, follow: true },
    ...(origin && url
      ? { alternates: { canonical: url, languages: languageAlternates(origin, path) } }
      : {}),
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      locale: ogLocale(locale),
      title,
      description,
      ...(url ? { url } : {}),
      ...(image ? { images: [{ url: image }] } : {}),
    },
    twitter: { card: image ? 'summary_large_image' : 'summary', title, description },
  };
}

export async function homeMetadata(locale: Locale): Promise<Metadata> {
  const [site, origin] = await Promise.all([fetchPublicSite(locale), requestOrigin()]);
  const text = getSiteText(locale);
  const widest = site?.heroImage?.sources[site.heroImage.sources.length - 1];
  const lead = site?.intro ?? text.home.lead;
  return indexable({
    locale,
    origin,
    path: '',
    title: site ? `${SITE_NAME} — ${site.tagline}` : SITE_NAME,
    description: clip(site ? `${lead} ${site.address}` : lead),
    image: origin ? absoluteImage(origin, widest?.url) : null,
  });
}

export async function servicesMetadata(locale: Locale): Promise<Metadata> {
  const [site, origin] = await Promise.all([fetchPublicSite(locale), requestOrigin()]);
  const text = getSiteText(locale);
  return indexable({
    locale,
    origin,
    path: '/services',
    title: `${text.services.title} · ${SITE_NAME}`,
    description: clip(
      site ? `${text.services.lead} ${SITE_NAME}, ${site.address}` : text.services.lead,
    ),
    image: null,
  });
}

export async function serviceMetadata(locale: Locale, code: string): Promise<Metadata> {
  const [detail, origin] = await Promise.all([fetchPublicService(locale, code), requestOrigin()]);
  const text = getSiteText(locale);
  // An unknown or paused service is a 404 page and says so; a failed read keeps the page out of the index.
  if (detail === 'missing' || detail === null) {
    return { title: `${text.services.notFoundTitle} · ${SITE_NAME}`, robots: { index: false } };
  }
  return indexable({
    locale,
    origin,
    path: `/services/${encodeURIComponent(detail.service.code)}`,
    title: `${detail.service.name} · ${SITE_NAME}`,
    description: serviceDescription(detail, locale, SITE_NAME),
    image: null,
  });
}

/** The codes of every service the public catalogue shows, for the sitemap (empty when it cannot be read). */
export async function publicServiceCodes(): Promise<string[]> {
  const catalogue = await fetchPublicServices('vi');
  return catalogue
    ? catalogue.groups.flatMap((group) => group.services.map((entry) => entry.code))
    : [];
}

/**
 * The cosmetics list. Its address and the hero's words are the Owner's; a search, a filter or a later page is a view of the same
 * list, so it names the plain list as canonical and stays out of the index (its links are still followed).
 */
export async function productsMetadata(locale: Locale, state: ProductsState): Promise<Metadata> {
  const [site, data, origin] = await Promise.all([
    fetchPublicSite(locale),
    // The plain first page is what a crawler reads; it is also the one already in the 60-second memory.
    fetchPublicProducts(locale, {
      ...state,
      campaign: '',
      q: '',
      category: '',
      brand: '',
      sort: 'featured',
      page: 1,
    }),
    requestOrigin(),
  ]);
  const text = getSiteText(locale);
  const title = data?.hero?.title ?? text.products.title;
  const lead = data?.hero?.text ?? text.products.lead;
  const widest = data?.hero?.image?.sources.at(-1);
  const metadata = indexable({
    locale,
    origin,
    path: '/products',
    title: `${title} · ${SITE_NAME}`,
    description: clip(site ? `${lead} ${SITE_NAME}, ${site.address}` : lead),
    image: origin ? absoluteImage(origin, widest?.url) : null,
  });
  // A list with nothing in it (no published product yet) is not worth indexing either.
  const empty = data !== null && data.total === 0;
  return isPlainList(state) && !empty
    ? metadata
    : { ...metadata, robots: { index: false, follow: true } };
}

export async function productMetadata(locale: Locale, code: string): Promise<Metadata> {
  const [detail, site, origin] = await Promise.all([
    fetchPublicProduct(locale, code),
    fetchPublicSite(locale),
    requestOrigin(),
  ]);
  const text = getSiteText(locale);
  // An unknown, unpublished or discontinued product is a 404 page and says so; a failed read keeps the page out of the index.
  if (detail === 'missing' || detail === null) {
    return { title: `${text.products.notFoundTitle} · ${SITE_NAME}`, robots: { index: false } };
  }
  const widest = detail.product.images[0]?.sources.at(-1);
  return indexable({
    locale,
    origin,
    path: `/products/${encodeURIComponent(detail.product.code)}`,
    title: `${detail.product.name} · ${SITE_NAME}`,
    description: productDescription(detail.product, locale, SITE_NAME, site?.address ?? null),
    image: origin ? absoluteImage(origin, widest?.url) : null,
  });
}

/** The codes of every visible product, for the sitemap (empty when they cannot be read). */
export const publicProductCodes = (): Promise<string[]> => fetchPublicProductCodes();

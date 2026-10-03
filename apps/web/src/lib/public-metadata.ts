import type { Metadata } from 'next';
import { headers } from 'next/headers';
import type { Locale } from '../i18n/locales';
import { getSiteText } from '../i18n/site';
import { fetchPublicService, fetchPublicServices, fetchPublicSite } from './public-site';
import {
  absoluteImage,
  clip,
  languageAlternates,
  ogLocale,
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
  return indexable({
    locale,
    origin,
    path: '',
    title: site ? `${SITE_NAME} — ${site.tagline}` : SITE_NAME,
    description: clip(site ? `${text.home.lead} ${site.address}` : text.home.lead),
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

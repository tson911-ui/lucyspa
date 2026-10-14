import type { MetadataRoute } from 'next';
import {
  homeEnglishApproved,
  publicPageTargets,
  publicProductTargets,
  publicServiceTargets,
  requestOrigin,
} from '../lib/public-metadata';
import { sitemapEntries } from '../lib/seo-core';

// The indexable pages with their language alternates (the English ones only once their English text is approved). The services and the cosmetics come from the live
// public catalogue (cached a minute); when it cannot be read the sitemap lists the fixed pages only.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await requestOrigin();
  if (!origin) return [];
  const [services, products, homeEnglish, pages] = await Promise.all([
    publicServiceTargets(),
    publicProductTargets(),
    homeEnglishApproved(),
    publicPageTargets(),
  ]);
  return sitemapEntries(origin, services, products, homeEnglish, pages).map((entry) => ({
    url: entry.url,
    alternates: { languages: entry.alternates },
  }));
}

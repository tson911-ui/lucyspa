import type { MetadataRoute } from 'next';
import { publicProductCodes, publicServiceCodes, requestOrigin } from '../lib/public-metadata';
import { sitemapEntries } from '../lib/seo-core';

// The indexable pages in both languages with their language alternates. The services and the cosmetics come from the live
// public catalogue (cached a minute); when it cannot be read the sitemap lists the fixed pages only.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await requestOrigin();
  if (!origin) return [];
  const [services, products] = await Promise.all([publicServiceCodes(), publicProductCodes()]);
  return sitemapEntries(origin, services, products).map((entry) => ({
    url: entry.url,
    alternates: { languages: entry.alternates },
  }));
}

import type { MetadataRoute } from 'next';
import { publicServiceCodes, requestOrigin } from '../lib/public-metadata';
import { sitemapEntries } from '../lib/seo-core';

// The indexable pages in both languages with their language alternates. The services come from the live public
// catalogue (cached a minute); when it cannot be read the sitemap lists the fixed pages only.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await requestOrigin();
  if (!origin) return [];
  return sitemapEntries(origin, await publicServiceCodes()).map((entry) => ({
    url: entry.url,
    alternates: { languages: entry.alternates },
  }));
}

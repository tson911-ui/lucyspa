import type { MetadataRoute } from 'next';
import { requestOrigin } from '../lib/public-metadata';
import { ROBOTS_DISALLOW } from '../lib/seo-core';

// Crawlers may read the public pages; the member area, the sign-in pages (inside it), the staff area and the API
// are off limits (the pages are also `noindex` themselves).
export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await requestOrigin();
  return {
    rules: [{ userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW] }],
    ...(origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  };
}

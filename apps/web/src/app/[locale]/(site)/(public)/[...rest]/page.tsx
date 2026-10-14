import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { InfoPageView } from '../../../../../components/public/info-view';
import { isLocale } from '../../../../../i18n/locales';
import { pageMetadata } from '../../../../../lib/public-metadata';
import { fetchPublicPage } from '../../../../../lib/public-site';

interface RestPageProps {
  params: Promise<{ locale: string; rest: string[] }>;
}

/** An information page the Owner published lives at one segment under the language: `/vi/chinh-sach-bao-mat`. */
const slugOf = (rest: string[]): string | null => (rest.length === 1 ? (rest[0] ?? null) : null);

export async function generateMetadata({ params }: RestPageProps): Promise<Metadata> {
  const { locale, rest } = await params;
  if (!isLocale(locale)) notFound();
  const slug = slugOf(rest);
  return slug === null ? { robots: { index: false } } : pageMetadata(locale, slug);
}

/**
 * Any address under a language that no other page answers. One segment that names a published information page is that page;
 * everything else is a real 404 inside the site frame (header, footer, tab bar), drawn by the group's `not-found.tsx`. More specific
 * routes (services, products, account, workforce, contact, ...) always win over this catch-all, and `RESERVED_PAGE_SLUGS` keeps a
 * page from taking one of their names.
 */
export default async function RestPage({ params }: RestPageProps) {
  const { locale, rest } = await params;
  if (!isLocale(locale)) notFound();
  const slug = slugOf(rest);
  if (slug === null) notFound();
  const page = await fetchPublicPage(locale, slug);
  // Only the API saying "there is no such published page" is a 404: a page that could not be read is the error page, so a
  // slow or restarting API never leaves a remembered 404 for a real policy.
  if (page === 'missing') notFound();
  if (page === null) throw new Error('The information page could not be read');
  return <InfoPageView locale={locale} page={page} />;
}

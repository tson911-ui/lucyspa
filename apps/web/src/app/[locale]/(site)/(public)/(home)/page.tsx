import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { HomeContent } from '../../../../../components/public/home-content';
import { isLocale } from '../../../../../i18n/locales';
import { loadHomeData } from '../../../../../lib/public-site';
import { homeMetadata, requestOrigin } from '../../../../../lib/public-metadata';
import { absoluteImage, jsonLdString, localBusinessJsonLd } from '../../../../../lib/seo-core';

interface HomePageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: HomePageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return homeMetadata(locale);
}

export default async function HomePage({ params }: HomePageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const [data, origin] = await Promise.all([loadHomeData(locale), requestOrigin()]);
  const site = data.site;
  const widest = site?.heroImage?.sources[site.heroImage.sources.length - 1];
  // The shop as structured data, from what the Owner entered in Shop info; nothing without it.
  const business =
    site && origin
      ? localBusinessJsonLd(site, origin, locale, absoluteImage(origin, widest?.url))
      : null;
  return (
    <>
      {business ? (
        <script
          type="application/ld+json"
          // The string escapes < > & so the data cannot close the tag.
          dangerouslySetInnerHTML={{ __html: jsonLdString(business) }}
        />
      ) : null}
      <HomeContent locale={locale} data={data} />
    </>
  );
}

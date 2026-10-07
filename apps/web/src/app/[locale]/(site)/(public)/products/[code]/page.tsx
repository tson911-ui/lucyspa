import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ProductDetailView } from '../../../../../../components/public/products-view';
import { isLocale } from '../../../../../../i18n/locales';
import { productMetadata, requestOrigin } from '../../../../../../lib/public-metadata';
import { productHref, productJsonLd } from '../../../../../../lib/public-products-core';
import { fetchPublicProduct, fetchPublicSite } from '../../../../../../lib/public-site';
import { absoluteImage, jsonLdString } from '../../../../../../lib/seo-core';

interface ProductPageProps {
  params: Promise<{ locale: string; code: string }>;
}

export async function generateMetadata({ params }: ProductPageProps): Promise<Metadata> {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  return productMetadata(locale, code);
}

export default async function ProductPage({ params }: ProductPageProps) {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  const [detail, site, origin] = await Promise.all([
    fetchPublicProduct(locale, code),
    fetchPublicSite(locale),
    requestOrigin(),
  ]);
  // An unknown, unpublished or discontinued product is a real 404; a failed read is a notice, not a 404.
  if (detail === 'missing') notFound();
  const structured =
    detail && origin
      ? productJsonLd(detail.product, {
          url: `${origin}${productHref(locale, detail.product.code)}`,
          images: detail.product.images.flatMap((image) => {
            const widest = image.sources[image.sources.length - 1];
            const url = widest ? absoluteImage(origin, widest.url) : null;
            return url ? [url] : [];
          }),
        })
      : null;
  return (
    <>
      {structured ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString(structured) }}
        />
      ) : null}
      <ProductDetailView locale={locale} detail={detail} site={site} />
    </>
  );
}

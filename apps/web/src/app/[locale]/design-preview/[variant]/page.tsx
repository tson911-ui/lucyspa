import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PreviewA } from '../../../../components/design-preview/preview-a';
import { PreviewB } from '../../../../components/design-preview/preview-b';
import { PreviewC } from '../../../../components/design-preview/preview-c';
import { previewModel } from '../../../../components/design-preview/preview-model';
import { isLocale } from '../../../../i18n/locales';
import { loadHomeData } from '../../../../lib/public-site';

// Hidden previews of three home-page directions (owner request 2026-10-09): not in a menu, not in the sitemap, not indexed. They draw
// the shop's real data (Shop info, the catalogue, the running campaign); the page the visitors see is unchanged.
export const metadata: Metadata = { robots: { index: false, follow: false } };

const VARIANTS = ['a', 'b', 'c'] as const;
type Variant = (typeof VARIANTS)[number];
const isVariant = (value: string): value is Variant =>
  (VARIANTS as readonly string[]).includes(value);

export function generateStaticParams() {
  return VARIANTS.map((variant) => ({ variant }));
}

export default async function DesignPreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; variant: string }>;
  searchParams: Promise<{ bare?: string }>;
}) {
  const { locale, variant } = await params;
  if (!isLocale(locale) || !isVariant(variant)) notFound();
  const { bare } = await searchParams;
  const model = previewModel(locale, await loadHomeData(locale));
  return (
    <>
      {variant === 'a' ? <PreviewA model={model} /> : null}
      {variant === 'b' ? <PreviewB model={model} /> : null}
      {variant === 'c' ? <PreviewC model={model} /> : null}
      {bare ? null : (
        <nav className="dp-switch" aria-label="Bản xem thử">
          {VARIANTS.map((entry) => (
            <Link
              key={entry}
              href={`/${locale}/design-preview/${entry}`}
              aria-current={entry === variant ? 'page' : undefined}
            >
              {entry.toUpperCase()}
            </Link>
          ))}
        </nav>
      )}
    </>
  );
}

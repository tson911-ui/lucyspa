import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { ProductsView } from '../../../../../../components/public/products-view';
import { isLocale } from '../../../../../../i18n/locales';
import { productsMetadata } from '../../../../../../lib/public-metadata';
import { fetchPublicProducts } from '../../../../../../lib/public-site';
import {
  lastPage,
  productsHref,
  productsStateOf,
} from '../../../../../../lib/public-products-core';

interface ProductsPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({
  params,
  searchParams,
}: ProductsPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return productsMetadata(locale, productsStateOf(await searchParams));
}

export default async function ProductsPage({ params, searchParams }: ProductsPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const state = productsStateOf(await searchParams);
  const data = await fetchPublicProducts(locale, state);
  // A page past the end (a stale link, or products that were taken down) goes to the last page that exists.
  if (data && data.items.length === 0 && data.total > 0 && state.page > lastPage(data.total)) {
    redirect(productsHref(locale, { ...state, page: lastPage(data.total) }));
  }
  return <ProductsView locale={locale} data={data} state={state} />;
}

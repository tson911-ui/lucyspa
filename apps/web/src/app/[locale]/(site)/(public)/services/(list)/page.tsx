import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServicesView } from '../../../../../../components/public/services-view';
import { isLocale } from '../../../../../../i18n/locales';
import { servicesMetadata } from '../../../../../../lib/public-metadata';
import { fetchPublicServices } from '../../../../../../lib/public-site';
import { groupFilter } from '../../../../../../lib/public-site-core';

interface ServicesPageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ group?: string | string[] }>;
}

export async function generateMetadata({
  params,
}: Pick<ServicesPageProps, 'params'>): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return servicesMetadata(locale);
}

export default async function ServicesPage({ params, searchParams }: ServicesPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  const data = await fetchPublicServices(locale);
  const { group } = await searchParams;
  return (
    <ServicesView locale={locale} data={data} group={data ? groupFilter(group, data.groups) : ''} />
  );
}

import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ServiceDetailView } from '../../../../../components/public/services-view';
import { isLocale } from '../../../../../i18n/locales';
import { serviceMetadata } from '../../../../../lib/public-metadata';
import { fetchPublicService } from '../../../../../lib/public-site';

interface ServicePageProps {
  params: Promise<{ locale: string; code: string }>;
}

export async function generateMetadata({ params }: ServicePageProps): Promise<Metadata> {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  return serviceMetadata(locale, code);
}

export default async function ServicePage({ params }: ServicePageProps) {
  const { locale, code } = await params;
  if (!isLocale(locale)) notFound();
  const detail = await fetchPublicService(locale, code);
  // An unknown, paused or unavailable service is a real 404; a failed read is a notice, not a 404.
  if (detail === 'missing') notFound();
  return <ServiceDetailView locale={locale} detail={detail} />;
}

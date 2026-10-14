import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ContactView } from '../../../../../components/public/contact-view';
import { isLocale } from '../../../../../i18n/locales';
import { contactMetadata } from '../../../../../lib/public-metadata';
import { fetchPublicSite } from '../../../../../lib/public-site';

interface ContactPageProps {
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ContactPageProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return contactMetadata(locale);
}

export default async function ContactRoute({ params }: ContactPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <ContactView locale={locale} site={await fetchPublicSite(locale)} />;
}

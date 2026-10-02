import { notFound } from 'next/navigation';
import { HomeContent } from '../../../components/public/home-content';
import { isLocale } from '../../../i18n/locales';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <HomeContent locale={locale} />;
}

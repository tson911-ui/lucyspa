import { notFound } from 'next/navigation';
import { HomeContent } from '../../../../components/public/home-content';
import { isLocale } from '../../../../i18n/locales';
import { loadHomeData } from '../../../../lib/public-site';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return <HomeContent locale={locale} data={await loadHomeData(locale)} />;
}

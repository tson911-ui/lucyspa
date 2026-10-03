import { notFound } from 'next/navigation';
import { SitePageFrame } from '../../../components/public/site-page-frame';
import { isLocale } from '../../../i18n/locales';

interface PublicLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function PublicLayout({ children, params }: PublicLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <SitePageFrame locale={locale}>{children}</SitePageFrame>;
}

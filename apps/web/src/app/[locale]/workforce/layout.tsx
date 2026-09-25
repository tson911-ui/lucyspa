import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { WorkforceProvider } from '../../../components/workforce/session';
import { isLocale } from '../../../i18n/locales';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import '../../workforce.css';

interface WorkforceLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: WorkforceLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Internal application: never indexed.
  return {
    title: getWorkforceDictionary(locale).meta.title,
    robots: { index: false, follow: false },
  };
}

export default async function WorkforceLayout({ children, params }: WorkforceLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <WorkforceProvider locale={locale}>{children}</WorkforceProvider>;
}

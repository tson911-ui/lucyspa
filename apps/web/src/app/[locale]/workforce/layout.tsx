import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
// Session 10 page work (Steps 4-6), one sheet per area, after the foundation (the root layout's sheets load first).
import '@lucy-spa/ui/s10-pos.css';
import '@lucy-spa/ui/s10-admin-a.css';
import '@lucy-spa/ui/s10-admin-b.css';
import '@lucy-spa/ui/s10-admin-c.css';
import { WorkforceProvider } from '../../../components/workforce/session';
import { isLocale } from '../../../i18n/locales';
import { getWorkforceDictionary } from '../../../i18n/workforce';

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

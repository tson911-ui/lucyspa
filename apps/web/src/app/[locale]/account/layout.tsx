import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SeasonBand } from '../../../components/season/season-band';
import { CustomerProvider } from '../../../components/customer/session';
import { getCustomerDictionary } from '../../../i18n/customer';
import { isLocale } from '../../../i18n/locales';
import '../../customer.css';

interface AccountLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: AccountLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // Personal account pages: never indexed.
  return {
    title: getCustomerDictionary(locale).meta.title,
    robots: { index: false, follow: false },
  };
}

/** The member area (Phase 3 Step 4): shares the design tokens and form primitives. */
export default async function AccountLayout({ children, params }: AccountLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <div className="wf-app cu-app">
      <SeasonBand locale={locale} />
      <CustomerProvider locale={locale}>{children}</CustomerProvider>
    </div>
  );
}

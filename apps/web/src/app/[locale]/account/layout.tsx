import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SitePageFrame } from '../../../components/public/site-page-frame';
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

/** The member area and its sign-in pages: the shared site frame around the customer session provider. */
export default async function AccountLayout({ children, params }: AccountLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <SitePageFrame locale={locale}>
      <CustomerProvider locale={locale}>{children}</CustomerProvider>
    </SitePageFrame>
  );
}

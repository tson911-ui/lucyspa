import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CustomerProvider } from '../../../../components/customer/session';
import { ShopFrame } from '../../../../components/shop/shop-frame';
import { getCustomerDictionary } from '../../../../i18n/customer';
import { isLocale } from '../../../../i18n/locales';

interface ShopLayoutProps {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}

export async function generateMetadata({ params }: ShopLayoutProps): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  // The cart and the checkout are personal pages: never indexed.
  return {
    title: getCustomerDictionary(locale).meta.title,
    robots: { index: false, follow: false },
  };
}

/** The cart and the checkout of online ordering: the member session provider and the guard; the site frame is the `(site)` layout's. */
export default async function ShopLayout({ children, params }: ShopLayoutProps) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return (
    <CustomerProvider locale={locale}>
      <ShopFrame>{children}</ShopFrame>
    </CustomerProvider>
  );
}

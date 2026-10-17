import type { Metadata } from 'next';
import { CheckoutScreen } from '../../../../../components/shop/checkout-screen';
import { isLocale } from '../../../../../i18n/locales';
import { getShopText } from '../../../../../i18n/online-shop';
import { pageTitle } from '../../../../../lib/page-title';

interface CheckoutPageProps {
  params: Promise<{ locale: string }>;
}

/** The browser tab names the page ("Thanh toán – Lucy Spa"), not the member account; the layout keeps it out of every index. */
export async function generateMetadata({ params }: CheckoutPageProps): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? { title: pageTitle(getShopText(locale).checkout.title) } : {};
}

export default function Page() {
  return <CheckoutScreen />;
}

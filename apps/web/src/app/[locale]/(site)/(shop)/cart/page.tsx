import type { Metadata } from 'next';
import { CartScreen } from '../../../../../components/shop/cart-screen';
import { isLocale } from '../../../../../i18n/locales';
import { getShopText } from '../../../../../i18n/online-shop';
import { pageTitle } from '../../../../../lib/page-title';

interface CartPageProps {
  params: Promise<{ locale: string }>;
}

/** The browser tab names the page ("Giỏ hàng – Lucy Spa"), not the member account; the layout keeps it out of every index. */
export async function generateMetadata({ params }: CartPageProps): Promise<Metadata> {
  const { locale } = await params;
  return isLocale(locale) ? { title: pageTitle(getShopText(locale).cart.title) } : {};
}

export default function Page() {
  return <CartScreen />;
}

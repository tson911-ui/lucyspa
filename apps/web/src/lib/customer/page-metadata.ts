import type { Metadata } from 'next';
import { getCustomerDictionary, type CustomerDictionary } from '../../i18n/customer';
import { isLocale } from '../../i18n/locales';
import { pageTitle } from '../page-title';

/**
 * The browser title of a sign-in page (C71): "<page> – Lucy Spa" (C41, the one title form), so the tab and the history name the page,
 * not only "Tài khoản thành viên". The description and `noindex` come from the account and locale layouts.
 */
export async function authPageMetadata(
  params: Promise<{ locale: string }>,
  pick: (auth: CustomerDictionary['auth']) => string,
): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  return { title: pageTitle(pick(getCustomerDictionary(locale).auth)) };
}

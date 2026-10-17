import { notFound } from 'next/navigation';
import { AccountDeletedScreen } from '../../../../../components/customer/screens/account-deleted';
import { isLocale } from '../../../../../i18n/locales';

// After a deletion the session is gone: this page is outside the member area (no sign-in guard) and is a server component.
export default async function Page({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <AccountDeletedScreen locale={locale} />;
}

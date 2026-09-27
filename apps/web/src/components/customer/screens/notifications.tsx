'use client';
import { NotificationInbox } from '../../notifications/inbox';
import { useCustomer, useCustomerAccount } from '../session';
export function CustomerNotificationsScreen() {
  const { api, base, locale } = useCustomer();
  const { account } = useCustomerAccount();
  return <NotificationInbox api={api} account={account} base={base} locale={locale} />;
}

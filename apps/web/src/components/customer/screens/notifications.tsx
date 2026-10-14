'use client';
import { getNotificationDictionary } from '../../../i18n/notifications';
import { NotificationInbox } from '../../notifications/inbox';
import { AccountScreen } from '../account-frame';
import { useCustomer, useCustomerAccount } from '../session';
export function CustomerNotificationsScreen() {
  const { api, base, locale } = useCustomer();
  const { account } = useCustomerAccount();
  const t = getNotificationDictionary(locale);
  return (
    <NotificationInbox
      api={api}
      account={account}
      base={base}
      locale={locale}
      audience="customer"
      frame={({ actions, children }) => (
        <AccountScreen title={t.title} description={t.introCustomer} actions={actions}>
          {children}
        </AccountScreen>
      )}
    />
  );
}

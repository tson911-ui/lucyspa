'use client';
import { Page } from '@lucy-spa/ui';
import { NotificationInbox } from '../../notifications/inbox';
import { useCustomer, useCustomerAccount } from '../session';
export function CustomerNotificationsScreen() {
  const { api, base, locale } = useCustomer();
  const { account } = useCustomerAccount();
  return (
    <Page>
      <NotificationInbox
        api={api}
        account={account}
        base={base}
        locale={locale}
        audience="customer"
      />
    </Page>
  );
}

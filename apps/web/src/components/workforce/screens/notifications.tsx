'use client';
import { NotificationInbox } from '../../notifications/inbox';
import { useAccount, useWorkforce } from '../session';
export function WorkforceNotificationsScreen() {
  const { api, base, locale } = useWorkforce();
  const { account } = useAccount();
  return <NotificationInbox api={api} account={account} base={base} locale={locale} />;
}

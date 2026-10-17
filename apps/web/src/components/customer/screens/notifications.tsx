'use client';
import type { ReactNode } from 'react';
import { getNotificationDictionary } from '../../../i18n/notifications';
import { NotificationInbox } from '../../notifications/inbox';
import { AccountScreen } from '../account-frame';
import { useCustomer, useCustomerAccount } from '../session';

/**
 * The member's notifications in the account frame. "Đánh dấu tất cả đã đọc" is a list action, so it sits at the trailing edge above the
 * list (not in the title band, where it competed with the tabs); `ls-mem-inbox` is the hook of this page's list rules (s10-member.css).
 */
export function CustomerNotificationsScreen() {
  const { api, base, locale } = useCustomer();
  const { account } = useCustomerAccount();
  const t = getNotificationDictionary(locale);
  const frame = ({ actions, children }: { actions: ReactNode; children: ReactNode }) => (
    <AccountScreen title={t.title} description={t.introCustomer}>
      <div className="ls-mem-inbox">
        {actions ? <div className="ls-mem-inbox-actions">{actions}</div> : null}
        {children}
      </div>
    </AccountScreen>
  );
  return (
    <NotificationInbox
      api={api}
      account={account}
      base={base}
      locale={locale}
      audience="customer"
      frame={frame}
    />
  );
}

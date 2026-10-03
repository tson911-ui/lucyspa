'use client';

import { Menu, type MenuItem } from '@lucy-spa/ui';
import { useRouter } from 'next/navigation';
import { getSiteText, type SiteText } from '../../i18n/site';
import type { Locale } from '../../i18n/locales';
import { customerLogout } from '../../lib/customer/auth';
import { announceSessionChange } from '../../lib/site-session';
import { useUnreadCount } from '../notifications/inbox';
import { useSiteSession } from './site-session';

/** What the menu offers: sign-in and registration, or the member pages and sign-out (the order the contract lists). */
export function accountMenuItems({
  signedIn,
  base,
  text,
  go,
  signOut,
  unread = 0,
}: {
  signedIn: boolean;
  base: string;
  text: SiteText['member'];
  go: (path: string) => void;
  signOut: () => void;
  /** Unread notifications, shown beside "Thông báo". */
  unread?: number;
}): MenuItem[] {
  if (!signedIn) {
    return [
      { id: 'signin', label: text.signIn, icon: 'user', onSelect: () => go(`${base}/login`) },
      {
        id: 'register',
        label: text.register,
        icon: 'user-plus',
        onSelect: () => go(`${base}/register`),
      },
    ];
  }
  return [
    {
      id: 'bookings',
      label: text.bookings,
      icon: 'calendar-check',
      onSelect: () => go(`${base}/bookings`),
    },
    {
      id: 'invoices',
      label: text.invoices,
      icon: 'receipt',
      onSelect: () => go(`${base}/invoices`),
    },
    {
      id: 'notifications',
      label:
        unread > 0 ? `${text.notifications} (${unread > 99 ? '99+' : unread})` : text.notifications,
      icon: 'bell',
      onSelect: () => go(`${base}/notifications`),
    },
    { id: 'signout', label: text.signOut, icon: 'log-out', onSelect: signOut },
  ];
}

/**
 * The header's account control (Part 2 contract 3.3). Signed out (and for a staff session, which has no member
 * area) it offers sign-in and registration; signed in it offers the member pages and sign-out, and the unread count is
 * a badge on the same button (a separate bell would push the other tools sideways when the session becomes known).
 * It only reads who is signed in: every page and API call still authorizes on the server.
 */
export function PublicAccountMenu({ locale }: { locale: Locale }) {
  const site = getSiteText(locale);
  const router = useRouter();
  const { signedIn, api, markSignedOut } = useSiteSession();
  const { count } = useUnreadCount(signedIn ? api : null);
  const unread = count ?? 0;

  const base = `/${locale}/account`;
  const items = accountMenuItems({
    signedIn,
    base,
    text: site.member,
    unread,
    go: (path) => router.push(path),
    signOut: () => {
      void customerLogout(api)
        .catch(() => undefined)
        .finally(() => {
          markSignedOut();
          announceSessionChange();
          router.replace(`${base}/login?signedOut=1`);
        });
    },
  });
  const label =
    unread > 0
      ? `${site.header.account}, ${site.member.unread.replace('{count}', String(unread))}`
      : site.header.account;
  return (
    <span className="ls-site-account">
      <Menu label={label} items={items} icon="user" />
      {unread > 0 ? (
        <span className="ls-bell-count" data-testid="notification-badge" aria-hidden="true">
          {unread > 99 ? '99+' : unread}
        </span>
      ) : null}
    </span>
  );
}

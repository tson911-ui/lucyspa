'use client';

import { Menu, type MenuItem } from '@lucy-spa/ui';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSiteText, type SiteText } from '../../i18n/site';
import type { Locale } from '../../i18n/locales';
import { ApiClient } from '../../lib/api/client';
import { customerLogout, loadCustomerSession } from '../../lib/customer/auth';
import { announceSessionChange, SITE_SESSION_CHANGED } from '../../lib/site-session';
import { NotificationIndicator } from '../notifications/inbox';

/** What the menu offers: sign-in and registration, or the member pages and sign-out (the order the contract lists). */
export function accountMenuItems({
  signedIn,
  base,
  text,
  go,
  signOut,
}: {
  signedIn: boolean;
  base: string;
  text: SiteText['member'];
  go: (path: string) => void;
  signOut: () => void;
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
      label: text.notifications,
      icon: 'bell',
      onSelect: () => go(`${base}/notifications`),
    },
    { id: 'signout', label: text.signOut, icon: 'log-out', onSelect: signOut },
  ];
}

/**
 * The header's account control (Part 2 contract 3.3). Signed out (and for a staff session, which has no member
 * area) it offers sign-in and registration; signed in it offers the member pages and sign-out, with the unread
 * bell beside it. It only reads who is signed in: every page and API call still authorizes on the server.
 */
export function PublicAccountMenu({ locale }: { locale: Locale }) {
  const text = getSiteText(locale).member;
  const label = getSiteText(locale).header.account;
  const router = useRouter();
  const api = useMemo(() => new ApiClient(), []);
  const [signedIn, setSignedIn] = useState(false);

  const refresh = useCallback(() => {
    let active = true;
    loadCustomerSession(api)
      .then((session) => active && setSignedIn(session.kind === 'customer'))
      // A failed read keeps the signed-out menu: sign-in is always reachable.
      .catch(() => active && setSignedIn(false));
    return () => {
      active = false;
    };
  }, [api]);

  useEffect(() => {
    let cancel = refresh();
    const changed = () => {
      cancel();
      cancel = refresh();
    };
    window.addEventListener(SITE_SESSION_CHANGED, changed);
    return () => {
      cancel();
      window.removeEventListener(SITE_SESSION_CHANGED, changed);
    };
  }, [refresh]);

  const base = `/${locale}/account`;
  const items = accountMenuItems({
    signedIn,
    base,
    text,
    go: (path) => router.push(path),
    signOut: () => {
      void customerLogout(api)
        .catch(() => undefined)
        .finally(() => {
          setSignedIn(false);
          announceSessionChange();
          router.replace(`${base}/login?signedOut=1`);
        });
    },
  });
  return (
    <>
      {signedIn ? <NotificationIndicator api={api} base={base} locale={locale} /> : null}
      <Menu label={label} items={items} icon="user" />
    </>
  );
}

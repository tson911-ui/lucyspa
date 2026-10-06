'use client';

import { Menu, type MenuItem } from '@lucy-spa/ui';
import { useRouter } from 'next/navigation';
import { getSiteText, type SiteText } from '../../i18n/site';
import type { Locale } from '../../i18n/locales';
import { customerLogout } from '../../lib/customer/auth';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { announceSessionChange } from '../../lib/site-session';
import { useSiteSession } from './site-session';

/**
 * What the menu offers: sign-in and registration, or (signed in) only the account page, the rewards and sign-out, in
 * that order. Bookings and invoices are in the header menu and notifications are behind the bell.
 */
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
    { id: 'account', label: text.account, icon: 'user', onSelect: () => go(base) },
    {
      id: 'rewards',
      label: text.rewards,
      icon: 'award',
      onSelect: () => go(`${base}/loyalty`),
    },
    { id: 'signout', label: text.signOut, icon: 'log-out', onSelect: signOut },
  ];
}

/**
 * The header's account control (Part 2 contract 3.3). Signed out (and for a staff session, which has no member
 * area) it offers sign-in and registration; signed in it offers the account page, the rewards and sign-out. The
 * notification bell is its own control next to the language button. It only reads who is signed in: every page and
 * API call still authorizes on the server.
 */
export function PublicAccountMenu({ locale }: { locale: Locale }) {
  const site = getSiteText(locale);
  const router = useRouter();
  const { signedIn, api, markSignedOut } = useSiteSession();

  const base = `/${locale}/account`;
  const items = accountMenuItems({
    signedIn,
    base,
    text: site.member,
    go: (path) => router.push(path, { transitionTypes: NAV_TRANSITION }),
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
  return (
    <span className="ls-site-account">
      <Menu label={site.header.account} items={items} icon="user" />
    </span>
  );
}

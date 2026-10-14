'use client';

import { Band, Notice, SiteSubNav, type SiteLinkComponent } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import { PageBack } from '../navigation/page-back';
import { useCustomer } from './session';

const MemberLink: SiteLinkComponent = ({ children, ...rest }) => (
  <Link transitionTypes={NAV_TRANSITION} {...rest}>
    {children}
  </Link>
);

/** The member areas in the order of the quick-links list (the profile is last, as in every account menu). */
export function accountSections(
  t: ReturnType<typeof useCustomer>['t'],
  base: string,
): { key: string; label: string; href: string }[] {
  return [
    { key: 'home', label: t.home.overview, href: base },
    { key: 'bookings', label: t.home.hubBookings, href: `${base}/bookings` },
    { key: 'invoices', label: t.home.hubInvoices, href: `${base}/invoices` },
    { key: 'loyalty', label: t.home.hubRewards, href: `${base}/loyalty` },
    { key: 'orders', label: t.home.hubOrders, href: `${base}/orders` },
    { key: 'notifications', label: t.home.hubNotifications, href: `${base}/notifications` },
    { key: 'profile', label: t.home.hubProfile, href: `${base}/profile` },
  ];
}

/** The account's sub-navigation as tabs (from 768 px; a phone has the quick-links list on the account home and the Back link elsewhere). */
function AccountTabs() {
  const { t, base } = useCustomer();
  const pathname = usePathname() ?? '';
  const items = accountSections(t, base).map((section) => ({
    ...section,
    current: section.key === 'home' ? pathname === base : pathname.startsWith(section.href),
  }));
  return (
    <SiteSubNav
      label={t.nav.menu}
      items={items}
      LinkComponent={MemberLink}
      className="ls-acct-tabs"
    />
  );
}

/**
 * One screen of the member area (DESIGN.md 9.2): the title band (the Back link, the page's one h1, a sentence, the page's one action at
 * the trailing edge and, from 768 px, the account tabs) and the content band below it. `narrow` holds the content to one 720 px column
 * (a record that is not found, a form).
 */
export function AccountScreen({
  title,
  description,
  actions,
  narrow = false,
  children,
}: {
  title: string;
  description?: string | undefined;
  /** The page's one primary action (it sits at the trailing edge of the title row). */
  actions?: ReactNode;
  narrow?: boolean;
  children: ReactNode;
}) {
  const { t, locale, base, sessionLost } = useCustomer();
  return (
    <>
      <Band tone="page" className="ls-band--alt ls-acct-title">
        <PageBack root={base} publicHome={`/${locale}`} label={t.common.back} />
        <div className="ls-acct-head">
          <div className="ls-public-title">
            <h1 className="ls-h1-display">{title}</h1>
            {description ? <p className="ls-lead">{description}</p> : null}
          </div>
          {actions ? <div className="ls-acct-actions">{actions}</div> : null}
        </div>
        <AccountTabs />
      </Band>
      <Band tone="page" className="ls-band--base ls-acct-body">
        <div className="ls-acct-content" data-narrow={narrow ? 'true' : undefined}>
          {sessionLost ? <Notice tone="warning">{t.errors.sessionLost}</Notice> : null}
          {children}
        </div>
      </Band>
    </>
  );
}

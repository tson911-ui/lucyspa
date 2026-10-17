'use client';

import { Band, Notice, SiteSubNav, type SiteLinkComponent } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { hasParent } from '../../lib/navigation/back';
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
): { key: string; label: string; tabLabel?: string; href: string }[] {
  return [
    { key: 'home', label: t.home.overview, href: base },
    {
      key: 'bookings',
      label: t.home.hubBookings,
      tabLabel: t.home.tabBookings,
      href: `${base}/bookings`,
    },
    { key: 'invoices', label: t.home.hubInvoices, href: `${base}/invoices` },
    { key: 'loyalty', label: t.home.hubRewards, href: `${base}/loyalty` },
    { key: 'orders', label: t.home.hubOrders, href: `${base}/orders` },
    { key: 'notifications', label: t.home.hubNotifications, href: `${base}/notifications` },
    { key: 'profile', label: t.home.hubProfile, href: `${base}/profile` },
  ];
}

/** The account's sub-navigation as tabs (from 768 px; a phone has the quick-links list on the account home). */
function AccountTabs({ pathname }: { pathname: string }) {
  const { t, base } = useCustomer();
  const items = accountSections(t, base).map(({ tabLabel, ...section }) => ({
    ...section,
    label: tabLabel ?? section.label,
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
 * One screen of the member area (DESIGN.md 9.2, session 10): the title band (the page's one h1, a sentence, the page's one action at the
 * trailing edge and, from 768 px, the account tabs) and the content band below it. A record below a list (a booking, an invoice) has a
 * parent: it shows the Back chevron to its list and no tabs, so one navigation device is on screen (B7, C40). `narrow` holds the
 * content to one 720 px column (a record that is not found, a form).
 */
export function AccountScreen({
  title,
  description,
  actions,
  backLabel,
  narrow = false,
  children,
}: {
  title: string;
  description?: string | undefined;
  /** The page's one primary action (it sits at the trailing edge of the title row). */
  actions?: ReactNode;
  /** The accessible name of the Back chevron on a record page, naming where it goes ("Quay lại lịch hẹn"). */
  backLabel?: string | undefined;
  narrow?: boolean;
  children: ReactNode;
}) {
  const { t, locale, base, sessionLost } = useCustomer();
  const pathname = usePathname() ?? '';
  // Outside the router (a component test) there is no path: the frame draws the tabs, as on a top-level page.
  const record = pathname !== '' && hasParent(pathname, base, true);
  return (
    <>
      <Band tone="page" className="ls-band--alt ls-acct-title">
        <PageBack
          root={base}
          publicHome={`/${locale}`}
          menuRoot
          label={backLabel ?? t.common.back}
        />
        <div className="ls-acct-head">
          <div className="ls-public-title">
            <h1 className="ls-h1-display">{title}</h1>
            {description ? <p className="ls-lead">{description}</p> : null}
          </div>
          {actions ? <div className="ls-acct-actions">{actions}</div> : null}
        </div>
        {record ? null : <AccountTabs pathname={pathname} />}
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

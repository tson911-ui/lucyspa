'use client';

import { buttonClass, SiteNav, SiteSubNav, TabBar, ThemeCycle } from '@lucy-spa/ui';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { getSiteText } from '../../i18n/site';
import type { Locale } from '../../i18n/locales';
import { accountTabItems, headerNavItems, otherLocalePath, tabBarItems } from '../../lib/site-nav';
import { PublicAccountMenu } from './account-menu';

// The parts of the site chrome that depend on the current page (current menu entry, the other language's URL).

export function PublicNav({ locale }: { locale: Locale }) {
  const text = getSiteText(locale);
  const pathname = usePathname();
  return (
    <SiteNav
      label={text.nav.menu}
      items={headerNavItems(locale, pathname, text.nav)}
      LinkComponent={Link}
    />
  );
}

export function PublicTabBar({ locale }: { locale: Locale }) {
  const text = getSiteText(locale);
  const pathname = usePathname();
  return (
    <TabBar
      label={text.nav.phone}
      items={tabBarItems(locale, pathname, text.nav)}
      LinkComponent={Link}
    />
  );
}

/** Language, theme and account: round 44 px tools (40 px on a fine pointer). */
export function PublicTools({ locale }: { locale: Locale }) {
  const text = getSiteText(locale);
  const pathname = usePathname();
  const other = locale === 'vi' ? 'en' : 'vi';
  return (
    <>
      <Link
        className="ls-site-tool"
        href={otherLocalePath(pathname, locale)}
        hrefLang={other}
        lang={other}
        aria-label={text.header.switchLanguage}
      >
        {other.toUpperCase()}
      </Link>
      <ThemeCycle labels={text.header.theme} />
      <PublicAccountMenu locale={locale} />
    </>
  );
}

/** The row of the member area (overview, bookings, invoices, notifications), under the header. */
export function AccountTabs({ locale }: { locale: Locale }) {
  const text = getSiteText(locale);
  const pathname = usePathname();
  return (
    <SiteSubNav
      label={text.member.tabs}
      items={accountTabItems(locale, pathname, text.member)}
      LinkComponent={Link}
    />
  );
}

/** The header call to action; the booking pages already are the action, so it stays away from them. */
export function PublicHeaderCta({ locale }: { locale: Locale }) {
  const text = getSiteText(locale);
  const pathname = usePathname();
  if (pathname.startsWith(`/${locale}/account/book`)) return null;
  return (
    <Link className={buttonClass('primary')} href={`/${locale}/account/book`}>
      {text.header.bookNow}
    </Link>
  );
}

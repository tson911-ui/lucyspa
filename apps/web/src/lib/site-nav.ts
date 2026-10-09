import type { IconName, SiteNavItem, TabBarItem } from '@lucy-spa/ui';
import type { SiteText } from '../i18n/site';

/**
 * The one list behind the header menu, the phone tab bar and the footer (Part 2 contract 3.3). A new destination
 * (for example the cosmetics shop in a later phase) is one entry here plus its route and its text; nothing else changes.
 */
export interface SiteNavEntry {
  key: 'home' | 'services' | 'products' | 'book' | 'bookings' | 'invoices' | 'account';
  /** Path after `/{locale}`. */
  path: string;
  /** `exact` matches only the path; `prefix` also its sub-pages. */
  match: 'exact' | 'prefix';
  /** A route that does not exist yet stays out of every menu. */
  enabled: boolean;
  /** Shown only to a signed-in member (the member pages). */
  members: boolean;
  header: boolean;
  phoneTab: IconName | null;
  /** The phone tab is for visitors who are not signed in only (a member's bar already has five: OQ-P6-27). */
  phoneTabGuestsOnly?: boolean;
  /** Stays out of every menu while the shop has no published product (the page itself still answers, kindly). */
  needsProducts?: boolean;
  footer: 'discover' | null;
}

export const SITE_NAV: readonly SiteNavEntry[] = [
  {
    key: 'home',
    path: '',
    match: 'exact',
    enabled: true,
    members: false,
    header: true,
    phoneTab: 'home',
    footer: null,
  },
  {
    key: 'services',
    path: '/services',
    match: 'prefix',
    enabled: true,
    members: false,
    header: true,
    phoneTab: 'sparkles',
    footer: 'discover',
  },
  // The cosmetics catalog (Phase 6 P6-6, OQ-P6-27): one menu item for everyone; on a phone only guests get a tab.
  {
    key: 'products',
    path: '/products',
    match: 'prefix',
    enabled: true,
    members: false,
    header: true,
    phoneTab: 'droplet',
    phoneTabGuestsOnly: true,
    needsProducts: true,
    footer: 'discover',
  },
  // Booking is the header's call to action ("Đặt lịch"), not a menu item; it is a tab on phones and a footer link.
  {
    key: 'book',
    path: '/account/book',
    match: 'prefix',
    enabled: true,
    members: false,
    header: false,
    phoneTab: 'calendar-check',
    footer: 'discover',
  },
  {
    key: 'bookings',
    path: '/account/bookings',
    match: 'prefix',
    enabled: true,
    members: true,
    header: true,
    phoneTab: 'calendar',
    footer: null,
  },
  {
    key: 'invoices',
    path: '/account/invoices',
    match: 'prefix',
    enabled: true,
    members: true,
    header: true,
    phoneTab: 'receipt',
    footer: null,
  },
  // The account pages as a whole (overview, sign-in): only the account menu leads there.
  {
    key: 'account',
    path: '/account',
    match: 'prefix',
    enabled: true,
    members: false,
    header: false,
    phoneTab: null,
    footer: null,
  },
];

const hrefOf = (locale: string, entry: SiteNavEntry) => `/${locale}${entry.path}`;

/** The entry whose page `pathname` is (the longest matching path wins); null on a page that is in no menu. */
export function currentNavKey(pathname: string, locale: string): SiteNavEntry['key'] | null {
  const path = pathname.replace(/\/+$/, '');
  let best: SiteNavEntry | null = null;
  for (const entry of SITE_NAV) {
    if (!entry.enabled) continue;
    const href = hrefOf(locale, entry);
    const hit =
      entry.match === 'exact' ? path === href : path === href || path.startsWith(`${href}/`);
    if (hit && (!best || entry.path.length > best.path.length)) best = entry;
  }
  return best?.key ?? null;
}

/**
 * An entry only for signed-in members stays out of the menus of a visitor who is not signed in; the cosmetics entry stays
 * out while the shop has no published product (`hasProducts`; true when that is not known, so a failed read hides nothing).
 */
const shown = (entry: SiteNavEntry, signedIn: boolean, hasProducts: boolean) =>
  entry.enabled && (!entry.members || signedIn) && (!entry.needsProducts || hasProducts);

export function headerNavItems(
  locale: string,
  pathname: string,
  text: SiteText['nav'],
  signedIn = false,
  hasProducts = true,
): SiteNavItem[] {
  const current = currentNavKey(pathname, locale);
  return SITE_NAV.filter((entry) => entry.header && shown(entry, signedIn, hasProducts)).map(
    (entry) => ({
      key: entry.key,
      label: text[entry.key],
      href: hrefOf(locale, entry),
      current: entry.key === current,
    }),
  );
}

/** The phone tab bar: the booking tab reads "Đặt lịch" (the one booking call to action) and stands out. */
export function tabBarItems(
  locale: string,
  pathname: string,
  text: SiteText['nav'],
  signedIn = false,
  hasProducts = true,
): TabBarItem[] {
  const current = currentNavKey(pathname, locale);
  return SITE_NAV.flatMap((entry) =>
    entry.phoneTab && shown(entry, signedIn, hasProducts) && !(entry.phoneTabGuestsOnly && signedIn)
      ? [
          {
            key: entry.key,
            label: entry.key === 'book' ? text.bookNow : text[entry.key],
            href: hrefOf(locale, entry),
            icon: entry.phoneTab,
            current: entry.key === current,
            ...(entry.key === 'book' ? { emphasis: true } : {}),
          },
        ]
      : [],
  ).slice(0, 5);
}

export function footerDiscoverItems(locale: string, text: SiteText['nav'], hasProducts = true) {
  return SITE_NAV.filter(
    (entry) => shown(entry, false, hasProducts) && entry.footer === 'discover',
  ).map((entry) => ({
    key: entry.key,
    label: text[entry.key],
    href: hrefOf(locale, entry),
  }));
}

/** The same page in the other language (the path keeps everything after the locale). */
export function otherLocalePath(pathname: string, locale: string): string {
  const other = locale === 'vi' ? 'en' : 'vi';
  return pathname.replace(new RegExp(`^/${locale}(?=/|$)`), `/${other}`);
}

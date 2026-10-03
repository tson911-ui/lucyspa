import type { IconName, SiteNavItem, TabBarItem } from '@lucy-spa/ui';
import type { SiteText } from '../i18n/site';

/**
 * The one list behind the header menu, the phone tab bar and the footer (Part 2 contract 3.3). A new destination
 * (for example the cosmetics shop in a later phase) is one entry here plus its route and its text; nothing else changes.
 */
export interface SiteNavEntry {
  key: 'home' | 'services' | 'book' | 'bookings' | 'account';
  /** Path after `/{locale}`. */
  path: string;
  /** `exact` matches only the path; `prefix` also its sub-pages. */
  match: 'exact' | 'prefix';
  /** A route that does not exist yet stays out of every menu. */
  enabled: boolean;
  header: boolean;
  phoneTab: IconName | null;
  footer: 'discover' | null;
}

export const SITE_NAV: readonly SiteNavEntry[] = [
  {
    key: 'home',
    path: '',
    match: 'exact',
    enabled: true,
    header: true,
    phoneTab: 'home',
    footer: null,
  },
  {
    key: 'services',
    path: '/services',
    match: 'prefix',
    enabled: true,
    header: true,
    phoneTab: 'sparkles',
    footer: 'discover',
  },
  {
    key: 'book',
    path: '/account/book',
    match: 'prefix',
    enabled: true,
    header: true,
    phoneTab: 'calendar-check',
    footer: 'discover',
  },
  {
    key: 'bookings',
    path: '/account/bookings',
    match: 'prefix',
    enabled: true,
    header: false,
    phoneTab: 'receipt',
    footer: null,
  },
  {
    key: 'account',
    path: '/account',
    match: 'prefix',
    enabled: true,
    header: false,
    phoneTab: 'user',
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

export function headerNavItems(
  locale: string,
  pathname: string,
  text: SiteText['nav'],
): SiteNavItem[] {
  const current = currentNavKey(pathname, locale);
  return SITE_NAV.filter((entry) => entry.enabled && entry.header).map((entry) => ({
    key: entry.key,
    label: text[entry.key],
    href: hrefOf(locale, entry),
    current: entry.key === current,
  }));
}

export function tabBarItems(locale: string, pathname: string, text: SiteText['nav']): TabBarItem[] {
  const current = currentNavKey(pathname, locale);
  return SITE_NAV.flatMap((entry) =>
    entry.enabled && entry.phoneTab
      ? [
          {
            key: entry.key,
            label: text[entry.key],
            href: hrefOf(locale, entry),
            icon: entry.phoneTab,
            current: entry.key === current,
          },
        ]
      : [],
  ).slice(0, 5);
}

export function footerDiscoverItems(locale: string, text: SiteText['nav']) {
  return SITE_NAV.filter((entry) => entry.enabled && entry.footer === 'discover').map((entry) => ({
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

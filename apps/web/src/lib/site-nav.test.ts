import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSiteText } from '../i18n/site';
import {
  accountTabItems,
  SITE_NAV,
  currentNavKey,
  footerDiscoverItems,
  headerNavItems,
  otherLocalePath,
  tabBarItems,
} from './site-nav';

const vi = getSiteText('vi').nav;

test('the current menu entry is the longest matching path', () => {
  assert.equal(currentNavKey('/vi', 'vi'), 'home');
  assert.equal(currentNavKey('/vi/', 'vi'), 'home');
  assert.equal(currentNavKey('/vi/account/book', 'vi'), 'book');
  assert.equal(currentNavKey('/vi/account/book/', 'vi'), 'book');
  assert.equal(currentNavKey('/vi/account/bookings/abc', 'vi'), 'bookings');
  assert.equal(currentNavKey('/vi/account/invoices', 'vi'), 'account');
  assert.equal(currentNavKey('/vi/account/login', 'vi'), 'account');
  assert.equal(currentNavKey('/en/account/book', 'vi'), null);
  assert.equal(currentNavKey('/vi/unknown', 'vi'), null);
});

test('a route that does not exist yet stays out of every menu', () => {
  const services = SITE_NAV.find((entry) => entry.key === 'services');
  assert.ok(services);
  if (services.enabled) return; // enabled by the Step that adds the route
  assert.deepEqual(
    headerNavItems('vi', '/vi', vi).map((item) => item.key),
    ['home', 'book'],
  );
  assert.equal(currentNavKey('/vi/services', 'vi'), null);
});

test('header items carry the locale, the label and the current flag', () => {
  const items = headerNavItems('en', '/en/account/book', getSiteText('en').nav);
  const book = items.find((item) => item.key === 'book');
  assert.deepEqual(book, { key: 'book', label: 'Book', href: '/en/account/book', current: true });
  assert.equal(items.find((item) => item.key === 'home')?.current, false);
});

test('the phone tab bar never has more than five tabs and each has an icon', () => {
  const tabs = tabBarItems('vi', '/vi/account', vi);
  assert.ok(tabs.length >= 1 && tabs.length <= 5);
  assert.ok(tabs.every((tab) => tab.icon && tab.href.startsWith('/vi')));
  assert.equal(tabs.filter((tab) => tab.current).length, 1);
  assert.equal(tabs.find((tab) => tab.current)?.key, 'account');
});

test('the footer lists the discovery destinations that exist', () => {
  const items = footerDiscoverItems('vi', vi);
  assert.ok(items.every((item) => item.href.startsWith('/vi/')));
  assert.ok(items.some((item) => item.key === 'book'));
});

test('the language link keeps the rest of the path', () => {
  assert.equal(otherLocalePath('/vi', 'vi'), '/en');
  assert.equal(otherLocalePath('/vi/account/book', 'vi'), '/en/account/book');
  assert.equal(otherLocalePath('/en/services', 'en'), '/vi/services');
  assert.equal(otherLocalePath('/vietnam', 'vi'), '/vietnam');
});

test('the member row marks the overview only on its own page and the others with their sub-pages', () => {
  const text = getSiteText('vi').member;
  const current = (path: string) =>
    accountTabItems('vi', path, text)
      .filter((item) => item.current)
      .map((item) => item.key);
  assert.deepEqual(current('/vi/account'), ['overview']);
  assert.deepEqual(current('/vi/account/'), ['overview']);
  assert.deepEqual(current('/vi/account/bookings'), ['bookings']);
  assert.deepEqual(current('/vi/account/bookings/abc'), ['bookings']);
  assert.deepEqual(current('/vi/account/invoices/x'), ['invoices']);
  assert.deepEqual(current('/vi/account/notifications'), ['notifications']);
  assert.deepEqual(current('/vi/account/book'), []);
  assert.deepEqual(
    accountTabItems('en', '/en/account', getSiteText('en').member).map((item) => item.label),
    ['Overview', 'Bookings', 'Invoices', 'Notifications'],
  );
});

test('every menu label exists in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const text = getSiteText(locale).nav;
    for (const entry of SITE_NAV) assert.ok(text[entry.key].length > 0, `${locale} ${entry.key}`);
  }
});

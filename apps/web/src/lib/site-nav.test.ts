import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getSiteText } from '../i18n/site';
import {
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
  assert.equal(currentNavKey('/vi/account/invoices', 'vi'), 'invoices');
  assert.equal(currentNavKey('/vi/account/notifications', 'vi'), 'account');
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
    ['home'],
  );
  assert.equal(currentNavKey('/vi/services', 'vi'), null);
});

test('the menu is Trang chủ, Dịch vụ and Mỹ phẩm; Lịch hẹn and Hóa đơn appear only for a signed-in member; booking is no menu item', () => {
  const keys = (signedIn: boolean) =>
    headerNavItems('vi', '/vi', vi, signedIn).map((item) => item.key);
  assert.deepEqual(keys(false), ['home', 'services', 'products']);
  assert.deepEqual(keys(true), ['home', 'services', 'products', 'bookings', 'invoices']);
  assert.deepEqual(
    headerNavItems('vi', '/vi', vi, true).map((item) => item.label),
    ['Trang chủ', 'Dịch vụ', 'Mỹ phẩm', 'Lịch hẹn', 'Hóa đơn'],
  );
  // The cosmetics entry is /products (OQ-P6-27), not the reference's /my-pham; the default is the visitor who is not signed in.
  assert.equal(SITE_NAV.find((entry) => entry.key === 'products')?.path, '/products');
  assert.ok(!SITE_NAV.some((entry) => /my-pham/i.test(entry.path)));
  assert.deepEqual(headerNavItems('vi', '/vi', vi), headerNavItems('vi', '/vi', vi, false));
});

test('header items carry the locale, the label and the current flag', () => {
  const items = headerNavItems('en', '/en/account/invoices/abc', getSiteText('en').nav, true);
  const invoices = items.find((item) => item.key === 'invoices');
  assert.deepEqual(invoices, {
    key: 'invoices',
    label: 'Invoices',
    href: '/en/account/invoices',
    current: true,
  });
  assert.equal(items.find((item) => item.key === 'home')?.current, false);
  // The booking pages are in no menu entry, so no menu entry is current there.
  assert.ok(
    headerNavItems('en', '/en/account/book', getSiteText('en').nav, true).every((i) => !i.current),
  );
});

test('the phone tab bar: four tabs for a visitor (cosmetics included), five for a member (none for cosmetics), the booking tab is the call to action', () => {
  const visitor = tabBarItems('vi', '/vi', vi);
  assert.deepEqual(
    visitor.map((tab) => tab.key),
    ['home', 'services', 'products', 'book'],
  );
  assert.equal(visitor.find((tab) => tab.key === 'products')?.label, 'Mỹ phẩm');
  assert.equal(
    tabBarItems('vi', '/vi/products/kem', vi).find((tab) => tab.current)?.key,
    'products',
  );
  const member = tabBarItems('vi', '/vi/account/bookings/x', vi, true);
  assert.deepEqual(
    member.map((tab) => tab.key),
    ['home', 'services', 'book', 'bookings', 'invoices'],
  );
  assert.ok(member.every((tab) => tab.icon && tab.href.startsWith('/vi')));
  assert.equal(member.filter((tab) => tab.current).length, 1);
  assert.equal(member.find((tab) => tab.current)?.key, 'bookings');
  const book = member.find((tab) => tab.key === 'book');
  assert.equal(book?.label, 'Đặt lịch');
  assert.equal(book?.emphasis, true);
  assert.ok(member.filter((tab) => tab.emphasis).length === 1);
  // No tab leads to the account overview: the account icon in the header does.
  assert.ok(!member.some((tab) => tab.key === 'account'));
});

test('the footer lists the discovery destinations that exist', () => {
  const items = footerDiscoverItems('vi', vi);
  assert.ok(items.every((item) => item.href.startsWith('/vi/')));
  assert.ok(items.some((item) => item.key === 'book'));
  assert.ok(items.some((item) => item.key === 'products' && item.href === '/vi/products'));
});

test('while no product is published the cosmetics entry is out of the header, the phone bar and the footer', () => {
  for (const signedIn of [false, true]) {
    assert.ok(
      !headerNavItems('vi', '/vi', vi, signedIn, false).some((item) => item.key === 'products'),
    );
  }
  assert.deepEqual(
    headerNavItems('vi', '/vi', vi, false, false).map((item) => item.key),
    ['home', 'services'],
  );
  assert.deepEqual(
    tabBarItems('vi', '/vi', vi, false, false).map((tab) => tab.key),
    ['home', 'services', 'book'],
  );
  assert.ok(!footerDiscoverItems('vi', vi, false).some((item) => item.key === 'products'));
  assert.ok(footerDiscoverItems('vi', vi, false).some((item) => item.key === 'services'));
  // Not knowing (the default) leaves the entry where it is.
  assert.ok(headerNavItems('vi', '/vi', vi).some((item) => item.key === 'products'));
});

test('the language link keeps the rest of the path', () => {
  assert.equal(otherLocalePath('/vi', 'vi'), '/en');
  assert.equal(otherLocalePath('/vi/account/book', 'vi'), '/en/account/book');
  assert.equal(otherLocalePath('/en/services', 'en'), '/vi/services');
  assert.equal(otherLocalePath('/vietnam', 'vi'), '/vietnam');
});

test('every menu label exists in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const text = getSiteText(locale).nav;
    for (const entry of SITE_NAV) assert.ok(text[entry.key].length > 0, `${locale} ${entry.key}`);
  }
});

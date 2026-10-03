import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSiteText } from '../../i18n/site';
import { accountMenuItems, PublicAccountMenu } from './account-menu';

const labels = (signedIn: boolean, locale: 'vi' | 'en') =>
  accountMenuItems({
    signedIn,
    base: `/${locale}/account`,
    text: getSiteText(locale).member,
    go: () => undefined,
    signOut: () => undefined,
  }).map((item) => item.label);

test('signed out the menu offers sign-in and registration, signed in the member pages and sign-out', () => {
  assert.deepEqual(labels(false, 'vi'), ['Đăng nhập', 'Đăng ký']);
  assert.deepEqual(labels(true, 'vi'), ['Lịch hẹn', 'Hóa đơn', 'Thông báo', 'Đăng xuất']);
  assert.deepEqual(labels(false, 'en'), ['Sign in', 'Create account']);
  assert.deepEqual(labels(true, 'en'), ['Bookings', 'Invoices', 'Notifications', 'Sign out']);
});

test('choosing an entry goes to its member page; sign-out is the only entry that signs out', () => {
  const went: string[] = [];
  let signedOut = 0;
  const items = accountMenuItems({
    signedIn: true,
    base: '/vi/account',
    text: getSiteText('vi').member,
    go: (path) => went.push(path),
    signOut: () => (signedOut += 1),
  });
  for (const item of items) item.onSelect?.();
  assert.deepEqual(went, [
    '/vi/account/bookings',
    '/vi/account/invoices',
    '/vi/account/notifications',
  ]);
  assert.equal(signedOut, 1);
});

test('before the session is known the header shows one named account button and no member entries', () => {
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      <PublicAccountMenu locale="vi" />
    </AppRouterContext.Provider>,
  );
  assert.match(html, /aria-label="Tài khoản của tôi"/);
  assert.match(html, /aria-haspopup="menu"/);
  assert.doesNotMatch(html, /Lịch hẹn|Đăng xuất|notification-badge/);
});

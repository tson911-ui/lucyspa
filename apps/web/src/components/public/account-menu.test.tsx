import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { getSiteText } from '../../i18n/site';
import { accountMenuItems, PublicAccountMenu } from './account-menu';

const labels = (locale: 'vi' | 'en') =>
  accountMenuItems({
    base: `/${locale}/account`,
    text: getSiteText(locale).member,
    signOut: () => undefined,
  }).map((item) => item.label);

test('signed in the menu offers the member pages and sign-out', () => {
  assert.deepEqual(labels('vi'), ['Tài khoản của tôi', 'Điểm thưởng', 'Đăng xuất']);
  assert.deepEqual(labels('en'), ['My account', 'Rewards', 'Sign out']);
});

test('each page entry is a real link to its member page; sign-out is the only action and the only entry that signs out', () => {
  let signedOut = 0;
  const items = accountMenuItems({
    base: '/vi/account',
    text: getSiteText('vi').member,
    signOut: () => (signedOut += 1),
  });
  // Links, not router pushes from a button (wig account-menu.tsx:41): a new tab and a middle click work.
  assert.deepEqual(
    items.flatMap((item) => (item.href ? [item.href] : [])),
    ['/vi/account', '/vi/account/loyalty'],
  );
  for (const item of items) item.onSelect?.();
  assert.equal(signedOut, 1);
});

test('signed out (and before the session is known) the header shows one named link to sign-in, not a two-item menu (C47)', () => {
  const html = renderToStaticMarkup(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      <PublicAccountMenu locale="vi" />
    </AppRouterContext.Provider>,
  );
  assert.match(html, /<a[^>]*aria-label="Đăng nhập hoặc đăng ký"/);
  assert.match(html, /href="\/vi\/account\/login"/);
  assert.doesNotMatch(html, /aria-haspopup="menu"/);
  assert.doesNotMatch(html, /Điểm thưởng|Đăng xuất|notification-badge/);
});

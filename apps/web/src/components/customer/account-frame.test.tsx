import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { ApiClient } from '../../lib/api/client';
import { customer } from '../../test/support';
import { AccountScreen, accountSections } from './account-frame';
import { CustomerAccountContext, CustomerContext } from './session';
import { CustomerLoginScreen } from './screens/auth';
import { CustomerNotificationsScreen } from './screens/notifications';
import { CustomerLoyaltyScreen } from './screens/loyalty';
import { CustomerProfileScreen } from './screens/profile';

function paint(node: ReactNode, locale: Locale = 'vi', sessionLost = false): string {
  const api = new ApiClient({ fetch: () => new Promise<Response>(() => undefined) });
  return renderToStaticMarkup(
    <CustomerContext.Provider
      value={{
        locale,
        t: getCustomerDictionary(locale),
        api,
        base: `/${locale}/account`,
        sessionLost,
      }}
    >
      <CustomerAccountContext.Provider
        value={{ account: { ...customer, displayName: 'Lan' }, signOut: () => Promise.resolve() }}
      >
        <AppRouterContext.Provider value={{ push: () => undefined } as never}>
          {node}
        </AppRouterContext.Provider>
      </CustomerAccountContext.Provider>
    </CustomerContext.Provider>,
  );
}

test('C15: a member screen is a title band (one h1, the account tabs) and a content band, no member frame', () => {
  const html = paint(
    <AccountScreen title="Hóa đơn" description="Các hóa đơn của bạn">
      <p>nội dung</p>
    </AccountScreen>,
  );
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(html, /class="ls-band ls-band-page ls-band--alt ls-acct-title"/);
  assert.match(html, /class="ls-band ls-band-page ls-band--base ls-acct-body"/);
  assert.match(
    html,
    /<nav[^>]*aria-label="Điều hướng tài khoản"[^>]*class="ls-subnav ls-acct-tabs"/,
  );
  assert.doesNotMatch(html, /ls-member-page|<details|wf-/);
  assert.ok(html.includes('nội dung'));
});

test('C15: the tabs are the seven places of the account (profile last), in the order of the quick-links list, in both languages', () => {
  for (const locale of ['vi', 'en'] as const) {
    const t = getCustomerDictionary(locale);
    const base = `/${locale}/account`;
    assert.deepEqual(
      accountSections(t, base).map((section) => section.key),
      ['home', 'bookings', 'invoices', 'loyalty', 'orders', 'notifications', 'profile'],
    );
    assert.equal(accountSections(t, base)[0]?.href, base);
    // The tab row is one line at 768 px: the bookings tab says what the header menu says, the list keeps the long label.
    assert.equal(
      accountSections(t, base)[1]?.tabLabel,
      locale === 'vi' ? 'Lịch hẹn' : 'Appointments',
    );
    assert.ok(
      (accountSections(t, base)[1]?.label.length ?? 0) >
        (accountSections(t, base)[1]?.tabLabel?.length ?? 99),
    );
  }
});

test('C15: a lost session is a notice inside the content band, and the title carries the page action', () => {
  const html = paint(
    <AccountScreen title="Lịch hẹn" actions={<button type="button">Hủy</button>}>
      <p>x</p>
    </AccountScreen>,
    'vi',
    true,
  );
  assert.match(html, /class="ls-acct-actions"><button type="button">Hủy<\/button>/);
  assert.match(html, /ls-acct-content[^>]*>.*ls-notice/s);
});

test('C15: the pages that moved off the member frame each draw one h1 through the frame', () => {
  for (const node of [<CustomerNotificationsScreen />, <CustomerLoyaltyScreen />]) {
    // The first paint is already the frame (title band, tabs), with the loading state inside it: no second h1 from the inbox.
    assert.equal(paint(node).match(/<h1\b/g)?.length, 1);
  }
});

test('C15: sign-in is the wordmark above one centered card on the flat panel, no aside and no gradient classes', () => {
  const html = paint(<CustomerLoginScreen />);
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(html, /class="ls-band ls-band-page ls-auth-panel"/);
  assert.match(html, /class="ls-auth-brand" aria-hidden="true"/);
  assert.match(html, /class="ls-card ls-member-card"/);
  assert.doesNotMatch(html, /ls-member-aside|ls-member-auth/);
});

test('S7: the profile tab shows the name and language of the signed-in member inside the frame, with no form', () => {
  for (const locale of ['vi', 'en'] as const) {
    const html = paint(<CustomerProfileScreen />, locale);
    assert.equal(html.match(/<h1\b/g)?.length, 1);
    assert.ok(html.includes('Lan'));
    assert.ok(html.includes(locale === 'vi' ? 'Hồ sơ' : 'Profile'));
    assert.doesNotMatch(html, /<form|<input|<textarea/);
  }
});

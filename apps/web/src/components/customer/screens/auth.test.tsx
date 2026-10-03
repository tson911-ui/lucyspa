import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { SearchParamsContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCustomerDictionary } from '../../../i18n/customer';
import type { Locale } from '../../../i18n/locales';
import { ApiClient } from '../../../lib/api/client';
import { CustomerContext } from '../session';
import { CustomerForgotPasswordScreen, CustomerLoginScreen, CustomerRegisterScreen } from './auth';

/** A real context and an API whose requests never settle. */
function withContext(node: ReactNode, locale: Locale): ReactNode {
  const api = new ApiClient({ fetch: () => new Promise<Response>(() => undefined) });
  return (
    <CustomerContext.Provider
      value={{
        locale,
        t: getCustomerDictionary(locale),
        api,
        base: `/${locale}/account`,
        sessionLost: false,
      }}
    >
      <AppRouterContext.Provider
        value={{ push: () => undefined, replace: () => undefined } as never}
      >
        {node}
      </AppRouterContext.Provider>
    </CustomerContext.Provider>
  );
}

function paint(node: ReactNode, locale: Locale): string {
  return renderToStaticMarkup(withContext(node, locale));
}

test('the register card is one centered Card with the sign-in / register switch, no legacy classes', () => {
  const html = paint(<CustomerRegisterScreen />, 'vi');
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(html, /<main[^>]*id="main-content"/);
  assert.match(html, /class="ls-card ls-member-card"/);
  assert.match(html, /role="radiogroup"[^>]*aria-label="Đăng nhập hoặc đăng ký"/);
  assert.match(html, /aria-checked="true"[^>]*>Đăng ký</);
  assert.match(html, /aria-checked="false"[^>]*>Đăng nhập</);
  // Both passwords can be shown, every field says it is required in words.
  assert.equal(html.match(/aria-label="Hiện mật khẩu"/g)?.length, 2);
  assert.match(html, /\(bắt buộc\)/);
  assert.doesNotMatch(html, /wf-/);
});

test('the forgot-password card has no switch and ends with back (secondary) then the primary submit', () => {
  const html = paint(<CustomerForgotPasswordScreen />, 'en');
  assert.doesNotMatch(html, /role="radiogroup"/);
  assert.match(html, /<h1[^>]*>Forgot password<\/h1>/);
  const back = html.indexOf('Back to sign in');
  const send = html.indexOf('Send code');
  assert.ok(back > 0 && send > back, 'the primary action is the last one');
  assert.match(html, /href="\/en\/account\/login"/);
  assert.doesNotMatch(html, /wf-/);
});

test('sign-in puts "Quên mật khẩu?" at the end of the password label row and shows the notices', () => {
  const html = renderToStaticMarkup(
    <SearchParamsContext.Provider value={new URLSearchParams('signedOut=1&next=/vi/account/book')}>
      {withContext(<CustomerLoginScreen />, 'vi')}
    </SearchParamsContext.Provider>,
  );
  assert.match(html, /aria-checked="true"[^>]*>Đăng nhập</);
  assert.match(html, /Bạn đã đăng xuất\./);
  assert.match(
    html,
    /class="ls-label-row"><label[^>]*>Mật khẩu[\s\S]*?<\/label><span class="ls-label-action"><a href="\/vi\/account\/forgot-password">Quên mật khẩu\?<\/a>/,
  );
  assert.doesNotMatch(html, /wf-/);
});

test('without its search parameters the card paints a skeleton of the same width (no layout jump)', () => {
  const html = paint(<CustomerLoginScreen />, 'vi');
  assert.match(html, /ls-member-card/);
  assert.doesNotMatch(html, /wf-/);
});

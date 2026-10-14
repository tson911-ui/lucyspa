import type { CustomerProfileResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCustomerDictionary } from '../../../i18n/customer';
import { customerProfileDictionary } from '../../../i18n/customer-profile';
import type { Locale } from '../../../i18n/locales';
import { ApiClient } from '../../../lib/api/client';
import { CustomerContext } from '../session';
import { ProfileView } from './profile';

function paint(node: ReactNode, locale: Locale = 'vi'): string {
  const api = new ApiClient({ fetch: () => new Promise<Response>(() => undefined) });
  return renderToStaticMarkup(
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
    </CustomerContext.Provider>,
  );
}

const profile: CustomerProfileResponse = {
  fullName: 'Hoàng Thị Lan',
  email: { address: 'lan@example.com', verified: true },
  phone: '+84901234567',
  dateOfBirth: '1990-03-05',
  dateOfBirthLocked: true,
  locale: 'vi',
  version: 3,
};

test('the profile: details as text, the phone and the birthday never as fields, who changes them said once', () => {
  const html = paint(
    <ProfileView
      profile={profile}
      text={customerProfileDictionary('vi')}
      onEditName={() => undefined}
      onChangeEmail={() => undefined}
    />,
  );
  assert.match(html, /Hoàng Thị Lan/);
  assert.match(html, /0901234567/);
  assert.match(html, /05\/03\/1990/);
  assert.match(html, /lan@example\.com/);
  assert.match(html, /Đã xác minh/);
  assert.match(html, /Số điện thoại và ngày sinh do Lucy Spa quản lý/);
  // Nothing on the page itself can be typed into: editing happens in a dialog.
  assert.doesNotMatch(html, /<input|<textarea|<select/);
  // Two cards, each with its one action in the card header, and no heading carries a count or symbol.
  assert.equal(html.match(/class="ls-card[ "]/g)?.length, 2);
  assert.equal(html.match(/<h2/g)?.length, 2);
  assert.match(html, /Thông tin cá nhân/);
  assert.match(html, /Email đăng nhập/);
  assert.ok(html.indexOf('>Sửa<') > 0 && html.indexOf('>Đổi email<') > html.indexOf('>Sửa<'));
  assert.doesNotMatch(html, /wf-|<details|<fieldset/);
});

test('an unverified email is said so in words, and English reads the same page', () => {
  const html = paint(
    <ProfileView
      profile={{ ...profile, email: { address: 'lan@example.com', verified: false }, locale: 'en' }}
      text={customerProfileDictionary('en')}
      onEditName={() => undefined}
      onChangeEmail={() => undefined}
    />,
    'en',
  );
  assert.match(html, /Not verified/);
  assert.match(html, /Lucy Spa manages your phone number and date of birth/);
  assert.match(html, /Change email/);
  assert.match(html, /English/);
});

test('a missing phone or birthday shows the empty mark, never the word "null"', () => {
  const html = paint(
    <ProfileView
      profile={{ ...profile, phone: null, dateOfBirth: null, dateOfBirthLocked: false }}
      text={customerProfileDictionary('vi')}
      onEditName={() => undefined}
      onChangeEmail={() => undefined}
    />,
  );
  assert.doesNotMatch(html, /null|undefined/);
});

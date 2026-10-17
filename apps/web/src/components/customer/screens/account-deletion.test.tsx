import type { AccountDeletionCheckResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { auditArea } from '../../../i18n/audit';
import { getCustomerDictionary } from '../../../i18n/customer';
import { customerProfileDictionary } from '../../../i18n/customer-profile';
import type { Locale } from '../../../i18n/locales';
import { ApiClient, ApiError } from '../../../lib/api/client';
import {
  deleteAccount,
  deletionErrorMessage,
  orderAdvice,
  orderHref,
  sessionsLeft,
} from '../../../lib/customer/account-deletion';
import { CustomerContext } from '../session';
import { AccountDeletedScreen } from './account-deleted';
import { DeletionView } from './account-deletion';

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

const clear: AccountDeletionCheckResponse = {
  canDelete: true,
  blockers: { combos: [], orders: [], atSpa: false, openReturns: 0 },
  losses: { points: null, upcomingBookings: [] },
};

const view = (check: AccountDeletionCheckResponse, locale: Locale = 'vi') =>
  paint(
    <DeletionView
      check={check}
      text={customerProfileDictionary(locale)}
      locale={locale}
      onBlocked={() => undefined}
    />,
    locale,
  );

test('nothing blocks: what is deleted, kept and lost, then the password and Cancel before the destructive outline', () => {
  const html = view(clear);
  assert.match(html, /Những gì sẽ bị xóa/);
  assert.match(html, /Những gì Lucy Spa vẫn lưu giữ/);
  assert.match(html, /Những gì bạn sẽ mất/);
  assert.match(html, /Hóa đơn và thanh toán, theo quy định về kế toán/);
  assert.doesNotMatch(html, /Chưa thể xóa tài khoản/);
  // The password has a label and the browser's current-password hint; nothing takes the focus by itself.
  assert.match(html, /<label[^>]*>Mật khẩu hiện tại/);
  assert.match(
    html,
    /<input[^>]*autoComplete="current-password"|<input[^>]*autocomplete="current-password"/,
  );
  assert.doesNotMatch(html, /autofocus/i);
  // Cancel first, then the destructive outline; it is a plain button (Enter in the field never deletes), never filled or primary.
  const cancel = html.indexOf('href="/vi/account/profile"');
  const destroy = html.indexOf('Xóa tài khoản vĩnh viễn');
  assert.ok(cancel > 0 && destroy > cancel, 'Cancel comes before the destructive action');
  const button = /<button[^>]*class="[^"]*ls-btn-danger-outline[^"]*"[^>]*>/.exec(html)?.[0] ?? '';
  assert.match(button, /type="button"/);
  assert.doesNotMatch(html, /type="submit"/);
  assert.doesNotMatch(html, /ls-btn-primary|ls-btn-danger[ "]/);
  assert.match(html, /<form[^>]*novalidate/i);
  // Headings are text only; no "khám", no count beside a heading.
  const headings = [...html.matchAll(/<h2[^>]*>([^<]*)<\/h2>/g)].map((match) => match[1]!);
  assert.equal(headings.length, 4);
  for (const heading of headings) assert.doesNotMatch(heading, /\d|[•°#·→]/);
  assert.doesNotMatch(html, /khám|wf-|<details|<fieldset/i);
});

test('unused prepaid sessions block the deletion: said plainly, with the refund policy and the packages linked, no password asked', () => {
  const html = view({
    ...clear,
    canDelete: false,
    blockers: {
      ...clear.blockers,
      combos: [
        {
          id: 'c1',
          nameVi: 'Combo gội đầu 10 buổi',
          nameEn: 'Hair wash, 10 sessions',
          serviceNameVi: 'Gội đầu',
          serviceNameEn: 'Hair wash',
          sessionsLeft: 3,
          expiresAt: null,
        },
        {
          id: 'c2',
          nameVi: 'Gói massage chân',
          nameEn: 'Foot massage pack',
          serviceNameVi: 'Massage chân',
          serviceNameEn: 'Foot massage',
          sessionsLeft: 2,
          expiresAt: null,
        },
      ],
    },
  });
  assert.match(html, /Chưa thể xóa tài khoản/);
  assert.match(html, /Bạn còn 5 buổi đã trả trước/);
  assert.match(html, /Combo gội đầu 10 buổi: còn 3 buổi/);
  assert.match(
    html,
    /href="\/vi\/chinh-sach-doi-tra-hoan-tien"[^>]*>Chính sách đổi trả và hoàn tiền/,
  );
  // The member page's own term ("Combo của tôi"), and every link fades like the rest of the site.
  assert.match(html, /Bạn còn 5 buổi đã trả trước trong combo\./);
  assert.match(html, /href="\/vi\/account\/loyalty"[^>]*>Xem combo của tôi</);
  assert.doesNotMatch(html, /gói dịch vụ/);
  assert.doesNotMatch(html, /<input|Xóa tài khoản vĩnh viễn/);
});

test('unfinished orders say what to do; online ones link to their page, a counter pre-order has none', () => {
  const html = view({
    ...clear,
    canDelete: false,
    blockers: {
      combos: [],
      orders: [
        { id: 'o1', code: 'DH-001', kind: 'ONLINE_UNPAID', placedAt: '2026-10-15T03:00:00Z' },
        { id: 'o2', code: 'DH-002', kind: 'ONLINE_IN_PROGRESS', placedAt: '2026-10-14T03:00:00Z' },
        { id: 'o3', code: 'DT-003', kind: 'COUNTER_PREORDER', placedAt: '2026-10-13T03:00:00Z' },
      ],
      atSpa: true,
      openReturns: 1,
    },
  });
  // The order code is an identifier: page translation leaves it alone.
  assert.match(html, /Đơn <span translate="no">DH-001<\/span> đang chờ thanh toán\. Hãy hủy đơn/);
  assert.match(
    html,
    // On a line of its own with the 44 px link sizing, not a small inline target.
    /<p class="ls-acct-del-links"><a [^>]*href="\/vi\/account\/orders\/o1"[^>]*><span>Xem đơn <span translate="no">DH-001<\/span>/,
  );
  assert.match(html, /href="\/vi\/account\/orders\/o2"/);
  assert.doesNotMatch(html, /orders\/o3/);
  assert.match(html, /Đơn đặt trước <span translate="no">DT-003<\/span> chưa được nhận/);
  assert.match(html, /đang có lịch hẹn hoặc lượt làm dịch vụ tại tiệm/);
  assert.match(html, /Bạn còn 1 yêu cầu đổi trả/);
  assert.doesNotMatch(html, /<input/);
});

test('what is lost: the points as numbers and every booking that will be cancelled, in English too', () => {
  const check: AccountDeletionCheckResponse = {
    ...clear,
    losses: {
      points: { spa: 1250, beauty: 0 },
      upcomingBookings: [
        {
          id: 'b1',
          code: 'LH-1',
          branch: { id: 'br', name: 'Lucy Spa Hoàn Kiếm', timezone: 'Asia/Ho_Chi_Minh' },
          date: '2026-10-20',
          startsAt: '2026-10-20T03:00:00.000Z',
          endsAt: '2026-10-20T04:00:00.000Z',
          status: 'CONFIRMED',
          serviceNames: [{ vi: 'Gội đầu dưỡng sinh', en: 'Herbal hair wash' }],
          canCancel: true,
        },
      ],
    },
  };
  const vi = view(check);
  assert.match(vi, /1\.250 điểm Lucy Spa và 0 điểm Lucy Beauty/);
  assert.match(vi, /Các lịch hẹn sắp tới dưới đây sẽ bị hủy/);
  assert.match(vi, /Gội đầu dưỡng sinh/);
  const en = view(check, 'en');
  assert.match(en, /1,250 Lucy Spa points/);
  assert.match(en, /Herbal hair wash/);
  assert.match(en, /Delete account permanently/);
  // No points programme yet: the general line only.
  assert.doesNotMatch(view(clear), /Số điểm hiện có/);
});

test('after the deletion: one heading, one sentence and the way home as an outline link', () => {
  // A server component: no session, no provider needed.
  const html = renderToStaticMarkup(<AccountDeletedScreen locale="vi" />);
  assert.equal(html.match(/<h1/g)?.length, 1);
  assert.match(html, /Tài khoản đã được xóa/);
  assert.match(html, /Bạn đã được đăng xuất/);
  assert.match(
    html,
    /<a[^>]*href="\/vi"[^>]*class="[^"]*ls-btn-secondary|<a[^>]*class="[^"]*ls-btn-secondary[^"]*"[^>]*href="\/vi"/,
  );
  assert.doesNotMatch(html, /ls-btn-primary/);
});

test('the helpers: counts, advice, links and error messages that name the fix', () => {
  const text = customerProfileDictionary('vi');
  assert.equal(
    sessionsLeft({
      ...clear,
      blockers: {
        ...clear.blockers,
        combos: [
          {
            id: 'a',
            nameVi: '',
            nameEn: '',
            serviceNameVi: '',
            serviceNameEn: '',
            sessionsLeft: 4,
            expiresAt: null,
          },
          {
            id: 'b',
            nameVi: '',
            nameEn: '',
            serviceNameVi: '',
            serviceNameEn: '',
            sessionsLeft: 1,
            expiresAt: null,
          },
        ],
      },
    }),
    5,
  );
  const order = { id: 'x', code: 'DH-9', kind: 'ONLINE_IN_PROGRESS' as const, placedAt: '' };
  assert.equal(
    orderAdvice(order, text.deletion),
    'Đơn DH-9 đang được chuẩn bị hoặc đang giao. Hãy đợi đến khi bạn nhận hàng.',
  );
  assert.equal(orderHref(order, '/vi/account'), '/vi/account/orders/x');
  assert.equal(orderHref({ ...order, kind: 'COUNTER_PREORDER' }, '/vi/account'), null);
  assert.equal(
    deletionErrorMessage(new ApiError(401, 'AUTHENTICATION_FAILED'), text),
    text.wrongPassword,
  );
  assert.equal(
    deletionErrorMessage(new ApiError(409, 'ACCOUNT_DELETION_BLOCKED'), text),
    text.deletion.blockedNow,
  );
  assert.equal(deletionErrorMessage(new ApiError(429, 'RATE_LIMITED'), text), null);
  assert.equal(deletionErrorMessage(new Error('x'), text), null);
  // The staff audit log files the new event under "access" by its prefix (no new label needed, no personal data shown).
  assert.equal(auditArea('CUSTOMER_ACCOUNT_DELETED'), 'access');
});

test('deleting sends the current password only, with the CSRF token, to the session-only route', async () => {
  const calls: { url: string; method: string; body: unknown; headers: Headers }[] = [];
  const api = new ApiClient({
    fetch: (input, init) => {
      const url = String(input);
      calls.push({
        url,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        headers: new Headers(init?.headers),
      });
      if (url.endsWith('/api/v1/auth/context')) {
        return Promise.resolve(
          new Response(JSON.stringify({ authenticated: true, csrfToken: 'token' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 204 }));
    },
  });
  await deleteAccount(api, 'a calm lotus evening');
  const write = calls.find((call) => call.method === 'POST');
  assert.ok(write);
  assert.match(write.url, /\/api\/v1\/me\/account-deletion$/);
  assert.deepEqual(write.body, { currentPassword: 'a calm lotus evening' });
  assert.ok(write.headers.get('x-csrf-token'));
});

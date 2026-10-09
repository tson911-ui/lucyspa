import type { OnlineOrderResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { onlineFulfilmentDictionary } from '../../i18n/online-fulfilment';
import { ApiClient } from '../../lib/api/client';
import { fulfilmentView } from '../../lib/shop/fulfilment';
import { CustomerContext } from '../customer/session';
import { OrderFulfilment } from './order-fulfilment';

const vi = onlineFulfilmentDictionary('vi').customer;
const en = onlineFulfilmentDictionary('en').customer;
const re = (value: string) => new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const order = (patch: Partial<OnlineOrderResponse> = {}): OnlineOrderResponse => ({
  id: 'o1',
  code: 'DO000012',
  invoiceId: 'i1',
  invoiceCode: 'HD000042',
  state: 'PAID',
  placedAt: '2026-10-08T03:00:00.000Z',
  deadlineAt: null,
  paidAt: '2026-10-08T03:05:00.000Z',
  subtotalVnd: '500000',
  discountVnd: '0',
  shippingFeeVnd: '0',
  totalVnd: '500000',
  recipient: {
    name: 'Lê Văn Bình',
    phone: '+84912000003',
    provinceName: 'Hà Nội',
    ward: 'Phường Cửa Nam',
    street: '12 Phố Hàng Bài',
  },
  lines: [],
  hasPreOrder: false,
  shipment: null,
  deliveredAt: null,
  refundedVnd: '0',
  returnWindows: null,
  payment: null,
  can: { pay: false, cancel: false, confirmReceived: false },
  policyVersion: 1,
  ...patch,
});

const shipped = (patch: Partial<OnlineOrderResponse> = {}) =>
  order({
    state: 'SHIPPED',
    shipment: {
      carrierName: 'GHN',
      trackingCode: 'GHN123',
      trackingUrl: 'https://track.example.vn/?code=GHN123',
      shippedAt: '2026-10-09T03:00:00.000Z',
    },
    ...patch,
  });

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
      <AppRouterContext.Provider value={{ push: () => undefined } as never}>
        {node}
      </AppRouterContext.Provider>
    </CustomerContext.Provider>,
    {},
  );
}

const draw = (value: OnlineOrderResponse, locale: Locale = 'vi') =>
  paint(<OrderFulfilment order={value} locale={locale} />, locale);

test('nothing is drawn before the parcel leaves', () => {
  assert.equal(draw(order()), '');
  assert.equal(fulfilmentView(order()).any, false);
});

test('a shipped order shows the carrier, the code as a link and the shipping date', () => {
  const html = draw(shipped());
  assert.match(html, re(vi.title));
  assert.match(html, /GHN/);
  assert.match(html, /href="https:\/\/track\.example\.vn\/\?code=GHN123"/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, re(vi.shippedAt));
  assert.doesNotMatch(html, re(vi.received), 'the button appears only when the order says so');
  assert.doesNotMatch(html, /khám/i);
});

test('without a tracking link the code is plain text', () => {
  const html = draw(shipped({ shipment: { ...shipped().shipment!, trackingUrl: null } }));
  assert.match(html, /GHN123/);
  assert.doesNotMatch(html, /href="https:\/\/track/);
});

test('"Tôi đã nhận hàng" is in the card header only when the order allows it', () => {
  const html = draw(shipped({ can: { pay: false, cancel: false, confirmReceived: true } }));
  assert.match(html, /ls-btn-primary[^>]*>(?:<[^>]*>)*[^<]*Tôi đã nhận hàng/);
  assert.equal(vi.received, 'Tôi đã nhận hàng');
});

test('after the delivery the return windows quote the approved sentences and say the shop handles returns', () => {
  const html = draw(
    shipped({
      state: 'COMPLETED',
      deliveredAt: '2026-10-10T03:00:00.000Z',
      returnWindows: {
        personalPreferenceUntil: '2026-10-17T03:00:00.000Z',
        wrongOrDamagedUntil: '2026-10-12T03:00:00.000Z',
      },
    }),
  );
  assert.match(html, re(vi.deliveredAt));
  assert.match(html, /7 ngày kể từ ngày nhận hàng/);
  assert.match(html, /48 giờ kể từ ngày nhận hàng/);
  assert.match(html, /17\/10\/2026/);
  assert.match(html, /12\/10\/2026/);
  assert.match(html, re(vi.handled));
});

test('a failed delivery and a refund each get a plain message; a cancelled order is told by its status card', () => {
  assert.match(draw(shipped({ state: 'DELIVERY_FAILED' })), re(vi.failed));
  const cancelled = draw(order({ state: 'CANCELLED', refundedVnd: '450000' }));
  assert.match(cancelled, /Cửa hàng đã hoàn 450\.000 ₫/);
  assert.equal(
    draw(order({ state: 'CANCELLED', paidAt: null })),
    '',
    'an order cancelled before payment has nothing to add',
  );
});

test('a refund of 0 is not announced', () => {
  const view = fulfilmentView(shipped({ refundedVnd: '0' }));
  assert.equal(view.refundedVnd, null);
  assert.doesNotMatch(draw(shipped({ refundedVnd: '0' })), /đã hoàn/);
});

test('the customer never sees a carrier cost', () => {
  const html = draw(shipped());
  assert.doesNotMatch(html, /phí vận chuyển|carrier cost|carrierFee/i);
});

test('English renders every text', () => {
  const html = draw(
    shipped({
      state: 'COMPLETED',
      deliveredAt: '2026-10-10T03:00:00.000Z',
      returnWindows: {
        personalPreferenceUntil: '2026-10-17T03:00:00.000Z',
        wrongOrDamagedUntil: '2026-10-12T03:00:00.000Z',
      },
    }),
    'en',
  );
  assert.match(html, re(en.carrier));
  assert.match(html, /Change of mind/);
  assert.match(html, re(en.handled));
});

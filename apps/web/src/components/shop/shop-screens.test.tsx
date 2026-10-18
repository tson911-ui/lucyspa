import type { OnlineOrderResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import { PathnameContext } from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getCustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { onlineFulfilmentDictionary } from '../../i18n/online-fulfilment';
import { ApiClient } from '../../lib/api/client';
import { CustomerContext } from '../customer/session';
import { OrderFulfilment } from './order-fulfilment';
import { OrderTimeline } from './orders-screens';
import { ShopScreen } from './shop-frame';

function paint(node: ReactNode, path: string, locale: Locale = 'vi', sessionLost = false): string {
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
      <AppRouterContext.Provider value={{ push: () => undefined } as never}>
        <PathnameContext.Provider value={path}>{node}</PathnameContext.Provider>
      </AppRouterContext.Provider>
    </CustomerContext.Provider>,
  );
}

test('shop screen (C13): a title band with one h1 and a sentence, then the content band; the cart has no back control', () => {
  const html = paint(
    <ShopScreen title="Giỏ hàng" description="Giao hàng miễn phí.">
      <p>nội dung</p>
    </ShopScreen>,
    '/vi/cart',
  );
  assert.equal(html.match(/<h1\b/g)?.length, 1);
  assert.match(
    html,
    /<h1 class="ls-h1-display">Giỏ hàng<\/h1><p class="ls-lead">Giao hàng miễn phí\.<\/p>/,
  );
  // The cart is a top-level page: no back control (B7, C40); a title band then a content band, neither with a color of its own.
  assert.doesNotMatch(html, /ls-back/);
  assert.doesNotMatch(html, /ls-band--(base|alt)/);
  assert.doesNotMatch(html, /data-narrow/);
  assert.match(html, /<div class="ls-shop-content">.*nội dung/s);
});

test('shop screen: the checkout goes back to the cart, a form page is held to one narrow column, a lost session is said in words', () => {
  const html = paint(
    <ShopScreen title="Thanh toán" narrow>
      <p>x</p>
    </ShopScreen>,
    '/vi/checkout',
    'vi',
    true,
  );
  // The checkout's parent is the cart: the icon-only chevron, named for it (no "← Quay lại" text).
  assert.match(
    html,
    /<a class="[^"]*ls-back ls-btn-icon[^"]*" aria-label="Quay lại giỏ hàng" title="Quay lại giỏ hàng" href="\/vi\/cart"><svg/,
  );
  assert.match(html, /<div class="ls-shop-content" data-narrow="true">/);
  assert.match(html, /ls-notice/);
  assert.doesNotMatch(html, /ls-description-list|ls-page-header/);
});

const placed = (patch: Partial<OnlineOrderResponse> = {}): OnlineOrderResponse =>
  ({
    id: 'o1',
    code: 'ON000001',
    state: 'PAID',
    placedAt: '2026-10-08T03:00:00.000Z',
    paidAt: '2026-10-08T03:05:00.000Z',
    shipment: null,
    deliveredAt: null,
    ...patch,
  }) as OnlineOrderResponse;

test('order timeline: only moments the order has, each with an icon and a word', () => {
  const dates = onlineFulfilmentDictionary('vi').customer;
  const waiting = paint(
    <OrderTimeline order={placed({ paidAt: null, state: 'AWAITING_PAYMENT' })} locale="vi" />,
    '/vi/account/orders/o1',
  );
  assert.equal(waiting.match(/<li>/g)?.length, 1, 'placed only');
  assert.match(waiting, /Ngày đặt/);
  const paid = paint(<OrderTimeline order={placed()} locale="vi" />, '/vi/account/orders/o1');
  assert.equal(paid.match(/<li>/g)?.length, 2);
  assert.equal(
    paid.match(/<svg[^>]*aria-hidden="true"/g)?.length,
    2,
    'an icon for each, hidden from readers (the word says it)',
  );
  const delivered = paint(
    <OrderTimeline
      order={placed({
        state: 'COMPLETED',
        shipment: {
          carrierName: 'GHN',
          trackingCode: 'X1',
          trackingUrl: null,
          shippedAt: '2026-10-09T03:00:00.000Z',
        },
        deliveredAt: '2026-10-10T03:00:00.000Z',
      })}
      locale="vi"
    />,
    '/vi/account/orders/o1',
  );
  assert.equal(delivered.match(/<li>/g)?.length, 4);
  assert.match(delivered, new RegExp(dates.shippedAt));
  assert.match(delivered, new RegExp(dates.deliveredAt));
  // The order of the list is the order of events.
  const at = ['Ngày đặt', dates.shippedAt, dates.deliveredAt].map((word) =>
    delivered.indexOf(word),
  );
  assert.deepEqual(
    [...at].sort((a, b) => a - b),
    at,
  );
});

test('the shipment card leaves the dates out when the page lists them in its timeline', () => {
  const shipped = placed({
    state: 'SHIPPED',
    can: { pay: false, cancel: false, confirmReceived: false },
    shipment: {
      carrierName: 'GHN',
      trackingCode: 'X1',
      trackingUrl: null,
      shippedAt: '2026-10-09T03:00:00.000Z',
    },
  });
  const dates = onlineFulfilmentDictionary('vi').customer;
  const withDates = paint(<OrderFulfilment order={shipped} locale="vi" />, '/vi/account/orders/o1');
  const without = paint(
    <OrderFulfilment order={shipped} locale="vi" hideDates />,
    '/vi/account/orders/o1',
  );
  assert.match(withDates, new RegExp(dates.shippedAt));
  assert.doesNotMatch(without, new RegExp(dates.shippedAt));
  assert.match(without, /GHN/);
});

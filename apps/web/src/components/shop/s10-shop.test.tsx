import type { OnlineCartLineResponse } from '@lucy-spa/contracts';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { getShopText } from '../../i18n/online-shop';
import { CartLine, removedAfter } from './cart-screen';
import { OrderStateBadge } from './orders-screens';
import { PayBar } from './pay-bar';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const paint = (node: ReactNode) =>
  renderToStaticMarkup(
    <AppRouterContext.Provider value={{ push: () => undefined } as never}>
      {node}
    </AppRouterContext.Provider>,
  );

const line = (patch: Partial<OnlineCartLineResponse> = {}): OnlineCartLineResponse =>
  ({
    variantId: 'v1',
    productCode: 'kem',
    nameVi: 'Kem dưỡng ẩm',
    nameEn: 'Moisturiser',
    variantLabelVi: null,
    variantLabelEn: null,
    imageMediaId: null,
    quantity: 3,
    unitPriceVnd: '100000',
    listPriceVnd: '100000',
    onPromotion: false,
    lineTotalVnd: '300000',
    mode: 'IN_STOCK',
    expectedDaysMin: null,
    expectedDaysMax: null,
    problem: null,
    ...patch,
  }) as OnlineCartLineResponse;

const s = getShopText('vi');

test('cart undo (C72): a removed line is kept with its old quantity so it can be put back; any other change keeps nothing', () => {
  assert.deepEqual(removedAfter(line(), 0, 'vi'), {
    variantId: 'v1',
    quantity: 3,
    name: 'Kem dưỡng ẩm',
  });
  assert.equal(removedAfter(line(), 2, 'vi'), null);
  assert.equal(s.cart.undo, 'Hoàn tác');
});

test('cart line: a problem is an icon and words under the name; a line only removing can fix has one remove button, no stepper', () => {
  const props = {
    locale: 'vi' as const,
    s,
    max: 10,
    busy: false,
    disabled: false,
    onChange: () => undefined,
  };
  const shopOnly = paint(<CartLine {...props} first line={line({ problem: 'NOT_SOLD_ONLINE' })} />);
  assert.match(
    shopOnly,
    /<p class="ls-shop-problem" id="cart-first-problem" tabindex="-1"><svg[^>]*>.*?<\/svg>Sản phẩm này chỉ bán tại cửa hàng\./,
  );
  assert.doesNotMatch(shopOnly, /ls-qty/);
  assert.match(
    shopOnly,
    /ls-btn-secondary[^"]*"[^>]*>(<svg[^>]*>.*?<\/svg>)?(<span[^>]*>)?Bỏ khỏi giỏ/,
  );
  // A quantity problem keeps the stepper (lowering it fixes the line); the trash button is named after the line.
  const over = paint(
    <CartLine {...props} first={false} line={line({ problem: 'OUT_OF_STOCK' })} />,
  );
  assert.match(over, /ls-qty/);
  assert.match(over, /aria-label="Bỏ Kem dưỡng ẩm khỏi giỏ hàng"/);
  // A pre-order line: a neutral label (no blue, A3/R26) and the wait with a clock icon at 14 px.
  const pre = paint(
    <CartLine
      {...props}
      first={false}
      line={line({ mode: 'PRE_ORDER', expectedDaysMin: 3, expectedDaysMax: 5 })}
    />,
  );
  assert.match(pre, /<span class="ls-badge ls-badge-outline">Đặt trước<\/span>/);
  assert.doesNotMatch(pre, /ls-badge-info/);
  assert.match(pre, /<span class="ls-shop-line-meta"><svg[^>]*>.*?<\/svg>Dự kiến 3–5\u00a0ngày/);
});

test('order status badges carry an icon with the word (C5); shipped is a status colour, not the accent (B18)', () => {
  for (const state of ['AWAITING_PAYMENT', 'SHIPPED', 'CANCELLED', 'COMPLETED'] as const) {
    const html = renderToStaticMarkup(
      <OrderStateBadge state={state} label={s.orders.state[state]} />,
    );
    assert.match(html, /^<span class="ls-badge ls-badge-[a-z]+"><svg/);
    assert.doesNotMatch(html, /ls-badge-brand/);
  }
});

test('phone pay bar: a named region with the total and the one action, the kit action bar; the sheet shows it below 1024 px only', () => {
  const html = renderToStaticMarkup(
    <PayBar label={s.cart.payBar} totalLabel={s.cart.subtotal} total="300.000 ₫">
      <button type="submit" className="ls-btn ls-btn-primary ls-btn-lg">
        {s.cart.checkout}
      </button>
    </PayBar>,
  );
  assert.equal(
    html,
    '<div class="ls-action-bar ls-pay-bar" role="region" aria-label="Tạm tính và thanh toán"><p class="ls-pay-bar-total"><span class="ls-pay-bar-label">Tạm tính</span><strong>300.000 ₫</strong></p><div class="ls-pay-bar-action"><button type="submit" class="ls-btn ls-btn-primary ls-btn-lg">Thanh toán</button></div></div>',
  );
  const css = readFileSync(
    fileURLToPath(new URL('../../../../../packages/ui/src/s10-public.css', import.meta.url)),
    'utf8',
  );
  // Hidden from 1024 px; below it the bar shows and the summary's copy of the button hides (one filled button in view); no entrance
  // motion; at a large text size it stops sticking.
  assert.match(css, /\.ls-pay-bar \{\s*display: none;/);
  assert.match(
    css,
    /@media \(max-width: 1023\.98px\) \{\s*\[data-ui='v2'\] \.ls-pay-bar \{[^}]*display: flex;[^}]*animation: none;[^}]*\}\s*\[data-ui='v2'\] \.ls-pay-inline \{\s*display: none;/,
  );
  assert.match(
    css,
    /html\[data-text-large\] \[data-ui='v2'\] \.ls-pay-bar \{\s*position: relative;/,
  );
});

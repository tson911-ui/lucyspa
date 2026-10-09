'use client';

import type { OnlineCartLineResponse, OnlineCartResponse } from '@lucy-spa/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  IconButton,
  MediaThumb,
  Notice,
  Page,
  PageHeader,
  Stack,
  buttonClass,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { Locale } from '../../i18n/locales';
import { getShopText, type ShopText } from '../../i18n/online-shop';
import { customerErrorMessage } from '../../lib/customer/booking';
import { formatVnd } from '../../lib/customer/invoice';
import { fill } from '../../lib/fill';
import {
  announceCartChange,
  cartImageUrl,
  problemLines,
  shopErrorMessage,
  waitRange,
} from '../../lib/shop/online';
import { useCustomer } from '../customer/session';
import { LoadState, useFetch } from '../customer/screens/bookings';
import { QuantityStepper } from './quantity-stepper';
import { isOpen, useOnlineSales } from './shop-data';

/** The name of a cart line in the reader's language, with its variant label. */
export function lineName(line: OnlineCartLineResponse, locale: Locale): string {
  return locale === 'vi' ? line.nameVi : line.nameEn;
}

export function lineLabel(line: OnlineCartLineResponse, locale: Locale): string | null {
  return locale === 'vi' ? line.variantLabelVi : line.variantLabelEn;
}

/**
 * "Giỏ hàng" (Phase 6 P6-19): the lines of the member's cart priced today, a quantity stepper and a remove button per line, the
 * problem of a line in words, the pre-order notice, the subtotal, "Miễn phí giao hàng" and the way to the checkout. Online
 * ordering closed or an empty cart read as a plain message with the way to the shop's products.
 */
export function CartScreen() {
  const { api, t, locale } = useCustomer();
  const s = getShopText(locale);
  const { sales } = useOnlineSales();
  const first = useFetch(() => api.get<OnlineCartResponse>('/api/v1/me/cart'), 'cart');
  const [override, setOverride] = useState<OnlineCartResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const cart = override ?? first.data;

  if (sales === null || !cart) {
    return (
      <Page>
        <PageHeader title={s.cart.title} description={s.cart.intro} />
        <LoadState error={first.error} retry={first.retry} />
      </Page>
    );
  }
  if (!isOpen(sales)) {
    return (
      <Page>
        <PageHeader title={s.cart.title} />
        <EmptyState
          icon="cart"
          action={
            <Link className={buttonClass('secondary')} href={`/${locale}/products`}>
              {s.cart.closedAction}
            </Link>
          }
        >
          {s.cart.closed}
        </EmptyState>
      </Page>
    );
  }

  async function change(line: OnlineCartLineResponse, quantity: number) {
    if (busy) return;
    setBusy(line.variantId);
    setFailure(null);
    try {
      const next = await api.post<OnlineCartResponse>('/api/v1/me/cart/set', {
        variantId: line.variantId,
        quantity,
      });
      setOverride(next);
      announceCartChange();
    } catch (error) {
      setFailure(shopErrorMessage(error, s.errors, (e) => customerErrorMessage(e, t)));
    } finally {
      setBusy(null);
    }
  }

  if (cart.lines.length === 0) {
    return (
      <Page>
        <PageHeader title={s.cart.title} />
        <EmptyState
          icon="cart"
          action={
            <Link className={buttonClass('primary')} href={`/${locale}/products`}>
              {s.cart.emptyAction}
            </Link>
          }
        >
          {s.cart.empty}
        </EmptyState>
      </Page>
    );
  }

  const problems = problemLines(cart);
  const unpaidLimit = cart.unpaidOrders >= sales.maxUnpaidOrders;
  return (
    <Page>
      <PageHeader title={s.cart.title} description={s.cart.intro} />
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <div className="ls-shop-layout">
        <Card as="section" aria-label={s.cart.lines}>
          <ul className="ls-shop-lines">
            {cart.lines.map((line) => (
              <CartLine
                key={line.variantId}
                line={line}
                locale={locale}
                s={s}
                max={sales.maxLineQuantity}
                busy={busy === line.variantId}
                disabled={busy !== null}
                onChange={(quantity) => void change(line, quantity)}
              />
            ))}
          </ul>
        </Card>
        <Card as="section" aria-label={s.cart.summary} className="ls-shop-summary">
          <CardHeader title={s.cart.summary} />
          <Stack gap="block">
            <DescriptionList
              layout="totals"
              items={[
                { label: s.cart.subtotal, value: formatVnd(cart.subtotalVnd, locale) },
                { label: s.cart.shipping, value: s.cart.free },
              ]}
            />
            <p className="ls-hint">{s.cart.discountNote}</p>
            {cart.hasPreOrder ? <Notice tone="info">{s.cart.preOrderNote}</Notice> : null}
            {problems.length > 0 ? <Notice tone="warning">{s.cart.fixProblems}</Notice> : null}
            {unpaidLimit ? (
              <Notice tone="warning">
                {fill(s.cart.unpaidLimit, {
                  count: cart.unpaidOrders,
                  max: sales.maxUnpaidOrders,
                })}
              </Notice>
            ) : null}
            {unpaidLimit ? (
              <Link
                className={buttonClass('secondary', 'lg', 'ls-btn-block')}
                href={`/${locale}/account/orders`}
              >
                {s.cart.viewOrders}
              </Link>
            ) : (
              <CheckoutLink
                href={`/${locale}/checkout`}
                label={s.cart.checkout}
                disabled={!cart.checkoutReady || busy !== null}
              />
            )}
          </Stack>
        </Card>
      </div>
    </Page>
  );
}

/** The checkout button: a link while the cart is ready, a disabled button (never a dead link) while it is not. */
function CheckoutLink({
  href,
  label,
  disabled,
}: {
  href: string;
  label: string;
  disabled: boolean;
}) {
  if (disabled) {
    return (
      <Button variant="primary" size="lg" fullWidth disabled>
        {label}
      </Button>
    );
  }
  return (
    <Link className={buttonClass('primary', 'lg', 'ls-btn-block')} href={href}>
      {label}
    </Link>
  );
}

function CartLine({
  line,
  locale,
  s,
  max,
  busy,
  disabled,
  onChange,
}: {
  line: OnlineCartLineResponse;
  locale: Locale;
  s: ShopText;
  max: number;
  busy: boolean;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  const name = lineName(line, locale);
  const label = lineLabel(line, locale);
  const wait = waitRange(line.expectedDaysMin, line.expectedDaysMax);
  const problem = line.problem;
  return (
    <li className="ls-shop-line" data-problem={problem ?? undefined} aria-busy={busy || undefined}>
      <Link
        className="ls-shop-line-thumb"
        href={`/${locale}/products/${line.productCode}`}
        tabIndex={-1}
        aria-hidden="true"
      >
        <MediaThumb src={cartImageUrl(line)} />
      </Link>
      <div className="ls-shop-line-main">
        <Link className="ls-shop-line-name" href={`/${locale}/products/${line.productCode}`}>
          {name}
        </Link>
        {label ? <span className="ls-hint">{label}</span> : null}
        <span className="ls-shop-line-price">
          <strong>{formatVnd(line.unitPriceVnd, locale)}</strong>
          {line.onPromotion ? <del>{formatVnd(line.listPriceVnd, locale)}</del> : null}
        </span>
        {line.mode === 'PRE_ORDER' ? (
          <span className="ls-shop-line-note">
            <Badge tone="info">{s.cart.preOrder}</Badge>
            {wait ? (
              <span className="ls-hint">{fill(s.cart.preOrderWait, { range: wait })}</span>
            ) : null}
          </span>
        ) : null}
        {problem ? (
          <p className="ls-shop-problem" role="alert">
            {fill(s.cart.problems[problem], { max })}
          </p>
        ) : null}
      </div>
      <div className="ls-shop-line-side">
        <div className="ls-shop-line-controls">
          <QuantityStepper
            value={line.quantity}
            max={Math.max(max, line.quantity)}
            onChange={onChange}
            label={`${s.cart.quantity}: ${name}`}
            decreaseLabel={fill(s.cart.decrease, { name })}
            increaseLabel={fill(s.cart.increase, { name })}
            disabled={disabled}
          />
          <IconButton
            icon="trash"
            label={fill(s.cart.removeNamed, { name })}
            disabled={disabled}
            onClick={() => onChange(0)}
          />
        </div>
        <strong className="ls-shop-line-total">{formatVnd(line.lineTotalVnd, locale)}</strong>
      </div>
    </li>
  );
}

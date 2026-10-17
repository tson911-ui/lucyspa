'use client';

import type { OnlineCartLineResponse, OnlineCartResponse } from '@lucy-spa/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  DescriptionList,
  EmptyState,
  Icon,
  IconButton,
  MediaThumb,
  Notice,
  Stack,
  buttonClass,
  useOptionalToast,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useState } from 'react';
import type { Locale } from '../../i18n/locales';
import { getShopText, type ShopText } from '../../i18n/online-shop';
import { customerErrorMessage } from '../../lib/customer/booking';
import { formatVnd } from '../../lib/customer/invoice';
import { fill } from '../../lib/fill';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import {
  announceCartChange,
  cartImageUrl,
  problemLines,
  shopErrorMessage,
  waitRange,
} from '../../lib/shop/online';
import { useCustomer } from '../customer/session';
import { LoadState, useFetch } from '../customer/screens/bookings';
import { PayBar } from './pay-bar';
import { QuantityStepper } from './quantity-stepper';
import { ShopScreen } from './shop-frame';
import { isOpen, useOnlineSales } from './shop-data';

/** The name of a cart line in the reader's language, with its variant label. */
export function lineName(line: OnlineCartLineResponse, locale: Locale): string {
  return locale === 'vi' ? line.nameVi : line.nameEn;
}

export function lineLabel(line: OnlineCartLineResponse, locale: Locale): string | null {
  return locale === 'vi' ? line.variantLabelVi : line.variantLabelEn;
}

/** A line can only be removed (no quantity makes it valid): sold in the shop only, or not on sale. */
const REMOVE_ONLY = new Set<OnlineCartLineResponse['problem']>(['NOT_SOLD_ONLINE', 'UNAVAILABLE']);

/** The id of the first problem row, where the checkout button takes the focus while the cart has problems. */
const FIRST_PROBLEM_ID = 'cart-first-problem';

/** A line just removed, kept so it can be put back (C72): the variant, how many, and its name for the message. */
export interface Removed {
  variantId: string;
  quantity: number;
  name: string;
}

/**
 * What the undo row holds after a successful change of `line` to `quantity`: the line when it was removed (0), so it can be put back with
 * its old quantity; nothing after any other change (only the last removal can be undone).
 */
export function removedAfter(
  line: OnlineCartLineResponse,
  quantity: number,
  locale: Locale,
): Removed | null {
  return quantity === 0
    ? { variantId: line.variantId, quantity: line.quantity, name: lineName(line, locale) }
    : null;
}

/**
 * "Giỏ hàng" (Phase 6 P6-19; DESIGN.md 9.2): the lines of the member's cart priced today in one surface split by hairlines, a quantity
 * stepper and a remove button per line, the problem of a line as a status line (icon + words) under its name, the subtotal, "Miễn phí
 * giao hàng" and the way to the checkout in the summary card, sticky beside the lines from 1024 px. Removing a line can be undone (C72): a
 * toast names the line with "Hoàn tác", which puts it back with the same cart call the product page uses. While lines need a change,
 * "Thanh toán" stays enabled and takes the focus to the first of them (the reason is said beside it). Online ordering closed and an empty
 * cart read as an empty state (icon, heading, sentence, one way on); the cart is a top-level page, so it has no back control.
 */
export function CartScreen() {
  const { api, t, locale } = useCustomer();
  const s = getShopText(locale);
  const { sales } = useOnlineSales();
  const first = useFetch(() => api.get<OnlineCartResponse>('/api/v1/me/cart'), 'cart');
  const [override, setOverride] = useState<OnlineCartResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Removed | null>(null);
  const toast = useOptionalToast();
  const cart = override ?? first.data;

  if (sales === null || !cart) {
    return (
      <ShopScreen title={s.cart.title} description={s.cart.intro}>
        <LoadState error={first.error} retry={first.retry} />
      </ShopScreen>
    );
  }
  if (!isOpen(sales)) {
    return (
      <ShopScreen title={s.cart.title} description={s.cart.intro}>
        <EmptyState
          icon="cart"
          title={s.cart.closedTitle}
          action={
            <Link
              className={buttonClass('secondary')}
              href={`/${locale}/products`}
              transitionTypes={NAV_TRANSITION}
            >
              {s.cart.closedAction}
            </Link>
          }
        >
          {s.cart.closed}
        </EmptyState>
      </ShopScreen>
    );
  }

  async function send(key: string, call: () => Promise<OnlineCartResponse>): Promise<boolean> {
    if (busy) return false;
    setBusy(key);
    setFailure(null);
    try {
      setOverride(await call());
      announceCartChange();
      return true;
    } catch (error) {
      setFailure(shopErrorMessage(error, s.errors, (e) => customerErrorMessage(e, t)));
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function change(line: OnlineCartLineResponse, quantity: number) {
    const done = await send(line.variantId, () =>
      api.post<OnlineCartResponse>('/api/v1/me/cart/set', { variantId: line.variantId, quantity }),
    );
    if (!done) return;
    const gone = removedAfter(line, quantity, locale);
    // The kit toast carries the undo (8 s, "Hoàn tác"); without a toast region (a test renders the screen alone) the same words and
    // button sit in a status row above the lines.
    if (gone && toast) {
      toast.push({
        tone: 'success',
        message: fill(s.cart.removed, { name: gone.name }),
        action: { label: s.cart.undo, onAction: () => void undo(gone) },
      });
    } else {
      setRemoved(gone);
    }
  }

  async function undo(line: Removed) {
    const done = await send('undo', () =>
      api.post<OnlineCartResponse>('/api/v1/me/cart/add', {
        variantId: line.variantId,
        quantity: line.quantity,
      }),
    );
    if (done) setRemoved(null);
  }

  const undoRow = removed ? (
    <div className="ls-shop-undo" role="status">
      <Icon name="check-circle" size={20} aria-hidden="true" />
      <p>{fill(s.cart.removed, { name: removed.name })}</p>
      <Button variant="neutral" loading={busy === 'undo'} onClick={() => void undo(removed)}>
        {busy === 'undo' ? s.cart.undoing : s.cart.undo}
      </Button>
      <IconButton icon="close" label={s.cart.dismiss} onClick={() => setRemoved(null)} />
    </div>
  ) : null;

  if (cart.lines.length === 0) {
    return (
      <ShopScreen title={s.cart.title} description={s.cart.intro}>
        {undoRow}
        <EmptyState
          icon="cart"
          title={s.cart.emptyTitle}
          action={
            <Link
              className={buttonClass('secondary')}
              href={`/${locale}/products`}
              transitionTypes={NAV_TRANSITION}
            >
              {s.cart.emptyAction}
            </Link>
          }
        >
          {s.cart.emptyBody}
        </EmptyState>
      </ShopScreen>
    );
  }

  const problems = problemLines(cart);
  const firstProblem = problems[0]?.variantId ?? null;
  const unpaidLimit = cart.unpaidOrders >= sales.maxUnpaidOrders;
  // The way on, drawn twice: in the summary card from 1024 px and in the phone's pay bar below it (CSS shows one, so one filled button
  // is ever in view).
  const action = unpaidLimit ? (
    <Link
      className={buttonClass('secondary', 'lg', 'ls-btn-block')}
      href={`/${locale}/account/orders`}
      transitionTypes={NAV_TRANSITION}
    >
      {s.cart.viewOrders}
    </Link>
  ) : problems.length > 0 ? (
    // Enabled with the reason beside it: pressing it takes the focus to the first line that needs a change.
    <Button
      variant="primary"
      size="lg"
      fullWidth
      aria-describedby="cart-fix-reason"
      onClick={() => document.getElementById(FIRST_PROBLEM_ID)?.focus()}
    >
      {s.cart.checkout}
    </Button>
  ) : (
    <CheckoutLink
      href={`/${locale}/checkout`}
      label={s.cart.checkout}
      disabled={!cart.checkoutReady || busy !== null}
    />
  );
  return (
    <ShopScreen title={s.cart.title} description={s.cart.intro}>
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      {undoRow}
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
                first={line.variantId === firstProblem}
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
            <p className="ls-shop-note">{s.cart.discountNote}</p>
            {cart.hasPreOrder ? (
              <p className="ls-shop-note">
                <Icon name="info" size={16} aria-hidden="true" />
                {s.cart.preOrderNote}
              </p>
            ) : null}
            {problems.length > 0 ? (
              <p className="ls-shop-note" data-tone="warning" id="cart-fix-reason">
                <Icon name="alert-triangle" size={16} aria-hidden="true" />
                {fill(s.cart.fixCount, { count: problems.length })}
              </p>
            ) : null}
            {unpaidLimit ? (
              <Notice tone="warning">
                {fill(s.cart.unpaidLimit, {
                  count: cart.unpaidOrders,
                  max: sales.maxUnpaidOrders,
                })}
              </Notice>
            ) : null}
            <div className="ls-pay-inline">{action}</div>
          </Stack>
        </Card>
      </div>
      <PayBar
        label={s.cart.payBar}
        totalLabel={s.cart.subtotal}
        total={formatVnd(cart.subtotalVnd, locale)}
      >
        {action}
      </PayBar>
    </ShopScreen>
  );
}

/** The checkout button: a link while the cart is ready, a disabled button (never a dead link) while a change is being saved. */
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
    <Link
      className={buttonClass('primary', 'lg', 'ls-btn-block')}
      href={href}
      transitionTypes={NAV_TRANSITION}
    >
      {label}
    </Link>
  );
}

export function CartLine({
  line,
  locale,
  s,
  max,
  first,
  busy,
  disabled,
  onChange,
}: {
  line: OnlineCartLineResponse;
  locale: Locale;
  s: ShopText;
  max: number;
  /** The first line with a problem: the checkout button brings the focus to its message. */
  first: boolean;
  busy: boolean;
  disabled: boolean;
  onChange: (quantity: number) => void;
}) {
  const name = lineName(line, locale);
  const label = lineLabel(line, locale);
  const wait = waitRange(line.expectedDaysMin, line.expectedDaysMax);
  const problem = line.problem;
  const problemId = `cart-problem-${line.variantId}`;
  return (
    <li className="ls-shop-line" data-problem={problem ?? undefined} aria-busy={busy || undefined}>
      <Link
        className="ls-shop-line-thumb"
        href={`/${locale}/products/${line.productCode}`}
        transitionTypes={NAV_TRANSITION}
        tabIndex={-1}
        aria-hidden="true"
      >
        <MediaThumb src={cartImageUrl(line)} />
      </Link>
      <div className="ls-shop-line-main">
        <Link
          className="ls-shop-line-name"
          href={`/${locale}/products/${line.productCode}`}
          transitionTypes={NAV_TRANSITION}
        >
          {name}
        </Link>
        {label ? <span className="ls-shop-line-meta">{label}</span> : null}
        <span className="ls-shop-line-price">
          <strong>{formatVnd(line.unitPriceVnd, locale)}</strong>
          {line.onPromotion ? <del>{formatVnd(line.listPriceVnd, locale)}</del> : null}
        </span>
        {line.mode === 'PRE_ORDER' ? (
          <span className="ls-shop-line-note">
            <Badge tone="outline" icon={false}>
              {s.cart.preOrder}
            </Badge>
            {wait ? (
              <span className="ls-shop-line-meta">
                <Icon name="clock" size={16} aria-hidden="true" />
                {fill(s.cart.preOrderWait, { range: wait })}
              </span>
            ) : null}
          </span>
        ) : null}
        {problem ? (
          <p
            className="ls-shop-problem"
            id={first ? FIRST_PROBLEM_ID : problemId}
            tabIndex={first ? -1 : undefined}
          >
            <Icon name="alert-triangle" size={16} aria-hidden="true" />
            {fill(s.cart.problems[problem], { max })}
          </p>
        ) : null}
      </div>
      <div className="ls-shop-line-side">
        <div className="ls-shop-line-controls">
          {problem && REMOVE_ONLY.has(problem) ? (
            // Nothing but removing makes this line valid: the stepper is replaced by that one action.
            <Button
              variant="secondary"
              icon="trash"
              disabled={disabled}
              onClick={() => onChange(0)}
            >
              {s.cart.remove}
            </Button>
          ) : (
            <>
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
            </>
          )}
        </div>
        <strong className="ls-shop-line-total">{formatVnd(line.lineTotalVnd, locale)}</strong>
      </div>
    </li>
  );
}

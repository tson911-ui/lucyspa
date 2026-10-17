'use client';

import type {
  OnlineOrderListItem,
  OnlineOrderListResponse,
  OnlineOrderResponse,
  OnlineOrderState,
  OnlinePaymentResponse,
} from '@lucy-spa/contracts';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  CursorPagination,
  DataTable,
  DescriptionList,
  EmptyState,
  Icon,
  Notice,
  Spinner,
  Stack,
  buttonClass,
  type BadgeTone,
  type DataTableColumn,
  type DataTablePaging,
  type IconName,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n/locales';
import { getShopText } from '../../i18n/online-shop';
import { ApiError } from '../../lib/api/client';
import { customerErrorMessage, formatDateTime } from '../../lib/customer/booking';
import { appendPage, formatVnd } from '../../lib/customer/invoice';
import { fill } from '../../lib/fill';
import { NAV_TRANSITION } from '../../lib/nav-transition';
import {
  POLL_INTERVAL_MS,
  announceCartChange,
  cameBackFromBank,
  formatClock,
  formatCountdown,
  nationalPhone,
  secondsLeft,
  shopErrorMessage,
  shouldPoll,
} from '../../lib/shop/online';
import { MEMBER_PAGE_SIZE, useUrlPage } from '../customer/member-paging';
import { expectedRange } from '../customer/member-format';
import { AccountScreen } from '../customer/account-frame';
import { RowLink } from '../customer/member-ui';
import { useCustomer } from '../customer/session';
import { LoadState, NotFoundPage, useFetch } from '../customer/screens/bookings';
import { OrderFulfilment } from './order-fulfilment';
import { onlineFulfilmentDictionary } from '../../i18n/online-fulfilment';
import { promiseNumbers } from '../../lib/shop/online';
import { useOnlineSales } from './shop-data';

/** The shop works in Vietnam: every date of an order is read in this zone. */
const SHOP_ZONE = 'Asia/Ho_Chi_Minh';

const orderName = (item: OnlineOrderListItem, locale: Locale) =>
  locale === 'vi' ? item.firstLineNameVi : item.firstLineNameEn;

/** One date format for every account list: the day only ("14/10/2026"), in the shop's zone. Formatters are built once per language. */
const DATE_FORMATS = new Map<Locale, Intl.DateTimeFormat>();
function orderDate(iso: string, locale: Locale): string {
  let format = DATE_FORMATS.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: SHOP_ZONE,
    });
    DATE_FORMATS.set(locale, format);
  }
  return format.format(new Date(iso));
}

/** The status badge of an order: the status tone with its own icon and the word, never colour alone (C5, B18). */
const STATE_ICON: Record<OnlineOrderState, IconName> = {
  AWAITING_PAYMENT: 'clock',
  PAID: 'wallet',
  READY_TO_SHIP: 'wallet',
  WAITING_GOODS: 'clock',
  SHIPPED: 'truck',
  DELIVERY_FAILED: 'alert-triangle',
  COMPLETED: 'check-circle',
  CANCELLED: 'x-circle',
};
const STATE_TONE: Record<OnlineOrderState, BadgeTone> = {
  AWAITING_PAYMENT: 'warning',
  PAID: 'info',
  READY_TO_SHIP: 'info',
  WAITING_GOODS: 'info',
  SHIPPED: 'info',
  DELIVERY_FAILED: 'danger',
  COMPLETED: 'success',
  CANCELLED: 'neutral',
};

export function OrderStateBadge({ state, label }: { state: OnlineOrderState; label: string }) {
  return (
    <Badge tone={STATE_TONE[state]} icon={STATE_ICON[state]}>
      {label}
    </Badge>
  );
}

/**
 * "Đơn hàng online": the member's online orders, newest first, 20 a page, as the kit's customer table (8.4): the code (the row's link;
 * no one-item row menu repeating it), the day it was placed, the goods (they wrap, never cut), the total and the status badge with its
 * icon. A top-level account page: no back control. No order yet: an empty state with a heading, a sentence and one way on.
 */
export function OnlineOrdersScreen() {
  const { api, t, locale, base } = useCustomer();
  const s = getShopText(locale);
  // The page and the "Xem thêm" pages live in the address bar (wig: list state in the URL), as on the invoice list: Back from an
  // order or a reload shows the same rows again.
  const [pageNumber, setPageNumber] = useUrlPage('page');
  const [loaded, setLoaded] = useUrlPage('loaded');
  const paging: DataTablePaging = {
    page: pageNumber,
    pageSize: MEMBER_PAGE_SIZE,
    onPageChange: setPageNumber,
    labels: s.orders.list,
  };
  const first = useFetch(
    () => api.get<OnlineOrderListResponse>('/api/v1/me/online-orders'),
    'orders',
  );
  const [more, setMore] = useState<{
    items: OnlineOrderListItem[];
    cursor: string | null | undefined;
    /** Further pages fetched with "Xem thêm". */
    pages: number;
  }>({ items: [], cursor: undefined, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // `undefined` = no further page fetched yet: continue from the first response.
  const next = !first.data ? null : more.cursor === undefined ? first.data.nextCursor : more.cursor;

  async function loadMore(fromButton: boolean) {
    if (loading || !next) return;
    setLoading(true);
    setFailure(null);
    try {
      const page = await api.get<OnlineOrderListResponse>(
        `/api/v1/me/online-orders?cursor=${encodeURIComponent(next)}`,
      );
      setMore((current) => ({
        items: appendPage(current.items, page.orders),
        cursor: page.nextCursor,
        pages: current.pages + 1,
      }));
      if (fromButton) setLoaded(more.pages + 2, true);
    } catch (error) {
      setFailure(customerErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  }

  // Coming back to the list: the pages the address names are fetched again, one after another (a cursor list has no page numbers).
  useEffect(() => {
    if (first.data && next && !loading && failure === null && 1 + more.pages < loaded) {
      void loadMore(false);
    }
  }, [first.data, next, loading, failure, more.pages, loaded]);

  if (!first.data) {
    return (
      <AccountScreen title={s.orders.title} description={s.orders.intro}>
        <LoadState error={first.error} retry={first.retry} />
      </AccountScreen>
    );
  }
  const shown = appendPage(first.data.orders, more.items);

  const columns: DataTableColumn<OnlineOrderListItem>[] = [
    {
      key: 'code',
      header: s.orders.columns.code,
      mobileTitle: true,
      // The whole row opens the order (stretched link, as on bookings and invoices); the chevron column says so (C55).
      cell: (item) => (
        <RowLink href={`${base}/orders/${item.id}`}>
          <span translate="no">{item.code}</span>
        </RowLink>
      ),
    },
    {
      key: 'date',
      header: s.orders.columns.date,
      cell: (item) => orderDate(item.placedAt, locale),
    },
    {
      key: 'items',
      header: s.orders.columns.items,
      // The goods wrap by word (Owner answer 7; the foundation lifts the kit's two-line cut): never cut with an ellipsis.
      wrap: true,
      width: 'lg',
      cell: (item) =>
        item.lineCount > 1
          ? fill(s.orders.moreItems, {
              name: orderName(item, locale),
              count: item.lineCount - 1,
            })
          : orderName(item, locale),
    },
    {
      key: 'total',
      header: s.orders.columns.total,
      numeric: true,
      cell: (item) => formatVnd(item.totalVnd, locale),
    },
    {
      key: 'status',
      header: s.orders.columns.status,
      cell: (item) => <OrderStateBadge state={item.state} label={s.orders.state[item.state]} />,
    },
  ];

  return (
    <AccountScreen title={s.orders.title} description={s.orders.intro}>
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <DataTable
        mode="client"
        className="ls-mem-rows"
        caption={s.orders.list.table}
        phoneRows="compact"
        drillDown
        columns={columns}
        rows={shown}
        rowKey={(item) => item.id}
        empty={
          <EmptyState
            icon="cart"
            title={s.orders.emptyTitle}
            action={
              <Link
                className={buttonClass('secondary')}
                href={`/${locale}/products`}
                transitionTypes={NAV_TRANSITION}
              >
                {s.orders.emptyAction}
              </Link>
            }
          >
            {s.orders.emptyBody}
          </EmptyState>
        }
        paging={paging}
      />
      {next ? (
        <CursorPagination
          hasNext
          loading={loading}
          onNext={() => void loadMore(true)}
          labels={{
            nav: s.orders.list.nav,
            loadMore: s.orders.loadMore,
            previous: s.orders.list.previous,
            next: s.orders.list.next,
            loading: s.orders.list.loading,
          }}
        />
      ) : null}
    </AccountScreen>
  );
}

/**
 * What happened to the order, as a vertical list (DESIGN.md 9.2): each step has an icon and a word, so nothing rests on color alone.
 * Only moments the order really has are listed: it was placed, paid, shipped, delivered.
 */
export function OrderTimeline({ order, locale }: { order: OnlineOrderResponse; locale: Locale }) {
  const o = getShopText(locale).orders;
  const f = onlineFulfilmentDictionary(locale).customer;
  const steps = [
    { key: 'placed', icon: 'cart' as const, label: o.placedAt, at: order.placedAt },
    ...(order.paidAt
      ? [{ key: 'paid', icon: 'wallet' as const, label: o.paidAt, at: order.paidAt }]
      : []),
    ...(order.shipment
      ? [
          {
            key: 'shipped',
            icon: 'truck' as const,
            label: f.shippedAt,
            at: order.shipment.shippedAt,
          },
        ]
      : []),
    ...(order.deliveredAt
      ? [
          {
            key: 'delivered',
            icon: 'check-circle' as const,
            label: f.deliveredAt,
            at: order.deliveredAt,
          },
        ]
      : []),
  ];
  return (
    <ol className="ls-timeline">
      {steps.map((step) => (
        <li key={step.key}>
          <span className="ls-timeline-icon">
            <Icon name={step.icon} size={20} aria-hidden="true" />
          </span>
          <span className="ls-timeline-text">
            <span className="ls-timeline-label">{step.label}</span>
            <span className="ls-timeline-date">{formatDateTime(step.at, SHOP_ZONE, locale)}</span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What the page was opened by: PayOS bringing the customer back, or the checkout failing to open the payment page. */
interface Arrival {
  returned: boolean;
  cancelled: boolean;
  payFailed: boolean;
}

function readArrival(): Arrival {
  const search = window.location.search;
  const params = new URLSearchParams(search);
  return {
    returned: cameBackFromBank(search),
    cancelled: params.get('cancelled') === '1' || params.get('cancel') === 'true',
    payFailed: params.get('payFailed') === '1',
  };
}

/**
 * Whether the payment time of an unpaid order is over. One timer set for the deadline (not a tick every second), so the page itself does
 * not re-render while the countdown runs (rbp orders-screens.tsx:283-293); the ticking lives in `OrderCountdown`.
 */
function usePaymentTimeOver(order: OnlineOrderResponse | null): boolean {
  const waiting = order?.state === 'AWAITING_PAYMENT';
  const deadline = order?.deadlineAt ?? null;
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (!waiting) return undefined;
    const left = secondsLeft(deadline, Date.now());
    if (left === null) return undefined;
    if (left === 0) {
      setOver(true);
      return undefined;
    }
    setOver(false);
    const timer = window.setTimeout(() => setOver(true), left * 1000);
    return () => window.clearTimeout(timer);
  }, [waiting, deadline]);
  return waiting && over;
}

/**
 * The payment sentence of an unpaid order with its live countdown ("Hãy thanh toán trước 14:35. Còn lại 04:59."): the only part of the
 * page that ticks, once a second, in tabular digits so the line never jitters; under five minutes it turns to the warning tone with an
 * icon (the parent marks the paragraph).
 */
export function OrderCountdown({
  template,
  deadlineAt,
  locale,
}: {
  /** With {time} and {left}. */
  template: string;
  deadlineAt: string | null;
  locale: Locale;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const left = secondsLeft(deadlineAt, now);
  const urgent = left !== null && left < 300;
  return (
    <span className="ls-order-countdown" data-urgent={urgent ? 'true' : undefined}>
      {urgent ? <Icon name="alert-triangle" size={16} aria-hidden="true" /> : null}
      {fill(template, {
        time: deadlineAt ? formatClock(deadlineAt, locale) : '',
        left: left === null ? '' : formatCountdown(left),
      })}
    </span>
  );
}

/**
 * One online order of the signed-in member: the state, what is bought, the amounts, the address and, while unpaid, the deadline
 * with the "Thanh toán" and "Hủy đơn" buttons. When PayOS brings the customer back the order is read from the provider once and
 * then every 5 seconds for about two minutes (while it is still unpaid), without hiding the page.
 */
export function OnlineOrderDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const s = getShopText(locale);
  const o = s.orders;
  const detail = useFetch(() => api.get<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}`), id);
  const { sales } = useOnlineSales();
  // How the customer arrived (back from PayOS, a cancelled payment, a failed link), read once from the address while the first render
  // runs, not in an effect after it (react-best-practices rerender-derived-state-no-effect). The notices it drives appear only after
  // the order is read in the browser, so the server's empty reading never differs on screen.
  const [arrival] = useState<Arrival | null>(() =>
    typeof window === 'undefined' ? null : readArrival(),
  );
  const [checking, setChecking] = useState(false);
  const [paidNow, setPaidNow] = useState(false);
  const [paying, setPaying] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelledNow, setCancelledNow] = useState(false);
  const order = detail.data;
  const previous = useRef<OnlineOrderResponse['state'] | null>(null);
  const started = useRef<number>(0);
  const timeOver = usePaymentTimeOver(order);

  const accept = useCallback(
    (next: OnlineOrderResponse) => {
      if (previous.current === 'AWAITING_PAYMENT' && next.state !== 'AWAITING_PAYMENT') {
        if (next.state !== 'CANCELLED') setPaidNow(true);
      }
      previous.current = next.state;
      detail.set(next);
    },
    // `detail.set` only replaces state, so the first one stays valid.
    [],
  );

  // The first load: remember the state the order was seen in.
  useEffect(() => {
    if (order && previous.current === null) previous.current = order.state;
  }, [order]);

  // Coming back from the bank: read the PayOS request once now.
  const refreshed = useRef(false);
  useEffect(() => {
    if (!order || !arrival?.returned || refreshed.current) return;
    if (order.state !== 'AWAITING_PAYMENT') {
      refreshed.current = true;
      return;
    }
    refreshed.current = true;
    started.current = Date.now();
    setChecking(true);
    api
      .post<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}/refresh`, {})
      .then(accept)
      .catch(() => undefined)
      .finally(() => setChecking(false));
  }, [order, arrival, api, id, accept]);

  // ... then every 5 seconds for about two minutes, as a passive read (it never keeps the session alive).
  const state = order?.state ?? null;
  useEffect(() => {
    if (!arrival?.returned || state !== 'AWAITING_PAYMENT') return undefined;
    if (started.current === 0) started.current = Date.now();
    const timer = window.setInterval(() => {
      if (
        !shouldPoll({
          state: 'AWAITING_PAYMENT',
          returned: true,
          elapsedMs: Date.now() - started.current,
        })
      ) {
        window.clearInterval(timer);
        setChecking(false);
        return;
      }
      api
        .get<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}`, {}, { passive: true })
        .then(accept)
        .catch(() => undefined);
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [arrival, state, api, id, accept]);

  // The deadline reached: read the order once more, it was cancelled by the system or the payment arrived at the last second.
  useEffect(() => {
    if (!timeOver) return;
    api
      .get<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}`, {}, { passive: true })
      .then(accept)
      .catch(() => undefined);
  }, [timeOver, api, id, accept]);

  if (!order) {
    if (detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND') {
      return (
        <NotFoundPage message={o.notFound} backHref={`${base}/orders`} backLabel={o.allOrders} />
      );
    }
    return (
      <AccountScreen title={o.detailTitle} narrow>
        <LoadState error={detail.error} retry={detail.retry} />
      </AccountScreen>
    );
  }

  const awaiting = order.state === 'AWAITING_PAYMENT';
  const timeIsUp = awaiting && timeOver;
  const canPay = order.can.pay && !timeIsUp;
  const canCancel = order.can.cancel && !timeIsUp;
  const hasShipping = BigInt(order.shippingFeeVnd) > 0n;

  async function pay() {
    if (paying) return;
    setPaying(true);
    setFailure(null);
    try {
      const payment = await api.post<OnlinePaymentResponse>(`/api/v1/me/online-orders/${id}/pay`, {
        locale,
      });
      if (payment.checkoutUrl) {
        window.location.assign(payment.checkoutUrl);
        return;
      }
      setFailure(o.payFailed);
    } catch (error) {
      setFailure(shopErrorMessage(error, s.errors, (e) => customerErrorMessage(e, t)));
    }
    setPaying(false);
  }

  async function cancel() {
    const next = await api.post<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}/cancel`, {});
    previous.current = next.state;
    detail.set(next);
    setCancelledNow(true);
    setAsking(false);
    announceCartChange();
  }

  const stateLine = o.stateHint[order.state];
  // The badge and the sentence come from one state, so they never disagree: past the payment time the badge says so too.
  const closed = order.state === 'CANCELLED';
  const browse = timeIsUp || closed;

  return (
    <AccountScreen title={`${o.detailTitle} ${order.code}`} backLabel={o.backLabel}>
      {paidNow ? <Notice tone="success">{o.paidNow}</Notice> : null}
      {cancelledNow ? <Notice tone="info">{o.cancelledDone}</Notice> : null}
      {arrival?.payFailed && awaiting && !failure ? (
        <Notice tone="warning">{o.payFailed}</Notice>
      ) : null}
      {arrival?.cancelled && awaiting && !failure ? (
        <Notice tone="info">{o.cancelledBack}</Notice>
      ) : null}
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <div className="ls-order-layout" data-closed={closed ? 'true' : undefined}>
        <div className="ls-order-main">
          <Card as="section" aria-label={o.status}>
            <CardHeader
              title={o.status}
              actions={
                timeIsUp ? (
                  <Badge tone="danger" icon="alert-triangle">
                    {o.expiredBadge}
                  </Badge>
                ) : (
                  <OrderStateBadge state={order.state} label={o.state[order.state]} />
                )
              }
            />
            {checking ? (
              <p className="ls-shop-checking" role="status">
                <Spinner /> {o.checking}
              </p>
            ) : null}
            <p className="ls-shop-state">
              {timeIsUp ? (
                o.expiredBody
              ) : awaiting ? (
                <OrderCountdown
                  template={o.stateHint.AWAITING_PAYMENT}
                  deadlineAt={order.deadlineAt}
                  locale={locale}
                />
              ) : closed && !order.paidAt ? (
                `${stateLine} ${o.notCharged}`
              ) : (
                stateLine
              )}
            </p>
            {browse ? (
              <div>
                <Link
                  className={buttonClass('secondary')}
                  href={`/${locale}/products`}
                  transitionTypes={NAV_TRANSITION}
                >
                  {o.emptyAction}
                </Link>
              </div>
            ) : null}
            <OrderTimeline order={order} locale={locale} />
            {order.state === 'WAITING_GOODS' ? (
              <p className="ls-shop-note">{o.waitingNote}</p>
            ) : null}
            {sales &&
            sales !== 'failed' &&
            (order.state === 'PAID' || order.state === 'READY_TO_SHIP') ? (
              <p className="ls-shop-note">{fill(o.promise, promiseNumbers(sales))}</p>
            ) : null}
          </Card>
          <OrderFulfilment order={order} locale={locale} onUpdated={accept} hideDates />
          <Card as="section" aria-label={o.lines}>
            <CardHeader title={o.lines} />
            {/* One hairline row per line: the name (it wraps), "quantity × price" and its state under it, the line total at the
                trailing edge. No numbering, no equation. */}
            <ul className="ls-order-lines">
              {order.lines.map((line) => {
                const name = locale === 'vi' ? line.nameVi : line.nameEn;
                const label = locale === 'vi' ? line.variantLabelVi : line.variantLabelEn;
                return (
                  <li key={line.id} className="ls-order-line">
                    <div className="ls-order-line-main">
                      {/* The name of an order line already carries its variant ("Kem - 50 ml"): the label is added only when it does not. */}
                      <span className="ls-order-line-name">
                        {name}
                        {label && !name.includes(label) ? ` (${label})` : ''}
                      </span>
                      <span className="ls-shop-line-meta">
                        {line.quantity} × {formatVnd(line.unitPriceVnd, locale)}
                      </span>
                      {line.mode === 'PRE_ORDER' ||
                      (line.status === 'CANCELLED' && !closed) ||
                      line.refundedVnd ? (
                        <span className="ls-shop-line-note">
                          {line.mode === 'PRE_ORDER' ? (
                            <Badge tone="outline" icon={false}>
                              {o.preOrder}
                            </Badge>
                          ) : null}
                          {/* A line cancelled inside a live order says so; a cancelled order says it once, in its badge. */}
                          {line.status === 'CANCELLED' && !closed ? (
                            <Badge tone="neutral" icon="x-circle">
                              {o.lineCancelled}
                            </Badge>
                          ) : null}
                          {line.mode === 'PRE_ORDER' &&
                          line.status !== 'CANCELLED' &&
                          order.state !== 'AWAITING_PAYMENT' ? (
                            <span className="ls-shop-line-meta">
                              <Icon name="clock" size={16} aria-hidden="true" />
                              {fill(o.preOrderWait, {
                                range: expectedRange(line, locale, {
                                  range: o.expectedRange,
                                  afterPayment: o.afterPayment,
                                }),
                              })}
                            </span>
                          ) : null}
                          {line.refundedVnd ? (
                            <span className="ls-shop-line-meta">
                              {fill(o.lineRefunded, {
                                amount: formatVnd(line.refundedVnd, locale),
                              })}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                    <strong className="ls-order-line-total">
                      {formatVnd(line.lineTotalVnd, locale)}
                    </strong>
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
        <div className="ls-order-side">
          <Card as="section" aria-label={s.cart.summary} className="ls-order-summary">
            <CardHeader title={s.cart.summary} />
            <Stack gap="block">
              <DescriptionList
                layout="totals"
                items={[
                  { label: o.subtotal, value: formatVnd(order.subtotalVnd, locale) },
                  ...(BigInt(order.discountVnd) > 0n
                    ? [{ label: o.discount, value: `−${formatVnd(order.discountVnd, locale)}` }]
                    : []),
                  {
                    label: o.shipping,
                    value: hasShipping ? formatVnd(order.shippingFeeVnd, locale) : o.free,
                  },
                  { label: o.total, value: formatVnd(order.totalVnd, locale), strong: true },
                ]}
              />
              {awaiting && (canPay || canCancel) ? (
                <div className="ls-order-actions-stack">
                  {canPay ? (
                    <Button
                      variant="primary"
                      size="lg"
                      fullWidth
                      loading={paying}
                      onClick={() => void pay()}
                    >
                      {paying ? o.paying : o.pay}
                    </Button>
                  ) : null}
                  {canCancel ? (
                    <Button
                      variant="danger-outline"
                      icon="x-circle"
                      fullWidth
                      onClick={() => setAsking(true)}
                      disabled={paying}
                    >
                      {o.cancel}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </Stack>
            {/* The delivery address in the same card (one surface for the summary): plain lines, no small label above each. */}
            <section className="ls-order-address" aria-labelledby="order-address-title">
              <h2 className="ls-order-address-title" id="order-address-title">
                {o.delivery}
              </h2>
              <p>{order.recipient.name}</p>
              <p translate="no">{nationalPhone(order.recipient.phone)}</p>
              <p>
                {[order.recipient.street, order.recipient.ward, order.recipient.provinceName]
                  .filter((part) => part !== '')
                  .join(', ')}
              </p>
            </section>
          </Card>
        </div>
      </div>
      {asking ? (
        <ConfirmDialog
          title={o.cancelTitle}
          description={o.cancelBody}
          tone="danger"
          confirmLabel={o.cancelConfirm}
          busyLabel={o.cancelBusy}
          cancelLabel={o.keep}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: shopErrorMessage(error, s.errors, (e) => customerErrorMessage(e, t)),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onConfirm={cancel}
          onCancel={() => setAsking(false)}
        />
      ) : null}
    </AccountScreen>
  );
}

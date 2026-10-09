'use client';

import type {
  OnlineOrderListItem,
  OnlineOrderListResponse,
  OnlineOrderResponse,
  OnlinePaymentResponse,
} from '@lucy-spa/contracts';
import {
  Badge,
  Breadcrumbs,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  CursorPagination,
  DataTable,
  DescriptionList,
  EmptyState,
  Notice,
  Page,
  PageHeader,
  Reveal,
  RowActions,
  Spinner,
  buttonClass,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Locale } from '../../i18n/locales';
import { getShopText } from '../../i18n/online-shop';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { getWorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from '../../lib/api/client';
import { customerErrorMessage, formatDateTime } from '../../lib/customer/booking';
import { appendPage, formatVnd } from '../../lib/customer/invoice';
import { fill } from '../../lib/fill';
import {
  POLL_INTERVAL_MS,
  announceCartChange,
  cameBackFromBank,
  formatClock,
  formatCountdown,
  nationalPhone,
  orderStateTone,
  secondsLeft,
  shopErrorMessage,
  shouldPoll,
} from '../../lib/shop/online';
import { cursorLabels } from '../../lib/workforce/list-view';
import { expectedText, orderStatusTone } from '../../lib/workforce/product-orders';
import { useClientPaging } from '../../lib/workforce/use-client-paging';
import { useCustomer } from '../customer/session';
import { LoadState, NotFoundPage, useFetch } from '../customer/screens/bookings';
import { OrderFulfilment } from './order-fulfilment';
import { promiseNumbers } from '../../lib/shop/online';
import { useOnlineSales } from './shop-data';

/** The shop works in Vietnam: every date of an order is read in this zone. */
const SHOP_ZONE = 'Asia/Ho_Chi_Minh';

const orderName = (item: OnlineOrderListItem, locale: Locale) =>
  locale === 'vi' ? item.firstLineNameVi : item.firstLineNameEn;

/** "Đơn hàng online": the member's online orders, newest first, 20 a page. */
export function OnlineOrdersScreen() {
  const { api, t, locale, base } = useCustomer();
  const s = getShopText(locale);
  const router = useRouter();
  const w = getWorkforceDictionary(locale);
  const paging = useClientPaging(w, s.orders.title);
  const first = useFetch(
    () => api.get<OnlineOrderListResponse>('/api/v1/me/online-orders'),
    'orders',
  );
  const [more, setMore] = useState<{
    items: OnlineOrderListItem[];
    cursor: string | null | undefined;
  }>({
    items: [],
    cursor: undefined,
  });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!first.data) {
    return (
      <Page>
        <PageHeader title={s.orders.title} description={s.orders.intro} />
        <LoadState error={first.error} retry={first.retry} />
      </Page>
    );
  }
  const next = more.cursor === undefined ? first.data.nextCursor : more.cursor;
  const shown = appendPage(first.data.orders, more.items);

  async function loadMore() {
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
      }));
    } catch (error) {
      setFailure(customerErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  }

  const columns: DataTableColumn<OnlineOrderListItem>[] = [
    {
      key: 'code',
      header: s.orders.columns.code,
      mobileTitle: true,
      cell: (item) => (
        <Link className="ls-link" href={`${base}/orders/${item.id}`}>
          {item.code}
        </Link>
      ),
    },
    {
      key: 'date',
      header: s.orders.columns.date,
      hideBelow: 'lg',
      cell: (item) => formatDateTime(item.placedAt, SHOP_ZONE, locale),
    },
    {
      key: 'items',
      header: s.orders.columns.items,
      hideBelow: 'md',
      truncate: true,
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
      cell: (item) => <Badge tone={orderStateTone(item.state)}>{s.orders.state[item.state]}</Badge>,
    },
    {
      key: 'actions',
      header: s.orders.columns.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(s.orders.actionsFor, { code: item.code })}
          items={[
            {
              id: 'open',
              label: s.orders.open,
              icon: 'eye',
              onSelect: () => router.push(`${base}/orders/${item.id}`),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Page>
      <PageHeader title={s.orders.title} description={s.orders.intro} />
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <DataTable
        mode="client"
        className="ls-cards-one-line"
        caption={fill(w.common.list.table, { list: s.orders.title })}
        columns={columns}
        rows={shown}
        rowKey={(item) => item.id}
        empty={
          <EmptyState
            icon="cart"
            action={
              <Link className={buttonClass('secondary')} href={`/${locale}/products`}>
                {s.orders.emptyAction}
              </Link>
            }
          >
            {s.orders.empty}
          </EmptyState>
        }
        paging={paging}
      />
      {next ? (
        <CursorPagination
          hasNext
          loading={loading}
          onNext={() => void loadMore()}
          labels={{ ...cursorLabels(w, s.orders.title), loadMore: s.orders.loadMore }}
        />
      ) : null}
    </Page>
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

/** The seconds left to pay, ticking once a second while the order waits for money. */
function useSecondsLeft(order: OnlineOrderResponse | null): number | null {
  const [now, setNow] = useState(() => Date.now());
  const waiting = order?.state === 'AWAITING_PAYMENT';
  useEffect(() => {
    if (!waiting) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  return waiting && order ? secondsLeft(order.deadlineAt, now) : null;
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
  const status = productOrdersDictionary(locale);
  const detail = useFetch(() => api.get<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}`), id);
  const { sales } = useOnlineSales();
  const [arrival, setArrival] = useState<Arrival | null>(null);
  const [checking, setChecking] = useState(false);
  const [paidNow, setPaidNow] = useState(false);
  const [paying, setPaying] = useState(false);
  const [asking, setAsking] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [cancelledNow, setCancelledNow] = useState(false);
  const order = detail.data;
  const previous = useRef<OnlineOrderResponse['state'] | null>(null);
  const started = useRef<number>(0);
  const left = useSecondsLeft(order);

  useEffect(() => setArrival(readArrival()), []);

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
    if (left !== 0) return;
    api
      .get<OnlineOrderResponse>(`/api/v1/me/online-orders/${id}`, {}, { passive: true })
      .then(accept)
      .catch(() => undefined);
  }, [left, api, id, accept]);

  if (!order) {
    if (detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND') {
      return <NotFoundPage message={o.notFound} backHref={`${base}/orders`} backLabel={o.title} />;
    }
    return (
      <Page width="form">
        <LoadState error={detail.error} retry={detail.retry} />
      </Page>
    );
  }

  const awaiting = order.state === 'AWAITING_PAYMENT';
  const timeIsUp = awaiting && left === 0;
  const canPay = order.can.pay && !timeIsUp;
  const canCancel = order.can.cancel && !timeIsUp;
  const zone = SHOP_ZONE;
  const hasShipping = BigInt(order.shippingFeeVnd) > 0n;
  const words = status.accountBlock;

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

  const stateLine = awaiting
    ? fill(o.stateHint.AWAITING_PAYMENT, {
        time: order.deadlineAt ? formatClock(order.deadlineAt, locale) : '',
        left: left === null ? '' : formatCountdown(left),
      })
    : o.stateHint[order.state];

  return (
    <Page width="form">
      <PageHeader
        title={`${o.detailTitle} ${order.code}`}
        breadcrumbs={
          <Breadcrumbs
            label={t.nav.menu}
            LinkComponent={Link}
            items={[{ label: o.title, href: `${base}/orders` }, { label: order.code }]}
          />
        }
        actions={
          awaiting ? (
            <>
              {canCancel ? (
                <Button variant="secondary" onClick={() => setAsking(true)} disabled={paying}>
                  {o.cancel}
                </Button>
              ) : null}
              {canPay ? (
                <Button variant="primary" loading={paying} onClick={() => void pay()}>
                  {paying ? o.paying : o.pay}
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      {paidNow ? <Notice tone="success">{o.paidNow}</Notice> : null}
      {cancelledNow ? <Notice tone="info">{o.cancelledDone}</Notice> : null}
      {arrival?.payFailed && awaiting && !failure ? (
        <Notice tone="warning">{o.payFailed}</Notice>
      ) : null}
      {arrival?.cancelled && awaiting && !failure ? (
        <Notice tone="info">{o.cancelledBack}</Notice>
      ) : null}
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <Reveal>
        <Card as="section" aria-label={o.status}>
          <CardHeader
            title={o.status}
            actions={<Badge tone={orderStateTone(order.state)}>{o.state[order.state]}</Badge>}
          />
          {checking ? (
            <p className="ls-shop-checking" role="status">
              <Spinner /> {o.checking}
            </p>
          ) : null}
          <p
            className="ls-shop-state"
            data-urgent={awaiting && left !== null && left < 300 ? 'true' : undefined}
          >
            {timeIsUp ? o.expired : stateLine}
          </p>
          <DescriptionList
            items={[
              { label: o.code, value: order.code },
              { label: o.placedAt, value: formatDateTime(order.placedAt, zone, locale) },
              ...(order.paidAt
                ? [{ label: o.paidAt, value: formatDateTime(order.paidAt, zone, locale) }]
                : []),
            ]}
          />
          {sales &&
          sales !== 'failed' &&
          (order.state === 'PAID' || order.state === 'READY_TO_SHIP') ? (
            <p className="ls-hint">{fill(o.promise, promiseNumbers(sales))}</p>
          ) : null}
        </Card>
      </Reveal>
      <OrderFulfilment order={order} locale={locale} onUpdated={accept} />
      <Reveal>
        <Card as="section" aria-label={o.lines}>
          <CardHeader title={o.lines} />
          <DescriptionList
            items={order.lines.map((line) => {
              const name = locale === 'vi' ? line.nameVi : line.nameEn;
              const label = locale === 'vi' ? line.variantLabelVi : line.variantLabelEn;
              return {
                // The name of an order line already carries its variant ("Kem - 50 ml"): the label is added only when it does not.
                label: `${line.sequence}. ${name}${label && !name.includes(label) ? ` (${label})` : ''}`,
                value: (
                  <>
                    {formatVnd(line.unitPriceVnd, locale)} × {line.quantity} ={' '}
                    <strong>{formatVnd(line.lineTotalVnd, locale)}</strong>
                    {line.mode === 'PRE_ORDER' || line.status === 'CANCELLED' ? (
                      <span className="ls-shop-line-note">
                        {line.mode === 'PRE_ORDER' ? <Badge tone="info">{o.preOrder}</Badge> : null}
                        {line.status === 'CANCELLED' ? (
                          <Badge tone="neutral">{o.lineCancelled}</Badge>
                        ) : line.mode === 'PRE_ORDER' ? (
                          <Badge tone={orderStatusTone(line.status)}>
                            {status.customerStatus[line.status]}
                          </Badge>
                        ) : null}
                        {line.mode === 'PRE_ORDER' &&
                        line.status !== 'CANCELLED' &&
                        order.state !== 'AWAITING_PAYMENT' ? (
                          <span className="ls-hint">
                            {fill(o.preOrderWait, {
                              range: expectedText(line, locale, {
                                range: words.range,
                                afterPayment: words.afterPayment,
                              }),
                            })}
                          </span>
                        ) : null}
                        {line.refundedVnd ? (
                          <span className="ls-hint">
                            {fill(o.lineRefunded, { amount: formatVnd(line.refundedVnd, locale) })}
                          </span>
                        ) : null}
                      </span>
                    ) : null}
                  </>
                ),
              };
            })}
          />
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
        </Card>
      </Reveal>
      <Reveal>
        <Card as="section" aria-label={o.delivery}>
          <CardHeader title={o.delivery} />
          <DescriptionList
            items={[
              { label: o.recipient, value: order.recipient.name },
              { label: o.phone, value: nationalPhone(order.recipient.phone) },
              {
                label: o.address,
                value: [order.recipient.street, order.recipient.ward, order.recipient.provinceName]
                  .filter((part) => part !== '')
                  .join(', '),
              },
            ]}
          />
        </Card>
      </Reveal>
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
    </Page>
  );
}

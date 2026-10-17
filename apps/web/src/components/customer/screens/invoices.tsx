'use client';

import type {
  CustomerInvoiceDetail,
  CustomerInvoiceListResponse,
  CustomerInvoiceSummary,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  CursorPagination,
  DataTable,
  DescriptionList,
  Notice,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useState } from 'react';
import { fill } from '../../../i18n/customer';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { ApiError } from '../../../lib/api/client';
import { customerErrorMessage, formatDateTime } from '../../../lib/customer/booking';
import {
  appendPage,
  formatBusinessDate,
  formatVnd,
  invoiceTone,
} from '../../../lib/customer/invoice';
import { AccountScreen } from '../account-frame';
import { expectedRange, memberCursorLabels, orderLineTone } from '../member-format';
import { useMemberPaging, useUrlPage } from '../member-paging';
import { MemberEmpty, RowLink, StatusBadge } from '../member-ui';
import { useCustomer } from '../session';
import { LoadState, NotFoundPage, useFetch } from './bookings';
import { ReviewBlock, useReviewPrompt } from './review-card';

/** An invoice state with its icon and word (B18): a cancelled invoice is neutral with a cross. */
function InvoiceStatus({ status }: { status: CustomerInvoiceSummary['status'] }) {
  const { t } = useCustomer();
  return (
    <StatusBadge tone={invoiceTone(status)} icon={status === 'CANCELLED' ? 'x-circle' : undefined}>
      {t.invoices.status[status]}
    </StatusBadge>
  );
}

/** "Hóa đơn của tôi": the invoices the signed-in customer paid for, newest first, from the server. */
export function CustomerInvoicesScreen() {
  const { api, t, locale, base } = useCustomer();
  const paging = useMemberPaging(t, t.invoices.title);
  const first = useFetch(
    () => api.get<CustomerInvoiceListResponse>('/api/v1/me/invoices'),
    'invoices',
    { cache: '/api/v1/me/invoices' },
  );
  const [more, setMore] = useState<{
    items: CustomerInvoiceSummary[];
    cursor: string | null | undefined;
    /** Further pages fetched with "Xem thêm". */
    pages: number;
  }>({ items: [], cursor: undefined, pages: 0 });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // How many "Xem thêm" pages are shown lives in the address bar (wig invoices.tsx:163): Back from an invoice or a reload shows them again.
  const [loaded, setLoaded] = useUrlPage('loaded');
  // `undefined` = no further page fetched yet: continue from the first response.
  const next = !first.data ? null : more.cursor === undefined ? first.data.nextCursor : more.cursor;

  async function loadMore(fromButton: boolean) {
    if (loading || !next) return;
    setLoading(true);
    setFailure(null);
    try {
      const page = await api.get<CustomerInvoiceListResponse>(
        `/api/v1/me/invoices?cursor=${encodeURIComponent(next)}`,
      );
      setMore((current) => ({
        items: appendPage(current.items, page.invoices),
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

  // One branch only: a column that says the same thing on every row is left out (it was cut off and told nothing).
  const oneBranch =
    new Set([...(first.data?.invoices ?? []), ...more.items].map((item) => item.branch.name))
      .size <= 1;
  // The code tells the rows apart (seven invoices of one day all read "14/10/2026" by date alone, C15); the date is under it.
  // One column set per language and branch case, not per render (a client table re-sorts when its columns change).
  const columns = useMemo<DataTableColumn<CustomerInvoiceSummary>[]>(() => {
    const all: DataTableColumn<CustomerInvoiceSummary>[] = [
      {
        key: 'code',
        header: t.invoices.columns.code,
        mobileTitle: true,
        cell: (item) => (
          <span className="ls-mem-cell-stack">
            <RowLink href={`${base}/invoices/${item.id}`}>
              <span translate="no">{item.code}</span>
            </RowLink>
            <span className="ls-mem-cell-sub">{formatBusinessDate(item.businessDate, locale)}</span>
          </span>
        ),
      },
      {
        key: 'branch',
        header: t.invoices.columns.branch,
        hideBelow: 'lg',
        cell: (item) => item.branch.name,
      },
      {
        key: 'total',
        header: t.invoices.columns.total,
        numeric: true,
        cell: (item) => formatVnd(item.totalVnd, locale),
      },
      {
        key: 'balance',
        header: t.invoices.columns.balance,
        numeric: true,
        hideBelow: 'md',
        // A phone row has no column labels: a second amount beside the total could not be told apart (E4 review). The status says
        // "Chờ thanh toán" and the invoice page shows what is still due.
        hidePhone: true,
        cell: (item) =>
          formatVnd(item.status === 'PENDING_PAYMENT' ? item.balanceVnd : '0', locale),
      },
      {
        key: 'status',
        header: t.invoices.columns.status,
        cell: (item) => <InvoiceStatus status={item.status} />,
      },
    ];
    return oneBranch ? all.filter((column) => column.key !== 'branch') : all;
  }, [t, locale, base, oneBranch]);

  if (!first.data) {
    return (
      <AccountScreen title={t.invoices.title} description={t.invoices.intro}>
        <LoadState error={first.error} retry={first.retry} />
      </AccountScreen>
    );
  }
  const shown = appendPage(first.data.invoices, more.items);

  if (shown.length === 0) {
    return (
      <AccountScreen title={t.invoices.title} description={t.invoices.intro}>
        <MemberEmpty
          icon="receipt"
          title={t.invoices.emptyTitle}
          actionHref={`${base}/book`}
          actionLabel={t.home.bookCta}
        >
          {t.invoices.empty}
        </MemberEmpty>
      </AccountScreen>
    );
  }

  return (
    <AccountScreen title={t.invoices.title} description={t.invoices.intro}>
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <DataTable
        mode="client"
        className="ls-mem-rows"
        phoneRows="compact"
        drillDown
        caption={fill(t.list.table, { list: t.invoices.title })}
        columns={columns}
        rows={shown}
        rowKey={(item) => item.id}
        paging={paging}
      />
      {next ? (
        <CursorPagination
          hasNext
          loading={loading}
          onNext={() => void loadMore(true)}
          labels={memberCursorLabels(t, t.invoices.title, t.invoices.loadMore)}
        />
      ) : null}
    </AccountScreen>
  );
}

/** One own invoice. A foreign, guest-payer, draft or missing invoice all read as "not found". */
export function CustomerInvoiceDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const detail = useFetch(() => api.get<CustomerInvoiceDetail>(`/api/v1/me/invoices/${id}`), id, {
    cache: `/api/v1/me/invoices/${id}`,
  });
  // Read beside the invoice, not after it (rbp invoices.tsx:392); shown only for a paid invoice.
  const review = useReviewPrompt(id);

  if (!detail.data) {
    if (detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND') {
      return (
        <NotFoundPage
          message={t.invoices.notFound}
          backHref={`${base}/invoices`}
          backLabel={t.invoices.title}
        />
      );
    }
    return (
      <AccountScreen title={t.invoices.detailTitle} backLabel={t.invoices.back} narrow>
        <LoadState error={detail.error} retry={detail.retry} />
      </AccountScreen>
    );
  }
  const invoice = detail.data;
  const zone = invoice.branch.timezone;
  const status = productOrdersDictionary(locale);
  const orders = status.accountBlock;
  const nameOf = (line: { nameVi: string; nameEn: string }) =>
    locale === 'vi' ? line.nameVi : line.nameEn;
  const linesBySequence = new Map(invoice.lines.map((line) => [line.sequence, line]));
  // Phase 6 P6-10 (T26): services and combos first, then the products; each group is its own card.
  const productSequences = new Set(invoice.productSequences ?? []);
  const groups = [
    {
      key: 'services' as const,
      title: t.invoices.services,
      lines: invoice.lines.filter((line) => !productSequences.has(line.sequence)),
    },
    {
      key: 'products' as const,
      title: t.invoices.products,
      lines: invoice.lines.filter((line) => productSequences.has(line.sequence)),
    },
  ].filter((group) => group.lines.length > 0);
  return (
    <AccountScreen
      title={t.invoices.detailTitle}
      description={formatBusinessDate(invoice.visitDate, locale)}
      backLabel={t.invoices.back}
    >
      <div className="ls-mem-split">
        <div className="ls-mem-main">
          {groups.map((group) => (
            <Card as="section" key={group.key} aria-label={group.title}>
              <CardHeader title={group.title} />
              <ul className="ls-mem-lines">
                {group.lines.map((line) => {
                  const recipientText =
                    group.key === 'services'
                      ? line.forSelf
                        ? t.invoices.forSelf
                        : line.recipientName
                          ? fill(t.invoices.forOther, { name: line.recipientName })
                          : null
                      : null;
                  return (
                    <li key={line.sequence} className="ls-mem-line">
                      <div className="ls-mem-line-head">
                        <p className="ls-mem-line-name">{nameOf(line)}</p>
                        <p className="ls-mem-line-price">{formatVnd(line.grossVnd, locale)}</p>
                      </div>
                      <p className="ls-mem-line-meta">
                        <span>
                          {formatVnd(line.unitPriceVnd, locale)} × {line.quantity}
                        </span>
                        {recipientText ? <span>{recipientText}</span> : null}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
          {invoice.productOrder ? (
            <Card as="section" aria-label={orders.title}>
              <CardHeader title={orders.title} description={orders.note} />
              {invoice.productOrder.lines.some((line) => line.status === 'ARRIVED') ? (
                <Notice tone="success">{orders.arrivedHint}</Notice>
              ) : null}
              <p className="ls-mem-line-meta">
                <span>{orders.code}</span>
                <span translate="no">{invoice.productOrder.code}</span>
              </p>
              <ul className="ls-mem-lines">
                {invoice.productOrder.lines.map((line) => {
                  const source = linesBySequence.get(line.sequence);
                  const waiting = !(
                    line.status === 'CANCELLED' ||
                    line.status === 'ARRIVED' ||
                    line.status === 'HANDED_OVER' ||
                    line.status === 'COMPLETED'
                  );
                  return (
                    <li key={line.sequence} className="ls-mem-line">
                      <div className="ls-mem-line-head">
                        <p className="ls-mem-line-name">{source ? nameOf(source) : ''}</p>
                        <StatusBadge
                          tone={orderLineTone(line.status)}
                          icon={line.status === 'CANCELLED' ? 'x-circle' : undefined}
                        >
                          {status.customerStatus[line.status]}
                        </StatusBadge>
                      </div>
                      {waiting ? (
                        <p className="ls-mem-line-meta">
                          <span>
                            {orders.expected}:{' '}
                            {expectedRange(line, locale, {
                              range: orders.range,
                              afterPayment: orders.afterPayment,
                            })}
                          </span>
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ) : null}
          <Card as="section" aria-label={t.invoices.payments}>
            <CardHeader title={t.invoices.payments} />
            {invoice.payments.length === 0 ? (
              <p className="ls-empty-line">{t.invoices.noPayments}</p>
            ) : (
              <ul className="ls-mem-lines">
                {invoice.payments.map((payment, index) => (
                  <li key={`${payment.paidAt}-${index}`} className="ls-mem-line">
                    <div className="ls-mem-line-head">
                      <p className="ls-mem-line-name">{t.invoices.method[payment.method]}</p>
                      <p className="ls-mem-line-price">{formatVnd(payment.amountVnd, locale)}</p>
                    </div>
                    <p className="ls-mem-line-meta">
                      <span>{formatDateTime(payment.paidAt, zone, locale)}</span>
                      {payment.reversed ? (
                        <StatusBadge tone="warning">{t.invoices.reversed}</StatusBadge>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <Card as="section" aria-label={t.invoices.detailTitle} className="ls-mem-aside">
          <InvoiceStatus status={invoice.status} />
          <DescriptionList
            className="ls-mem-summary"
            items={[
              { label: t.invoices.code, value: <span translate="no">{invoice.code}</span> },
              { label: t.invoices.branch, value: invoice.branch.name },
              {
                label: t.invoices.issuedAt,
                value: formatDateTime(invoice.finalizedAt, zone, locale),
              },
              ...(invoice.paidAt
                ? [
                    {
                      label: t.invoices.paidAt,
                      value: formatDateTime(invoice.paidAt, zone, locale),
                    },
                  ]
                : []),
              ...(invoice.cancelledAt
                ? [
                    {
                      label: t.invoices.cancelledAt,
                      value: formatDateTime(invoice.cancelledAt, zone, locale),
                    },
                  ]
                : []),
            ]}
          />
          <DescriptionList
            layout="totals"
            className="ls-mem-totals"
            items={[
              { label: t.invoices.subtotal, value: formatVnd(invoice.subtotalVnd, locale) },
              ...(invoice.discount
                ? [
                    {
                      label: `${t.invoices.discount} (${locale === 'vi' ? invoice.discount.nameVi : invoice.discount.nameEn}${
                        invoice.discount.voucherCode
                          ? `, ${fill(t.invoices.voucher, { code: invoice.discount.voucherCode })}`
                          : ''
                      })`,
                      value: `−${formatVnd(invoice.discount.amountVnd, locale)}`,
                    },
                  ]
                : []),
              { label: t.invoices.total, value: formatVnd(invoice.totalVnd, locale), strong: true },
              { label: t.invoices.paid, value: formatVnd(invoice.paidVnd, locale) },
              ...(invoice.status === 'PENDING_PAYMENT'
                ? [
                    {
                      label: t.invoices.balance,
                      value: formatVnd(invoice.balanceVnd, locale),
                      strong: true,
                    },
                  ]
                : []),
            ]}
          />
          <p className="ls-mem-note">{t.invoices.note}</p>
        </Card>
      </div>
      {invoice.status === 'PAID' ? <ReviewBlock prompt={review.data} /> : null}
    </AccountScreen>
  );
}

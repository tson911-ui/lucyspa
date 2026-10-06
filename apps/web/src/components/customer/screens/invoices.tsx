'use client';

import type {
  CustomerInvoiceDetail,
  CustomerInvoiceListResponse,
  CustomerInvoiceSummary,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CardHeader,
  CursorPagination,
  DataTable,
  DescriptionList,
  Notice,
  Page,
  PageHeader,
  Reveal,
  RowActions,
  type DataTableColumn,
} from '@lucy-spa/ui';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { fill } from '../../../i18n/customer';
import { getWorkforceDictionary } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/api/client';
import { customerErrorMessage, formatDateTime } from '../../../lib/customer/booking';
import {
  appendPage,
  formatBusinessDate,
  formatVnd,
  invoiceTone,
} from '../../../lib/customer/invoice';
import { cursorLabels } from '../../../lib/workforce/list-view';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { Badge, Empty } from '../../workforce/ui';
import { useCustomer } from '../session';
import { LoadState, NotFoundPage, useFetch } from './bookings';

/** "Hóa đơn của tôi": the invoices the signed-in customer paid for, newest first, from the server. */
export function CustomerInvoicesScreen() {
  const { api, t, locale, base } = useCustomer();
  const router = useRouter();
  const w = getWorkforceDictionary(locale);
  const paging = useClientPaging(w, t.invoices.title);
  const first = useFetch(
    () => api.get<CustomerInvoiceListResponse>('/api/v1/me/invoices'),
    'invoices',
  );
  const [more, setMore] = useState<{
    items: CustomerInvoiceSummary[];
    cursor: string | null | undefined;
  }>({ items: [], cursor: undefined });
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  if (!first.data) {
    return (
      <Page>
        <PageHeader title={t.invoices.title} description={t.invoices.intro} />
        <LoadState error={first.error} retry={first.retry} />
      </Page>
    );
  }
  // `undefined` = no further page fetched yet: continue from the first response.
  const next = more.cursor === undefined ? first.data.nextCursor : more.cursor;
  const shown = appendPage(first.data.invoices, more.items);

  async function loadMore() {
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
      }));
    } catch (error) {
      setFailure(customerErrorMessage(error, t));
    } finally {
      setLoading(false);
    }
  }

  const columns: DataTableColumn<CustomerInvoiceSummary>[] = [
    {
      key: 'date',
      header: t.invoices.columns.date,
      mobileTitle: true,
      cell: (item) => (
        <Link className="ls-link" href={`${base}/invoices/${item.id}`}>
          {formatBusinessDate(item.businessDate, locale)}
        </Link>
      ),
    },
    {
      key: 'branch',
      header: t.invoices.columns.branch,
      hideBelow: 'lg',
      truncate: true,
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
      cell: (item) =>
        item.status === 'PENDING_PAYMENT' ? formatVnd(item.balanceVnd, locale) : '—',
    },
    {
      key: 'status',
      header: t.invoices.columns.status,
      cell: (item) => (
        <Badge tone={invoiceTone(item.status)}>{t.invoices.status[item.status]}</Badge>
      ),
    },
    {
      key: 'actions',
      header: t.invoices.columns.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.invoices.actionsFor, { code: item.code })}
          items={[
            {
              id: 'open',
              label: t.invoices.open,
              icon: 'eye',
              onSelect: () => router.push(`${base}/invoices/${item.id}`),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Page>
      <PageHeader title={t.invoices.title} description={t.invoices.intro} />
      {failure ? <Notice tone="danger">{failure}</Notice> : null}
      <DataTable
        mode="client"
        className="ls-cards-one-line"
        caption={fill(w.common.list.table, { list: t.invoices.title })}
        columns={columns}
        rows={shown}
        rowKey={(item) => item.id}
        empty={<Empty>{t.invoices.empty}</Empty>}
        paging={paging}
      />
      {next ? (
        <CursorPagination
          hasNext
          loading={loading}
          onNext={() => void loadMore()}
          labels={{ ...cursorLabels(w, t.invoices.title), loadMore: t.invoices.loadMore }}
        />
      ) : null}
    </Page>
  );
}

/** One own invoice. A foreign, guest-payer, draft or missing invoice all read as "not found". */
export function CustomerInvoiceDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const detail = useFetch(() => api.get<CustomerInvoiceDetail>(`/api/v1/me/invoices/${id}`), id);

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
      <Page width="form">
        <LoadState error={detail.error} retry={detail.retry} />
      </Page>
    );
  }
  const invoice = detail.data;
  const zone = invoice.branch.timezone;
  return (
    <Page width="form">
      <PageHeader
        title={t.invoices.detailTitle}
        breadcrumbs={
          <Breadcrumbs
            label={t.nav.menu}
            LinkComponent={Link}
            items={[{ label: t.invoices.title, href: `${base}/invoices` }, { label: invoice.code }]}
          />
        }
      />
      <Reveal>
        <Card as="section" aria-label={t.invoices.detailTitle}>
          <DescriptionList
            items={[
              { label: t.invoices.code, value: invoice.code },
              {
                label: t.invoices.statusLabel,
                value: (
                  <Badge tone={invoiceTone(invoice.status)}>
                    {t.invoices.status[invoice.status]}
                  </Badge>
                ),
              },
              { label: t.invoices.branch, value: invoice.branch.name },
              { label: t.invoices.date, value: formatBusinessDate(invoice.visitDate, locale) },
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
        </Card>
      </Reveal>
      <Reveal>
        <Card as="section" aria-label={t.invoices.services}>
          <CardHeader title={t.invoices.services} />
          <DescriptionList
            items={invoice.lines.map((line) => ({
              label: `${line.sequence}. ${locale === 'vi' ? line.nameVi : line.nameEn}`,
              value: (
                <>
                  {line.forSelf
                    ? t.invoices.forSelf
                    : line.recipientName
                      ? fill(t.invoices.forOther, { name: line.recipientName })
                      : null}
                  {line.forSelf || line.recipientName ? <br /> : null}
                  {formatVnd(line.unitPriceVnd, locale)} × {line.quantity} ={' '}
                  <strong>{formatVnd(line.grossVnd, locale)}</strong>
                </>
              ),
            }))}
          />
          <DescriptionList
            layout="totals"
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
        </Card>
      </Reveal>
      <Reveal>
        <Card as="section" aria-label={t.invoices.payments}>
          <CardHeader title={t.invoices.payments} />
          {invoice.payments.length === 0 ? (
            <Empty>{t.invoices.noPayments}</Empty>
          ) : (
            <DescriptionList
              items={invoice.payments.map((payment) => ({
                label: `${t.invoices.method[payment.method]} · ${formatDateTime(payment.paidAt, zone, locale)}`,
                value: (
                  <>
                    <strong>{formatVnd(payment.amountVnd, locale)}</strong>
                    {payment.reversed ? (
                      <>
                        {' '}
                        <Badge tone="warning">{t.invoices.reversed}</Badge>
                      </>
                    ) : null}
                  </>
                ),
              }))}
            />
          )}
          <p className="ls-detail-note">{t.invoices.note}</p>
        </Card>
      </Reveal>
    </Page>
  );
}

'use client';

import type {
  CustomerInvoiceDetail,
  CustomerInvoiceListResponse,
  CustomerInvoiceSummary,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useState } from 'react';
import { fill } from '../../../i18n/customer';
import { ApiError } from '../../../lib/api/client';
import { customerErrorMessage, formatDateTime } from '../../../lib/customer/booking';
import {
  appendPage,
  formatBusinessDate,
  formatVnd,
  invoiceTone,
} from '../../../lib/customer/invoice';
import { Badge, Notice } from '../../workforce/ui';
import { useCustomer } from '../session';
import { LoadState, useFetch } from './bookings';

function InvoiceCard({ item }: { item: CustomerInvoiceSummary }) {
  const { t, locale, base } = useCustomer();
  return (
    <li className="cu-card">
      <div className="cu-card-head">
        <strong>{formatBusinessDate(item.businessDate, locale)}</strong>
        <Badge tone={invoiceTone(item.status)}>{t.invoices.status[item.status]}</Badge>
      </div>
      <p>
        <strong>{formatVnd(item.totalVnd, locale)}</strong>
        {item.status === 'PENDING_PAYMENT' ? (
          <span className="wf-muted">
            {' '}
            · {t.invoices.balance}: {formatVnd(item.balanceVnd, locale)}
          </span>
        ) : null}
      </p>
      <p className="wf-muted">
        {item.branch.name} · {t.invoices.code} {item.code}
      </p>
      <Link href={`${base}/invoices/${item.id}`} className="wf-button wf-button-quiet">
        {t.invoices.open}
      </Link>
    </li>
  );
}

/** "Hóa đơn của tôi": the invoices the signed-in customer paid for, newest first, from the server. */
export function CustomerInvoicesScreen() {
  const { api, t } = useCustomer();
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
      <section className="cu-panel">
        <h1>{t.invoices.title}</h1>
        <LoadState error={first.error} retry={first.retry} />
      </section>
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

  return (
    <section className="cu-panel">
      <h1>{t.invoices.title}</h1>
      <p className="wf-muted">{t.invoices.intro}</p>
      {shown.length === 0 ? (
        <p className="wf-empty">{t.invoices.empty}</p>
      ) : (
        <ul className="cu-cards">
          {shown.map((item) => (
            <InvoiceCard key={item.id} item={item} />
          ))}
        </ul>
      )}
      {failure ? <Notice tone="error">{failure}</Notice> : null}
      {next ? (
        <button
          type="button"
          className="wf-button"
          disabled={loading}
          onClick={() => void loadMore()}
        >
          {loading ? t.common.loading : t.invoices.loadMore}
        </button>
      ) : null}
    </section>
  );
}

/** One own invoice. A foreign, guest-payer, draft or missing invoice all read as "not found". */
export function CustomerInvoiceDetailScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useCustomer();
  const detail = useFetch(() => api.get<CustomerInvoiceDetail>(`/api/v1/me/invoices/${id}`), id);

  if (!detail.data) {
    if (detail.error instanceof ApiError && detail.error.code === 'NOT_FOUND') {
      return (
        <section className="cu-panel">
          <Notice tone="warning">{t.invoices.notFound}</Notice>
          <Link href={`${base}/invoices`}>{t.invoices.title}</Link>
        </section>
      );
    }
    return (
      <section className="cu-panel">
        <LoadState error={detail.error} retry={detail.retry} />
      </section>
    );
  }
  const invoice = detail.data;
  const zone = invoice.branch.timezone;
  return (
    <section className="cu-panel">
      <p>
        <Link href={`${base}/invoices`}>← {t.invoices.title}</Link>
      </p>
      <h1>{t.invoices.detailTitle}</h1>
      <dl className="cu-summary">
        <dt>{t.invoices.code}</dt>
        <dd>{invoice.code}</dd>
        <dt>{t.invoices.statusLabel}</dt>
        <dd>
          <Badge tone={invoiceTone(invoice.status)}>{t.invoices.status[invoice.status]}</Badge>
        </dd>
        <dt>{t.invoices.branch}</dt>
        <dd>{invoice.branch.name}</dd>
        <dt>{t.invoices.date}</dt>
        <dd>{formatBusinessDate(invoice.visitDate, locale)}</dd>
        <dt>{t.invoices.issuedAt}</dt>
        <dd>{formatDateTime(invoice.finalizedAt, zone, locale)}</dd>
        {invoice.paidAt ? (
          <>
            <dt>{t.invoices.paidAt}</dt>
            <dd>{formatDateTime(invoice.paidAt, zone, locale)}</dd>
          </>
        ) : null}
        {invoice.cancelledAt ? (
          <>
            <dt>{t.invoices.cancelledAt}</dt>
            <dd>{formatDateTime(invoice.cancelledAt, zone, locale)}</dd>
          </>
        ) : null}
      </dl>
      <h2>{t.invoices.services}</h2>
      <ol className="cu-lines">
        {invoice.lines.map((line) => (
          <li key={line.sequence}>
            <strong>{locale === 'vi' ? line.nameVi : line.nameEn}</strong>
            <br />
            <span className="wf-muted">
              {line.forSelf
                ? t.invoices.forSelf
                : line.recipientName
                  ? fill(t.invoices.forOther, { name: line.recipientName })
                  : null}
            </span>
            <br />
            <span>
              {formatVnd(line.unitPriceVnd, locale)} × {line.quantity} ={' '}
              <strong>{formatVnd(line.grossVnd, locale)}</strong>
            </span>
          </li>
        ))}
      </ol>
      <dl className="cu-summary">
        <dt>{t.invoices.subtotal}</dt>
        <dd>{formatVnd(invoice.subtotalVnd, locale)}</dd>
        {invoice.discount ? (
          <>
            <dt>{t.invoices.discount}</dt>
            <dd>
              −{formatVnd(invoice.discount.amountVnd, locale)} (
              {locale === 'vi' ? invoice.discount.nameVi : invoice.discount.nameEn}
              {invoice.discount.voucherCode
                ? `, ${fill(t.invoices.voucher, { code: invoice.discount.voucherCode })}`
                : ''}
              )
            </dd>
          </>
        ) : null}
        <dt>{t.invoices.total}</dt>
        <dd>
          <strong>{formatVnd(invoice.totalVnd, locale)}</strong>
        </dd>
        <dt>{t.invoices.paid}</dt>
        <dd>{formatVnd(invoice.paidVnd, locale)}</dd>
        {invoice.status === 'PENDING_PAYMENT' ? (
          <>
            <dt>{t.invoices.balance}</dt>
            <dd>
              <strong>{formatVnd(invoice.balanceVnd, locale)}</strong>
            </dd>
          </>
        ) : null}
      </dl>
      <h2>{t.invoices.payments}</h2>
      {invoice.payments.length === 0 ? (
        <p className="wf-empty">{t.invoices.noPayments}</p>
      ) : (
        <ul className="cu-lines">
          {invoice.payments.map((payment) => (
            <li key={payment.id}>
              <strong>{formatVnd(payment.amountVnd, locale)}</strong>
              <span className="wf-muted">
                {' '}
                · {t.invoices.method[payment.method]} ·{' '}
                {formatDateTime(payment.paidAt, zone, locale)}
              </span>
              {payment.reversed ? (
                <>
                  {' '}
                  <Badge tone="warning">{t.invoices.reversed}</Badge>
                </>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="wf-muted">{t.invoices.note}</p>
    </section>
  );
}

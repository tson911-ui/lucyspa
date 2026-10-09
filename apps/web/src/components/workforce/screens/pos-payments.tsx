'use client';

import type {
  InvoicePaymentAnomaly,
  InvoicePaymentResponse,
  InvoiceResponse,
} from '@lucy-spa/contracts';
import {
  Button,
  ButtonLink,
  Card,
  CardHeader,
  DataTable,
  DescriptionList,
  RowActions,
  Stack,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { useQrImage } from '../use-qr-image';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { formatCountdown, remainingMs } from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { Badge, Notice, type Tone } from '../ui';

type Note = InvoiceResponse['managementNotes'][number];

/**
 * What the cash form may take: no live PayOS request holds the rest of the balance (the API enforces the
 * same rule). Shared by the card and the dialog that the screen opens.
 */
export function cashBalanceOf(invoice: InvoiceResponse): bigint {
  return BigInt(invoice.balanceVnd) - BigInt(invoice.pendingProviderVnd);
}

function usePaging() {
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  return {
    ...paging,
    onPageChange: (page: number) => setPaging((current) => ({ ...current, page })),
    onPageSizeChange: (pageSize: number) => setPaging({ page: 1, pageSize }),
  };
}

/**
 * Payments of one invoice (Phase 4 Steps 7 and 8): the history (a reversed payment stays listed with its
 * correction), the cash and PayOS actions in the card header, the waiting PayOS request and, for
 * management, the PayOS money that was not applied plus audited notes. The browser never decides a
 * balance or a status: it shows the server's numbers and sends only choices (amounts, keys, notes). A PayOS
 * payment becomes paid only when PayOS confirms it; there is no "mark as received" control anywhere. The
 * dialogs themselves (cash, PayOS, reversal, notes) are opened by the screen.
 */
export function PosPaymentsSection({
  invoice,
  working,
  onCollect,
  onCreatePayos,
  onReverse,
  onRefreshPayos,
  onCancelPayos,
  onReviewAnomaly,
  onAddNote,
}: {
  invoice: InvoiceResponse;
  working: string | null;
  onCollect: () => void;
  onCreatePayos: () => void;
  onReverse: (paymentId: string) => void;
  onRefreshPayos: (paymentId: string) => void;
  onCancelPayos: (paymentId: string) => void;
  onReviewAnomaly: (anomalyId: string) => void;
  onAddNote: () => void;
}) {
  const { t, locale } = useWorkforce();
  const zone = invoice.branch.timezone;
  const paging = usePaging();
  const pendingPayment = invoice.payments.find((payment) => payment.status === 'PENDING') ?? null;
  const balance = BigInt(invoice.balanceVnd);
  const held = BigInt(invoice.pendingProviderVnd);
  const canCollect = invoice.actions.collectPayment && cashBalanceOf(invoice) > 0n;
  const canCreatePayos = invoice.actions.collectPayos && balance > 0n && pendingPayment === null;
  const idle = working === null;

  const columns: DataTableColumn<InvoicePaymentResponse>[] = [
    {
      key: 'time',
      header: t.pos.colTime,
      mobileTitle: true,
      cell: (payment) => formatDateTime(payment.collectedAt, zone, locale),
    },
    {
      key: 'collector',
      header: t.pos.colCollector,
      hideBelow: 'lg',
      truncate: true,
      cell: (payment) => payment.collectedBy.displayName,
    },
    { key: 'method', header: t.pos.colMethod, cell: (payment) => t.pos.methods[payment.method] },
    {
      key: 'credited',
      header: t.pos.colCredited,
      numeric: true,
      cell: (payment) => formatVnd(payment.amountVnd, locale),
    },
    {
      key: 'tendered',
      header: t.pos.colTendered,
      numeric: true,
      hideBelow: 'md',
      cell: (payment) =>
        payment.method === 'PAYOS' ? '—' : formatVnd(payment.tenderedVnd, locale),
    },
    {
      key: 'change',
      header: t.pos.colChange,
      numeric: true,
      hideBelow: 'md',
      cell: (payment) => (payment.method === 'PAYOS' ? '—' : formatVnd(payment.changeVnd, locale)),
    },
    { key: 'state', header: t.pos.colState, cell: (payment) => <PaymentState payment={payment} /> },
    {
      key: 'details',
      header: t.pos.colNote,
      hideBelow: 'xl',
      wrap: true,
      width: 'lg',
      cell: (payment) => paymentDetails(payment, zone, t, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (payment) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, {
            name: formatDateTime(payment.collectedAt, zone, locale),
          })}
          items={
            payment.reversible
              ? [
                  {
                    id: 'reverse',
                    label: t.pos.reverse,
                    tone: 'danger' as const,
                    disabled: !idle,
                    onSelect: () => onReverse(payment.id),
                  },
                ]
              : []
          }
        />
      ),
    },
  ];

  return (
    <>
      <Card as="section">
        <CardHeader
          title={t.pos.paymentTitle}
          description={t.pos.paymentNote}
          actions={
            canCreatePayos || canCollect ? (
              <>
                {canCreatePayos ? (
                  <Button variant="secondary" disabled={!idle} onClick={onCreatePayos}>
                    {t.pos.payosCreate}
                  </Button>
                ) : null}
                {canCollect ? (
                  <Button variant="primary" icon="plus" disabled={!idle} onClick={onCollect}>
                    {t.pos.collectTitle}
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
        <DescriptionList
          layout="totals"
          items={[
            { label: t.pos.paidLabel, value: formatVnd(invoice.paidVnd, locale) },
            {
              label: t.pos.balanceLabel,
              value: formatVnd(invoice.balanceVnd, locale),
              strong: true,
            },
          ]}
        />
        {held > 0n ? (
          <Notice tone="info">
            {fill(t.pos.payosHeld, { amount: formatVnd(invoice.pendingProviderVnd, locale) })}
          </Notice>
        ) : null}
        {invoice.payments.length === 0 ? (
          <p className="ls-hint">{t.pos.noPayments}</p>
        ) : (
          <DataTable
            mode="client"
            caption={fill(t.common.list.table, { list: t.pos.paymentTitle })}
            columns={columns}
            rows={invoice.payments}
            rowKey={(payment) => payment.id}
            paging={{ ...paging, labels: paginationLabels(t, t.pos.paymentTitle) }}
          />
        )}
      </Card>

      {pendingPayment ? (
        <PayosPending
          key={pendingPayment.id}
          payment={pendingPayment}
          working={working}
          onRefresh={onRefreshPayos}
          onCancel={onCancelPayos}
        />
      ) : null}

      {invoice.actions.manageAnomalies &&
      (invoice.anomalies.length > 0 ||
        invoice.managementNotes.length > 0 ||
        invoice.actions.addManagementNote) ? (
        <>
          {invoice.anomalies.length > 0 ? (
            <AnomaliesCard
              anomalies={invoice.anomalies}
              zone={zone}
              working={!idle}
              onReview={onReviewAnomaly}
            />
          ) : null}
          <NotesCard
            notes={invoice.managementNotes}
            zone={zone}
            canAdd={invoice.actions.addManagementNote}
            working={!idle}
            onAdd={onAddNote}
          />
        </>
      ) : null}
    </>
  );
}

function stateTone(payment: InvoicePaymentResponse): Tone {
  if (payment.status === 'SUCCEEDED') return payment.effective ? 'success' : 'warning';
  if (payment.status === 'PENDING') return 'info';
  if (payment.status === 'FAILED') return 'error';
  return 'neutral';
}

function PaymentState({ payment }: { payment: InvoicePaymentResponse }) {
  const { t } = useWorkforce();
  const provider = payment.method === 'PAYOS';
  if (payment.correction) return <Badge tone="warning">{t.pos.paymentReversed}</Badge>;
  if (provider && payment.status !== 'SUCCEEDED') {
    return <Badge tone={stateTone(payment)}>{t.pos.paymentStates[payment.status as never]}</Badge>;
  }
  return <Badge tone={stateTone(payment)}>{t.pos.paymentEffective}</Badge>;
}

/** The correction of a reversed payment, or the PayOS reference of a confirmed one: one muted sentence. */
function paymentDetails(
  payment: InvoicePaymentResponse,
  zone: string,
  t: ReturnType<typeof useWorkforce>['t'],
  locale: 'vi' | 'en',
): string {
  const parts: string[] = [];
  if (payment.correction) {
    parts.push(
      fill(t.pos.reversedInfo, {
        time: formatDateTime(payment.correction.occurredAt, zone, locale),
        name: payment.correction.actor.displayName,
        reason: payment.correction.reason,
      }),
    );
  }
  if (payment.method === 'PAYOS' && payment.status === 'SUCCEEDED' && payment.provider) {
    parts.push(
      `${
        payment.provider.reference
          ? fill(t.pos.paymentReference, { reference: payment.provider.reference })
          : ''
      }${payment.provider.late ? ` ${t.pos.paymentLate}` : ''} ${t.pos.paymentProviderFinal}`.trim(),
    );
  }
  return parts.join(' ') || '—';
}

/** The waiting request: the QR, the countdown, a re-check and a cancel. Nothing here marks it received. */
function PayosPending({
  payment,
  working,
  onRefresh,
  onCancel,
}: {
  payment: InvoicePaymentResponse;
  working: string | null;
  onRefresh: (paymentId: string) => void;
  onCancel: (paymentId: string) => void;
}) {
  const { t, locale } = useWorkforce();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const provider = payment.provider;
  const image = useQrImage(provider?.qrCode ?? null);
  if (!provider) return null;
  const left = remainingMs(provider.expiresAt, now);
  return (
    <Card as="section">
      <CardHeader
        title={t.pos.payosWaiting}
        actions={
          <>
            {provider.qrCode && provider.checkoutUrl ? (
              <ButtonLink
                variant="secondary"
                href={provider.checkoutUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.pos.payosOpenLink}
              </ButtonLink>
            ) : null}
            {payment.cancellable ? (
              <>
                <Button
                  variant="secondary"
                  disabled={working !== null}
                  loading={working === `payos-refresh-${payment.id}`}
                  onClick={() => onRefresh(payment.id)}
                >
                  {working === `payos-refresh-${payment.id}`
                    ? t.pos.payosRefreshing
                    : t.pos.payosRefresh}
                </Button>
                <Button
                  variant="secondary"
                  disabled={working !== null}
                  loading={working === `payos-cancel-${payment.id}`}
                  onClick={() => onCancel(payment.id)}
                >
                  {working === `payos-cancel-${payment.id}`
                    ? t.pos.payosCancelling
                    : t.pos.payosCancel}
                </Button>
              </>
            ) : null}
          </>
        }
      />
      <DescriptionList
        layout="totals"
        items={[
          { label: t.pos.colCredited, value: formatVnd(payment.amountVnd, locale), strong: true },
        ]}
      />
      <Notice tone={left > 0 ? 'info' : 'warning'}>
        {left > 0
          ? fill(t.pos.payosExpiresIn, { time: formatCountdown(left) })
          : t.pos.payosExpired}
      </Notice>
      {provider.qrCode ? (
        <Stack>
          {image ? (
            // A data URL generated here from the QR content; not a remote image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="PayOS QR" width={240} height={240} />
          ) : null}
          <p className="ls-hint">{t.pos.payosScan}</p>
        </Stack>
      ) : (
        <Notice tone="warning">{t.pos.payosNoQr}</Notice>
      )}
    </Card>
  );
}

/** PayOS money that was not applied (CORRECT_PAYMENTS; the API checks again). */
function AnomaliesCard({
  anomalies,
  zone,
  working,
  onReview,
}: {
  anomalies: readonly InvoicePaymentAnomaly[];
  zone: string;
  working: boolean;
  onReview: (anomalyId: string) => void;
}) {
  const { t, locale } = useWorkforce();
  const paging = usePaging();
  const columns: DataTableColumn<InvoicePaymentAnomaly>[] = [
    {
      key: 'kind',
      header: t.pos.colKind,
      mobileTitle: true,
      cell: (anomaly) => t.pos.anomalyKinds[anomaly.kind],
    },
    {
      key: 'opened',
      header: t.pos.colTime,
      hideBelow: 'md',
      cell: (anomaly) => formatDateTime(anomaly.openedAt, zone, locale),
    },
    {
      key: 'expected',
      header: t.pos.colExpected,
      numeric: true,
      cell: (anomaly) =>
        anomaly.expectedAmountVnd ? formatVnd(anomaly.expectedAmountVnd, locale) : '—',
    },
    {
      key: 'received',
      header: t.pos.colReceived,
      numeric: true,
      cell: (anomaly) => formatVnd(anomaly.receivedAmountVnd, locale),
    },
    {
      key: 'reference',
      header: t.pos.colReference,
      hideBelow: 'lg',
      truncate: true,
      cell: (anomaly) => anomaly.providerReference,
    },
    {
      key: 'status',
      header: t.pos.colState,
      cell: (anomaly) =>
        anomaly.status === 'OPEN' ? (
          <Badge tone="warning">{t.pos.anomalyOpen}</Badge>
        ) : (
          <Badge tone="neutral">{t.pos.anomalyReviewed}</Badge>
        ),
    },
    {
      key: 'review',
      header: t.pos.colNote,
      hideBelow: 'xl',
      wrap: true,
      width: 'lg',
      cell: (anomaly) =>
        anomaly.status === 'REVIEWED' && anomaly.reviewedAt && anomaly.reviewedBy
          ? fill(t.pos.anomalyReviewedInfo, {
              time: formatDateTime(anomaly.reviewedAt, zone, locale),
              name: anomaly.reviewedBy.displayName,
              note: anomaly.reviewNote ?? '—',
            })
          : '—',
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (anomaly) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: anomaly.providerReference })}
          items={
            anomaly.status === 'REVIEWED'
              ? []
              : [
                  {
                    id: 'review',
                    label: t.pos.anomalyReview,
                    disabled: working,
                    onSelect: () => onReview(anomaly.id),
                  },
                ]
          }
        />
      ),
    },
  ];
  return (
    <Card as="section">
      <CardHeader title={t.pos.anomalyTitle} description={t.pos.anomalyHint} />
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: t.pos.anomalyTitle })}
        columns={columns}
        rows={anomalies}
        rowKey={(anomaly) => anomaly.id}
        paging={{ ...paging, labels: paginationLabels(t, t.pos.anomalyTitle) }}
      />
    </Card>
  );
}

/** Audited management notes (a paid PayOS invoice is not editable in this version). */
function NotesCard({
  notes,
  zone,
  canAdd,
  working,
  onAdd,
}: {
  notes: readonly Note[];
  zone: string;
  canAdd: boolean;
  working: boolean;
  onAdd: () => void;
}) {
  const { t, locale } = useWorkforce();
  const paging = usePaging();
  const columns: DataTableColumn<Note>[] = [
    {
      key: 'note',
      header: t.pos.colNote,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (note) => note.note,
    },
    {
      key: 'author',
      header: t.pos.colAuthor,
      hideBelow: 'md',
      truncate: true,
      cell: (note) => note.author.displayName,
    },
    {
      key: 'time',
      header: t.pos.colTime,
      cell: (note) => formatDateTime(note.createdAt, zone, locale),
    },
  ];
  return (
    <Card as="section">
      <CardHeader
        title={t.pos.noteTitle}
        description={t.pos.noteHint}
        actions={
          canAdd ? (
            <Button variant="secondary" icon="plus" disabled={working} onClick={onAdd}>
              {t.pos.noteAdd}
            </Button>
          ) : undefined
        }
      />
      {notes.length === 0 ? (
        <p className="ls-hint">{t.pos.noNotes}</p>
      ) : (
        <DataTable
          mode="client"
          caption={fill(t.common.list.table, { list: t.pos.noteTitle })}
          columns={columns}
          rows={notes}
          rowKey={(note) => note.id}
          paging={{ ...paging, labels: paginationLabels(t, t.pos.noteTitle) }}
        />
      )}
    </Card>
  );
}

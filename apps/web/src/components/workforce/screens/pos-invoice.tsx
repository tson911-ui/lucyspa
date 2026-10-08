'use client';

import type {
  InvoiceComboLineResponse,
  InvoiceLineResponse,
  InvoiceProductLineAddRequest,
  InvoiceProductLineUpdateRequest,
  InvoiceResponse,
  PaymentPayosRequest,
  PaymentRecordRequest,
  PaymentResultResponse,
  PaymentReverseRequest,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CardHeader,
  Cluster,
  DataTable,
  DescriptionList,
  RowActions,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { PrefetchLink as Link } from '../link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { comboDictionary } from '../../../i18n/combo';
import { productExchangesDictionary } from '../../../i18n/product-exchanges';
import { productSaleDictionary } from '../../../i18n/product-sale';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import { organizationDictionary } from '../../../i18n/organization';
import { comboErrorText, comboName, sessionsText } from '../../../lib/workforce/combo';
import { hasPreOrderLine } from '../../../lib/workforce/product-orders';
import { productErrorText } from '../../../lib/workforce/product-sale';
import { formatDate, formatDateTime, formatVnd } from '../../../lib/workforce/format';
import {
  hasPriceRange,
  hasQuantity,
  invoiceTone,
  payerBody,
  posErrorMessage,
  priceRange,
} from '../../../lib/workforce/pos';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  useSuccessToast,
} from '../ui';
import {
  CancelConfirm,
  CashDialog,
  LineDialog,
  NoteDialog,
  PayerDialog,
  PayosDialog,
  ReverseConfirm,
  VoucherDialog,
  type Attempt,
} from './pos-dialogs';
import { ComboUseCard, ComboUseDialog } from './pos-combo-use';
import { cashBalanceOf, PosPaymentsSection } from './pos-payments';
import { PreOrderContactDialog, ProductOrderCard } from './pos-pre-orders';
import { ProductAddDialog, ProductEditDialog, ProductLinesCard, SidesCard } from './pos-products';
import { DiscountCard, PayerCard, VouchersCard } from './pos-sections';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

/** The one dialog that is open (or none): the screen owns them so a failed command can keep its dialog open. */
type Overlay =
  | { kind: 'line'; lineId: string }
  | { kind: 'combo-use'; lineId: string }
  | { kind: 'product-add' }
  | { kind: 'product-edit'; lineId: string }
  | { kind: 'pre-order-contact' }
  | { kind: 'voucher' }
  | { kind: 'payer' }
  | { kind: 'cash' }
  | { kind: 'payos' }
  | { kind: 'reverse'; paymentId: string }
  | { kind: 'cancel' }
  | { kind: 'anomaly'; anomalyId: string }
  | { kind: 'note' };

/**
 * One invoice (Phase 4 Steps 5-7). A DRAFT is edited line by line (a price inside the historical range, a
 * quantity inside the limit), the payer is chosen, then the invoice is finalized; a cancellation needs a
 * reason (and the actor's password for a finalized invoice). A finalized invoice takes cash payments (also
 * partial ones) and an erroneous payment can be reversed with a reason and the actor's password. The server
 * returns the whole invoice after every command (a payment command returns its own result and the screen
 * re-reads the invoice); the browser never computes a bill, and reloads on any conflict.
 */
export function PosInvoiceScreen({ id }: { id: string }) {
  const { api, t, locale, base } = useWorkforce();
  const { confirm, dialog } = useReauthentication();
  const notify = useSuccessToast();
  const text = organizationDictionary(locale);
  const c = comboDictionary(locale);
  const p = productSaleDictionary(locale);
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState<string | null>(null);
  // One idempotency key per intended payment, kept while a dialog is closed and reopened (see pos-dialogs).
  const cashAttempt: Attempt = useRef(null);
  const payosAttempt: Attempt = useRef(null);

  const load = useCallback(async () => {
    try {
      setInvoice(await api.get<InvoiceResponse>(`/api/v1/pos/invoices/${id}`));
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
    }
  }, [api, id]);
  useEffect(() => {
    void load();
  }, [load]);
  // While a PayOS request waits, re-read the invoice so a confirmation appears without a manual reload.
  const waiting = invoice?.payments.some((payment) => payment.status === 'PENDING') ?? false;
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => {
      if (!busy.current) void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  /**
   * One command at a time; the server's answer replaces the invoice, a failure reloads it. Success is a
   * toast, a failure a notice. A confirmation dialog passes `rethrow` so it can explain the refusal itself.
   */
  async function command(
    name: string,
    work: () => Promise<InvoiceResponse>,
    success: (result: InvoiceResponse) => string,
    rethrow = false,
  ): Promise<boolean> {
    if (busy.current) {
      if (rethrow) throw new Error('A command is already running.');
      return false;
    }
    busy.current = true;
    setWorking(name);
    setFeedback(null);
    try {
      const result = await work();
      setInvoice(result);
      const message = success(result);
      notify(message, () => setFeedback({ tone: 'success', text: message }));
      return true;
    } catch (error) {
      if (!rethrow) {
        setFeedback({
          tone: 'error',
          text: productErrorText(error, locale, invoice, (cause) =>
            comboErrorText(cause, locale, (other) => posErrorMessage(other, t)),
          ),
        });
      }
      await load();
      if (rethrow) throw error;
      return false;
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  function closeOverlay() {
    setOverlay(null);
    setFeedback((current) => (current?.tone === 'error' ? null : current));
  }

  if (loadError && !invoice) {
    return (
      <>
        <PageHeader
          title={t.pos.title}
          breadcrumbs={
            <Breadcrumbs
              label={text.breadcrumbs}
              LinkComponent={Link}
              items={[{ label: t.pos.title, href: `${base}/pos` }]}
            />
          }
        />
        <ErrorState error={loadError} t={t} onRetry={() => void load()} />
      </>
    );
  }
  if (!invoice) return <Loading t={t} page />;

  const zone = invoice.branch.timezone;
  const draft = invoice.status === 'DRAFT';
  const version = invoice.version;
  const idle = working === null;
  const dialogError = feedback?.tone === 'error' ? feedback.text : null;
  const lineTarget =
    overlay?.kind === 'line' ? invoice.lines.find((line) => line.id === overlay.lineId) : undefined;
  const comboUseTarget =
    overlay?.kind === 'combo-use'
      ? invoice.lines.find((line) => line.id === overlay.lineId)
      : undefined;
  const reverseTarget =
    overlay?.kind === 'reverse'
      ? invoice.payments.find((payment) => payment.id === overlay.paymentId)
      : undefined;

  const setPayer = (payerUserId: string | null) =>
    command(
      'payer',
      () =>
        api.post<InvoiceResponse>(
          `/api/v1/pos/invoices/${invoice.id}/payer`,
          payerBody(payerUserId, version),
        ),
      () => t.pos.payerSaved,
    );

  const reload = () => api.get<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}`);
  const addProduct = (body: InvoiceProductLineAddRequest) =>
    command(
      'product-add',
      () => api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}/product-lines`, body),
      () => p.lines.added,
    );
  const saveProduct = (lineId: string, body: InvoiceProductLineUpdateRequest) =>
    command(
      `product-${lineId}`,
      () =>
        api.post<InvoiceResponse>(
          `/api/v1/pos/invoices/${invoice.id}/product-lines/${lineId}/update`,
          body,
        ),
      () => p.lines.saved,
    );
  const removeProduct = (lineId: string) =>
    void command(
      `product-remove-${lineId}`,
      () =>
        api.post<InvoiceResponse>(
          `/api/v1/pos/invoices/${invoice.id}/product-lines/${lineId}/remove`,
          { expectedVersion: version },
        ),
      () => p.lines.removed,
    );
  const collect = (body: PaymentRecordRequest) =>
    command(
      'collect',
      async () => {
        await api.post<PaymentResultResponse>(`/api/v1/pos/invoices/${invoice.id}/payments`, body);
        return reload();
      },
      (result) => (result.status === 'PAID' ? t.pos.collectedPaid : t.pos.collected),
    );
  const reversePayment = async (paymentId: string, body: PaymentReverseRequest) => {
    await command(
      `reverse-${paymentId}`,
      // The actor confirms THEIR OWN password when the API asks (every reversal).
      () =>
        withReauthentication(async () => {
          await api.post<PaymentResultResponse>(
            `/api/v1/pos/invoices/${invoice.id}/payments/${paymentId}/reverse`,
            body,
          );
          return reload();
        }, confirm),
      () => t.pos.reverseDone,
      true,
    );
  };
  const createPayos = (body: PaymentPayosRequest) =>
    command(
      'payos-create',
      async () => {
        await api.post<PaymentResultResponse>(
          `/api/v1/pos/invoices/${invoice.id}/payments/payos`,
          body,
        );
        return reload();
      },
      () => t.pos.payosCreated,
    );
  const refreshPayos = (paymentId: string) =>
    command(
      `payos-refresh-${paymentId}`,
      async () => {
        await api.post<PaymentResultResponse>(
          `/api/v1/pos/invoices/${invoice.id}/payments/${paymentId}/refresh`,
          {},
        );
        return reload();
      },
      () => t.pos.payosRefreshed,
    );
  const cancelPayos = (paymentId: string) =>
    command(
      `payos-cancel-${paymentId}`,
      async () => {
        await api.post<PaymentResultResponse>(
          `/api/v1/pos/invoices/${invoice.id}/payments/${paymentId}/cancel`,
          {},
        );
        return reload();
      },
      () => t.pos.payosCancelled,
    );
  const reviewAnomaly = (anomalyId: string, note: string) =>
    command(
      `anomaly-${anomalyId}`,
      async () => {
        await api.post(`/api/v1/pos/payment-anomalies/${anomalyId}/review`, { note });
        return reload();
      },
      () => t.pos.anomalyDone,
    );
  const addNote = (note: string) =>
    command(
      'note',
      () =>
        api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}/management-notes`, { note }),
      () => t.pos.noteAdded,
    );

  const lineColumns = lineColumnsOf({
    invoice,
    t,
    locale,
    idle,
    c,
    onEdit: (lineId) => setOverlay({ kind: 'line', lineId }),
    onUseCombo: (lineId) => setOverlay({ kind: 'combo-use', lineId }),
    onClearCombo: (lineId) =>
      void command(
        `combo-clear-${lineId}`,
        () =>
          api.post<InvoiceResponse>(
            `/api/v1/pos/invoices/${invoice.id}/lines/${lineId}/combo-use/clear`,
            { expectedVersion: version },
          ),
        () => c.use.cleared,
      ),
  });
  const comboSale = invoice.kind === 'COMBO_SALE';
  // Phase 6 P6-10: a product-only sale has no service lines; a visit invoice shows the product card when it has products or when a
  // seller may still add some to the draft.
  const productOnly = invoice.kind === 'PRODUCT_SALE';
  const showProducts =
    productOnly ||
    invoice.productLines.length > 0 ||
    (draft && invoice.actions.sellProducts && !comboSale);
  const noLines = productOnly && invoice.productLines.length === 0;
  // The totals close the last card of the lines: the products when the invoice has any, otherwise the services (a visit invoice with an
  // empty product card keeps its totals where it always had them).
  const totalsInProducts = productOnly || invoice.productLines.length > 0;
  const productTarget =
    overlay?.kind === 'product-edit'
      ? invoice.productLines.find((line) => line.id === overlay.lineId)
      : undefined;
  const comboColumns = comboColumnsOf({ c, locale });
  const cashBalance = cashBalanceOf(invoice).toString();
  const totals = [
    { label: t.pos.subtotal, value: formatVnd(invoice.subtotalVnd, locale) },
    ...(invoice.discountTotalVnd !== '0'
      ? [
          {
            label: invoice.exchange
              ? productExchangesDictionary(locale).invoicePage.creditRow
              : t.pos.discountRow,
            value: `− ${formatVnd(invoice.discountTotalVnd, locale)}`,
          },
        ]
      : []),
    { label: t.pos.total, value: formatVnd(invoice.totalVnd, locale), strong: true },
  ];

  return (
    <>
      <PageHeader
        title={fill(t.pos.detailTitle, { code: invoice.code })}
        intro={
          invoice.visit
            ? `${fill(t.pos.visitInfo, {
                code: invoice.visit.code,
                date: formatDate(invoice.visit.serviceDate, locale),
              })} · ${invoice.branch.name}`
            : invoice.exchange
              ? fill(productExchangesDictionary(locale).invoicePage.intro, {
                  code: invoice.exchange.code,
                  case: invoice.exchange.caseCode,
                  branch: invoice.branch.name,
                })
              : productOnly
                ? fill(p.lines.intro, { branch: invoice.branch.name })
                : fill(c.invoice.intro, { branch: invoice.branch.name })
        }
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[{ label: t.pos.title, href: `${base}/pos` }, { label: invoice.code }]}
          />
        }
      >
        {invoice.actions.cancel ? (
          <RowActions
            menuLabel={text.moreActions}
            items={[
              {
                id: 'cancel',
                label: t.pos.cancel,
                tone: 'danger',
                disabled: !idle,
                onSelect: () => setOverlay({ kind: 'cancel' }),
              },
            ]}
          />
        ) : null}
        {draft && invoice.actions.finalize ? (
          <Button
            variant="primary"
            disabled={!idle || !invoice.readiness.ready}
            loading={working === 'finalize'}
            onClick={() =>
              // Phase 6 P6-16: a pre-order needs the customer's phone number, asked in one dialog whose action is the finalization.
              hasPreOrderLine(invoice)
                ? setOverlay({ kind: 'pre-order-contact' })
                : void command(
                    'finalize',
                    () =>
                      api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}/finalize`, {
                        expectedVersion: version,
                      }),
                    (result) => (result.status === 'PAID' ? t.pos.finalizedPaid : t.pos.finalized),
                  )
            }
          >
            {working === 'finalize' ? t.pos.finalizing : t.pos.finalize}
          </Button>
        ) : null}
      </PageHeader>
      <Cluster gap="inline">
        <span className="ls-hint">{t.pos.status}:</span>
        <Badge tone={invoiceTone(invoice.status)}>{t.pos.statuses[invoice.status]}</Badge>
      </Cluster>
      {feedback && overlay === null ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
      {draft && noLines ? <Notice tone="info">{p.lines.needLines}</Notice> : null}
      {draft && invoice.actions.finalize ? (
        <>
          <Notice tone="info">{comboSale ? c.invoice.finalizeHint : t.pos.finalizeHint}</Notice>

          {!invoice.readiness.ready && !comboSale && !noLines ? (
            <Notice tone="warning">
              {fill(t.pos.notReady, { count: invoice.readiness.unpricedLines })}
            </Notice>
          ) : null}
        </>
      ) : null}
      {invoice.status === 'PENDING_PAYMENT' ? (
        <Notice tone="info">{t.pos.pendingNote}</Notice>
      ) : null}
      {invoice.status === 'PAID' ? (
        <Notice tone="success">
          {invoice.payments.length === 0 ? t.pos.paidNote : t.pos.paidFullNote}
        </Notice>
      ) : null}
      {invoice.comboLine?.issuance === 'PENDING' ? (
        <Notice tone="info">{c.invoice.pending}</Notice>
      ) : null}
      {invoice.comboLine?.issuance === 'ISSUED' ? (
        <Notice tone="success">
          {fill(c.invoice.issued, { total: invoice.comboLine.totalSessions })}
        </Notice>
      ) : null}
      {invoice.comboLine?.issuance === 'REVOKED' ? (
        <Notice tone="warning">{c.invoice.revoked}</Notice>
      ) : null}
      {invoice.status === 'CANCELLED' ? (
        <Notice tone="error">
          {fill(t.pos.cancelledInfo, {
            time: invoice.cancelledAt ? formatDateTime(invoice.cancelledAt, zone, locale) : '—',
            reason: invoice.cancelReason ?? '—',
          })}
        </Notice>
      ) : null}

      {productOnly ? null : (
        <Card as="section">
          <CardHeader title={comboSale ? c.invoice.linesTitle : t.pos.linesTitle} />
          {comboSale ? (
            <DataTable
              mode="client"
              caption={fill(t.common.list.table, { list: c.invoice.linesTitle })}
              columns={comboColumns}
              rows={invoice.comboLine ? [invoice.comboLine] : []}
              rowKey={(line) => line.id}
              empty={<Empty>{c.invoice.noLine}</Empty>}
              paging={{ off: 'one combo per sale' }}
            />
          ) : (
            <DataTable
              mode="client"
              caption={fill(t.common.list.table, { list: t.pos.linesTitle })}
              columns={lineColumns}
              rows={invoice.lines}
              rowKey={(line) => `${line.id}:${line.unitPriceVnd}:${line.quantity}`}
              empty={<Empty>{t.pos.noLines}</Empty>}
              paging={{ off: 'the lines of one visit' }}
            />
          )}
          {totalsInProducts ? null : <DescriptionList layout="totals" items={totals} />}
        </Card>
      )}
      {showProducts ? (
        <ProductLinesCard
          invoice={invoice}
          idle={idle}
          onAdd={() => setOverlay({ kind: 'product-add' })}
          onEdit={(lineId) => setOverlay({ kind: 'product-edit', lineId })}
          onRemove={removeProduct}
          {...(totalsInProducts
            ? { footer: <DescriptionList layout="totals" items={totals} /> }
            : {})}
        />
      ) : null}

      {invoice.productOrder ? (
        <ProductOrderCard
          invoice={invoice}
          order={invoice.productOrder}
          idle={idle}
          api={api}
          onChanged={() => void load()}
        />
      ) : null}

      <ComboUseCard lines={invoice.lines} />

      {/* The invoice of an exchange has no program or member benefit to explain: its one discount row says it is the credit. */}
      {invoice.exchange ? null : <SidesCard invoice={invoice} />}
      {productOnly ? null : (
        <DiscountCard
          invoice={invoice}
          {...(invoice.discount.sides ? { title: p.sides.spaDetail } : {})}
        />
      )}
      {invoice.exchange ? null : (
        <VouchersCard
          invoice={invoice}
          working={!idle}
          onEnter={() => setOverlay({ kind: 'voucher' })}
          onRemove={(entry) =>
            void command(
              `voucher-${entry.id}`,
              () =>
                api.post<InvoiceResponse>(
                  `/api/v1/pos/invoices/${invoice.id}/vouchers/${entry.id}/remove`,
                  { expectedVersion: version },
                ),
              () => t.pos.voucherRemoved,
            )
          }
        />
      )}
      <PayerCard
        invoice={invoice}
        working={!idle}
        onFind={() => setOverlay({ kind: 'payer' })}
        onSetPayer={(payerUserId) => void setPayer(payerUserId)}
      />

      {invoice.status !== 'DRAFT' &&
      (invoice.payments.length > 0 || invoice.status === 'PENDING_PAYMENT') ? (
        <PosPaymentsSection
          invoice={invoice}
          working={working}
          onCollect={() => setOverlay({ kind: 'cash' })}
          onCreatePayos={() => setOverlay({ kind: 'payos' })}
          onReverse={(paymentId) => setOverlay({ kind: 'reverse', paymentId })}
          onRefreshPayos={(paymentId) => void refreshPayos(paymentId)}
          onCancelPayos={(paymentId) => void cancelPayos(paymentId)}
          onReviewAnomaly={(anomalyId) => setOverlay({ kind: 'anomaly', anomalyId })}
          onAddNote={() => setOverlay({ kind: 'note' })}
        />
      ) : null}

      {overlay?.kind === 'pre-order-contact' ? (
        <PreOrderContactDialog
          working={working === 'finalize'}
          error={dialogError}
          onFinalize={(contact) =>
            command(
              'finalize',
              () =>
                api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}/finalize`, {
                  expectedVersion: version,
                  preOrderContact: contact,
                }),
              (result) => (result.status === 'PAID' ? t.pos.finalizedPaid : t.pos.finalized),
            )
          }
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'product-add' ? (
        <ProductAddDialog
          branchId={invoice.branch.id}
          version={version}
          working={working === 'product-add'}
          error={dialogError}
          onAdd={addProduct}
          onClose={closeOverlay}
        />
      ) : null}
      {productTarget ? (
        <ProductEditDialog
          branchId={invoice.branch.id}
          line={productTarget}
          version={version}
          working={working === `product-${productTarget.id}`}
          error={dialogError}
          onSave={(body) => saveProduct(productTarget.id, body)}
          onClose={closeOverlay}
        />
      ) : null}
      {lineTarget ? (
        <LineDialog
          line={lineTarget}
          version={version}
          working={working === `line-${lineTarget.id}`}
          error={dialogError}
          onSave={(body) =>
            command(
              `line-${lineTarget.id}`,
              () =>
                api.post<InvoiceResponse>(
                  `/api/v1/pos/invoices/${invoice.id}/lines/${lineTarget.id}/price`,
                  body,
                ),
              () => t.pos.lineSaved,
            )
          }
          onClose={closeOverlay}
        />
      ) : null}
      {comboUseTarget ? (
        <ComboUseDialog
          invoiceId={invoice.id}
          line={comboUseTarget}
          version={version}
          working={working === `combo-use-${comboUseTarget.id}`}
          error={dialogError}
          onUse={(body) =>
            command(
              `combo-use-${comboUseTarget.id}`,
              () =>
                api.post<InvoiceResponse>(
                  `/api/v1/pos/invoices/${invoice.id}/lines/${comboUseTarget.id}/combo-use`,
                  body,
                ),
              () => c.use.done,
            )
          }
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'voucher' ? (
        <VoucherDialog
          working={working === 'voucher'}
          error={dialogError}
          onApply={(code) =>
            command(
              'voucher',
              () =>
                api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}/vouchers`, {
                  expectedVersion: version,
                  code,
                }),
              () => t.pos.voucherSupplied,
            )
          }
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'payer' ? (
        <PayerDialog
          invoice={invoice}
          working={working === 'payer'}
          error={dialogError}
          onSetPayer={(payerUserId) => setPayer(payerUserId)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'cash' ? (
        <CashDialog
          // A new balance (after a payment or a reversal) restarts the form from that balance.
          key={`${invoice.id}:${cashBalance}`}
          balance={cashBalance}
          attempt={cashAttempt}
          working={working === 'collect'}
          error={dialogError}
          onCollect={collect}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'payos' ? (
        <PayosDialog
          key={`${invoice.id}:${invoice.balanceVnd}:payos`}
          balance={invoice.balanceVnd}
          attempt={payosAttempt}
          working={working === 'payos-create'}
          error={dialogError}
          onCreate={createPayos}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'anomaly' ? (
        <NoteDialog
          title={t.pos.anomalyReview}
          label={t.pos.anomalyNoteLabel}
          problemText={t.pos.anomalyNeedNote}
          submitLabel={t.pos.anomalyReview}
          submittingLabel={t.pos.anomalyReviewing}
          working={working === `anomaly-${overlay.anomalyId}`}
          error={dialogError}
          onSave={(note) => reviewAnomaly(overlay.anomalyId, note)}
          onClose={closeOverlay}
        />
      ) : null}
      {overlay?.kind === 'note' ? (
        <NoteDialog
          title={t.pos.noteAdd}
          label={t.pos.noteLabel}
          problemText={t.pos.noteNeed}
          submitLabel={t.pos.noteAdd}
          submittingLabel={t.pos.noteAdding}
          working={working === 'note'}
          error={dialogError}
          onSave={addNote}
          onClose={closeOverlay}
        />
      ) : null}
      {reverseTarget ? (
        <ReverseConfirm payment={reverseTarget} onReverse={reversePayment} onClose={closeOverlay} />
      ) : null}
      {overlay?.kind === 'cancel' ? (
        <CancelConfirm
          invoice={invoice}
          onCancelInvoice={async (body) => {
            await command(
              'cancel',
              // The actor confirms THEIR OWN password when the API asks (a finalized invoice).
              () =>
                withReauthentication(
                  () =>
                    api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice.id}/cancel`, body),
                  confirm,
                ),
              () => t.pos.cancelled,
              true,
            );
          }}
          onClose={closeOverlay}
        />
      ) : null}
      {/* Last, so the password confirmation sits above a confirmation dialog that asked for it. */}
      {dialog}
    </>
  );
}

/** The columns of a combo sale: the one combo line, its price fixed by the combo (nothing to choose, so no row menu). */
function comboColumnsOf({
  c,
  locale,
}: {
  c: ReturnType<typeof comboDictionary>;
  locale: 'vi' | 'en';
}): DataTableColumn<InvoiceComboLineResponse>[] {
  return [
    {
      key: 'combo',
      header: c.invoice.colCombo,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (line) => comboName(line, locale),
    },
    {
      key: 'service',
      header: c.invoice.colService,
      hideBelow: 'lg',
      truncate: true,
      cell: (line) => comboName(line.service, locale),
    },
    {
      key: 'sessions',
      header: c.invoice.colSessions,
      cell: (line) => sessionsText(line.paidSessions, line.bonusSessions, locale),
    },
    {
      key: 'price',
      header: c.invoice.colPrice,
      numeric: true,
      hideBelow: 'xl',
      cell: (line) => formatVnd(line.priceVnd, locale),
    },
    {
      key: 'amount',
      header: c.invoice.colAmount,
      numeric: true,
      cell: (line) => formatVnd(line.priceVnd, locale),
    },
  ];
}

/** The columns of the lines table; the `⋮` offers the price/quantity dialog only where the line permits a choice. */
function lineColumnsOf({
  invoice,
  t,
  locale,
  idle,
  c,
  onEdit,
  onUseCombo,
  onClearCombo,
}: {
  invoice: InvoiceResponse;
  t: WorkforceDictionary;
  locale: 'vi' | 'en';
  idle: boolean;
  c: ReturnType<typeof comboDictionary>;
  onEdit: (lineId: string) => void;
  onUseCombo: (lineId: string) => void;
  onClearCombo: (lineId: string) => void;
}): DataTableColumn<InvoiceLineResponse>[] {
  const nameOf = (line: InvoiceLineResponse) => (locale === 'vi' ? line.nameVi : line.nameEn);
  const editable = (line: InvoiceLineResponse) =>
    invoice.status === 'DRAFT' &&
    invoice.actions.editPrices &&
    line.priceEditable &&
    (hasPriceRange(line) || hasQuantity(line));
  const canUseCombo = (line: InvoiceLineResponse) =>
    invoice.status === 'DRAFT' && invoice.actions.useCombos && line.comboUse === null;
  const canClearCombo = (line: InvoiceLineResponse) =>
    invoice.status === 'DRAFT' &&
    invoice.actions.useCombos &&
    line.comboUse !== null &&
    line.comboUse.state === 'SELECTED';
  return [
    {
      key: 'service',
      header: t.pos.colService,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (line) => (
        <>
          {nameOf(line)}
          {line.addedOnBehalf ? (
            <>
              {' '}
              <Badge tone="info">{t.pos.addedOnBehalf}</Badge>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'basis',
      header: t.pos.colBasis,
      hideBelow: 'xl',
      cell: (line) => (line.pricingUnit === 'PER_NAIL' ? t.pos.perNail : t.pos.perService),
    },
    {
      key: 'guest',
      header: t.pos.colGuest,
      hideBelow: 'md',
      truncate: true,
      cell: (line) => line.participant.displayName ?? '—',
    },
    {
      key: 'staff',
      header: t.pos.colStaff,
      hideBelow: 'lg',
      truncate: true,
      cell: (line) => line.employee.displayName,
    },
    {
      key: 'range',
      header: t.pos.colRange,
      numeric: true,
      hideBelow: 'xl',
      cell: (line) =>
        hasPriceRange(line)
          ? priceRange(line, locale)
          : `${formatVnd(line.priceMinVnd, locale)} (${t.pos.fixedPrice})`,
    },
    {
      key: 'price',
      header: t.pos.colPrice,
      numeric: true,
      cell: (line) =>
        line.unitPriceVnd === null ? t.pos.notSet : formatVnd(line.unitPriceVnd, locale),
    },
    {
      key: 'quantity',
      header: t.pos.colQuantity,
      numeric: true,
      cell: (line) => line.quantity ?? t.pos.notSet,
    },
    {
      key: 'amount',
      header: t.pos.colAmount,
      numeric: true,
      cell: (line) => (line.grossVnd === null ? '—' : formatVnd(line.grossVnd, locale)),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: nameOf(line) })}
          items={[
            ...(editable(line)
              ? [
                  {
                    id: 'edit',
                    label: t.pos.editLine,
                    icon: 'edit' as const,
                    disabled: !idle,
                    onSelect: () => onEdit(line.id),
                  },
                ]
              : []),
            ...(canUseCombo(line)
              ? [
                  {
                    id: 'use-combo',
                    label: c.use.action,
                    icon: 'award' as const,
                    disabled: !idle,
                    onSelect: () => onUseCombo(line.id),
                  },
                ]
              : []),
            ...(canClearCombo(line)
              ? [
                  {
                    id: 'clear-combo',
                    label: c.use.clear,
                    icon: 'x-circle' as const,
                    disabled: !idle,
                    onSelect: () => onClearCombo(line.id),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
}

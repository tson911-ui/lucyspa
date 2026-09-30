'use client';

import type {
  InvoiceLinePriceRequest,
  InvoiceLineResponse,
  InvoiceResponse,
  PaymentPayosRequest,
  PaymentRecordRequest,
  PaymentResultResponse,
  PaymentReverseRequest,
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import {
  candidateBenefitLabel,
  ineligibleText,
  voucherCodeOf,
} from '../../../lib/workforce/discounts';
import { formatDate, formatDateTime, formatVnd } from '../../../lib/workforce/format';
import {
  cancelBody,
  hasPriceRange,
  hasQuantity,
  invoiceTone,
  lineInput,
  payerBody,
  posErrorMessage,
  priceBody,
  priceRange,
} from '../../../lib/workforce/pos';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { PosPaymentsSection } from './pos-payments';
import { Badge, Empty, Field, Loading, Notice, PageHeader, Section, SubmitButton } from '../ui';

type Feedback = { tone: 'success' | 'error'; text: string } | null;

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
  const [invoice, setInvoice] = useState<InvoiceResponse | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const busy = useRef(false);
  const [working, setWorking] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [lookupValue, setLookupValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [voucherText, setVoucherText] = useState('');

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

  /** One command at a time; the server's answer replaces the invoice, a failure reloads it. */
  async function command(
    name: string,
    work: () => Promise<InvoiceResponse>,
    success: (result: InvoiceResponse) => string,
  ): Promise<boolean> {
    if (busy.current) return false;
    busy.current = true;
    setWorking(name);
    setFeedback(null);
    try {
      const result = await work();
      setInvoice(result);
      setFeedback({ tone: 'success', text: success(result) });
      return true;
    } catch (error) {
      setFeedback({ tone: 'error', text: posErrorMessage(error, t) });
      await load();
      return false;
    } finally {
      busy.current = false;
      setWorking(null);
    }
  }

  if (loadError && !invoice) {
    return (
      <>
        <PageHeader title={t.pos.title} />
        <Notice tone="error">{posErrorMessage(loadError, t)}</Notice>
        <Link className="wf-button" href={`${base}/pos`}>
          {t.pos.back}
        </Link>
      </>
    );
  }
  if (!invoice) return <Loading t={t} />;

  const zone = invoice.branch.timezone;
  const draft = invoice.status === 'DRAFT';
  const version = invoice.version;
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
  const collect = (body: PaymentRecordRequest) =>
    command(
      'collect',
      async () => {
        await api.post<PaymentResultResponse>(`/api/v1/pos/invoices/${invoice.id}/payments`, body);
        return reload();
      },
      (result) => (result.status === 'PAID' ? t.pos.collectedPaid : t.pos.collected),
    );
  const reversePayment = (paymentId: string, body: PaymentReverseRequest) =>
    command(
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
    );

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

  async function search(event: FormEvent) {
    event.preventDefault();
    if (!lookupValue.trim() || working) return;
    setWorking('lookup');
    setFeedback(null);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(
          `/api/v1/pos/branches/${invoice!.branch.id}/members`,
          { [lookupBy]: lookupValue.trim() },
        ),
      );
    } catch (error) {
      setLookup(null);
      setFeedback({ tone: 'error', text: posErrorMessage(error, t) });
    } finally {
      setWorking(null);
    }
  }

  async function supplyVoucher(event: FormEvent) {
    event.preventDefault();
    const code = voucherCodeOf(voucherText);
    if (!code) {
      setFeedback({ tone: 'error', text: t.pos.voucherNeedCode });
      return;
    }
    const done = await command(
      'voucher',
      () =>
        api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice!.id}/vouchers`, {
          expectedVersion: invoice!.version,
          code,
        }),
      () => t.pos.voucherSupplied,
    );
    if (done) setVoucherText('');
  }

  async function cancel(event: FormEvent) {
    event.preventDefault();
    const body = cancelBody(reason, version);
    if (!body) {
      setFeedback({ tone: 'error', text: t.pos.needReason });
      return;
    }
    const done = await command(
      'cancel',
      // The actor confirms THEIR OWN password when the API asks (a finalized invoice).
      () =>
        withReauthentication(
          () => api.post<InvoiceResponse>(`/api/v1/pos/invoices/${invoice!.id}/cancel`, body),
          confirm,
        ),
      () => t.pos.cancelled,
    );
    if (done) setReason('');
  }

  return (
    <>
      <PageHeader title={fill(t.pos.detailTitle, { code: invoice.code })}>
        <Badge tone={invoiceTone(invoice.status)}>{t.pos.statuses[invoice.status]}</Badge>
      </PageHeader>
      <p className="wf-muted">
        {fill(t.pos.visitInfo, {
          code: invoice.visit.code,
          date: formatDate(invoice.visit.serviceDate, locale),
        })}{' '}
        · {invoice.branch.name}
      </p>
      <p>
        <Link href={`${base}/pos`}>{t.pos.back}</Link>
      </p>
      {feedback ? <Notice tone={feedback.tone}>{feedback.text}</Notice> : null}
      {dialog}

      <Section title={t.pos.linesTitle}>
        {invoice.lines.length === 0 ? <Empty>{t.pos.noLines}</Empty> : null}
        {invoice.lines.length > 0 ? (
          <table className="wf-table">
            <thead>
              <tr>
                <th>{t.pos.colService}</th>
                <th>{t.pos.colGuest}</th>
                <th>{t.pos.colRange}</th>
                <th>{t.pos.colPrice}</th>
                <th>{t.pos.colQuantity}</th>
                <th>{t.pos.colAmount}</th>
              </tr>
            </thead>
            <tbody>
              {invoice.lines.map((line) => (
                <LineRow
                  key={`${line.id}:${line.unitPriceVnd}:${line.quantity}`}
                  line={line}
                  editable={draft && invoice.actions.editPrices && line.priceEditable}
                  working={working !== null}
                  onSave={(body) =>
                    command(
                      `line-${line.id}`,
                      () =>
                        api.post<InvoiceResponse>(
                          `/api/v1/pos/invoices/${invoice.id}/lines/${line.id}/price`,
                          body,
                        ),
                      () => t.pos.lineSaved,
                    )
                  }
                  version={version}
                  locale={locale}
                />
              ))}
            </tbody>
          </table>
        ) : null}
        <dl className="wf-summary">
          <div>
            <dt>{t.pos.subtotal}</dt>
            <dd>{formatVnd(invoice.subtotalVnd, locale)}</dd>
          </div>
          {invoice.discountTotalVnd !== '0' ? (
            <div>
              <dt>{t.pos.discountRow}</dt>
              <dd>− {formatVnd(invoice.discountTotalVnd, locale)}</dd>
            </div>
          ) : null}
          <div>
            <dt>
              <strong>{t.pos.total}</strong>
            </dt>
            <dd>
              <strong>{formatVnd(invoice.totalVnd, locale)}</strong>
            </dd>
          </div>
        </dl>
      </Section>

      <Section title={t.pos.discountTitle}>
        <p className="wf-small">{t.pos.discountNote}</p>
        {invoice.discount.winner ? (
          <Notice tone="success">
            <p>
              <strong>
                {fill(t.pos.discountApplied, {
                  name:
                    locale === 'vi'
                      ? invoice.discount.winner.nameVi
                      : invoice.discount.winner.nameEn,
                })}
              </strong>{' '}
              · {candidateBenefitLabel(invoice.discount.winner, locale)} ·{' '}
              {fill(t.pos.candidateAmount, {
                amount: formatVnd(invoice.discount.winner.amountVnd, locale),
              })}
            </p>
            {invoice.discount.selectionReason ? (
              <p className="wf-small">
                {t.pos.selectionReasons[
                  invoice.discount.selectionReason as keyof typeof t.pos.selectionReasons
                ] ?? invoice.discount.selectionReason}
              </p>
            ) : null}
          </Notice>
        ) : (
          <Empty>{t.pos.discountNone}</Empty>
        )}
        {invoice.discount.candidates.length > 0 ? (
          <>
            <h3>{t.pos.candidatesTitle}</h3>
            <ul className="wf-plain-list">
              {invoice.discount.candidates.map((candidate) => (
                <li key={`${candidate.discountId}:${candidate.voucherId ?? ''}`}>
                  {locale === 'vi' ? candidate.nameVi : candidate.nameEn} ·{' '}
                  {candidateBenefitLabel(candidate, locale)} ·{' '}
                  {candidate.voucherCode
                    ? fill(t.pos.candidateCode, { code: candidate.voucherCode })
                    : t.pos.candidateAuto}{' '}
                  {candidate.winner ? (
                    <Badge tone="success">{t.pos.candidateWinner}</Badge>
                  ) : candidate.eligible ? (
                    <Badge tone="neutral">{t.pos.candidateEligible}</Badge>
                  ) : (
                    <Badge tone="warning">
                      {candidate.reason ? ineligibleText(candidate.reason, t) : '—'}
                    </Badge>
                  )}
                </li>
              ))}
            </ul>
          </>
        ) : null}
        <h3>{t.pos.voucherTitle}</h3>
        {invoice.discount.vouchers.length === 0 ? (
          <p className="wf-muted">{t.pos.voucherNone}</p>
        ) : (
          <ul className="wf-plain-list">
            {invoice.discount.vouchers.map((entry) => (
              <li key={entry.id}>
                <code>{entry.code}</code> · {locale === 'vi' ? entry.nameVi : entry.nameEn}{' '}
                {draft && invoice.actions.applyVouchers ? (
                  <button
                    type="button"
                    className="wf-button wf-button-quiet"
                    disabled={working !== null}
                    onClick={() =>
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
                  >
                    {t.pos.voucherRemove}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {draft && invoice.actions.applyVouchers ? (
          <form className="wf-inline-form" onSubmit={(event) => void supplyVoucher(event)}>
            <Field id="pos-voucher" label={t.pos.voucherCode} hint={t.pos.voucherHint}>
              <input
                id="pos-voucher"
                autoComplete="off"
                autoCapitalize="characters"
                maxLength={64}
                value={voucherText}
                onChange={(event) => setVoucherText(event.target.value.toUpperCase())}
              />
            </Field>
            <SubmitButton
              pending={working === 'voucher'}
              label={t.pos.voucherApply}
              pendingLabel={t.pos.voucherApplying}
              tone="quiet"
              disabled={working !== null}
            />
          </form>
        ) : null}
      </Section>

      <Section title={t.pos.payerTitle}>
        <p>
          <strong>{invoice.payer ? invoice.payer.displayName : t.pos.guestPayer}</strong>
          {invoice.payer?.phoneMasked ? ` · ${invoice.payer.phoneMasked}` : ''}
          {invoice.payer?.emailMasked ? ` · ${invoice.payer.emailMasked}` : ''}
        </p>
        {draft && invoice.actions.setPayer ? (
          <>
            <p className="wf-small">{t.pos.payerHint}</p>
            <div className="wf-row-actions">
              {invoice.defaultPayer && invoice.payer?.id !== invoice.defaultPayer.id ? (
                <button
                  type="button"
                  className="wf-button"
                  disabled={working !== null}
                  onClick={() => void setPayer(invoice.defaultPayer!.id)}
                >
                  {t.pos.useDefaultPayer}: {invoice.defaultPayer.displayName}
                </button>
              ) : null}
              {invoice.payer ? (
                <button
                  type="button"
                  className="wf-button"
                  disabled={working !== null}
                  onClick={() => void setPayer(null)}
                >
                  {t.pos.useGuestPayer}
                </button>
              ) : null}
            </div>
            <form className="wf-inline-form" onSubmit={(event) => void search(event)}>
              <Field id="pos-lookup-by" label={t.pos.lookupBy}>
                <select
                  id="pos-lookup-by"
                  value={lookupBy}
                  onChange={(event) => (
                    setLookupBy(event.target.value as 'phone' | 'email'),
                    setLookup(null)
                  )}
                >
                  <option value="phone">{t.pos.phone}</option>
                  <option value="email">{t.pos.email}</option>
                </select>
              </Field>
              <Field id="pos-lookup" label={lookupBy === 'phone' ? t.pos.phone : t.pos.email}>
                <input
                  id="pos-lookup"
                  type={lookupBy === 'phone' ? 'tel' : 'email'}
                  inputMode={lookupBy === 'phone' ? 'tel' : 'email'}
                  autoComplete="off"
                  maxLength={lookupBy === 'phone' ? 32 : 320}
                  value={lookupValue}
                  onChange={(event) => (setLookupValue(event.target.value), setLookup(null))}
                />
              </Field>
              <SubmitButton
                pending={working === 'lookup'}
                label={t.pos.search}
                pendingLabel={t.pos.searching}
                tone="quiet"
              />
            </form>
            {lookup && lookup.members[0] ? (
              <Notice tone="success">
                <p>
                  {fill(t.pos.found, { name: lookup.members[0].displayName })}
                  {lookup.members[0].phoneMasked ? ` · ${lookup.members[0].phoneMasked}` : ''}
                  {lookup.members[0].emailMasked ? ` · ${lookup.members[0].emailMasked}` : ''}
                </p>
                <button
                  type="button"
                  className="wf-button"
                  disabled={working !== null || invoice.payer?.id === lookup.members[0].id}
                  onClick={() => {
                    const member = lookup.members[0]!;
                    void setPayer(member.id).then((done) => {
                      if (!done) return;
                      setLookup(null);
                      setLookupValue('');
                    });
                  }}
                >
                  {t.pos.setPayer}
                </button>
              </Notice>
            ) : null}
            {lookup && lookup.members.length === 0 ? (
              <Notice tone="info">{t.pos.notFound}</Notice>
            ) : null}
          </>
        ) : null}
      </Section>

      {draft && invoice.actions.finalize ? (
        <Section title={t.pos.finalize}>
          <p className="wf-small">{t.pos.finalizeHint}</p>
          {!invoice.readiness.ready ? (
            <Notice tone="warning">
              {fill(t.pos.notReady, { count: invoice.readiness.unpricedLines })}
            </Notice>
          ) : null}
          <button
            type="button"
            className="wf-button wf-button-primary"
            disabled={working !== null || !invoice.readiness.ready}
            aria-busy={working === 'finalize'}
            onClick={() =>
              void command(
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
          </button>
        </Section>
      ) : null}

      {invoice.status !== 'DRAFT' &&
      (invoice.payments.length > 0 || invoice.status === 'PENDING_PAYMENT') ? (
        <PosPaymentsSection
          invoice={invoice}
          working={working}
          onCollect={collect}
          onReverse={reversePayment}
          onCreatePayos={createPayos}
          onRefreshPayos={refreshPayos}
          onCancelPayos={cancelPayos}
          onReviewAnomaly={reviewAnomaly}
          onAddNote={addNote}
        />
      ) : null}

      {invoice.status === 'PENDING_PAYMENT' ? (
        <Notice tone="info">{t.pos.pendingNote}</Notice>
      ) : null}
      {invoice.status === 'PAID' ? (
        <Notice tone="success">
          {invoice.payments.length === 0 ? t.pos.paidNote : t.pos.paidFullNote}
        </Notice>
      ) : null}
      {invoice.status === 'CANCELLED' ? (
        <Notice tone="error">
          {fill(t.pos.cancelledInfo, {
            time: invoice.cancelledAt ? formatDateTime(invoice.cancelledAt, zone, locale) : '—',
            reason: invoice.cancelReason ?? '—',
          })}
        </Notice>
      ) : null}

      {invoice.actions.cancel ? (
        <Section title={t.pos.cancelTitle}>
          <form onSubmit={(event) => void cancel(event)}>
            <Field
              id="pos-cancel-reason"
              label={t.pos.cancelReason}
              hint={t.pos.cancelReasonHint}
              required
            >
              <textarea
                id="pos-cancel-reason"
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </Field>
            {invoice.actions.cancelNeedsReauth ? (
              <p className="wf-small">{t.pos.cancelNeedsReauth}</p>
            ) : null}
            <SubmitButton
              pending={working === 'cancel'}
              label={t.pos.cancel}
              pendingLabel={t.pos.cancelling}
              tone="danger"
              disabled={working !== null}
            />
          </form>
        </Section>
      ) : null}
    </>
  );
}

/** One service line: the historical range as reference, and the choices the line permits. */
function LineRow({
  line,
  editable,
  working,
  version,
  locale,
  onSave,
}: {
  line: InvoiceLineResponse;
  editable: boolean;
  working: boolean;
  version: number;
  locale: 'vi' | 'en';
  onSave: (body: InvoiceLinePriceRequest) => Promise<boolean>;
}) {
  const { t } = useWorkforce();
  const [input, setInput] = useState(() => lineInput(line));
  const [problem, setProblem] = useState<string | null>(null);
  const name = locale === 'vi' ? line.nameVi : line.nameEn;
  const choosesPrice = hasPriceRange(line);
  const choosesQuantity = hasQuantity(line);
  const canEdit = editable && (choosesPrice || choosesQuantity);

  function save(event: FormEvent) {
    event.preventDefault();
    const result = priceBody(line, input, version);
    if ('problem' in result) {
      setProblem(
        result.problem === 'price'
          ? t.pos.invalidPrice
          : result.problem === 'quantity'
            ? t.pos.invalidQuantity
            : t.pos.unchanged,
      );
      return;
    }
    setProblem(null);
    void onSave(result.body);
  }

  return (
    <tr>
      <td data-label={t.pos.colService}>
        {name}
        <br />
        <span className="wf-small">
          {line.pricingUnit === 'PER_NAIL' ? t.pos.perNail : t.pos.perService} ·{' '}
          {line.employee.displayName}
        </span>
        {line.addedOnBehalf ? (
          <>
            {' '}
            <Badge tone="info">{t.pos.addedOnBehalf}</Badge>
          </>
        ) : null}
      </td>
      <td data-label={t.pos.colGuest}>{line.participant.displayName ?? '—'}</td>
      <td data-label={t.pos.colRange}>
        {choosesPrice
          ? priceRange(line, locale)
          : `${formatVnd(line.priceMinVnd, locale)} (${t.pos.fixedPrice})`}
      </td>
      {canEdit ? (
        <td colSpan={2} data-label={t.pos.colPrice}>
          <form className="wf-inline-form" onSubmit={save}>
            {choosesPrice ? (
              <Field id={`price-${line.id}`} label={t.pos.priceLabel}>
                <input
                  id={`price-${line.id}`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={18}
                  value={input.price}
                  onChange={(event) => setInput({ ...input, price: event.target.value })}
                />
              </Field>
            ) : null}
            {choosesQuantity ? (
              <Field
                id={`quantity-${line.id}`}
                label={t.pos.quantityLabel}
                hint={fill(t.pos.quantityLimit, { limit: line.quantityLimit })}
              >
                <input
                  id={`quantity-${line.id}`}
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={9}
                  value={input.quantity}
                  onChange={(event) => setInput({ ...input, quantity: event.target.value })}
                />
              </Field>
            ) : null}
            <SubmitButton
              pending={false}
              label={t.pos.saveLine}
              pendingLabel={t.pos.savingLine}
              tone="quiet"
              disabled={working}
            />
            {problem ? (
              <p className="wf-hint" role="alert">
                {problem}
              </p>
            ) : null}
          </form>
        </td>
      ) : (
        <>
          <td data-label={t.pos.colPrice}>
            {line.unitPriceVnd === null ? t.pos.notSet : formatVnd(line.unitPriceVnd, locale)}
          </td>
          <td data-label={t.pos.colQuantity}>{line.quantity ?? t.pos.notSet}</td>
        </>
      )}
      <td data-label={t.pos.colAmount}>
        {line.grossVnd === null ? '—' : formatVnd(line.grossVnd, locale)}
      </td>
    </tr>
  );
}

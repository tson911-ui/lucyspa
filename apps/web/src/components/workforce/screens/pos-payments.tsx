'use client';

import type {
  InvoicePaymentAnomaly,
  InvoicePaymentResponse,
  InvoiceResponse,
  PaymentPayosRequest,
  PaymentRecordRequest,
  PaymentReverseRequest,
} from '@lucy-spa/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import {
  changePreview,
  formatCountdown,
  newPaymentKey,
  noteBody,
  paymentBody,
  paymentInput,
  payosBody,
  remainingMs,
  reverseBody,
  type PaymentInput,
  type PaymentProblem,
} from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { Badge, Empty, Field, Notice, Section, SubmitButton, type Tone } from '../ui';

/**
 * Payments of one invoice (Phase 4 Steps 7 and 8): the history (a reversed payment stays listed with its
 * correction), a cash form, a PayOS QR request, the reversal of an erroneous CASH payment and, for management,
 * the PayOS money that was not applied plus audited notes. The browser never decides a balance or a status:
 * it shows the server's numbers and sends only choices (amounts, keys, notes). A PayOS payment becomes paid
 * only when PayOS confirms it; there is no "mark as received" control anywhere.
 */
export function PosPaymentsSection({
  invoice,
  working,
  onCollect,
  onReverse,
  onCreatePayos,
  onRefreshPayos,
  onCancelPayos,
  onReviewAnomaly,
  onAddNote,
}: {
  invoice: InvoiceResponse;
  working: string | null;
  onCollect: (body: PaymentRecordRequest) => Promise<boolean>;
  onReverse: (paymentId: string, body: PaymentReverseRequest) => Promise<boolean>;
  onCreatePayos: (body: PaymentPayosRequest) => Promise<boolean>;
  onRefreshPayos: (paymentId: string) => Promise<boolean>;
  onCancelPayos: (paymentId: string) => Promise<boolean>;
  onReviewAnomaly: (anomalyId: string, note: string) => Promise<boolean>;
  onAddNote: (note: string) => Promise<boolean>;
}) {
  const { t, locale } = useWorkforce();
  const zone = invoice.branch.timezone;
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState(false);
  const target = invoice.payments.find((payment) => payment.id === reversing) ?? null;
  const pendingPayment = invoice.payments.find((payment) => payment.status === 'PENDING') ?? null;
  const balance = BigInt(invoice.balanceVnd);
  const held = BigInt(invoice.pendingProviderVnd);
  // Cash can only take what no live PayOS request holds (the API enforces the same rule).
  const cashBalance = balance - held;
  const canCollect = invoice.actions.collectPayment && cashBalance > 0n;
  const canCreatePayos = invoice.actions.collectPayos && balance > 0n && pendingPayment === null;

  async function submitReverse(event: FormEvent) {
    event.preventDefault();
    if (!target) return;
    const body = reverseBody(reason);
    if (!body) {
      setReasonProblem(true);
      return;
    }
    setReasonProblem(false);
    if (await onReverse(target.id, body)) {
      setReversing(null);
      setReason('');
    }
  }

  return (
    <Section title={t.pos.paymentTitle}>
      <p className="wf-small">{t.pos.paymentNote}</p>
      <dl className="wf-summary">
        <div>
          <dt>{t.pos.paidLabel}</dt>
          <dd>{formatVnd(invoice.paidVnd, locale)}</dd>
        </div>
        <div>
          <dt>
            <strong>{t.pos.balanceLabel}</strong>
          </dt>
          <dd>
            <strong>{formatVnd(invoice.balanceVnd, locale)}</strong>
          </dd>
        </div>
      </dl>
      {held > 0n ? (
        <p className="wf-small">
          {fill(t.pos.payosHeld, { amount: formatVnd(invoice.pendingProviderVnd, locale) })}
        </p>
      ) : null}

      {invoice.payments.length === 0 ? (
        <Empty>{t.pos.noPayments}</Empty>
      ) : (
        <table className="wf-table">
          <thead>
            <tr>
              <th>{t.pos.colTime}</th>
              <th>{t.pos.colCollector}</th>
              <th>{t.pos.colMethod}</th>
              <th>{t.pos.colCredited}</th>
              <th>{t.pos.colTendered}</th>
              <th>{t.pos.colChange}</th>
              <th>{t.pos.colState}</th>
            </tr>
          </thead>
          <tbody>
            {invoice.payments.map((payment) => (
              <PaymentRow
                key={payment.id}
                payment={payment}
                zone={zone}
                working={working !== null}
                onReverse={() => {
                  setReversing(payment.id);
                  setReason('');
                  setReasonProblem(false);
                }}
              />
            ))}
          </tbody>
        </table>
      )}

      {target ? (
        <form onSubmit={(event) => void submitReverse(event)}>
          <h3>{t.pos.reverseTitle}</h3>
          <p className="wf-small">
            {formatVnd(target.amountVnd, locale)} · {target.collectedBy.displayName}
          </p>
          <p className="wf-small">{t.pos.reverseHint}</p>
          <Field id="pos-reverse-reason" label={t.pos.reverseReason} required>
            <textarea
              id="pos-reverse-reason"
              rows={2}
              maxLength={500}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </Field>
          {reasonProblem ? (
            <p className="wf-hint" role="alert">
              {t.pos.needReverseReason}
            </p>
          ) : null}
          <div className="wf-row-actions">
            <SubmitButton
              pending={working === `reverse-${target.id}`}
              label={t.pos.reverse}
              pendingLabel={t.pos.reversing}
              tone="danger"
              disabled={working !== null}
            />
            <button
              type="button"
              className="wf-button"
              disabled={working !== null}
              onClick={() => setReversing(null)}
            >
              {t.pos.reverseKeep}
            </button>
          </div>
        </form>
      ) : null}

      {pendingPayment ? (
        <PayosPending
          key={pendingPayment.id}
          payment={pendingPayment}
          working={working}
          onRefresh={onRefreshPayos}
          onCancel={onCancelPayos}
        />
      ) : null}

      {canCollect ? (
        <CollectForm
          // A new balance (after a payment or a reversal) restarts the form from that balance.
          key={`${invoice.id}:${cashBalance.toString()}`}
          balance={cashBalance.toString()}
          working={working}
          onCollect={onCollect}
        />
      ) : null}

      {canCreatePayos ? (
        <PayosForm
          key={`${invoice.id}:${invoice.balanceVnd}:payos`}
          balance={invoice.balanceVnd}
          working={working}
          onCreate={onCreatePayos}
        />
      ) : null}

      {invoice.actions.manageAnomalies &&
      (invoice.anomalies.length > 0 ||
        invoice.managementNotes.length > 0 ||
        invoice.actions.addManagementNote) ? (
        <ManagementSection
          invoice={invoice}
          zone={zone}
          working={working}
          onReview={onReviewAnomaly}
          onAddNote={onAddNote}
        />
      ) : null}
    </Section>
  );
}

function stateTone(payment: InvoicePaymentResponse): Tone {
  if (payment.status === 'SUCCEEDED') return payment.effective ? 'success' : 'warning';
  if (payment.status === 'PENDING') return 'info';
  if (payment.status === 'FAILED') return 'error';
  return 'neutral';
}

function PaymentRow({
  payment,
  zone,
  working,
  onReverse,
}: {
  payment: InvoicePaymentResponse;
  zone: string;
  working: boolean;
  onReverse: () => void;
}) {
  const { t, locale } = useWorkforce();
  const provider = payment.method === 'PAYOS';
  return (
    <tr>
      <td data-label={t.pos.colTime}>{formatDateTime(payment.collectedAt, zone, locale)}</td>
      <td data-label={t.pos.colCollector}>{payment.collectedBy.displayName}</td>
      <td data-label={t.pos.colMethod}>{t.pos.methods[payment.method]}</td>
      <td data-label={t.pos.colCredited}>{formatVnd(payment.amountVnd, locale)}</td>
      <td data-label={t.pos.colTendered}>
        {provider ? '—' : formatVnd(payment.tenderedVnd, locale)}
      </td>
      <td data-label={t.pos.colChange}>{provider ? '—' : formatVnd(payment.changeVnd, locale)}</td>
      <td data-label={t.pos.colState}>
        {payment.correction ? (
          <>
            <Badge tone="warning">{t.pos.paymentReversed}</Badge>
            <br />
            <span className="wf-small">
              {fill(t.pos.reversedInfo, {
                time: formatDateTime(payment.correction.occurredAt, zone, locale),
                name: payment.correction.actor.displayName,
                reason: payment.correction.reason,
              })}
            </span>
          </>
        ) : provider && payment.status !== 'SUCCEEDED' ? (
          <Badge tone={stateTone(payment)}>{t.pos.paymentStates[payment.status as never]}</Badge>
        ) : (
          <Badge tone={stateTone(payment)}>{t.pos.paymentEffective}</Badge>
        )}
        {provider && payment.status === 'SUCCEEDED' && payment.provider ? (
          <>
            <br />
            <span className="wf-small">
              {payment.provider.reference
                ? fill(t.pos.paymentReference, { reference: payment.provider.reference })
                : null}
              {payment.provider.late ? ` ${t.pos.paymentLate}` : ''} {t.pos.paymentProviderFinal}
            </span>
          </>
        ) : null}
        {payment.reversible ? (
          <>
            {' '}
            <button
              type="button"
              className="wf-button wf-button-quiet"
              disabled={working}
              onClick={onReverse}
            >
              {t.pos.reverse}
            </button>
          </>
        ) : null}
      </td>
    </tr>
  );
}

/** The QR image, generated in the browser from the PayOS QR content (no third-party image service). */
function useQrImage(content: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!content) {
      setUrl(null);
      return;
    }
    void import('qrcode')
      .then((module) =>
        module.toDataURL(content, { margin: 1, width: 240, errorCorrectionLevel: 'M' }),
      )
      .then((dataUrl) => {
        if (!cancelled) setUrl(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
    };
  }, [content]);
  return url;
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
  onRefresh: (paymentId: string) => Promise<boolean>;
  onCancel: (paymentId: string) => Promise<boolean>;
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
    <div className="wf-card">
      <h3>{t.pos.payosWaiting}</h3>
      <p>
        <strong>{formatVnd(payment.amountVnd, locale)}</strong> ·{' '}
        {left > 0
          ? fill(t.pos.payosExpiresIn, { time: formatCountdown(left) })
          : t.pos.payosExpired}
      </p>
      {provider.qrCode ? (
        <>
          {image ? (
            // A data URL generated here from the QR content; not a remote image.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="PayOS QR" width={240} height={240} />
          ) : null}
          <p className="wf-small">{t.pos.payosScan}</p>
          {provider.checkoutUrl ? (
            <p>
              <a href={provider.checkoutUrl} target="_blank" rel="noopener noreferrer">
                {t.pos.payosOpenLink}
              </a>
            </p>
          ) : null}
        </>
      ) : (
        <Notice tone="warning">{t.pos.payosNoQr}</Notice>
      )}
      {payment.cancellable ? (
        <div className="wf-row-actions">
          <button
            type="button"
            className="wf-button"
            disabled={working !== null}
            onClick={() => void onRefresh(payment.id)}
          >
            {working === `payos-refresh-${payment.id}` ? t.pos.payosRefreshing : t.pos.payosRefresh}
          </button>
          <button
            type="button"
            className="wf-button"
            disabled={working !== null}
            onClick={() => void onCancel(payment.id)}
          >
            {working === `payos-cancel-${payment.id}` ? t.pos.payosCancelling : t.pos.payosCancel}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** PayOS: the amount (default the whole balance; less is a split with cash). One idempotency key per choice. */
function PayosForm({
  balance,
  working,
  onCreate,
}: {
  balance: string;
  working: string | null;
  onCreate: (body: PaymentPayosRequest) => Promise<boolean>;
}) {
  const { t } = useWorkforce();
  const [amount, setAmount] = useState(balance);
  const [problem, setProblem] = useState(false);
  const attempt = useRef<{ key: string; amount: string } | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!attempt.current || attempt.current.amount !== amount) {
      attempt.current = { key: newPaymentKey(), amount };
    }
    const result = payosBody(amount, balance, attempt.current.key);
    if ('problem' in result) {
      setProblem(true);
      return;
    }
    setProblem(false);
    if (await onCreate(result.body)) attempt.current = null;
  }

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h3>{t.pos.payosTitle}</h3>
      <p className="wf-small">{t.pos.payosNote}</p>
      <Field id="pos-payos-amount" label={t.pos.amountLabel} hint={t.pos.amountHint}>
        <input
          id="pos-payos-amount"
          inputMode="numeric"
          autoComplete="off"
          maxLength={18}
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>
      {problem ? <Notice tone="error">{t.pos.invalidAmount}</Notice> : null}
      <SubmitButton
        pending={working === 'payos-create'}
        label={t.pos.payosCreate}
        pendingLabel={t.pos.payosCreating}
        tone="primary"
        disabled={working !== null}
      />
    </form>
  );
}

/** Management: PayOS money that was not applied, and audited notes (CORRECT_PAYMENTS; the API checks again). */
function ManagementSection({
  invoice,
  zone,
  working,
  onReview,
  onAddNote,
}: {
  invoice: InvoiceResponse;
  zone: string;
  working: string | null;
  onReview: (anomalyId: string, note: string) => Promise<boolean>;
  onAddNote: (note: string) => Promise<boolean>;
}) {
  const { t, locale } = useWorkforce();
  const [text, setText] = useState('');
  const [noteProblem, setNoteProblem] = useState(false);

  async function submitNote(event: FormEvent) {
    event.preventDefault();
    const body = noteBody(text);
    if (!body) {
      setNoteProblem(true);
      return;
    }
    setNoteProblem(false);
    if (await onAddNote(body.note)) setText('');
  }

  return (
    <>
      {invoice.anomalies.length > 0 ? (
        <div>
          <h3>{t.pos.anomalyTitle}</h3>
          <p className="wf-small">{t.pos.anomalyHint}</p>
          {invoice.anomalies.map((anomaly) => (
            <AnomalyCard
              key={anomaly.id}
              anomaly={anomaly}
              zone={zone}
              working={working}
              onReview={onReview}
            />
          ))}
        </div>
      ) : null}
      <div>
        <h3>{t.pos.noteTitle}</h3>
        <p className="wf-small">{t.pos.noteHint}</p>
        {invoice.managementNotes.length === 0 ? (
          <Empty>{t.pos.noNotes}</Empty>
        ) : (
          <ul>
            {invoice.managementNotes.map((note) => (
              <li key={note.id}>
                {note.note}
                <br />
                <span className="wf-small">
                  {fill(t.pos.noteBy, {
                    name: note.author.displayName,
                    time: formatDateTime(note.createdAt, zone, locale),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
        {invoice.actions.addManagementNote ? (
          <form onSubmit={(event) => void submitNote(event)}>
            <Field id="pos-note" label={t.pos.noteLabel} required>
              <textarea
                id="pos-note"
                rows={2}
                maxLength={500}
                value={text}
                onChange={(event) => setText(event.target.value)}
              />
            </Field>
            {noteProblem ? (
              <p className="wf-hint" role="alert">
                {t.pos.noteNeed}
              </p>
            ) : null}
            <SubmitButton
              pending={working === 'note'}
              label={t.pos.noteAdd}
              pendingLabel={t.pos.noteAdding}
              tone="primary"
              disabled={working !== null}
            />
          </form>
        ) : null}
      </div>
    </>
  );
}

function AnomalyCard({
  anomaly,
  zone,
  working,
  onReview,
}: {
  anomaly: InvoicePaymentAnomaly;
  zone: string;
  working: string | null;
  onReview: (anomalyId: string, note: string) => Promise<boolean>;
}) {
  const { t, locale } = useWorkforce();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const body = noteBody(text);
    if (!body) {
      setProblem(true);
      return;
    }
    setProblem(false);
    if (await onReview(anomaly.id, body.note)) setText('');
  }

  return (
    <div className="wf-card">
      <p>
        {anomaly.status === 'OPEN' ? <Badge tone="warning">{t.pos.anomalyOpen}</Badge> : null}{' '}
        <strong>{t.pos.anomalyKinds[anomaly.kind]}</strong> ·{' '}
        {formatDateTime(anomaly.openedAt, zone, locale)}
      </p>
      <p className="wf-small">
        {fill(t.pos.anomalyDetail, {
          expected: anomaly.expectedAmountVnd ? formatVnd(anomaly.expectedAmountVnd, locale) : '—',
          received: formatVnd(anomaly.receivedAmountVnd, locale),
          reference: anomaly.providerReference,
        })}
      </p>
      {anomaly.status === 'REVIEWED' && anomaly.reviewedAt && anomaly.reviewedBy ? (
        <p className="wf-small">
          {fill(t.pos.anomalyReviewedInfo, {
            time: formatDateTime(anomaly.reviewedAt, zone, locale),
            name: anomaly.reviewedBy.displayName,
            note: anomaly.reviewNote ?? '—',
          })}
        </p>
      ) : (
        <form onSubmit={(event) => void submit(event)}>
          <Field id={`pos-anomaly-${anomaly.id}`} label={t.pos.anomalyNoteLabel} required>
            <textarea
              id={`pos-anomaly-${anomaly.id}`}
              rows={2}
              maxLength={500}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          </Field>
          {problem ? (
            <p className="wf-hint" role="alert">
              {t.pos.anomalyNeedNote}
            </p>
          ) : null}
          <SubmitButton
            pending={working === `anomaly-${anomaly.id}`}
            label={t.pos.anomalyReview}
            pendingLabel={t.pos.anomalyReviewing}
            tone="primary"
            disabled={working !== null}
          />
        </form>
      )}
    </div>
  );
}

/** Cash: the credited amount (default the whole cash-collectable balance) and what was handed over. */
function CollectForm({
  balance,
  working,
  onCollect,
}: {
  balance: string;
  working: string | null;
  onCollect: (body: PaymentRecordRequest) => Promise<boolean>;
}) {
  const { t, locale } = useWorkforce();
  const [input, setInput] = useState<PaymentInput>(() => paymentInput(balance));
  const [problem, setProblem] = useState<PaymentProblem | null>(null);
  // One idempotency key per intended payment: a retry of the same choice reuses it (the server then
  // returns the stored payment instead of collecting twice); another choice gets a new one.
  const attempt = useRef<{ key: string; amount: string; tendered: string } | null>(null);
  const change = changePreview(input);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !attempt.current ||
      attempt.current.amount !== input.amount ||
      attempt.current.tendered !== input.tendered
    ) {
      attempt.current = { key: newPaymentKey(), amount: input.amount, tendered: input.tendered };
    }
    const result = paymentBody(input, balance, attempt.current.key);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    if (await onCollect(result.body)) attempt.current = null;
  }

  const message =
    problem === 'amount'
      ? t.pos.invalidAmount
      : problem === 'tendered'
        ? t.pos.invalidTendered
        : problem === 'tenderLow'
          ? t.pos.tenderTooLow
          : null;

  return (
    <form onSubmit={(event) => void submit(event)}>
      <h3>{t.pos.collectTitle}</h3>
      <div className="wf-inline-form">
        <Field id="pos-pay-amount" label={t.pos.amountLabel} hint={t.pos.amountHint}>
          <input
            id="pos-pay-amount"
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            value={input.amount}
            onChange={(event) => {
              const amount = event.target.value;
              // Keep "exact tender" while the cashier has not typed a different tender.
              setInput((current) => ({
                amount,
                tendered: current.tendered === current.amount ? amount : current.tendered,
              }));
            }}
          />
        </Field>
        <Field id="pos-pay-tendered" label={t.pos.tenderedLabel}>
          <input
            id="pos-pay-tendered"
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            value={input.tendered}
            onChange={(event) => setInput({ ...input, tendered: event.target.value })}
          />
        </Field>
      </div>
      {change !== null ? (
        <p className="wf-small">
          {fill(t.pos.changePreview, { amount: formatVnd(change, locale) })}
        </p>
      ) : null}
      {message ? <Notice tone="error">{message}</Notice> : null}
      <SubmitButton
        pending={working === 'collect'}
        label={t.pos.collect}
        pendingLabel={t.pos.collecting}
        tone="primary"
        disabled={working !== null}
      />
    </form>
  );
}

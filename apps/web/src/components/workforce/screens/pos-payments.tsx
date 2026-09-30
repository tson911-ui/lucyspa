'use client';

import type {
  InvoicePaymentResponse,
  InvoiceResponse,
  PaymentRecordRequest,
  PaymentReverseRequest,
} from '@lucy-spa/contracts';
import { useRef, useState, type FormEvent } from 'react';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import {
  changePreview,
  newPaymentKey,
  paymentBody,
  paymentInput,
  reverseBody,
  type PaymentInput,
  type PaymentProblem,
} from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { Badge, Empty, Field, Notice, Section, SubmitButton } from '../ui';

/**
 * Payments of one invoice (Phase 4 Step 7): the history (a reversed payment stays listed with its
 * correction), a cash form for a PENDING_PAYMENT invoice, and the reversal of an erroneous payment. Cash is
 * the only method; the method is a constant of the request and the API refuses anything else. The browser
 * never decides a balance or a status: it shows the server's numbers and sends only the credited amount,
 * the tendered amount and an idempotency key (the server records the collector, the time and the change).
 */
export function PosPaymentsSection({
  invoice,
  working,
  onCollect,
  onReverse,
}: {
  invoice: InvoiceResponse;
  working: string | null;
  onCollect: (body: PaymentRecordRequest) => Promise<boolean>;
  onReverse: (paymentId: string, body: PaymentReverseRequest) => Promise<boolean>;
}) {
  const { t, locale } = useWorkforce();
  const zone = invoice.branch.timezone;
  const [reversing, setReversing] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [reasonProblem, setReasonProblem] = useState(false);
  const target = invoice.payments.find((payment) => payment.id === reversing) ?? null;
  const canCollect = invoice.actions.collectPayment && BigInt(invoice.balanceVnd) > 0n;

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

      {canCollect ? (
        <CollectForm
          // A new balance (after a payment or a reversal) restarts the form from that balance.
          key={`${invoice.id}:${invoice.balanceVnd}`}
          balance={invoice.balanceVnd}
          working={working}
          onCollect={onCollect}
        />
      ) : null}
    </Section>
  );
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
  return (
    <tr>
      <td data-label={t.pos.colTime}>{formatDateTime(payment.collectedAt, zone, locale)}</td>
      <td data-label={t.pos.colCollector}>{payment.collectedBy.displayName}</td>
      <td data-label={t.pos.colMethod}>{t.pos.methods[payment.method]}</td>
      <td data-label={t.pos.colCredited}>{formatVnd(payment.amountVnd, locale)}</td>
      <td data-label={t.pos.colTendered}>{formatVnd(payment.tenderedVnd, locale)}</td>
      <td data-label={t.pos.colChange}>{formatVnd(payment.changeVnd, locale)}</td>
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
        ) : (
          <Badge tone="success">{t.pos.paymentEffective}</Badge>
        )}
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

/** Cash: the credited amount (default the whole balance; less is a split payment) and what was handed over. */
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

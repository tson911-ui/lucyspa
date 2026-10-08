'use client';

import type {
  ProductRefundResponse,
  ProductRefundSummaryResponse,
  ProductReturnCaseResponse,
} from '@lucy-spa/contracts';
import {
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  NumberInput,
  RadioGroup,
  RowActions,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { productRefundsDictionary } from '../../../i18n/product-refunds';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  emptyRefundDraft,
  refundErrorText,
  refundPreview,
  refundRequest,
  REFUND_METHODS,
  REFUND_REASON_MAX,
  transferRefunds,
  validateRefundDraft,
  type RefundDraft,
} from '../../../lib/workforce/product-refunds';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Notice, Section } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';
const PATH = (caseId: string) => `/api/v1/product-returns/cases/${caseId}/refunds`;

/** The refunds of a case: where the line stands and each refund with its money, stock and points. Money is shown to REFUND_PRODUCTS holders only. */
export function RefundsSection({
  summary,
  onCorrect,
}: {
  summary: ProductRefundSummaryResponse;
  /** Opens the reference correction form (only offered when a transfer refund exists). */
  onCorrect: () => void;
}) {
  const { locale } = useWorkforce();
  const text = productRefundsDictionary(locale);
  const money = (value: string) => formatVnd(value, locale);
  const when = (instant: string) => formatDateTime(instant, ZONE, locale);
  return (
    <Section
      title={text.title}
      actions={
        summary.can.correctReference ? (
          <RowActions
            menuLabel={text.title}
            items={[{ id: 'correct', label: text.correct.action, onSelect: onCorrect }]}
          />
        ) : undefined
      }
    >
      {summary.blocked && summary.blocked !== 'NOTHING_LEFT' ? (
        <Notice tone="info">{text.blocked[summary.blocked]}</Notice>
      ) : null}
      <DescriptionList
        columns={2}
        items={[
          { label: text.summary.state, value: text.states[summary.lineState] },
          {
            label: text.summary.refundedUnits,
            value: fill(text.summary.refundedUnitsOf, {
              refunded: summary.lineRefundedQuantity,
              sold: summary.soldQuantity,
            }),
          },
          {
            label: text.summary.caseUnits,
            value: fill(text.summary.caseUnitsOf, {
              refunded: summary.caseRefundedQuantity,
              quantity: summary.caseQuantity,
              left: summary.caseRemainingQuantity,
            }),
          },
          ...(summary.lineNetVnd !== null
            ? [{ label: text.summary.paid, value: money(summary.lineNetVnd) }]
            : []),
          { label: text.summary.refunded, value: money(summary.lineRefundedVnd) },
        ]}
      />
      {summary.refunds.length === 0 ? (
        <p className="ls-hint">{text.empty}</p>
      ) : (
        <DescriptionList
          columns={1}
          items={summary.refunds.map((refund) => ({
            label: `${refund.code} · ${money(refund.amountVnd)}`,
            value: <RefundDetails refund={refund} when={when} />,
          }))}
        />
      )}
    </Section>
  );
}

function RefundDetails({
  refund,
  when,
}: {
  refund: ProductRefundResponse;
  when: (instant: string) => string;
}) {
  const { locale } = useWorkforce();
  const text = productRefundsDictionary(locale);
  const r = text.refund;
  const points =
    refund.beautyPointsTakenBack === null
      ? r.pointsNone
      : refund.beautyPointsShortfall > 0
        ? fill(r.pointsShort, {
            points: refund.beautyPointsTakenBack,
            short: refund.beautyPointsShortfall,
          })
        : fill(r.pointsTaken, { points: refund.beautyPointsTakenBack });
  return (
    <>
      <p className="ls-hint">
        {fill(r.when, { name: refund.actorName, time: when(refund.occurredAt) })}
      </p>
      <p>
        {r.quantity}: {refund.quantity} · {text.methods[refund.method]}
        {refund.bankReference ? ` · ${refund.bankReference}` : ''}
      </p>
      <p>
        {text.restocks[refund.restock]} ·{' '}
        {refund.lotCodes.length > 0
          ? fill(r.lots, { lots: refund.lotCodes.join(', ') })
          : r.noStock}
      </p>
      <p>
        {r.points}: {points}
      </p>
      <p>
        {r.reason}: {refund.reason}
      </p>
      {refund.corrections.length > 0 ? (
        <p className="ls-hint">
          {r.corrections}:{' '}
          {refund.corrections
            .map((correction) =>
              fill(r.correctionLine, {
                reference: correction.bankReference,
                name: correction.actorName,
                time: when(correction.occurredAt),
              }),
            )
            .join('; ')}
          {refund.firstBankReference ? ` (${r.referenceFirst}: ${refund.firstBankReference})` : ''}
        </p>
      ) : null}
    </>
  );
}

/**
 * "Hoàn tiền": the refund form. Quantity, cash or manual transfer (with the bank's reference, never an account number), whether the goods
 * can be sold again, and the reason. The amount is only shown (the API computes it from what the customer paid); the password is asked for
 * by the shared confirmation when the API says so, and the request id is made once so a retry can never refund twice.
 */
export function RefundDialog({
  item,
  summary,
  onClose,
  onDone,
  onFail,
}: {
  item: ProductReturnCaseResponse;
  summary: ProductRefundSummaryResponse;
  onClose: () => void;
  onDone: (code: string, amount: string) => Promise<void>;
  onFail: (error: unknown) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productRefundsDictionary(locale);
  const f = text.form;
  const { confirm, dialog } = useReauthentication();
  const [draft, setDraft] = useState<RefundDraft>(() => ({
    ...emptyRefundDraft(),
    quantity: String(Math.min(1, summary.caseRemainingQuantity) || 1),
  }));
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(globalThis.crypto.randomUUID());
  const errors = validateRefundDraft(draft, summary);
  const amount = refundPreview(summary, draft.quantity);
  const shown = (key: keyof typeof errors, invalid: string) =>
    checked && errors[key] ? (errors[key] === 'required' ? text.required : invalid) : undefined;
  const set = (patch: Partial<RefundDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = refundRequest(draft, summary, requestId.current);
    if (!body) return;
    setPending(true);
    try {
      const result = await withReauthentication(
        () => api.post<ProductRefundSummaryResponse>(PATH(item.id), body),
        confirm,
      );
      const made = result.refunds.at(-1);
      await onDone(made?.code ?? '', made?.amountVnd ?? amount ?? '0');
    } catch (failure) {
      // Cancelling the password confirmation is not an error: nothing was saved.
      if (!(failure instanceof Error && failure.name === 'ReauthenticationCancelled')) {
        await onFail(failure);
        setError(refundErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      }
      setPending(false);
    }
  }

  return (
    <>
      <FormDialog
        title={f.title}
        description={f.description}
        labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
        busy={pending}
        dirty={draft.reason !== '' || draft.restock !== '' || draft.bankReference !== ''}
        error={error ? <Notice tone="error">{error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <Stack gap="page">
          <FormGrid>
            <Field
              label={f.quantity}
              hint={fill(f.quantityHint, { max: summary.caseRemainingQuantity })}
              error={shown('quantity', text.errors.fields.quantity)}
              required
            >
              {(control) => (
                <NumberInput
                  {...control}
                  value={draft.quantity}
                  onChange={(event) => set({ quantity: event.target.value })}
                />
              )}
            </Field>
            <Field label={f.method} required>
              {(control) => (
                <Select
                  {...control}
                  value={draft.method}
                  options={REFUND_METHODS.map((value) => ({ value, label: text.methods[value] }))}
                  onChange={(event) =>
                    set({ method: event.target.value as RefundDraft['method'], bankReference: '' })
                  }
                />
              )}
            </Field>
            {draft.method === 'BANK_TRANSFER_MANUAL' ? (
              <Field
                label={f.reference}
                hint={f.referenceHint}
                error={shown('bankReference', text.errors.fields.bankReference)}
                required
                full
              >
                {(control) => (
                  <TextInput
                    {...control}
                    autoComplete="off"
                    maxLength={64}
                    value={draft.bankReference}
                    onChange={(event) => set({ bankReference: event.target.value })}
                  />
                )}
              </Field>
            ) : null}
          </FormGrid>
          <RadioGroup
            legend={f.goods}
            name="refund-goods"
            value={draft.restock || null}
            required
            invalid={checked && errors.restock !== undefined}
            onValueChange={(restock) => set({ restock: restock as RefundDraft['restock'] })}
            options={[
              { value: 'SELLABLE', label: f.goodsSellable, hint: f.goodsSellableHint },
              {
                value: 'NOT_SELLABLE',
                label: f.goodsNotSellable,
                hint: f.goodsNotSellableHint,
              },
            ]}
          />
          {checked && errors.restock ? (
            <Notice tone="error">{text.errors.fields.restock}</Notice>
          ) : null}
          <FormGrid cols={1}>
            <Field
              label={f.reason}
              hint={f.reasonHint}
              error={shown('reason', text.errors.fields.reason)}
              required
              full
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={REFUND_REASON_MAX}
                  value={draft.reason}
                  onChange={(event) => set({ reason: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
          <Notice tone="info">
            {amount === null ? f.noAmount : fill(f.amount, { amount: formatVnd(amount, locale) })}
            {amount === null ? '' : ` ${f.amountHint}`}
          </Notice>
          <Notice tone="warning">{f.warning}</Notice>
          <p className="ls-hint">{f.pointsNote}</p>
        </Stack>
      </FormDialog>
      {dialog}
    </>
  );
}

/** Corrects a mistyped transfer reference by a new linked record; the refund itself never changes. */
export function CorrectionDialog({
  item,
  summary,
  onClose,
  onDone,
  onFail,
}: {
  item: ProductReturnCaseResponse;
  summary: ProductRefundSummaryResponse;
  onClose: () => void;
  onDone: () => Promise<void>;
  onFail: (error: unknown) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productRefundsDictionary(locale);
  const c = text.correct;
  const transfers = transferRefunds(summary);
  const [refundId, setRefundId] = useState(transfers.at(-1)?.id ?? '');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const referenceOk = /^[A-Za-z0-9._/-]{4,64}$/.test(reference.trim());
  const reasonOk = reason.trim() !== '' && [...reason.trim()].length <= REFUND_REASON_MAX;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    if (!refundId || !referenceOk || !reasonOk) return;
    setPending(true);
    try {
      await api.post(`${PATH(item.id)}/${refundId}/corrections`, {
        bankReference: reference.trim(),
        reason: reason.trim(),
      });
      await onDone();
    } catch (failure) {
      await onFail(failure);
      setError(refundErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={c.title}
      description={c.description}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
      busy={pending}
      dirty={reference !== '' || reason !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        {transfers.length > 1 ? (
          <Field label={c.which} required>
            {(control) => (
              <Select
                {...control}
                value={refundId}
                options={transfers.map((refund) => ({
                  value: refund.id,
                  label: `${refund.code} · ${refund.bankReference ?? ''}`,
                }))}
                onChange={(event) => setRefundId(event.target.value)}
              />
            )}
          </Field>
        ) : null}
        <Field
          label={c.reference}
          hint={text.form.referenceHint}
          error={checked && !referenceOk ? text.errors.fields.bankReference : undefined}
          required
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={64}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </Field>
        <Field
          label={c.reason}
          error={checked && !reasonOk ? text.errors.fields.reason : undefined}
          required
          full
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={REFUND_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

'use client';

import {
  PRODUCT_REFUND_REFERENCE,
  type ProductRefundResponse,
  type ProductRefundSummaryResponse,
  type ProductReturnCaseResponse,
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
import { ErrorState, Notice, Section } from '../ui';
import { metaLine, sentence } from './pos-format';
import { Code, factNodes, fillNodes } from './product-returns-facts';
import { focusFirstInvalid } from './pos-dom';

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
  // Money the cashier compares keeps tabular figures (wig :94-96).
  const figure = (value: string) => <span className="ls-pos-figure">{money(value)}</span>;
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
            ? [{ label: text.summary.paid, value: figure(summary.lineNetVnd) }]
            : []),
          { label: text.summary.refunded, value: figure(summary.lineRefundedVnd) },
        ]}
      />
      {summary.refunds.length === 0 ? (
        <p className="ls-hint">{text.empty}</p>
      ) : (
        <DescriptionList
          columns={1}
          items={summary.refunds.map((refund) => ({
            // The code names the refund; its amount opens the details in tabular figures, not glued into the label (wig :105).
            label: refund.code,
            value: (
              <>
                <p>{figure(refund.amountVnd)}</p>
                <RefundDetails refund={refund} when={when} />
              </>
            ),
          }))}
        />
      )}
    </Section>
  );
}

/** The card of the refunds before they arrive (and when they could not be loaded): its place is known from the case, so nothing jumps in later. */
export function RefundsPending({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: (() => Promise<void>) | undefined;
}) {
  const { t, locale } = useWorkforce();
  const text = productRefundsDictionary(locale);
  return (
    <Section title={text.title}>
      {error ? (
        <ErrorState error={error} t={t} {...(onRetry ? { onRetry: () => void onRetry() } : {})} />
      ) : (
        <p className="ls-hint" role="status">
          {text.loading}
        </p>
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
      {/* Facts as Intl lists and "label: value" as one dictionary template; only the codes are `translate="no"` (Step 7). */}
      <p>
        {factNodes(locale, [
          fill(r.fact, { label: r.quantity, value: refund.quantity }),
          text.methods[refund.method],
          refund.bankReference ? <Code>{refund.bankReference}</Code> : null,
        ])}
      </p>
      <p>
        {factNodes(locale, [
          text.restocks[refund.restock],
          refund.lotCodes.length > 0
            ? fillNodes(r.lots, {
                lots: factNodes(
                  locale,
                  refund.lotCodes.map((lot) => <Code key={lot}>{lot}</Code>),
                ),
              })
            : r.noStock,
        ])}
      </p>
      <p>{fill(r.fact, { label: r.points, value: points })}</p>
      <p>{fill(r.fact, { label: r.reason, value: refund.reason })}</p>
      {refund.corrections.length > 0 ? (
        <p className="ls-hint">
          {/* One dictionary sentence with an Intl list of the corrections (wig :188, :162 family). */}
          {fillNodes(r.correctionsList, {
            list: factNodes(
              locale,
              refund.corrections.map((correction) =>
                fillNodes(r.correctionLine, {
                  reference: <Code>{correction.bankReference}</Code>,
                  name: correction.actorName,
                  time: when(correction.occurredAt),
                }),
              ),
            ),
          })}
          {refund.firstBankReference ? (
            <>
              {' '}
              {fillNodes(r.referenceFirstWas, {
                reference: <Code>{refund.firstBankReference}</Code>,
              })}
            </>
          ) : null}
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
  const { confirm, dialog, asking } = useReauthentication();
  const [initialDraft] = useState<RefundDraft>(() => ({
    ...emptyRefundDraft(),
    quantity: String(Math.min(1, summary.caseRemainingQuantity) || 1),
  }));
  const [draft, setDraft] = useState<RefundDraft>(initialDraft);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The first id is made once, not on every render (rbp rerender-lazy-state-init).
  const [firstRequestId] = useState(() => globalThis.crypto.randomUUID());
  const requestId = useRef(firstRequestId);
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
    if (!body) return focusFirstInvalid();
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
        suspended={asking}
        title={f.title}
        description={f.description}
        labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
        busy={pending}
        // Any change counts, the quantity and the method included (wig :263).
        dirty={JSON.stringify(draft) !== JSON.stringify(initialDraft)}
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
                  inputMode="numeric"
                  min={1}
                  max={summary.caseRemainingQuantity}
                  step={1}
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
                    spellCheck={false}
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
          {/* The amount in tabular figures; the hint is its own sentence, not glued to it (wig :355, :356). */}
          <Notice tone="info">
            {amount === null ? (
              f.noAmount
            ) : (
              <>
                <span className="ls-pos-figure-text">
                  {sentence(fill(f.amount, { amount: formatVnd(amount, locale) }))}
                </span>{' '}
                <span>{f.amountHint}</span>
              </>
            )}
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
  // The shared reference pattern, made once (rbp js-hoist-regexp), same rule as the refund form.
  const referenceOk = PRODUCT_REFUND_REFERENCE.test(reference.trim());
  const reasonOk = reason.trim() !== '' && [...reason.trim()].length <= REFUND_REASON_MAX;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    if (!refundId || !referenceOk || !reasonOk) return focusFirstInvalid();
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
      // Any change counts, the chosen refund included (wig Forms: warn before losing changes).
      dirty={reference !== '' || reason !== '' || refundId !== (transfers.at(-1)?.id ?? '')}
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
                  // An option is plain text: the code and the reference as an Intl list.
                  label: metaLine(locale, [refund.code, refund.bankReference]),
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
              spellCheck={false}
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

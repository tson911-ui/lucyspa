'use client';

import type {
  InvoiceLinePriceRequest,
  InvoiceLineResponse,
  InvoicePaymentResponse,
  InvoiceResponse,
  PaymentPayosRequest,
  PaymentRecordRequest,
  PaymentReverseRequest,
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import {
  ConfirmDialog,
  type ConfirmError,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  MoneyInput,
  Select,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useState, type MutableRefObject } from 'react';
import { fill, type WorkforceDictionary } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { voucherCodeOf } from '../../../lib/workforce/discounts';
import { formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  cancelBody,
  changePreview,
  hasPriceRange,
  hasQuantity,
  lineInput,
  newPaymentKey,
  noteBody,
  paymentBody,
  paymentInput,
  payosBody,
  posErrorMessage,
  priceBody,
  priceRange,
  reverseBody,
  type PaymentInput,
  type PaymentProblem,
} from '../../../lib/workforce/pos';
import { useWorkforce } from '../session';
import { Notice } from '../ui';

// Every dialog here only collects a choice and hands it to the screen's `command()`, which sends it to the
// API exactly as the inline forms did. A dialog stays open when the command fails, so the same input (and,
// for money, the same idempotency key) can be retried; it closes only on success.

/** An idempotency key kept by the screen across closing and reopening a payment dialog. */
export type Attempt = MutableRefObject<{ key: string; amount: string; tendered: string } | null>;

/** A problem the dialog found before sending anything; `ConfirmDialog` shows it like a server refusal. */
class FormProblem extends Error {}

const errorNotice = (error: string | null) =>
  error ? <Notice tone="error">{error}</Notice> : undefined;

/** The refusal a `ConfirmDialog` shows: the POS texts, and the request reference for support. */
const describe =
  (t: WorkforceDictionary) =>
  (failure: unknown): ConfirmError =>
    failure instanceof FormProblem
      ? { message: failure.message }
      : {
          message: posErrorMessage(failure, t),
          reference: failure instanceof ApiError ? failure.requestId : null,
        };

/** One service line: price inside the historical range and/or the quantity, as the line permits. */
export function LineDialog({
  line,
  version,
  working,
  error,
  onSave,
  onClose,
}: {
  line: InvoiceLineResponse;
  version: number;
  working: boolean;
  error: string | null;
  onSave: (body: InvoiceLinePriceRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const initial = lineInput(line);
  const [input, setInput] = useState(initial);
  const [problem, setProblem] = useState<'price' | 'quantity' | 'unchanged' | null>(null);
  const choosesPrice = hasPriceRange(line);
  const choosesQuantity = hasQuantity(line);

  async function save() {
    const result = priceBody(line, input, version);
    if ('problem' in result) {
      setProblem(result.problem);
      return;
    }
    setProblem(null);
    if (await onSave(result.body)) onClose();
  }

  return (
    <FormDialog
      title={t.pos.editLine}
      description={locale === 'vi' ? line.nameVi : line.nameEn}
      labels={{ ...formOverlayLabels(t, t.pos.saveLine), submitting: t.pos.savingLine }}
      busy={working}
      dirty={input.price !== initial.price || input.quantity !== initial.quantity}
      error={
        problem === 'unchanged' ? (
          <Notice tone="error">{t.pos.unchanged}</Notice>
        ) : (
          errorNotice(error)
        )
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        {choosesPrice ? (
          <Field
            label={t.pos.priceLabel}
            hint={`${t.pos.colRange}: ${priceRange(line, locale)}`}
            {...(problem === 'price' ? { error: t.pos.invalidPrice } : {})}
          >
            {(control) => (
              <VndInput
                control={control}
                value={input.price}
                onChange={(price) => setInput({ ...input, price })}
              />
            )}
          </Field>
        ) : null}
        {choosesQuantity ? (
          <Field
            label={t.pos.quantityLabel}
            hint={fill(t.pos.quantityLimit, { limit: line.quantityLimit })}
            {...(problem === 'quantity' ? { error: t.pos.invalidQuantity } : {})}
          >
            {(control) => (
              <TextInput
                {...control}
                className="ls-input-number"
                inputMode="numeric"
                autoComplete="off"
                maxLength={9}
                value={input.quantity}
                onChange={(event) => setInput({ ...input, quantity: event.target.value })}
              />
            )}
          </Field>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/** A promo code typed by the cashier (never an amount or a percentage). */
export function VoucherDialog({
  working,
  error,
  onApply,
  onClose,
}: {
  working: boolean;
  error: string | null;
  onApply: (code: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const [text, setText] = useState('');
  const [missing, setMissing] = useState(false);

  async function apply() {
    const code = voucherCodeOf(text);
    if (!code) {
      setMissing(true);
      return;
    }
    setMissing(false);
    if (await onApply(code)) onClose();
  }

  return (
    <FormDialog
      title={t.pos.voucherEnter}
      labels={{ ...formOverlayLabels(t, t.pos.voucherApply), submitting: t.pos.voucherApplying }}
      busy={working}
      dirty={text !== ''}
      error={errorNotice(error)}
      onClose={onClose}
      onSubmit={apply}
    >
      <FormGrid>
        <Field
          label={t.pos.voucherCode}
          hint={t.pos.voucherHint}
          {...(missing ? { error: t.pos.voucherNeedCode } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={64}
              value={text}
              onChange={(event) => setText(event.target.value.toUpperCase())}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/**
 * Find a member by the exact phone or email. One primary button: "Search" until a member is found, then
 * "Choose as payer"; changing the text goes back to searching, exactly like the inline form did.
 */
export function PayerDialog({
  invoice,
  working,
  error,
  onSetPayer,
  onClose,
}: {
  invoice: InvoiceResponse;
  working: boolean;
  error: string | null;
  onSetPayer: (payerUserId: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { api, t } = useWorkforce();
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const member = lookup?.members[0] ?? null;

  async function submit() {
    if (member) {
      if (await onSetPayer(member.id)) onClose();
      return;
    }
    if (!value.trim() || searching) return;
    setSearching(true);
    setSearchError(null);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(
          `/api/v1/pos/branches/${invoice.branch.id}/members`,
          { [lookupBy]: value.trim() },
        ),
      );
    } catch (failure) {
      setLookup(null);
      setSearchError(posErrorMessage(failure, t));
    } finally {
      setSearching(false);
    }
  }

  const label = member ? t.pos.setPayer : t.pos.search;
  return (
    <FormDialog
      title={t.pos.payerFind}
      description={t.pos.payerHint}
      labels={{
        ...formOverlayLabels(t, label),
        submitting: member ? t.common.saving : t.pos.searching,
      }}
      busy={working || searching}
      dirty={value !== ''}
      submitDisabled={member !== null && invoice.payer?.id === member.id}
      error={errorNotice(searchError ?? error)}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={t.pos.lookupBy}>
          {(control) => (
            <Select
              {...control}
              value={lookupBy}
              options={[
                { value: 'phone', label: t.pos.phone },
                { value: 'email', label: t.pos.email },
              ]}
              onChange={(event) => (
                setLookupBy(event.target.value as 'phone' | 'email'),
                setLookup(null)
              )}
            />
          )}
        </Field>
        <Field label={lookupBy === 'phone' ? t.pos.phone : t.pos.email}>
          {(control) => (
            <TextInput
              {...control}
              type={lookupBy === 'phone' ? 'tel' : 'email'}
              inputMode={lookupBy === 'phone' ? 'tel' : 'email'}
              autoComplete="off"
              maxLength={lookupBy === 'phone' ? 32 : 320}
              value={value}
              onChange={(event) => (setValue(event.target.value), setLookup(null))}
            />
          )}
        </Field>
        {member ? (
          <Notice tone="success">
            {fill(t.pos.found, { name: member.displayName })}
            {member.phoneMasked ? ` · ${member.phoneMasked}` : ''}
            {member.emailMasked ? ` · ${member.emailMasked}` : ''}
          </Notice>
        ) : null}
        {lookup && lookup.members.length === 0 ? (
          <Notice tone="info">{t.pos.notFound}</Notice>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/**
 * An amount in whole đồng typed with thousands separators ("329.000"): the screens keep the digits as a string, as before, so the
 * request the dialog builds is unchanged. An empty field is "".
 */
function VndInput({
  control,
  value,
  onChange,
}: {
  control: object;
  value: string;
  onChange: (digits: string) => void;
}) {
  const number = value === '' ? null : Number(value);
  return (
    <MoneyInput
      {...control}
      unit="₫"
      value={number !== null && Number.isSafeInteger(number) ? number : null}
      onValueChange={(next) => onChange(next === null ? '' : String(next))}
    />
  );
}

/** Cash: the credited amount (default the whole cash-collectable balance) and what was handed over. */
export function CashDialog({
  balance,
  attempt,
  working,
  error,
  onCollect,
  onClose,
}: {
  balance: string;
  attempt: Attempt;
  working: boolean;
  error: string | null;
  onCollect: (body: PaymentRecordRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const [input, setInput] = useState<PaymentInput>(() => paymentInput(balance));
  const [problem, setProblem] = useState<PaymentProblem | null>(null);
  const change = changePreview(input);

  async function submit() {
    // One idempotency key per intended payment: a retry of the same choice reuses it (the server then
    // returns the stored payment instead of collecting twice); another choice gets a new one.
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
    if (await onCollect(result.body)) {
      attempt.current = null;
      onClose();
    }
  }

  const initial = paymentInput(balance);
  return (
    <FormDialog
      title={t.pos.collectTitle}
      labels={{ ...formOverlayLabels(t, t.pos.collect), submitting: t.pos.collecting }}
      busy={working}
      dirty={input.amount !== initial.amount || input.tendered !== initial.tendered}
      error={errorNotice(error)}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={t.pos.amountLabel}
          hint={t.pos.amountHint}
          {...(problem === 'amount' ? { error: t.pos.invalidAmount } : {})}
        >
          {(control) => (
            <VndInput
              control={control}
              value={input.amount}
              onChange={(amount) => {
                // Keep "exact tender" while the cashier has not typed a different tender.
                setInput((current) => ({
                  amount,
                  tendered: current.tendered === current.amount ? amount : current.tendered,
                }));
              }}
            />
          )}
        </Field>
        <Field
          label={t.pos.tenderedLabel}
          {...(problem === 'tendered'
            ? { error: t.pos.invalidTendered }
            : problem === 'tenderLow'
              ? { error: t.pos.tenderTooLow }
              : {})}
        >
          {(control) => (
            <VndInput
              control={control}
              value={input.tendered}
              onChange={(tendered) => setInput({ ...input, tendered })}
            />
          )}
        </Field>
        {change !== null ? (
          <DescriptionList
            layout="totals"
            items={[{ label: t.pos.colChange, value: formatVnd(change, locale), strong: true }]}
          />
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/** PayOS: the amount (default the whole balance; less is a split with cash). One idempotency key per choice. */
export function PayosDialog({
  balance,
  attempt,
  working,
  error,
  onCreate,
  onClose,
}: {
  balance: string;
  attempt: Attempt;
  working: boolean;
  error: string | null;
  onCreate: (body: PaymentPayosRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const [amount, setAmount] = useState(balance);
  const [problem, setProblem] = useState(false);

  async function submit() {
    if (!attempt.current || attempt.current.amount !== amount) {
      attempt.current = { key: newPaymentKey(), amount, tendered: '' };
    }
    const result = payosBody(amount, balance, attempt.current.key);
    if ('problem' in result) {
      setProblem(true);
      return;
    }
    setProblem(false);
    if (await onCreate(result.body)) {
      attempt.current = null;
      onClose();
    }
  }

  return (
    <FormDialog
      title={t.pos.payosCreate}
      description={t.pos.payosNote}
      labels={{ ...formOverlayLabels(t, t.pos.payosCreate), submitting: t.pos.payosCreating }}
      busy={working}
      dirty={amount !== balance}
      error={errorNotice(error)}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field
          label={t.pos.amountLabel}
          hint={t.pos.amountHint}
          {...(problem ? { error: t.pos.invalidAmount } : {})}
        >
          {(control) => <VndInput control={control} value={amount} onChange={setAmount} />}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** A note on the invoice, or the review note of an anomaly: 1-500 characters. */
export function NoteDialog({
  title,
  label,
  problemText,
  submitLabel,
  submittingLabel,
  working,
  error,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  problemText: string;
  submitLabel: string;
  submittingLabel: string;
  working: boolean;
  error: string | null;
  onSave: (note: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const [text, setText] = useState('');
  const [problem, setProblem] = useState(false);

  async function save() {
    const body = noteBody(text);
    if (!body) {
      setProblem(true);
      return;
    }
    setProblem(false);
    if (await onSave(body.note)) onClose();
  }

  return (
    <FormDialog
      title={title}
      labels={{ ...formOverlayLabels(t, submitLabel), submitting: submittingLabel }}
      busy={working}
      dirty={text !== ''}
      error={errorNotice(error)}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={label}
          required
          requiredLabel={t.common.required}
          {...(problem ? { error: problemText } : {})}
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={text}
              onChange={(event) => setText(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

/** Reversal of an erroneous payment: a reason, then the actor's own password when the API asks. */
export function ReverseConfirm({
  payment,
  onReverse,
  onClose,
}: {
  payment: InvoicePaymentResponse;
  onReverse: (paymentId: string, body: PaymentReverseRequest) => Promise<void>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  return (
    <ConfirmDialog
      title={t.pos.reverseTitle}
      description={t.pos.reverseHint}
      facts={[
        { label: t.pos.colCredited, value: formatVnd(payment.amountVnd, locale) },
        { label: t.pos.colCollector, value: payment.collectedBy.displayName },
      ]}
      tone="danger"
      confirmLabel={t.pos.reverse}
      busyLabel={t.pos.reversing}
      cancelLabel={t.pos.reverseKeep}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: t.pos.reverseReason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: t.pos.needReverseReason,
      }}
      describeError={describe(t)}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const body = reverseBody(reason ?? '');
        if (!body) throw new FormProblem(t.pos.needReverseReason);
        await onReverse(payment.id, body);
        onClose();
      }}
    />
  );
}

/** Cancellation of the invoice: a reason, then the actor's own password for a finalized invoice. */
export function CancelConfirm({
  invoice,
  onCancelInvoice,
  onClose,
}: {
  invoice: InvoiceResponse;
  onCancelInvoice: (body: NonNullable<ReturnType<typeof cancelBody>>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useWorkforce();
  const needsReauth = invoice.actions.cancelNeedsReauth;
  return (
    <ConfirmDialog
      title={t.pos.cancelTitle}
      description={
        needsReauth
          ? `${fill(t.pos.cancelConfirmBody, { code: invoice.code })} ${t.pos.cancelNeedsReauth}`
          : fill(t.pos.cancelConfirmBody, { code: invoice.code })
      }
      facts={[{ label: t.pos.code, value: invoice.code }]}
      tone="danger"
      confirmLabel={t.pos.cancel}
      busyLabel={t.pos.cancelling}
      cancelLabel={t.common.cancel}
      referenceLabel={t.errors.reference}
      reasonField={{
        label: t.pos.cancelReason,
        required: true,
        requiredLabel: t.common.required,
        requiredMessage: t.pos.needReason,
        hint: t.pos.cancelReasonHint,
      }}
      describeError={describe(t)}
      onCancel={onClose}
      onConfirm={async (reason) => {
        const body = cancelBody(reason ?? '', invoice.version);
        if (!body) throw new FormProblem(t.pos.needReason);
        await onCancelInvoice(body);
        onClose();
      }}
    />
  );
}

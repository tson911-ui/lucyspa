'use client';

import type {
  ProductExchangeOptionsResponse,
  ProductExchangePreviewResponse,
  ProductExchangeResponse,
  ProductExchangeSummaryResponse,
  ProductReturnCaseResponse,
} from '@lucy-spa/contracts';
import {
  Combobox,
  DescriptionList,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  RadioGroup,
  RowActions,
  Select,
  Stack,
  Textarea,
  TextInput,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import { productExchangesDictionary } from '../../../i18n/product-exchanges';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { resultsText } from '../../../lib/workforce/list-view';
import {
  completableExchanges,
  completeRequest,
  emptyExchangeDraft,
  EXCHANGE_METHODS,
  EXCHANGE_REASON_MAX,
  exchangeErrorText,
  exchangeNeeds,
  exchangeOptionLabel,
  exchangeRequest,
  transferExchanges,
  validateExchangeDraft,
  type ExchangeDraft,
} from '../../../lib/workforce/product-exchanges';
import { productTitle } from '../../../lib/workforce/product-sale';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import { Button, ErrorState, Notice, Section } from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';
const PATH = (caseId: string) => `/api/v1/product-returns/cases/${caseId}/exchanges`;

/** The exchanges of a case: each with the new goods, the money, the invoice, the goods taken in and the points. Shown to REFUND_PRODUCTS holders only. */
export function ExchangesSection({
  summary,
  onComplete,
  onCorrect,
}: {
  summary: ProductExchangeSummaryResponse;
  /** Opens the completion form (offered while an exchange waits for the old goods). */
  onComplete: () => void;
  /** Opens the reference correction form (only offered when a transfer refund exists). */
  onCorrect: () => void;
}) {
  const { locale, base } = useWorkforce();
  const text = productExchangesDictionary(locale);
  const money = (value: string) => formatVnd(value, locale);
  const when = (instant: string) => formatDateTime(instant, ZONE, locale);
  // The exchange of this very case that is not finished says so itself (its status); the line notice is for another exchange's claim.
  const ownOpen =
    summary.blocked === 'OPEN_EXCHANGE' &&
    summary.exchanges.some(
      (exchange) =>
        exchange.status === 'AWAITING_PAYMENT' || exchange.status === 'AWAITING_COMPLETION',
    );
  return (
    <Section
      title={text.title}
      actions={
        <>
          {summary.can.complete ? (
            <Button variant="secondary" onClick={onComplete}>
              {text.complete.action}
            </Button>
          ) : null}
          {summary.can.correctReference ? (
            <RowActions
              menuLabel={text.title}
              items={[{ id: 'correct', label: text.correct.action, onSelect: onCorrect }]}
            />
          ) : null}
        </>
      }
    >
      {summary.blocked && summary.blocked !== 'ALREADY_EXCHANGED' && !ownOpen ? (
        <Notice tone="info">{text.blocked[summary.blocked]}</Notice>
      ) : null}
      <DescriptionList
        columns={2}
        items={[
          { label: text.summary.quantity, value: summary.caseQuantity },
          ...(summary.creditVnd !== null
            ? [{ label: text.summary.credit, value: money(summary.creditVnd) }]
            : []),
        ]}
      />
      {summary.exchanges.length === 0 ? (
        <p className="ls-hint">{text.empty}</p>
      ) : (
        <DescriptionList
          columns={1}
          items={summary.exchanges.map((exchange) => ({
            label: `${exchange.code} · ${text.statuses[exchange.status]}`,
            value: <ExchangeDetails exchange={exchange} base={base} when={when} />,
          }))}
        />
      )}
    </Section>
  );
}

/** The card of the exchanges before they arrive (and when they could not be loaded): its place is known from the case, so nothing jumps in later. */
export function ExchangesPending({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: (() => Promise<void>) | undefined;
}) {
  const { t, locale } = useWorkforce();
  const text = productExchangesDictionary(locale);
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

function ExchangeDetails({
  exchange,
  base,
  when,
}: {
  exchange: ProductExchangeResponse;
  base: string;
  when: (instant: string) => string;
}) {
  const { locale } = useWorkforce();
  const text = productExchangesDictionary(locale);
  const e = text.exchange;
  const money = (value: string) => formatVnd(value, locale);
  const points =
    exchange.beautyPointsEarned === null || exchange.beautyPointsEarned === 0
      ? e.pointsNone
      : fill(e.pointsEarned, { points: exchange.beautyPointsEarned });
  const difference =
    exchange.payableVnd !== '0'
      ? `${e.payable}: ${money(exchange.payableVnd)}`
      : exchange.refundVnd !== '0'
        ? `${e.refund}: ${money(exchange.refundVnd)}`
        : e.none;
  return (
    <>
      <p className="ls-hint">
        {fill(e.when, { name: exchange.actorName, time: when(exchange.occurredAt) })}
      </p>
      <p>
        {e.replacement}:{' '}
        {fill(e.replacementLine, {
          name: productTitle(
            {
              nameVi: exchange.replacement.nameVi,
              nameEn: exchange.replacement.nameEn,
              variantLabelVi: exchange.replacement.variantLabelVi,
              variantLabelEn: exchange.replacement.variantLabelEn,
            },
            locale,
          ),
          sku: exchange.replacement.sku,
          quantity: exchange.quantity,
          price: money(exchange.replacement.unitPriceVnd),
        })}
      </p>
      <p>
        {e.credit}: {money(exchange.creditVnd)} · {difference}
      </p>
      <p>{text.rules[exchange.rule]}</p>
      {exchange.refund ? (
        <p>
          {text.methods[exchange.refund.method]}
          {exchange.refund.bankReference ? ` · ${exchange.refund.bankReference}` : ''}
        </p>
      ) : null}
      <p>
        {e.invoice}:{' '}
        <Link className="ls-link" href={`${base}/pos/${exchange.invoice.id}`}>
          {fill(e.invoiceLine, {
            code: exchange.invoice.code,
            total: money(exchange.invoice.totalVnd),
          })}
        </Link>
        {exchange.invoice.balanceVnd !== '0'
          ? ` · ${fill(e.invoiceBalance, { amount: money(exchange.invoice.balanceVnd) })}`
          : ''}
      </p>
      <p>
        {e.goods}:{' '}
        {exchange.completion
          ? `${text.restocks[exchange.completion.restock]} · ${
              exchange.completion.lotCodes.length > 0
                ? fill(e.lots, { lots: exchange.completion.lotCodes.join(', ') })
                : e.noStock
            }`
          : exchange.status === 'CANCELLED'
            ? e.noStock
            : e.goodsPending}
      </p>
      <p>
        {e.points}: {points}
      </p>
      <p>
        {e.reason}: {exchange.reason}
      </p>
      {exchange.refund && exchange.refund.corrections.length > 0 ? (
        <p className="ls-hint">
          {e.corrections}:{' '}
          {exchange.refund.corrections
            .map((correction) =>
              fill(e.correctionLine, {
                reference: correction.bankReference,
                name: correction.actorName,
                time: when(correction.occurredAt),
              }),
            )
            .join('; ')}
          {exchange.refund.firstBankReference
            ? ` (${e.referenceFirst}: ${exchange.refund.firstBankReference})`
            : ''}
        </p>
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------ the exchange form

/**
 * The replacement search: items in stock with today's price, sent a moment after the person stops typing; a late answer to an older
 * search is ignored. The list is advisory: the API checks the stock, the price and the seller again when the exchange is made.
 */
function useExchangeOptions(caseId: string) {
  const { api } = useWorkforce();
  const [query, setQuery] = useState('');
  const [data, setData] = useState<ProductExchangeOptionsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(
      async () => {
        setLoading(true);
        try {
          const response = await api.get<ProductExchangeOptionsResponse>(
            `${PATH(caseId)}/options`,
            query.trim() ? { q: query.trim() } : {},
          );
          if (current) {
            setData(response);
            setError(null);
          }
        } catch (failure) {
          if (current) setError(failure);
        } finally {
          if (current) setLoading(false);
        }
      },
      query === '' ? 0 : 250,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [api, caseId, query]);
  return { data, loading, error, setQuery };
}

/** The figures of the exchange for the chosen goods, from the API (read only; they are sent back as the figures that were shown). */
function useExchangePreview(caseId: string, variantId: string | null) {
  const { api } = useWorkforce();
  const [preview, setPreview] = useState<ProductExchangePreviewResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [stamp, setStamp] = useState(0);
  useEffect(() => {
    if (!variantId) {
      setPreview(null);
      setError(null);
      return;
    }
    let current = true;
    setPreview(null);
    api
      .get<ProductExchangePreviewResponse>(`${PATH(caseId)}/preview`, { variantId })
      .then((response) => {
        if (current) {
          setPreview(response);
          setError(null);
        }
      })
      .catch((failure: unknown) => {
        if (current) setError(failure);
      });
    return () => {
      current = false;
    };
  }, [api, caseId, variantId, stamp]);
  return { preview, error, refresh: () => setStamp((value) => value + 1) };
}

/**
 * "Đổi hàng": the exchange form. Search the new goods (in stock), see the figures (what the customer paid, today's price, what they pay
 * more or what is handed back), say whether the old goods can be sold again when nothing is to be paid, and the reason. Nobody types an
 * amount or a price; the password is asked for by the shared confirmation when the API says so, and the request id is made once so a
 * retry can never exchange twice.
 */
export function ExchangeDrawer({
  item,
  onClose,
  onDone,
  onFail,
}: {
  item: ProductReturnCaseResponse;
  onClose: () => void;
  onDone: (code: string) => Promise<void>;
  onFail: (error: unknown) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productExchangesDictionary(locale);
  const f = text.form;
  const { confirm, dialog } = useReauthentication();
  const options = useExchangeOptions(item.id);
  const [draft, setDraft] = useState<ExchangeDraft>(() => emptyExchangeDraft(null));
  const loaded = options.data;
  const view = useExchangePreview(item.id, draft.option?.variantId ?? null);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(globalThis.crypto.randomUUID());
  const set = (patch: Partial<ExchangeDraft>) => setDraft((state) => ({ ...state, ...patch }));
  // The seller starts as the one the API proposes (the seller of the old line, else the person) once the list is known.
  useEffect(() => {
    if (loaded?.defaultSellerUserId) {
      setDraft((state) =>
        state.sellerUserId === '' ? { ...state, sellerUserId: loaded.defaultSellerUserId! } : state,
      );
    }
  }, [loaded?.defaultSellerUserId]);
  const results = useMemo(() => {
    const list = loaded?.options ?? [];
    const chosen = draft.option;
    return chosen && !list.some((option) => option.variantId === chosen.variantId)
      ? [chosen, ...list]
      : list;
  }, [loaded, draft.option]);
  const needSeller = !loaded?.defaultSellerUserId;
  const preview = view.preview;
  const needs = exchangeNeeds(preview);
  const errors = validateExchangeDraft(draft, preview, needSeller);
  const shown = (key: keyof typeof errors, invalid: string) =>
    checked && errors[key] ? (errors[key] === 'required' ? text.required : invalid) : undefined;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = exchangeRequest(draft, preview, needSeller, requestId.current);
    if (!body) return;
    setPending(true);
    try {
      const result = await withReauthentication(
        () => api.post<ProductExchangeSummaryResponse>(PATH(item.id), body),
        confirm,
      );
      await onDone(result.exchanges.at(-1)?.code ?? '');
    } catch (failure) {
      // Cancelling the password confirmation is not an error: nothing was saved.
      if (!(failure instanceof Error && failure.name === 'ReauthenticationCancelled')) {
        await onFail(failure);
        const code = (failure as { code?: unknown }).code;
        if (code === 'EXCHANGE_FIGURES_CHANGED') {
          // The figures moved: show the new ones and let the person decide again with a new request.
          requestId.current = globalThis.crypto.randomUUID();
          view.refresh();
        }
        setError(exchangeErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      }
      setPending(false);
    }
  }

  const money = (value: string) => formatVnd(value, locale);
  const failedLoad = !loaded && options.error ? errorMessage(options.error, t) : null;
  return (
    <>
      <FormDrawer
        title={f.title}
        labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
        busy={pending}
        dirty={draft.option !== null || draft.reason !== ''}
        submitDisabled={!loaded}
        error={
          error || failedLoad ? <Notice tone="error">{error ?? failedLoad}</Notice> : undefined
        }
        onClose={onClose}
        onSubmit={submit}
      >
        <Stack gap="page">
          <p className="ls-hint">{f.description}</p>
          <FormGrid cols={1}>
            <Field
              label={f.product}
              hint={loaded?.truncated ? f.more : f.productHint}
              error={
                shown('option', text.errors.fields.variantId) ??
                (checked && errors.stock ? f.needStock : undefined)
              }
              required
              full
            >
              {(control) => (
                <Combobox
                  {...control}
                  options={results.map((option) => ({
                    value: option.variantId,
                    label: exchangeOptionLabel(option, locale),
                    disabled: option.available < item.quantity,
                  }))}
                  value={draft.option?.variantId ?? null}
                  onValueChange={(value) =>
                    set({ option: results.find((option) => option.variantId === value) ?? null })
                  }
                  onQueryChange={options.setQuery}
                  loading={options.loading}
                  loadingLabel={f.loading}
                  emptyLabel={f.none}
                  placeholder={f.searchPlaceholder}
                  resultsLabel={(count) => resultsText(t, count)}
                />
              )}
            </Field>
          </FormGrid>
          {draft.option && !preview && !view.error ? (
            <p className="ls-hint" role="status">
              {f.loading}
            </p>
          ) : null}
          {view.error ? (
            <Notice tone="error">
              {exchangeErrorText(view.error, locale, (e) => errorMessage(e, t))}
            </Notice>
          ) : null}
          {preview ? (
            <>
              <DescriptionList
                columns={1}
                items={[
                  { label: f.credit, value: money(preview.creditVnd) },
                  {
                    label: f.gross,
                    value: `${money(preview.replacementGrossVnd)} (${preview.quantity} × ${money(preview.option.unitPriceVnd)})`,
                  },
                  needs.payable
                    ? { label: f.payable, value: <strong>{money(preview.payableVnd)}</strong> }
                    : needs.refund
                      ? { label: f.refund, value: <strong>{money(preview.refundVnd)}</strong> }
                      : { label: f.figures, value: <strong>{f.none0}</strong> },
                ]}
              />
              {preview.rule === 'SAME_ITEM' ? <Notice tone="info">{f.sameItem}</Notice> : null}
              <Notice tone="info">
                {needs.payable ? f.payableNote : needs.refund ? f.refundNote : f.equalNote}
              </Notice>
            </>
          ) : null}
          <FormGrid>
            <Field
              label={f.seller}
              hint={f.sellerHint}
              error={shown('seller', text.errors.fields.sellerUserId)}
              required={needSeller}
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.sellerUserId}
                  placeholder={f.sellerPlaceholder}
                  options={(loaded?.sellers ?? []).map((seller) => ({
                    value: seller.userId,
                    label: seller.displayName,
                  }))}
                  onChange={(event) => set({ sellerUserId: event.target.value })}
                />
              )}
            </Field>
            {needs.refund ? (
              <Field label={f.method} required>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.refundMethod}
                    options={EXCHANGE_METHODS.map((value) => ({
                      value,
                      label: text.methods[value],
                    }))}
                    onChange={(event) =>
                      set({
                        refundMethod: event.target.value as ExchangeDraft['refundMethod'],
                        bankReference: '',
                      })
                    }
                  />
                )}
              </Field>
            ) : null}
            {needs.refund && draft.refundMethod === 'BANK_TRANSFER_MANUAL' ? (
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
          {needs.restock ? (
            <>
              <RadioGroup
                legend={f.goods}
                name="exchange-goods"
                value={draft.restock || null}
                required
                invalid={checked && errors.restock !== undefined}
                onValueChange={(restock) => set({ restock: restock as ExchangeDraft['restock'] })}
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
            </>
          ) : needs.payable ? (
            <p className="ls-hint">{f.goodsLater}</p>
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
                  maxLength={EXCHANGE_REASON_MAX}
                  value={draft.reason}
                  onChange={(event) => set({ reason: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
          <Notice tone="warning">{f.warning}</Notice>
          <p className="ls-hint">{f.pointsNote}</p>
        </Stack>
      </FormDrawer>
      {dialog}
    </>
  );
}

// -------------------------------------------------------------------------------------- complete

/** Takes the old goods in once the exchange invoice is paid: whether they can be sold again. Nothing else changes. */
export function CompleteExchangeDialog({
  item,
  summary,
  onClose,
  onDone,
  onFail,
}: {
  item: ProductReturnCaseResponse;
  summary: ProductExchangeSummaryResponse;
  onClose: () => void;
  onDone: () => Promise<void>;
  onFail: (error: unknown) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productExchangesDictionary(locale);
  const c = text.complete;
  const target = completableExchanges(summary).at(-1);
  const [restock, setRestock] = useState<'SELLABLE' | 'NOT_SELLABLE' | ''>('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (pending || !target) return;
    setChecked(true);
    setError(null);
    const body = completeRequest(restock);
    if (!body) return;
    setPending(true);
    try {
      await api.post(`${PATH(item.id)}/${target.id}/completion`, body);
      await onDone();
    } catch (failure) {
      await onFail(failure);
      setError(exchangeErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={c.title}
      description={c.description}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
      busy={pending}
      dirty={restock !== ''}
      submitDisabled={!target}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        {target ? (
          <DescriptionList
            columns={1}
            items={[{ label: c.which, value: `${target.code} · ${target.invoice.code}` }]}
          />
        ) : null}
        <RadioGroup
          legend={text.form.goods}
          name="complete-goods"
          value={restock || null}
          required
          invalid={checked && restock === ''}
          onValueChange={(value) => setRestock(value as 'SELLABLE' | 'NOT_SELLABLE')}
          options={[
            {
              value: 'SELLABLE',
              label: text.form.goodsSellable,
              hint: text.form.goodsSellableHint,
            },
            {
              value: 'NOT_SELLABLE',
              label: text.form.goodsNotSellable,
              hint: text.form.goodsNotSellableHint,
            },
          ]}
        />
        {checked && restock === '' ? (
          <Notice tone="error">{text.errors.fields.restock}</Notice>
        ) : null}
      </Stack>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------- correction

/** Corrects a mistyped transfer reference of the money an exchange handed back, by a new linked record; the exchange itself never changes. */
export function ExchangeCorrectionDialog({
  item,
  summary,
  onClose,
  onDone,
  onFail,
}: {
  item: ProductReturnCaseResponse;
  summary: ProductExchangeSummaryResponse;
  onClose: () => void;
  onDone: () => Promise<void>;
  onFail: (error: unknown) => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productExchangesDictionary(locale);
  const c = text.correct;
  const transfers = transferExchanges(summary);
  const [exchangeId, setExchangeId] = useState(transfers.at(-1)?.id ?? '');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const referenceOk = /^[A-Za-z0-9._/-]{4,64}$/.test(reference.trim());
  const reasonOk = reason.trim() !== '' && [...reason.trim()].length <= EXCHANGE_REASON_MAX;

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    if (!exchangeId || !referenceOk || !reasonOk) return;
    setPending(true);
    try {
      await api.post(`${PATH(item.id)}/${exchangeId}/corrections`, {
        bankReference: reference.trim(),
        reason: reason.trim(),
      });
      await onDone();
    } catch (failure) {
      await onFail(failure);
      setError(exchangeErrorText(failure, locale, (cause) => errorMessage(cause, t)));
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
                value={exchangeId}
                options={transfers.map((exchange) => ({
                  value: exchange.id,
                  label: `${exchange.code} · ${exchange.refund?.bankReference ?? ''}`,
                }))}
                onChange={(event) => setExchangeId(event.target.value)}
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
              maxLength={EXCHANGE_REASON_MAX}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

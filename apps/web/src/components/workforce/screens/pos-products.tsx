'use client';

import type {
  InvoiceProductLineAddRequest,
  ProductLineModeName,
  InvoiceProductLineResponse,
  InvoiceProductLineUpdateRequest,
  InvoiceResponse,
  InvoiceSideDiscount,
  InvoiceOpenedResponse,
  PosProductOption,
  PosProductOptionsResponse,
  WalkInMemberLookupResponse,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  Combobox,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  RadioGroup,
  RowActions,
  Select,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { memo, useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { productSaleDictionary } from '../../../i18n/product-sale';
import { fill } from '../../../i18n/workforce';
import { formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { resultsText } from '../../../lib/workforce/list-view';
import { posErrorMessage } from '../../../lib/workforce/pos';
import { leadTimeText } from '../../../lib/workforce/product-orders';
import {
  addBody,
  optionLabel,
  parseQuantity,
  productTitle,
  stockTone,
  updateBody,
  type AddProblem,
} from '../../../lib/workforce/product-sale';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, Loading, Notice } from '../ui';
import { listFormat, metaLine, minusMoney } from './pos-format';
import { focusFirstInvalid } from './pos-dom';

const errorNotice = (error: string | null) =>
  error ? <Notice tone="error">{error}</Notice> : undefined;

/** The quantity typed, or a value no stock can cover when it is not a number (so a hint about stock never shows for it). */
const parseQuantityValue = (text: string): number =>
  parseQuantity(text) ?? Number.POSITIVE_INFINITY;

// ------------------------------------------------------------------------------------ product search

/**
 * The products the counter can add and the staff who may be the seller, from the server (SELL_PRODUCTS at the branch). The search
 * is sent a moment after the cashier stops typing; a late answer to an older search is ignored. The list is advisory: the API checks
 * the stock, the price and the seller again when the line is added.
 */
// The same search at the same branch within 30 s is answered from memory: opening "Thêm sản phẩm" and then "Sửa" (which only
// needs the sellers) does not ask the server twice (rbp client-swr-dedup, pos-products.tsx:64-98, :459-463).
const OPTIONS_TTL_MS = 30_000;
const optionsCache = new Map<string, { at: number; data: PosProductOptionsResponse }>();

function useProductOptions(branchId: string) {
  const { api } = useWorkforce();
  const [query, setQuery] = useState('');
  const key = `${branchId}|${query.trim()}`;
  // The last answer (kept on screen while the next search runs); "loading" is derived, not a flag set by hand (rbp :67-89).
  const [answer, setAnswer] = useState<{
    key: string;
    data: PosProductOptionsResponse | null;
    error: unknown;
  } | null>(null);
  useEffect(() => {
    const cached = optionsCache.get(key);
    if (cached && Date.now() - cached.at < OPTIONS_TTL_MS) {
      setAnswer({ key, data: cached.data, error: null });
      return;
    }
    let current = true;
    const timer = window.setTimeout(
      async () => {
        try {
          const response = await api.get<PosProductOptionsResponse>(
            `/api/v1/pos/branches/${branchId}/products`,
            query.trim() ? { q: query.trim() } : {},
          );
          optionsCache.set(key, { at: Date.now(), data: response });
          if (current) setAnswer({ key, data: response, error: null });
        } catch (failure) {
          if (current) setAnswer((last) => ({ key, data: last?.data ?? null, error: failure }));
        }
      },
      query === '' ? 0 : 250,
    );
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [api, branchId, query, key]);
  return {
    data: answer?.data ?? null,
    loading: answer?.key !== key,
    error: answer?.key === key ? answer.error : null,
    setQuery,
  };
}

// ------------------------------------------------------------------------------------ the lines card

/** The product lines of an invoice: price, quantity, seller and the state of the stock; a draft adds, edits and removes them. */
export function ProductLinesCard({
  invoice,
  idle,
  onAdd,
  onEdit,
  onRemove,
  undo,
  footer,
}: {
  invoice: InvoiceResponse;
  idle: boolean;
  onAdd: () => void;
  onEdit: (lineId: string) => void;
  onRemove: (lineId: string) => void;
  /** C72: the "removed, undo" line shown right above the table after a line was removed (inline first, H11). */
  undo?: ReactNode;
  footer?: ReactNode;
}) {
  const { t, locale } = useWorkforce();
  const d = productSaleDictionary(locale);
  const o = productOrdersDictionary(locale);
  const l = d.lines;
  const draft = invoice.status === 'DRAFT';
  const editable = draft && invoice.actions.sellProducts;
  const columns: DataTableColumn<InvoiceProductLineResponse>[] = [
    {
      key: 'product',
      header: l.colProduct,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      cell: (line) => (
        <>
          {productTitle(line, locale)}
          {line.onPromotion ? (
            <>
              {' '}
              <Badge tone="info">{l.onPromotion}</Badge>
            </>
          ) : null}
          {line.fulfilmentMode === 'PRE_ORDER' ? (
            <>
              {' '}
              <Badge tone="warning">{o.mode.badge}</Badge>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'sku',
      header: l.colSku,
      hideBelow: 'xl',
      cell: (line) => <span translate="no">{line.sku}</span>,
    },
    {
      key: 'seller',
      header: l.colSeller,
      hideBelow: 'lg',
      wrap: true,
      cell: (line) => line.seller?.displayName ?? '—',
    },
    {
      key: 'price',
      header: l.colPrice,
      numeric: true,
      hideBelow: 'lg',
      cell: (line) => formatVnd(line.unitPriceVnd, locale),
    },
    { key: 'quantity', header: l.colQuantity, numeric: true, cell: (line) => line.quantity },
    {
      key: 'amount',
      header: l.colAmount,
      numeric: true,
      cell: (line) => formatVnd(line.grossVnd, locale),
    },
    ...(invoice.productLines.some((line) => line.reservation)
      ? [
          {
            key: 'stock',
            header: l.colStock,
            hideBelow: 'lg' as const,
            cell: (line: InvoiceProductLineResponse) =>
              line.reservation ? (
                <Badge tone={stockTone(line.reservation.status)}>
                  {l.stock[line.reservation.status]}
                </Badge>
              ) : (
                '—'
              ),
          },
        ]
      : []),
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) =>
        editable ? (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: productTitle(line, locale) })}
            items={[
              {
                id: 'edit',
                label: l.edit,
                icon: 'edit' as const,
                disabled: !idle,
                onSelect: () => onEdit(line.id),
              },
              {
                id: 'remove',
                label: l.remove,
                icon: 'trash' as const,
                tone: 'danger' as const,
                disabled: !idle,
                onSelect: () => onRemove(line.id),
              },
            ]}
          />
        ) : null,
    },
  ];
  return (
    <Card as="section">
      <CardHeader
        title={l.title}
        description={draft ? l.description : undefined}
        actions={
          editable ? (
            <Button variant="secondary" icon="plus" disabled={!idle} onClick={onAdd}>
              {l.add}
            </Button>
          ) : undefined
        }
      />
      {undo}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: l.title })}
        columns={columns}
        rows={invoice.productLines}
        rowKey={(line) =>
          `${line.id}:${line.unitPriceVnd}:${line.quantity}:${line.seller?.id ?? ''}`
        }
        empty={<Empty>{l.empty}</Empty>}
        paging={{ off: 'the product lines of one invoice' }}
      />
      {footer}
    </Card>
  );
}

// ------------------------------------------------------------------------------------ add a product

/**
 * Add a product: search by name, brand, variant or SKU, choose the variant (a sold-out one is shown and cannot be chosen), the
 * quantity and the seller. Nobody types a price. The seller starts as the cashier when they work at this branch and must be chosen
 * when they do not (an Owner). The server checks everything again.
 */
export function ProductAddDialog({
  branchId,
  version,
  working,
  error,
  onAdd,
  onClose,
}: {
  branchId: string;
  version: number;
  working: boolean;
  error: string | null;
  onAdd: (body: InvoiceProductLineAddRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const d = productSaleDictionary(locale);
  const a = d.add;
  const o = productOrdersDictionary(locale);
  const options = useProductOptions(branchId);
  const [chosen, setChosen] = useState<PosProductOption | null>(null);
  // The cashier chooses the mode. A sold-out variant that is sold on order starts as a pre-order; anything else starts in stock.
  const [mode, setMode] = useState<ProductLineModeName>('IN_STOCK');
  const [quantity, setQuantity] = useState('1');
  const [chosenSeller, setSellerId] = useState('');
  const [problem, setProblem] = useState<AddProblem | null>(null);
  const modeHintId = useId();
  const loaded = options.data;
  // The seller is the caller until someone else is chosen: derived, not copied in by an effect (rbp :281-283).
  const sellerId = chosenSeller || loaded?.defaultSellerId || '';
  const results = useMemo(() => {
    const list = loaded?.products ?? [];
    return chosen && !list.some((option) => option.variantId === chosen.variantId)
      ? [chosen, ...list]
      : list;
  }, [loaded, chosen]);
  const modeHint = !chosen?.sellOnOrder
    ? undefined
    : mode === 'PRE_ORDER'
      ? leadTimeText(o.mode, chosen.leadTimeDaysMin, chosen.leadTimeDaysMax)
      : chosen.available === 0
        ? o.mode.soldOutOrder
        : undefined;

  async function save() {
    const result = addBody({ option: chosen, quantity, sellerUserId: sellerId, mode }, version);
    if ('problem' in result) {
      setProblem(result.problem);
      focusFirstInvalid();
      return;
    }
    setProblem(null);
    if (await onAdd(result.body)) onClose();
  }

  const failedLoad = !loaded && options.error ? posErrorMessage(options.error, t) : null;
  return (
    <FormDialog
      title={a.title}
      description={a.description}
      labels={{ ...formOverlayLabels(t, a.submit), submitting: a.submitting }}
      busy={working}
      // Any choice counts as a change, the seller too (wig Forms: no silent loss on close).
      dirty={chosen !== null || quantity !== '1' || chosenSeller !== ''}
      submitDisabled={!loaded}
      error={errorNotice(error ?? failedLoad)}
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        {!loaded && !options.error ? <Loading t={t} /> : null}
        <Field
          label={a.product}
          required
          full
          hint={loaded?.truncated ? a.more : a.description}
          {...(problem === 'product' ? { error: a.needProduct } : {})}
        >
          {(control) => (
            <Combobox
              {...control}
              options={results.map((option) => ({
                value: option.variantId,
                label: optionLabel(option, locale),
                disabled: option.available === 0 && !option.sellOnOrder,
              }))}
              value={chosen?.variantId ?? null}
              onValueChange={(value) => {
                const next = results.find((option) => option.variantId === value) ?? null;
                setChosen(next);
                setMode(
                  next && next.available === 0 && next.sellOnOrder ? 'PRE_ORDER' : 'IN_STOCK',
                );
                setProblem(null);
              }}
              onQueryChange={options.setQuery}
              loading={options.loading}
              loadingLabel={a.loading}
              emptyLabel={a.none}
              placeholder={a.searchPlaceholder}
              resultsLabel={(count) => resultsText(t, count)}
            />
          )}
        </Field>
        {chosen?.sellOnOrder ? (
          // Two choices are a toggle, not a pop-up menu (C47); the hint stays tied to the group.
          <div className="ls-field ls-field-full">
            <RadioGroup
              legend={o.mode.label}
              name="product-line-mode"
              layout="inline"
              required
              value={mode}
              options={[
                { value: 'IN_STOCK', label: o.mode.IN_STOCK },
                { value: 'PRE_ORDER', label: o.mode.PRE_ORDER },
              ]}
              onValueChange={(next) => (setMode(next as ProductLineModeName), setProblem(null))}
              describedById={modeHint ? modeHintId : undefined}
            />
            {modeHint ? (
              <p className="ls-hint" id={modeHintId}>
                {modeHint}
              </p>
            ) : null}
          </div>
        ) : null}
        <Field
          label={a.quantity}
          required
          hint={
            chosen
              ? mode === 'PRE_ORDER'
                ? undefined
                : chosen.available > 0
                  ? fill(a.quantityHint, { count: chosen.available })
                  : a.quantityHintNone
              : undefined
          }
          {...(problem === 'quantity'
            ? { error: a.badQuantity }
            : problem === 'stock' && chosen
              ? { error: fill(a.tooMany, { count: chosen.available }) }
              : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              className="ls-input-number"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={quantity}
              onChange={(event) => (setQuantity(event.target.value), setProblem(null))}
            />
          )}
        </Field>
        <Field
          label={a.seller}
          required
          hint={a.sellerHint}
          {...(problem === 'seller' ? { error: a.needSeller } : {})}
        >
          {(control) => (
            <Select
              {...control}
              value={sellerId}
              placeholder={a.sellerPlaceholder}
              options={(loaded?.sellers ?? []).map((seller) => ({
                value: seller.id,
                label: seller.displayName,
              }))}
              onChange={(event) => (setSellerId(event.target.value), setProblem(null))}
            />
          )}
        </Field>
        {mode === 'PRE_ORDER' && chosen && parseQuantityValue(quantity) <= chosen.available ? (
          <Notice tone="info">{o.mode.covered}</Notice>
        ) : null}
        {loaded && loaded.sellers.length === 0 ? <Notice tone="info">{a.noSellers}</Notice> : null}
      </FormGrid>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------ edit a line

/** Change the quantity and/or the seller of a line of a DRAFT (after finalization neither can change here). */
export function ProductEditDialog({
  branchId,
  line,
  version,
  working,
  error,
  onSave,
  onClose,
}: {
  branchId: string;
  line: InvoiceProductLineResponse;
  version: number;
  working: boolean;
  error: string | null;
  onSave: (body: InvoiceProductLineUpdateRequest) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t, locale } = useWorkforce();
  const d = productSaleDictionary(locale);
  const a = d.add;
  const options = useProductOptions(branchId);
  const [quantity, setQuantity] = useState(String(line.quantity));
  const [sellerId, setSellerId] = useState(line.seller?.id ?? '');
  const [problem, setProblem] = useState<'quantity' | 'seller' | 'unchanged' | null>(null);
  const sellers = options.data?.sellers ?? [];
  // The seller on the line is always offered, even if the list does not hold them any more (the server decides on save).
  const sellerOptions = sellers.some((seller) => seller.id === line.seller?.id)
    ? sellers
    : line.seller
      ? [{ id: line.seller.id, displayName: line.seller.displayName }, ...sellers]
      : sellers;
  const failedLoad = !options.data && options.error ? posErrorMessage(options.error, t) : null;

  async function save() {
    const result = updateBody(line, { quantity, sellerUserId: sellerId }, version);
    if ('problem' in result) {
      setProblem(result.problem);
      focusFirstInvalid();
      return;
    }
    setProblem(null);
    if (await onSave(result.body)) onClose();
  }

  return (
    <FormDialog
      title={d.edit.title}
      description={productTitle(line, locale)}
      labels={{ ...formOverlayLabels(t, d.edit.submit), submitting: d.edit.submitting }}
      busy={working}
      dirty={quantity !== String(line.quantity) || sellerId !== (line.seller?.id ?? '')}
      error={
        problem === 'unchanged' ? (
          <Notice tone="error">{d.edit.unchanged}</Notice>
        ) : (
          errorNotice(error ?? failedLoad)
        )
      }
      onClose={onClose}
      onSubmit={save}
    >
      <FormGrid>
        <Field
          label={a.quantity}
          required
          {...(problem === 'quantity' ? { error: a.badQuantity } : {})}
        >
          {(control) => (
            <TextInput
              {...control}
              className="ls-input-number"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={quantity}
              onChange={(event) => (setQuantity(event.target.value), setProblem(null))}
            />
          )}
        </Field>
        <Field
          label={a.seller}
          required
          hint={a.sellerHint}
          {...(problem === 'seller' ? { error: a.needSeller } : {})}
        >
          {(control) => (
            <Select
              {...control}
              value={sellerId}
              options={sellerOptions.map((seller) => ({
                value: seller.id,
                label: seller.displayName,
              }))}
              onChange={(event) => (setSellerId(event.target.value), setProblem(null))}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------ start a sale

/**
 * Start a product-only sale (the board). Leave the search empty to sell to a guest, or find a member by the exact phone or email;
 * the server decides the rest. One primary button: "Find customer" while a typed search has no answer, then "Start sale".
 */
export function ProductSaleDialog({
  branchId,
  onStarted,
  onClose,
}: {
  branchId: string;
  onStarted: (invoiceId: string) => void;
  onClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const s = productSaleDictionary(locale).start;
  const [lookupBy, setLookupBy] = useState<'phone' | 'email'>('phone');
  const [value, setValue] = useState('');
  const [lookup, setLookup] = useState<WalkInMemberLookupResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const member = lookup?.members[0] ?? null;
  const guest = value.trim() === '';

  async function submit() {
    if (starting || searching) return;
    setError(null);
    if (member || guest) {
      setStarting(true);
      try {
        const opened = await api.post<InvoiceOpenedResponse>(
          `/api/v1/pos/branches/${branchId}/product-sales`,
          member ? { payerUserId: member.id } : {},
        );
        onStarted(opened.invoice.id);
      } catch (failure) {
        setError(posErrorMessage(failure, t));
        setStarting(false);
      }
      return;
    }
    setSearching(true);
    try {
      setLookup(
        await api.get<WalkInMemberLookupResponse>(`/api/v1/pos/branches/${branchId}/members`, {
          [lookupBy]: value.trim(),
        }),
      );
    } catch (failure) {
      setLookup(null);
      setError(posErrorMessage(failure, t));
    } finally {
      setSearching(false);
    }
  }

  return (
    <FormDialog
      title={s.title}
      description={s.description}
      labels={{
        ...formOverlayLabels(t, member || guest ? s.start : s.search),
        submitting: member || guest ? s.starting : s.searching,
      }}
      busy={starting || searching}
      dirty={value !== ''}
      error={errorNotice(error)}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        {/* Two choices are a toggle, not a pop-up menu (C47). */}
        <RadioGroup
          legend={s.lookupBy}
          name="product-sale-lookup-by"
          layout="inline"
          value={lookupBy}
          options={[
            { value: 'phone', label: s.phone },
            { value: 'email', label: s.email },
          ]}
          onValueChange={(next) => (setLookupBy(next as 'phone' | 'email'), setLookup(null))}
        />
        <Field label={lookupBy === 'phone' ? s.phone : s.email} hint={s.guest}>
          {(control) => (
            <TextInput
              {...control}
              type={lookupBy === 'phone' ? 'tel' : 'email'}
              inputMode={lookupBy === 'phone' ? 'tel' : 'email'}
              autoComplete="off"
              spellCheck={false}
              maxLength={lookupBy === 'phone' ? 32 : 320}
              value={value}
              onChange={(event) => (setValue(event.target.value), setLookup(null))}
            />
          )}
        </Field>
        {member ? (
          <Notice tone="success">
            {/* The found member and the masked contacts as one Intl list, not commas glued in JSX. */}
            {metaLine(locale, [
              fill(s.found, { name: member.displayName }),
              member.phoneMasked,
              member.emailMasked,
            ])}
          </Notice>
        ) : null}
        {lookup && lookup.members.length === 0 ? <Notice tone="info">{s.notFound}</Notice> : null}
      </FormGrid>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------ the sides

interface SideRow {
  key: string;
  side: string;
  subtotal: string;
  benefit: string;
  discount: string;
  net: string;
}

/**
 * The discount of each side of an invoice that has products (Phase 6 P6-9): Spa and Lucy Beauty are priced separately, each with its
 * one best offer. The figures are the server's; this only reads them.
 */
// Memoised: it only shows the server's answer, so a busy flag, a feedback line or a dialog does not re-render it (rbp pos-invoice.tsx:100-776).
export const SidesCard = memo(function SidesCard({ invoice }: { invoice: InvoiceResponse }) {
  const { t, locale } = useWorkforce();
  const d = productSaleDictionary(locale).sides;
  const l = loyaltyDictionary(locale);
  const sides = invoice.discount.sides;
  if (!sides) return null;
  const nameOf = (side: InvoiceSideDiscount): string => {
    const parts: string[] = [];
    if (side.winnerSource === 'MEMBER_TIER' && side.member) {
      parts.push(fill(d.member, { tier: l.tiers[side.member.tier] }));
    } else if (side.winner) {
      parts.push(locale === 'vi' ? side.winner.nameVi : side.winner.nameEn);
    }
    if (side.birthday?.applied) parts.push(d.birthday);
    // The offers of a side as an Intl list ("Hạng Vàng và Quà sinh nhật"), not joined by a hand-typed " + ".
    return parts.length > 0 ? listFormat(locale).format(parts) : d.none;
  };
  const rows: SideRow[] = sides
    .filter((side) => side.subtotalVnd !== '0')
    .map((side) => ({
      key: side.side,
      side: side.side === 'SPA' ? d.spa : d.beauty,
      subtotal: formatVnd(side.subtotalVnd, locale),
      benefit: nameOf(side),
      discount: side.discountVnd === '0' ? '—' : minusMoney(locale, side.discountVnd),
      net: formatVnd(side.netVnd, locale),
    }));
  if (rows.length === 0) return null;
  const columns: DataTableColumn<SideRow>[] = [
    { key: 'side', header: d.colSide, mobileTitle: true, cell: (row) => row.side },
    {
      key: 'subtotal',
      header: d.colSubtotal,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => row.subtotal,
    },
    {
      key: 'benefit',
      header: d.colBenefit,
      wrap: true,
      width: 'lg',
      cell: (row) => row.benefit,
    },
    { key: 'discount', header: d.colDiscount, numeric: true, cell: (row) => row.discount },
    { key: 'net', header: d.colNet, numeric: true, cell: (row) => row.net },
  ];
  return (
    <Card as="section">
      <CardHeader title={d.title} description={d.note} />
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.title })}
        columns={columns}
        rows={rows}
        rowKey={(row) => row.key}
        paging={{ off: 'at most two sides' }}
      />
    </Card>
  );
});

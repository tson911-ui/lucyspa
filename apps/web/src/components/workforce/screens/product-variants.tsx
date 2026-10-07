'use client';

import type {
  ProductAccess,
  ProductDetailResponse,
  ProductVariantResponse,
} from '@lucy-spa/contracts';
import {
  CheckField,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Field,
  FormDialog,
  FormDrawer,
  FormGrid,
  ListSection,
  NumberInput,
  RowActions,
  Textarea,
  TextInput,
  type DataTableColumn,
  type MenuItem,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { isoToVnLocal } from '../../../lib/workforce/discounts';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatVnd } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import {
  costText,
  draftFromVariant,
  emptyVariantDraft,
  marginText,
  priceIssue,
  priceRequest,
  productErrorText,
  promotionRequest,
  validatePromotionDraft,
  validateVariantDraft,
  variantActiveRequest,
  variantColumnKeys,
  variantCreateRequest,
  variantEditRequest,
  variantName,
  type Issue,
  type PriceDraft,
  type PromotionDraft,
  type VariantDraft,
} from '../../../lib/workforce/products';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, Notice, useSuccessToast } from '../ui';
import { useProductCommand } from './use-product-command';

type Overlay = { kind: 'create' } | { kind: 'edit' | 'price' | 'promo' | 'active'; id: string };

/**
 * "Biến thể": the variants of one product as a table. Each variant is one SKU with its own list price. Edit, create, status and
 * images need the catalog permission, price and promotion actions the price permission; cost and margin are columns only when the
 * API sent them (the cost permission). Forms are a drawer (variant, promotion) or a dialog (price); the overlays keep only the
 * variant's id, so after a reload they always hold its current version.
 */
export function VariantsSection({
  product,
  reload,
  onHistory,
}: {
  product: ProductDetailResponse;
  reload: () => Promise<void>;
  /** "View price history": the history section filters to this variant. */
  onHistory: (variantId: string) => void;
}) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const v = p.variants;
  const { access } = product;
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [page, setPage] = useState({ page: 1, pageSize: 20 });
  const notify = useSuccessToast();
  const target =
    overlay && overlay.kind !== 'create'
      ? product.variants.find((variant) => variant.id === overlay.id)
      : undefined;
  const keys = variantColumnKeys(access);
  const leadText = (min: number, max: number) =>
    min === max ? fill(v.preOrderOneDay, { days: min }) : fill(v.preOrderDays, { min, max });

  const columns: DataTableColumn<ProductVariantResponse>[] = [
    {
      key: 'sku',
      header: v.sku,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (variant) => variant.sku,
    },
    {
      key: 'label',
      header: v.label,
      truncate: true,
      width: 'md',
      hideBelow: 'md',
      cell: (variant) =>
        (locale === 'vi'
          ? (variant.labelVi ?? variant.labelEn)
          : (variant.labelEn ?? variant.labelVi)) ?? '—',
    },
    {
      key: 'listPrice',
      header: v.listPrice,
      numeric: true,
      cell: (variant) =>
        variant.listPriceVnd === null ? v.noPrice : formatVnd(variant.listPriceVnd, locale),
    },
    {
      key: 'currentPrice',
      header: v.currentPrice,
      numeric: true,
      cell: (variant) =>
        variant.effectivePriceVnd === null ? (
          '—'
        ) : variant.activePromotion && variant.listPriceVnd !== null ? (
          <>
            {formatVnd(variant.effectivePriceVnd, locale)}{' '}
            <s className="ls-hint">{formatVnd(variant.listPriceVnd, locale)}</s>
          </>
        ) : (
          formatVnd(variant.effectivePriceVnd, locale)
        ),
    },
    {
      key: 'threshold',
      header: v.threshold,
      numeric: true,
      hideBelow: '2xl',
      cell: (variant) => variant.lowStockThreshold ?? '—',
    },
    {
      key: 'preOrder',
      header: v.preOrder,
      hideBelow: 'lg',
      cell: (variant) =>
        variant.sellOnOrder ? (
          <Badge tone="info">
            {variant.leadTimeDaysMin !== null && variant.leadTimeDaysMax !== null
              ? `${v.preOrderOn} · ${leadText(variant.leadTimeDaysMin, variant.leadTimeDaysMax)}`
              : v.preOrderOn}
          </Badge>
        ) : (
          <Badge tone="neutral">{v.preOrderOff}</Badge>
        ),
    },
    ...(keys.includes('cost')
      ? [
          {
            key: 'cost',
            header: v.cost,
            numeric: true,
            hideBelow: 'xl' as const,
            cell: (variant: ProductVariantResponse) => costText(variant, locale),
          },
          {
            key: 'margin',
            header: v.margin,
            numeric: true,
            hideBelow: '2xl' as const,
            cell: (variant: ProductVariantResponse) => marginText(variant, locale),
          },
        ]
      : []),
    {
      key: 'status',
      header: v.status,
      cell: (variant) => (
        <Badge tone={variant.isActive ? 'success' : 'neutral'}>
          {variant.isActive ? v.active : v.inactive}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (variant) => {
        const items: MenuItem[] = [
          ...(access.manage
            ? [
                {
                  id: 'edit',
                  label: v.edit,
                  icon: 'edit' as const,
                  onSelect: () => setOverlay({ kind: 'edit', id: variant.id }),
                },
              ]
            : []),
          ...(access.prices
            ? [
                {
                  id: 'price',
                  label: v.changePrice,
                  onSelect: () => setOverlay({ kind: 'price', id: variant.id }),
                },
                ...(variant.listPriceVnd !== null
                  ? [
                      {
                        id: 'promo',
                        label: v.createPromotion,
                        onSelect: () => setOverlay({ kind: 'promo', id: variant.id }),
                      },
                    ]
                  : []),
              ]
            : []),
          {
            id: 'history',
            label: p.history.title,
            onSelect: () => onHistory(variant.id),
          },
          ...(access.manage
            ? [
                {
                  id: 'active',
                  label: variant.isActive ? v.deactivate : v.activate,
                  ...(variant.isActive ? { tone: 'danger' as const } : {}),
                  onSelect: () => setOverlay({ kind: 'active', id: variant.id }),
                },
              ]
            : []),
        ];
        return (
          <RowActions
            menuLabel={fill(t.common.list.actionsFor, { name: variantName(variant, locale) })}
            items={items}
          />
        );
      },
    },
  ];

  const done = (message: string) => {
    setOverlay(null);
    notify(message);
  };

  return (
    <ListSection
      title={v.title}
      actions={
        access.manage ? (
          <Button variant="secondary" icon="plus" onClick={() => setOverlay({ kind: 'create' })}>
            {v.add}
          </Button>
        ) : undefined
      }
    >
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: v.title })}
        columns={columns}
        rows={product.variants}
        rowKey={(variant) => `${variant.id}:${variant.rowVersion}:${variant.priceVersionNo}`}
        empty={<Empty>{v.empty}</Empty>}
        paging={{
          ...page,
          onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
          onPageSizeChange: (pageSize) => setPage({ page: 1, pageSize }),
          labels: paginationLabels(t, v.title),
        }}
      />
      {overlay?.kind === 'create' ? (
        <VariantDrawer
          product={product}
          variant={null}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => done(v.created)}
        />
      ) : null}
      {overlay?.kind === 'edit' && target ? (
        <VariantDrawer
          key={target.id}
          product={product}
          variant={target}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => done(p.saved)}
        />
      ) : null}
      {overlay?.kind === 'price' && target ? (
        <PriceDialog
          key={target.id}
          product={product}
          variant={target}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => done(p.price.done)}
        />
      ) : null}
      {overlay?.kind === 'promo' && target ? (
        <PromotionDrawer
          key={target.id}
          product={product}
          variant={target}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => done(p.promo.created)}
        />
      ) : null}
      {overlay?.kind === 'active' && target ? (
        <VariantActiveConfirm
          key={target.id}
          product={product}
          variant={target}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => done(target.isActive ? v.deactivateDone : v.activateDone)}
        />
      ) : null}
    </ListSection>
  );
}

interface OverlayProps {
  product: ProductDetailResponse;
  variant: ProductVariantResponse | null;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}

const issueText = (
  show: boolean,
  issue: Issue | undefined,
  p: ReturnType<typeof productDictionary>,
): string | undefined =>
  show && issue ? (issue === 'required' ? p.required : p.invalid) : undefined;

function VariantDrawer({ product, variant, reload, onClose, onDone }: OverlayProps) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const v = p.variants;
  const access: ProductAccess = product.access;
  const creating = variant === null;
  const [initial] = useState<VariantDraft>(() =>
    variant ? draftFromVariant(variant) : emptyVariantDraft(),
  );
  const [draft, setDraft] = useState<VariantDraft>(initial);
  const [checked, setChecked] = useState(false);
  const command = useProductCommand(reload);
  const errors = validateVariantDraft(draft, {
    creating,
    prices: access.prices,
    cost: access.cost,
  });
  const set = (patch: Partial<VariantDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const skuError = command.field === 'sku' || command.field === 'barcode' ? command.message : null;
  const fieldMessage = (name: string) =>
    command.field === name ? (command.message ?? undefined) : undefined;

  async function submit() {
    setChecked(true);
    const body = variant
      ? variantEditRequest(draft, variant, access)
      : variantCreateRequest(draft, access);
    if (!body) return;
    const path = variant
      ? `/api/v1/products/${product.id}/variants/${variant.id}/edit`
      : `/api/v1/products/${product.id}/variants`;
    if (await command.run(path, body)) onDone();
  }

  return (
    <FormDrawer
      title={creating ? v.createTitle : v.editTitle}
      labels={{ ...formOverlayLabels(t, p.save), submitting: p.saving }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={
        command.message && !skuError ? <Notice tone="error">{command.message}</Notice> : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={2}>
        <Field
          label={v.skuField}
          hint={creating ? v.skuHint : undefined}
          error={issueText(checked, errors.sku, p) ?? fieldMessage('sku')}
          required={creating}
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={64}
              value={draft.sku}
              readOnly={!creating}
              disabled={!creating}
              onChange={(event) => set({ sku: event.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <Field
          label={v.barcode}
          error={issueText(checked, errors.barcode, p) ?? fieldMessage('barcode')}
        >
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={64}
              value={draft.barcode}
              onChange={(event) => set({ barcode: event.target.value })}
            />
          )}
        </Field>
        <Field label={v.labelVi} hint={v.labelViHint} error={issueText(checked, errors.labelVi, p)}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.labelVi}
              onChange={(event) => set({ labelVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={v.labelEn} error={issueText(checked, errors.labelEn, p)}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.labelEn}
              onChange={(event) => set({ labelEn: event.target.value })}
            />
          )}
        </Field>
        <Field
          label={v.thresholdField}
          hint={v.thresholdHint}
          error={issueText(checked, errors.threshold, p)}
        >
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={0}
              value={draft.threshold}
              onChange={(event) => set({ threshold: event.target.value })}
            />
          )}
        </Field>
        <Field label={v.sortOrder} error={issueText(checked, errors.sortOrder, p)}>
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={0}
              value={draft.sortOrder}
              onChange={(event) => set({ sortOrder: event.target.value })}
            />
          )}
        </Field>
        {creating && access.prices ? (
          <Field
            label={v.listPriceField}
            hint={v.listPriceHint}
            error={issueText(checked, errors.listPrice, p)}
          >
            {(control) => (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={1}
                value={draft.listPrice}
                onChange={(event) => set({ listPrice: event.target.value })}
              />
            )}
          </Field>
        ) : null}
        {access.cost ? (
          <Field label={v.costField} hint={v.costHint} error={issueText(checked, errors.cost, p)}>
            {(control) => (
              <NumberInput
                {...control}
                inputMode="numeric"
                min={0}
                value={draft.cost}
                onChange={(event) => set({ cost: event.target.value })}
              />
            )}
          </Field>
        ) : null}
      </FormGrid>
      <CheckField
        label={v.preOrderField}
        hint={v.preOrderHint}
        checked={draft.sellOnOrder}
        onChange={(event) => set({ sellOnOrder: event.target.checked })}
      />
      {draft.sellOnOrder ? (
        <>
          <FormGrid cols={2}>
            <Field
              label={v.leadMinField}
              hint={v.leadHint}
              error={checked && errors.leadTime ? v.leadInvalid : undefined}
            >
              {(control) => (
                <NumberInput
                  {...control}
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={draft.leadMin}
                  onChange={(event) => set({ leadMin: event.target.value })}
                />
              )}
            </Field>
            <Field label={v.leadMaxField}>
              {(control) => (
                <NumberInput
                  {...control}
                  inputMode="numeric"
                  min={1}
                  max={90}
                  value={draft.leadMax}
                  onChange={(event) => set({ leadMax: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
        </>
      ) : null}
      {!creating ? (
        <CheckField
          label={v.activeField}
          hint={v.activeHint}
          checked={draft.isActive}
          onChange={(event) => set({ isActive: event.target.checked })}
        />
      ) : null}
      {skuError ? <Notice tone="error">{skuError}</Notice> : null}
    </FormDrawer>
  );
}

function PriceDialog({ product, variant, reload, onClose, onDone }: OverlayProps) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const v = variant!;
  const [draft, setDraft] = useState<PriceDraft>({ price: '', reason: '' });
  const [checked, setChecked] = useState(false);
  const command = useProductCommand(reload);
  const issue = priceIssue(draft, v);
  const message =
    checked && issue
      ? issue === 'required'
        ? p.required
        : issue === 'same'
          ? p.price.unchanged
          : p.invalid
      : undefined;

  async function submit() {
    setChecked(true);
    const body = priceRequest(draft, v);
    if (!body) return;
    if (await command.run(`/api/v1/products/${product.id}/variants/${v.id}/price`, body)) onDone();
  }

  return (
    <FormDialog
      title={v.listPriceVnd === null ? p.price.firstPrice : p.price.title}
      labels={{ ...formOverlayLabels(t, p.price.submit), submitting: p.saving }}
      busy={command.pending}
      dirty={draft.price !== '' || draft.reason !== ''}
      error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <DescriptionList
          items={[
            { label: p.variants.skuField, value: variantName(v, locale) },
            {
              label: p.price.current,
              value:
                v.listPriceVnd === null ? p.variants.noPrice : formatVnd(v.listPriceVnd, locale),
            },
          ]}
        />
        <Field label={p.price.newPrice} hint={p.price.newPriceHint} error={message} required>
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={1}
              value={draft.price}
              onChange={(event) => setDraft((state) => ({ ...state, price: event.target.value }))}
            />
          )}
        </Field>
        <Field label={p.price.reason}>
          {(control) => (
            <Textarea
              {...control}
              rows={2}
              maxLength={500}
              value={draft.reason}
              onChange={(event) => setDraft((state) => ({ ...state, reason: event.target.value }))}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

function PromotionDrawer({ product, variant, reload, onClose, onDone }: OverlayProps) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const m = p.promo;
  const v = variant!;
  const [draft, setDraft] = useState<PromotionDraft>(() => ({
    price: '',
    startsAt: isoToVnLocal(new Date().toISOString()),
    endsAt: '',
  }));
  const [checked, setChecked] = useState(false);
  const command = useProductCommand(reload);
  const errors = validatePromotionDraft(draft, v);
  const set = (patch: Partial<PromotionDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const text = (issue: keyof typeof errors) => {
    const found = errors[issue];
    if (!checked || !found) return undefined;
    if (found === 'required') return p.required;
    if (found === 'tooHigh') return m.priceTooHigh;
    if (found === 'window') return m.windowInvalid;
    if (found === 'noListPrice') return m.noListPrice;
    return p.invalid;
  };

  async function submit() {
    setChecked(true);
    const body = promotionRequest(draft, v);
    if (!body) return;
    if (await command.run(`/api/v1/products/${product.id}/variants/${v.id}/promotions`, body)) {
      onDone();
    }
  }

  return (
    <FormDrawer
      title={m.createTitle}
      labels={{ ...formOverlayLabels(t, m.submit), submitting: p.saving }}
      busy={command.pending}
      dirty={draft.price !== '' || draft.endsAt !== ''}
      error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <DescriptionList
          items={[
            { label: p.variants.skuField, value: variantName(v, locale) },
            {
              label: m.listPrice,
              value:
                v.listPriceVnd === null ? p.variants.noPrice : formatVnd(v.listPriceVnd, locale),
            },
          ]}
        />
        <Field label={m.price} hint={m.priceHint} error={text('price')} required>
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={1}
              value={draft.price}
              onChange={(event) => set({ price: event.target.value })}
            />
          )}
        </Field>
        <Field label={m.startsAt} error={text('startsAt')} required>
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => set({ startsAt: event.target.value })}
            />
          )}
        </Field>
        <Field label={m.endsAt} error={text('endsAt')} required>
          {(control) => (
            <TextInput
              {...control}
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) => set({ endsAt: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
    </FormDrawer>
  );
}

/** Switching a variant off or on changes nothing else: every other value, and the cost key, are left as they are. */
function VariantActiveConfirm({ product, variant, reload, onClose, onDone }: OverlayProps) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const v = variant!;
  const deactivating = v.isActive;
  return (
    <ConfirmDialog
      title={deactivating ? p.variants.deactivateTitle : p.variants.activateTitle}
      description={deactivating ? p.variants.deactivateBody : p.variants.activateBody}
      facts={[{ label: p.variants.skuField, value: variantName(v, locale) }]}
      tone={deactivating ? 'danger' : 'neutral'}
      confirmLabel={deactivating ? p.variants.deactivate : p.variants.activate}
      busyLabel={p.variants.working}
      cancelLabel={p.variants.confirmCancel}
      referenceLabel={t.errors.reference}
      describeError={(error) => ({
        message: productErrorText(error, locale, (cause) => errorMessage(cause, t)),
        reference: error instanceof ApiError ? error.requestId : null,
      })}
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await api.post(
            `/api/v1/products/${product.id}/variants/${v.id}/edit`,
            variantActiveRequest(v, !deactivating),
          );
        } catch (error) {
          if (error instanceof ApiError && error.code === 'CONFLICT') await reload();
          throw error;
        }
        await reload();
        onDone();
      }}
    />
  );
}

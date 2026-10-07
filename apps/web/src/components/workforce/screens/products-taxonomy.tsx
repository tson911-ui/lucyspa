'use client';

import type { ProductBrandResponse, ProductCategoryResponse } from '@lucy-spa/contracts';
import {
  CheckField,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  NumberInput,
  RowActions,
  Select,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { productDictionary } from '../../../i18n/products';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels } from '../../../lib/workforce/list-view';
import {
  brandCreateRequest,
  brandEditRequest,
  categoryCreateRequest,
  categoryEditRequest,
  draftFromBrand,
  draftFromCategory,
  localizedName,
  orderCategoryTree,
  parentOptions,
  productErrorText,
  validateCategoryDraft,
  validateNames,
  type BrandDraft,
  type CategoryDraft,
  type Issue,
} from '../../../lib/workforce/products';
import { ApiError } from '../../../lib/workforce/api';
import { errorMessage } from '../../../lib/workforce/workflows';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useSuccessToast, type Resource } from '../ui';

/** The record was changed by someone else: the list is reloaded and the dialog closes with a message. */
const isConflict = (error: unknown): boolean =>
  error instanceof ApiError && error.code === 'CONFLICT' && error.field === null;

interface TabProps {
  manage: boolean;
  page: number;
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (pageSize: number) => void;
  createOpen: boolean;
  onCreateClose: () => void;
  /** After a save: say what happened and refresh whatever depends on brands or categories. */
  onSaved: (message: string, tone?: 'success' | 'error') => void;
}

/** The brands tab: a DataTable, a short form in a dialog (create from the page header, edit from the row menu). */
export function BrandsTab({
  resource,
  ...props
}: TabProps & { resource: Resource<{ brands: ProductBrandResponse[] }> }) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const b = p.brands;
  const [editing, setEditing] = useState<ProductBrandResponse | null>(null);
  const columns: DataTableColumn<ProductBrandResponse>[] = [
    {
      key: 'name',
      header: b.nameVi,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (brand) => localizedName(brand, locale),
    },
    { key: 'code', header: b.code, hideBelow: 'md', cell: (brand) => brand.code },
    { key: 'products', header: b.products, numeric: true, cell: (brand) => brand.productCount },
    {
      key: 'status',
      header: p.list.status,
      cell: (brand) => (
        <Badge tone={brand.isActive ? 'success' : 'neutral'}>
          {brand.isActive ? b.active : b.inactive}
        </Badge>
      ),
    },
    ...(props.manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (brand: ProductBrandResponse) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: localizedName(brand, locale) })}
                items={[
                  {
                    id: 'edit',
                    label: p.actions.edit,
                    icon: 'edit',
                    onSelect: () => setEditing(brand),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: p.tabs.brands })}
        columns={columns}
        rows={resource.data?.brands ?? []}
        rowKey={(brand) => `${brand.id}:${brand.rowVersion}`}
        loading={resource.loading}
        loadingLabel={t.common.loading}
        error={
          resource.error ? (
            <ErrorState error={resource.error} t={t} onRetry={() => void resource.reload()} />
          ) : undefined
        }
        empty={resource.data ? <Empty>{b.empty}</Empty> : undefined}
        paging={{
          page: props.page,
          pageSize: props.pageSize,
          onPageChange: props.onPage,
          onPageSizeChange: props.onPageSize,
          labels: paginationLabels(t, p.tabs.brands),
        }}
      />
      {props.createOpen || editing ? (
        <BrandDialog
          brand={editing}
          onClose={() => {
            setEditing(null);
            props.onCreateClose();
          }}
          onSaved={async (message, tone) => {
            await resource.reload();
            setEditing(null);
            props.onCreateClose();
            props.onSaved(message, tone);
          }}
        />
      ) : null}
    </>
  );
}

function issueText(
  checked: boolean,
  issue: Issue | undefined,
  p: ReturnType<typeof productDictionary>,
): string | undefined {
  return checked && issue ? (issue === 'required' ? p.required : p.invalid) : undefined;
}

function BrandDialog({
  brand,
  onClose,
  onSaved,
}: {
  brand: ProductBrandResponse | null;
  onClose: () => void;
  onSaved: (message: string, tone?: 'success' | 'error') => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const b = p.brands;
  const notify = useSuccessToast();
  const [initial] = useState(() => draftFromBrand(brand));
  const [draft, setDraft] = useState<BrandDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateNames(draft);
  const set = (patch: Partial<BrandDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = brand ? brandEditRequest(draft, brand.rowVersion) : brandCreateRequest(draft);
    if (!body) return;
    setPending(true);
    try {
      await api.post(
        brand ? `/api/v1/product-brands/${brand.id}/edit` : '/api/v1/product-brands',
        body,
      );
      const message = brand ? p.saved : b.created;
      notify(message);
      await onSaved(message);
    } catch (failure) {
      if (isConflict(failure)) {
        await onSaved(
          productErrorText(failure, locale, (cause) => errorMessage(cause, t)),
          'error',
        );
        return;
      }
      setError(productErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={brand ? b.editTitle : b.createTitle}
      labels={{ ...formOverlayLabels(t, p.save), submitting: p.saving }}
      busy={pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={b.nameVi} error={issueText(checked, errors.nameVi, p)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.nameVi}
              onChange={(event) => set({ nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={b.nameEn} error={issueText(checked, errors.nameEn, p)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.nameEn}
              onChange={(event) => set({ nameEn: event.target.value })}
            />
          )}
        </Field>
        {brand ? (
          <>
            <Field label={b.code} hint={b.codeHint}>
              {(control) => <TextInput {...control} value={brand.code} readOnly disabled />}
            </Field>
            <CheckField
              label={b.activeField}
              hint={b.activeHint}
              checked={draft.isActive}
              onChange={(event) => set({ isActive: event.target.checked })}
            />
          </>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

/** The categories tab: two levels (a root and its children), shown in tree order. */
export function CategoriesTab({
  resource,
  ...props
}: TabProps & { resource: Resource<{ categories: ProductCategoryResponse[] }> }) {
  const { t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const c = p.categories;
  const [editing, setEditing] = useState<ProductCategoryResponse | null>(null);
  const all = resource.data?.categories ?? [];
  const rows = orderCategoryTree(all);
  const parentName = (id: string | null) => {
    const parent = id ? all.find((entry) => entry.id === id) : undefined;
    return parent ? localizedName(parent, locale) : '—';
  };
  const columns: DataTableColumn<ProductCategoryResponse>[] = [
    {
      key: 'name',
      header: c.nameVi,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (category) => localizedName(category, locale),
    },
    {
      key: 'parent',
      header: c.parent,
      hideBelow: 'md',
      truncate: true,
      width: 'md',
      cell: (category) => parentName(category.parentId),
    },
    { key: 'code', header: c.code, hideBelow: 'lg', cell: (category) => category.code },
    {
      key: 'sortOrder',
      header: c.sortOrder,
      numeric: true,
      hideBelow: 'lg',
      cell: (category) => category.sortOrder,
    },
    {
      key: 'products',
      header: c.products,
      numeric: true,
      cell: (category) => category.productCount,
    },
    {
      key: 'status',
      header: p.list.status,
      cell: (category) => (
        <Badge tone={category.isActive ? 'success' : 'neutral'}>
          {category.isActive ? c.active : c.inactive}
        </Badge>
      ),
    },
    ...(props.manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (category: ProductCategoryResponse) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, {
                  name: localizedName(category, locale),
                })}
                items={[
                  {
                    id: 'edit',
                    label: p.actions.edit,
                    icon: 'edit',
                    onSelect: () => setEditing(category),
                  },
                ]}
              />
            ),
          },
        ]
      : []),
  ];
  return (
    <>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: p.tabs.categories })}
        columns={columns}
        rows={rows}
        rowKey={(category) => `${category.id}:${category.rowVersion}`}
        loading={resource.loading}
        loadingLabel={t.common.loading}
        error={
          resource.error ? (
            <ErrorState error={resource.error} t={t} onRetry={() => void resource.reload()} />
          ) : undefined
        }
        empty={resource.data ? <Empty>{c.empty}</Empty> : undefined}
        paging={{
          page: props.page,
          pageSize: props.pageSize,
          onPageChange: props.onPage,
          onPageSizeChange: props.onPageSize,
          labels: paginationLabels(t, p.tabs.categories),
        }}
      />
      {props.createOpen || editing ? (
        <CategoryDialog
          category={editing}
          categories={all}
          onClose={() => {
            setEditing(null);
            props.onCreateClose();
          }}
          onSaved={async (message, tone) => {
            await resource.reload();
            setEditing(null);
            props.onCreateClose();
            props.onSaved(message, tone);
          }}
        />
      ) : null}
    </>
  );
}

function CategoryDialog({
  category,
  categories,
  onClose,
  onSaved,
}: {
  category: ProductCategoryResponse | null;
  categories: readonly ProductCategoryResponse[];
  onClose: () => void;
  onSaved: (message: string, tone?: 'success' | 'error') => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const p = productDictionary(locale);
  const c = p.categories;
  const notify = useSuccessToast();
  const [initial] = useState(() => draftFromCategory(category));
  const [draft, setDraft] = useState<CategoryDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errors = validateCategoryDraft(draft);
  const parents = parentOptions(categories, category);
  const set = (patch: Partial<CategoryDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = category
      ? categoryEditRequest(draft, category.rowVersion)
      : categoryCreateRequest(draft);
    if (!body) return;
    setPending(true);
    try {
      await api.post(
        category ? `/api/v1/product-categories/${category.id}/edit` : '/api/v1/product-categories',
        body,
      );
      const message = category ? p.saved : c.created;
      notify(message);
      await onSaved(message);
    } catch (failure) {
      if (isConflict(failure)) {
        await onSaved(
          productErrorText(failure, locale, (cause) => errorMessage(cause, t)),
          'error',
        );
        return;
      }
      setError(productErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={category ? c.editTitle : c.createTitle}
      labels={{ ...formOverlayLabels(t, p.save), submitting: p.saving }}
      busy={pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid>
        <Field label={c.nameVi} error={issueText(checked, errors.nameVi, p)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.nameVi}
              onChange={(event) => set({ nameVi: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.nameEn} error={issueText(checked, errors.nameEn, p)} required>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.nameEn}
              onChange={(event) => set({ nameEn: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.parent} hint={c.parentHint}>
          {(control) => (
            <Select
              {...control}
              value={draft.parentId}
              options={[
                { value: '', label: c.parentNone },
                ...parents.map((parent) => ({
                  value: parent.id,
                  label: localizedName(parent, locale),
                })),
              ]}
              onChange={(event) => set({ parentId: event.target.value })}
            />
          )}
        </Field>
        <Field label={c.sortOrder} error={issueText(checked, errors.sortOrder, p)} width="md">
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
        {category ? (
          <>
            <Field label={c.code} hint={c.codeHint}>
              {(control) => <TextInput {...control} value={category.code} readOnly disabled />}
            </Field>
            <CheckField
              label={c.activeField}
              hint={c.activeHint}
              checked={draft.isActive}
              onChange={(event) => set({ isActive: event.target.checked })}
            />
          </>
        ) : null}
      </FormGrid>
    </FormDialog>
  );
}

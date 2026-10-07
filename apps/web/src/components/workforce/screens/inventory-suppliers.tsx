'use client';

import type { SupplierListResponse, SupplierResponse } from '@lucy-spa/contracts';
import {
  CheckField,
  DataTable,
  Field,
  FormDialog,
  FormGrid,
  ListToolbar,
  normalizeSearch,
  RowActions,
  SearchInput,
  Textarea,
  TextInput,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState } from 'react';
import { inventoryDictionary } from '../../../i18n/inventory';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import {
  draftFromSupplier,
  emptySupplierDraft,
  supplierCreateRequest,
  supplierEditRequest,
  validateSupplierDraft,
  type InventoryListState,
  type SupplierDraft,
} from '../../../lib/workforce/inventory';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { useWorkforce } from '../session';
import { Badge, Empty, ErrorState, Notice, useResource, useSuccessToast } from '../ui';
import { useInventoryCommand } from './use-inventory-command';

/**
 * The "Nhà cung cấp" tab. Everyone who may receive goods reads the list; adding and editing need MANAGE_PRODUCTS (the API's `manage`).
 * A supplier is never deleted: it is switched off ("Ngừng") and stops being offered on new receipts.
 */
export function SuppliersTab({
  list,
  updateList,
  creating,
  onCreateClose,
}: {
  list: InventoryListState;
  updateList: (patch: Partial<InventoryListState>, change?: { replace?: boolean }) => void;
  /** The page-header "Thêm nhà cung cấp" button asked for the dialog. */
  creating: boolean;
  onCreateClose: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const s = text.suppliers;
  const notify = useSuccessToast();
  const suppliers = useResource(() => api.get<SupplierListResponse>('/api/v1/suppliers'), [api]);
  const [editing, setEditing] = useState<SupplierResponse | null>(null);
  const manage = suppliers.data?.manage ?? false;
  const query = normalizeSearch(list.q);
  const all = suppliers.data?.suppliers ?? [];
  const rows = all.filter(
    (supplier) =>
      query === '' ||
      [supplier.name, supplier.phone ?? '', supplier.contactName ?? ''].some((field) =>
        normalizeSearch(field).includes(query),
      ),
  );

  const columns: DataTableColumn<SupplierResponse>[] = [
    {
      key: 'name',
      header: s.columns.name,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (supplier) => supplier.name,
    },
    {
      key: 'contact',
      header: s.columns.contact,
      truncate: true,
      width: 'sm',
      hideBelow: 'md',
      cell: (supplier) => supplier.contactName ?? text.none,
    },
    {
      key: 'phone',
      header: s.columns.phone,
      hideBelow: 'md',
      cell: (supplier) => supplier.phone ?? text.none,
    },
    {
      key: 'email',
      header: s.columns.email,
      truncate: true,
      width: 'md',
      hideBelow: 'xl',
      cell: (supplier) => supplier.email ?? text.none,
    },
    {
      key: 'receipts',
      header: s.columns.receipts,
      numeric: true,
      hideBelow: 'lg',
      cell: (supplier) => supplier.receiptCount,
    },
    {
      key: 'status',
      header: s.columns.status,
      cell: (supplier) => (
        <Badge tone={supplier.isActive ? 'success' : 'neutral'}>
          {supplier.isActive ? s.statuses.active : s.statuses.inactive}
        </Badge>
      ),
    },
    ...(manage
      ? [
          {
            key: 'actions',
            header: t.common.actions,
            actions: true,
            cell: (supplier: SupplierResponse) => (
              <RowActions
                menuLabel={fill(t.common.list.actionsFor, { name: supplier.name })}
                items={[
                  {
                    id: 'edit',
                    label: s.edit,
                    icon: 'edit' as const,
                    onSelect: () => setEditing(supplier),
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
      {suppliers.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={list.q ? 1 : 0}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '' })}
          reload={{ label: t.common.reload, onClick: () => void suppliers.reload() }}
          search={
            <SearchInput
              id="supplier-q"
              value={list.q}
              label={s.search}
              placeholder={s.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
        />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: text.tabs.suppliers })}
        columns={columns}
        rows={rows}
        rowKey={(supplier) => `${supplier.id}:${supplier.rowVersion}`}
        loading={suppliers.loading}
        loadingLabel={t.common.loading}
        error={
          suppliers.error ? (
            <ErrorState error={suppliers.error} t={t} onRetry={() => void suppliers.reload()} />
          ) : undefined
        }
        empty={suppliers.data ? <Empty>{all.length === 0 ? s.empty : s.noMatch}</Empty> : undefined}
        paging={{
          page: list.spage,
          pageSize: list.spageSize,
          onPageChange: (spage) => updateList({ spage }),
          onPageSizeChange: (spageSize) => updateList({ spageSize }),
          labels: paginationLabels(t, text.tabs.suppliers),
        }}
      />
      {creating && manage ? (
        <SupplierDialog
          supplier={null}
          onClose={onCreateClose}
          onSaved={async () => {
            onCreateClose();
            notify(s.created);
            await suppliers.reload();
          }}
        />
      ) : null}
      {editing ? (
        <SupplierDialog
          key={`${editing.id}:${editing.rowVersion}`}
          supplier={editing}
          reload={suppliers.reload}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            notify(s.saved);
          }}
        />
      ) : null}
    </>
  );
}

/** "Thêm / Sửa nhà cung cấp": a short form (dialog). An edit carries the row version; the active switch is on edit only. */
export function SupplierDialog({
  supplier,
  reload,
  onClose,
  onSaved,
}: {
  supplier: SupplierResponse | null;
  reload?: () => Promise<void>;
  onClose: () => void;
  onSaved: () => Promise<void> | void;
}) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const s = text.suppliers;
  const [initial] = useState<SupplierDraft>(() =>
    supplier ? draftFromSupplier(supplier) : emptySupplierDraft(),
  );
  const [draft, setDraft] = useState<SupplierDraft>(initial);
  const [checked, setChecked] = useState(false);
  const command = useInventoryCommand(reload);
  const errors = validateSupplierDraft(draft);
  const set = (patch: Partial<SupplierDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const shown = (field: keyof typeof errors) =>
    checked && errors[field]
      ? errors[field] === 'required'
        ? text.required
        : field === 'email'
          ? text.errors.fields.email
          : text.invalid
      : undefined;
  const nameTaken = command.field === 'name' ? (command.message ?? undefined) : undefined;

  async function submit() {
    setChecked(true);
    const body = supplier ? supplierEditRequest(draft, supplier) : supplierCreateRequest(draft);
    if (!body) return;
    const path = supplier ? `/api/v1/suppliers/${supplier.id}/edit` : '/api/v1/suppliers';
    const result = await command.run(path, body);
    if (result.ok) await onSaved();
  }

  return (
    <FormDialog
      title={supplier ? s.editTitle : s.createTitle}
      labels={{ ...formOverlayLabels(t, text.save), submitting: text.saving }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      error={
        command.message && !nameTaken ? <Notice tone="error">{command.message}</Notice> : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={2}>
        <Field label={s.fields.name} required full error={shown('name') ?? nameTaken}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.name}
              onChange={(event) => set({ name: event.target.value })}
            />
          )}
        </Field>
        <Field label={s.fields.contactName} error={shown('contactName')}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={200}
              value={draft.contactName}
              onChange={(event) => set({ contactName: event.target.value })}
            />
          )}
        </Field>
        <Field label={s.fields.phone} error={shown('phone')}>
          {(control) => (
            <TextInput
              {...control}
              type="tel"
              autoComplete="off"
              maxLength={40}
              value={draft.phone}
              onChange={(event) => set({ phone: event.target.value })}
            />
          )}
        </Field>
        <Field label={s.fields.email} full error={shown('email')}>
          {(control) => (
            <TextInput
              {...control}
              type="email"
              autoComplete="off"
              maxLength={254}
              value={draft.email}
              onChange={(event) => set({ email: event.target.value })}
            />
          )}
        </Field>
        <Field label={s.fields.address} full error={shown('address')}>
          {(control) => (
            <TextInput
              {...control}
              autoComplete="off"
              maxLength={500}
              value={draft.address}
              onChange={(event) => set({ address: event.target.value })}
            />
          )}
        </Field>
        <Field label={s.fields.notes} full error={shown('notes')}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={draft.notes}
              onChange={(event) => set({ notes: event.target.value })}
            />
          )}
        </Field>
      </FormGrid>
      {supplier ? (
        <CheckField
          label={s.fields.active}
          hint={s.activeHint}
          checked={draft.isActive}
          onChange={(event) => set({ isActive: event.target.checked })}
        />
      ) : null}
    </FormDialog>
  );
}

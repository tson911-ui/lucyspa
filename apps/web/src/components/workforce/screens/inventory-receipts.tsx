'use client';

import type {
  InventoryContextResponse,
  InventoryVariantOptionsResponse,
  StockReceiptLineResponse,
  StockReceiptListItem,
  StockReceiptListResponse,
  StockReceiptResponse,
  SupplierListResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Card,
  CardHeader,
  Combobox,
  ConfirmDialog,
  DataTable,
  DateTextInput,
  DescriptionList,
  FacetedFilter,
  Field,
  FormActions,
  FormGrid,
  IconButton,
  ListSection,
  ListToolbar,
  MoneyInput,
  NumberInput,
  Page,
  RowActions,
  SearchInput,
  Select,
  Stack,
  Textarea,
  TextInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { inventoryDictionary } from '../../../i18n/inventory';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { formatDate, formatDateTime, formatVnd } from '../../../lib/workforce/format';
import {
  draftFromReceipt,
  emptyLineDraft,
  emptyReceiptDraft,
  filterReceipts,
  inventoryErrorText,
  isConflict,
  receiptCreateRequest,
  receiptDraftValid,
  receiptEditRequest,
  receiptTone,
  RECEIPT_STATUSES,
  resolveBranch,
  todayInShop,
  validateReceiptDraft,
  variantOptionLabel,
  type InventoryListState,
  type ReceiptDraft,
  type ReceiptLineDraft,
} from '../../../lib/workforce/inventory';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSuccessToast,
  type Resource,
} from '../ui';
import { useInventoryContext } from './use-inventory-command';

const ZONE = 'Asia/Ho_Chi_Minh';

// ------------------------------------------------------------------------------------------------------ the tab

/** The "Phiếu nhập" tab: the receipts of one branch, newest first. Search and the status filter run in the browser. */
export function ReceiptsTab({
  branchId,
  branchControl,
  list,
  updateList,
}: {
  branchId: string;
  branchControl: ReactNode;
  list: InventoryListState;
  updateList: (patch: Partial<InventoryListState>, change?: { replace?: boolean }) => void;
}) {
  const { api } = useWorkforce();
  const receipts = useResource(
    () =>
      api.get<StockReceiptListResponse>(
        `/api/v1/stock-receipts?branchId=${encodeURIComponent(branchId)}`,
      ),
    [api, branchId],
  );
  return (
    <ReceiptsList
      receipts={receipts}
      branchControl={branchControl}
      list={list}
      updateList={updateList}
    />
  );
}

/** The receipts table and its toolbar (no request of its own, so a test can render it with data). */
export function ReceiptsList({
  receipts,
  branchControl,
  list,
  updateList,
}: {
  receipts: Resource<StockReceiptListResponse>;
  branchControl: ReactNode;
  list: InventoryListState;
  updateList: (patch: Partial<InventoryListState>, change?: { replace?: boolean }) => void;
}) {
  const { t, locale, base, navigate } = useWorkforce();
  const text = inventoryDictionary(locale);
  const r = text.receipts;
  const all = receipts.data?.receipts ?? [];
  const rows = filterReceipts(all, list);
  const active = (list.q ? 1 : 0) + (list.rstatus ? 1 : 0);
  const hasCost = all.some((receipt) => receipt.totalCostVnd !== undefined);
  const open = (receipt: StockReceiptListItem) => `${base}/inventory/receipts/${receipt.id}`;

  const columns: DataTableColumn<StockReceiptListItem>[] = [
    {
      key: 'code',
      header: r.columns.code,
      mobileTitle: true,
      cell: (receipt) => (
        <Link className="ls-link" href={open(receipt)}>
          {receipt.code}
        </Link>
      ),
    },
    {
      key: 'date',
      header: r.columns.date,
      cell: (receipt) => formatDate(receipt.receiptDate, locale),
    },
    {
      key: 'supplier',
      header: r.columns.supplier,
      truncate: true,
      width: 'md',
      hideBelow: 'lg',
      cell: (receipt) => receipt.supplierName ?? text.none,
    },
    {
      key: 'lines',
      header: r.columns.lines,
      numeric: true,
      hideBelow: 'lg',
      cell: (receipt) => receipt.lineCount,
    },
    {
      key: 'quantity',
      header: r.columns.quantity,
      numeric: true,
      cell: (receipt) => receipt.totalQuantity,
    },
    ...(hasCost
      ? [
          {
            key: 'cost',
            header: r.columns.cost,
            numeric: true,
            hideBelow: 'xl' as const,
            cell: (receipt: StockReceiptListItem) =>
              receipt.totalCostVnd !== undefined && receipt.totalCostVnd !== '0'
                ? formatVnd(receipt.totalCostVnd, locale)
                : text.none,
          },
        ]
      : []),
    {
      key: 'status',
      header: r.columns.status,
      cell: (receipt) => (
        <Badge tone={receiptTone(receipt.status)}>{r.statuses[receipt.status]}</Badge>
      ),
    },
    {
      key: 'createdBy',
      header: r.columns.createdBy,
      truncate: true,
      width: 'sm',
      hideBelow: 'xl',
      cell: (receipt) => receipt.createdByName,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (receipt) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: receipt.code })}
          items={[
            {
              id: 'open',
              label: r.open,
              icon: 'eye',
              onSelect: () => navigate?.(open(receipt)),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <>
      {receipts.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', rstatus: '' })}
          reload={{ label: t.common.reload, onClick: () => void receipts.reload() }}
          search={
            <SearchInput
              id="receipt-q"
              value={list.q}
              label={r.search}
              placeholder={r.search}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <>
              {branchControl}
              <FacetedFilter
                label={r.status}
                clearLabel={t.common.list.clearChoice}
                options={RECEIPT_STATUSES.map((status) => ({
                  value: status,
                  label: r.statuses[status],
                }))}
                selected={list.rstatus ? [list.rstatus] : []}
                onChange={([status]) => updateList({ rstatus: status ?? '' })}
              />
            </>
          }
        />
      ) : branchControl ? (
        <ListToolbar labels={toolbarLabels(t)} filters={branchControl} />
      ) : null}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: text.tabs.receipts })}
        columns={columns}
        rows={rows}
        rowKey={(receipt) => `${receipt.id}:${receipt.status}`}
        loading={receipts.loading}
        loadingLabel={t.common.loading}
        error={
          receipts.error ? (
            <ErrorState error={receipts.error} t={t} onRetry={() => void receipts.reload()} />
          ) : undefined
        }
        empty={receipts.data ? <Empty>{all.length === 0 ? r.empty : r.noMatch}</Empty> : undefined}
        paging={{
          page: list.rpage,
          pageSize: list.rpageSize,
          onPageChange: (rpage) => updateList({ rpage }),
          onPageSizeChange: (rpageSize) => updateList({ rpageSize }),
          labels: paginationLabels(t, text.tabs.receipts),
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------------------------- the receipt page

export function ReceiptScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const receipt = useResource(
    () => api.get<StockReceiptResponse>(`/api/v1/stock-receipts/${encodeURIComponent(id)}`),
    [api, id],
  );
  if (receipt.error && !receipt.data) {
    return <ErrorState error={receipt.error} t={t} onRetry={() => void receipt.reload()} />;
  }
  if (!receipt.data) return <Loading t={t} page />;
  return <ReceiptView receipt={receipt.data} reload={receipt.reload} />;
}

type Overlay = 'confirm' | 'cancel' | null;

/**
 * One receipt. A DRAFT carries the page's one primary action ("Xác nhận nhập kho") and, in the information card, "Sửa" and a menu
 * with "Hủy phiếu"; a confirmed or cancelled receipt is read-only. The status badge lives inside the card, never next to the title.
 */
export function ReceiptView({
  receipt,
  reload,
}: {
  receipt: StockReceiptResponse;
  reload: () => Promise<void>;
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const text = inventoryDictionary(locale);
  const d = text.receipt;
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const draft = receipt.status === 'DRAFT';
  const describeError = (error: unknown) => ({
    message: inventoryErrorText(error, locale, (cause) => errorMessage(cause, t)),
    reference: error instanceof ApiError ? error.requestId : null,
  });
  return (
    <>
      <PageHeader
        title={receipt.code}
        {...(draft ? { intro: d.draftHint } : {})}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              {
                label: text.title,
                href: `${base}/inventory?tab=receipts&branch=${encodeURIComponent(receipt.branchId)}`,
              },
              { label: receipt.code },
            ]}
          />
        }
      >
        {draft ? (
          <Button variant="primary" onClick={() => setOverlay('confirm')}>
            {d.confirm}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        <Section
          title={d.info}
          actions={
            draft ? (
              <>
                <Button
                  variant="secondary"
                  icon="edit"
                  onClick={() => navigate?.(`${base}/inventory/receipts/${receipt.id}/edit`)}
                >
                  {d.edit}
                </Button>
                <RowActions
                  menuLabel={d.moreActions}
                  items={[
                    {
                      id: 'cancel',
                      label: d.cancel,
                      tone: 'danger',
                      onSelect: () => setOverlay('cancel'),
                    },
                  ]}
                />
              </>
            ) : undefined
          }
        >
          <DescriptionList
            columns={2}
            items={[
              { label: d.fields.branch, value: receipt.branchName },
              { label: d.fields.supplier, value: receipt.supplierName ?? text.none },
              { label: d.fields.date, value: formatDate(receipt.receiptDate, locale) },
              {
                label: d.fields.status,
                value: (
                  <Badge tone={receiptTone(receipt.status)}>
                    {text.receipts.statuses[receipt.status]}
                  </Badge>
                ),
              },
              {
                label: d.fields.createdBy,
                value: `${receipt.createdByName} · ${formatDateTime(receipt.createdAt, ZONE, locale)}`,
              },
              ...(receipt.confirmedAt
                ? [
                    {
                      label: d.fields.confirmedBy,
                      value: `${receipt.confirmedByName ?? text.none} · ${formatDateTime(receipt.confirmedAt, ZONE, locale)}`,
                    },
                  ]
                : []),
              ...(receipt.cancelledAt
                ? [
                    {
                      label: d.fields.cancelledBy,
                      value: `${receipt.cancelledByName ?? text.none} · ${formatDateTime(receipt.cancelledAt, ZONE, locale)}`,
                    },
                    { label: d.fields.cancelReason, value: receipt.cancelReason ?? text.none },
                  ]
                : []),
              { label: d.fields.notes, value: receipt.notes ?? text.none },
            ]}
          />
        </Section>
        <ReceiptLines receipt={receipt} />
      </Stack>
      {overlay === 'confirm' ? (
        <ConfirmDialog
          title={d.confirmTitle}
          description={d.confirmBody}
          facts={[{ label: d.codeFact, value: receipt.code }]}
          tone="neutral"
          confirmLabel={d.confirm}
          busyLabel={text.working}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            try {
              await api.post(`/api/v1/stock-receipts/${receipt.id}/confirm`, {
                expectedRowVersion: receipt.rowVersion,
              });
            } catch (error) {
              if (isConflict(error)) await reload();
              throw error;
            }
            await reload();
            setOverlay(null);
            notify(d.confirmDone);
          }}
        />
      ) : null}
      {overlay === 'cancel' ? (
        <ConfirmDialog
          title={d.cancelTitle}
          description={d.cancelBody}
          facts={[{ label: d.codeFact, value: receipt.code }]}
          tone="warning"
          confirmLabel={d.cancel}
          busyLabel={text.working}
          cancelLabel={d.keep}
          referenceLabel={t.errors.reference}
          reasonField={{
            label: d.cancelReason,
            required: true,
            requiredLabel: t.common.required,
            requiredMessage: t.common.form.reasonRequired,
          }}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async (reason) => {
            try {
              await api.post(`/api/v1/stock-receipts/${receipt.id}/cancel`, {
                expectedRowVersion: receipt.rowVersion,
                reason: reason ?? '',
              });
            } catch (error) {
              if (isConflict(error)) await reload();
              throw error;
            }
            await reload();
            setOverlay(null);
            notify(d.cancelDone);
          }}
        />
      ) : null}
    </>
  );
}

function ReceiptLines({ receipt }: { receipt: StockReceiptResponse }) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const d = text.receipt;
  const [page, setPage] = useState({ page: 1, pageSize: 20 });
  const columns: DataTableColumn<StockReceiptLineResponse>[] = [
    { key: 'no', header: d.lineColumns.no, numeric: true, cell: (line) => line.lineNo },
    { key: 'sku', header: d.lineColumns.sku, mobileTitle: true, cell: (line) => line.sku },
    {
      key: 'product',
      header: d.lineColumns.product,
      truncate: true,
      width: 'md',
      hideBelow: 'md',
      cell: (line) => {
        const name = locale === 'vi' ? line.productNameVi : line.productNameEn;
        const label =
          locale === 'vi' ? (line.labelVi ?? line.labelEn) : (line.labelEn ?? line.labelVi);
        return label ? `${name} (${label})` : name;
      },
    },
    {
      key: 'quantity',
      header: d.lineColumns.quantity,
      numeric: true,
      cell: (line) => line.quantity,
    },
    {
      key: 'lot',
      header: d.lineColumns.lot,
      hideBelow: 'lg',
      cell: (line) => line.lotCode ?? text.none,
    },
    {
      key: 'expiry',
      header: d.lineColumns.expiry,
      hideBelow: 'lg',
      cell: (line) => (line.expiryDate ? formatDate(line.expiryDate, locale) : text.none),
    },
    ...(receipt.cost
      ? [
          {
            key: 'cost',
            header: d.lineColumns.cost,
            numeric: true,
            hideBelow: 'xl' as const,
            cell: (line: StockReceiptLineResponse) =>
              line.unitCostVnd ? formatVnd(line.unitCostVnd, locale) : text.none,
          },
        ]
      : []),
  ];
  return (
    <ListSection title={d.lines}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: d.lines })}
        columns={columns}
        rows={receipt.lines}
        rowKey={(line) => String(line.lineNo)}
        empty={<Empty>{d.linesEmpty}</Empty>}
        paging={{
          ...page,
          onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
          onPageSizeChange: (pageSize) => setPage({ page: 1, pageSize }),
          labels: paginationLabels(t, d.lines),
        }}
      />
    </ListSection>
  );
}

// ---------------------------------------------------------------------------------------------- the receipt form

/** `/inventory/receipts/new` (create) and `/inventory/receipts/[id]/edit` (a draft): a long form, so a page of its own. */
export function ReceiptFormScreen({ id }: { id?: string }) {
  const { api, t, locale, base } = useWorkforce();
  const text = inventoryDictionary(locale);
  const context = useInventoryContext();
  const [{ branch: chosen }] = useUrlState({ branch: '' });
  const suppliers = useResource(() => api.get<SupplierListResponse>('/api/v1/suppliers'), [api]);
  const options = useResource(
    () => api.get<InventoryVariantOptionsResponse>('/api/v1/inventory/variant-options'),
    [api],
  );
  const existing = useResource(
    () =>
      id
        ? api.get<StockReceiptResponse>(`/api/v1/stock-receipts/${encodeURIComponent(id)}`)
        : Promise.resolve(null),
    [api, id],
  );
  const back = id
    ? `${base}/inventory/receipts/${id}`
    : `${base}/inventory?tab=receipts${chosen ? `&branch=${encodeURIComponent(chosen)}` : ''}`;
  const title = id ? text.form.editTitle : text.form.createTitle;
  const failed = context.error ?? suppliers.error ?? options.error ?? existing.error;
  const ready = context.data && suppliers.data && options.data && (!id || existing.data);
  return (
    <Page>
      <PageHeader
        title={title}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              { label: text.title, href: `${base}/inventory?tab=receipts` },
              ...(id && existing.data ? [{ label: existing.data.code, href: back }] : []),
              { label: title },
            ]}
          />
        }
      />
      {failed && !ready ? (
        <ErrorState
          error={failed}
          t={t}
          onRetry={() =>
            void Promise.all([
              context.reload(),
              suppliers.reload(),
              options.reload(),
              existing.reload(),
            ])
          }
        />
      ) : ready ? (
        <ReceiptFormBody
          receipt={existing.data}
          context={context.data!}
          suppliers={suppliers.data!}
          variants={options.data!}
          chosenBranch={chosen}
          back={back}
        />
      ) : (
        <Loading t={t} />
      )}
    </Page>
  );
}

function ReceiptFormBody({
  receipt,
  context,
  suppliers,
  variants,
  chosenBranch,
  back,
}: {
  receipt: StockReceiptResponse | null;
  context: InventoryContextResponse;
  suppliers: SupplierListResponse;
  variants: InventoryVariantOptionsResponse;
  chosenBranch: string;
  back: string;
}) {
  const { api, t, locale, base, navigate } = useWorkforce();
  const text = inventoryDictionary(locale);
  const f = text.form;
  const notify = useSuccessToast();
  const today = todayInShop();
  const branch = receipt
    ? { id: receipt.branchId, name: receipt.branchName }
    : resolveBranch(context, chosenBranch, 'receipts');
  const cost = receipt ? receipt.cost : context.cost;
  const [initial] = useState<ReceiptDraft>(() =>
    receipt ? draftFromReceipt(receipt) : emptyReceiptDraft(today),
  );
  const [draft, setDraft] = useState<ReceiptDraft>(initial);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const counter = useRef(draft.lines.length + 1);
  const errors = validateReceiptDraft(draft, { cost, today });

  const set = (patch: Partial<ReceiptDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const setLine = (key: string, patch: Partial<ReceiptLineDraft>) =>
    setDraft((state) => ({
      ...state,
      lines: state.lines.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    }));
  const addLine = () =>
    setDraft((state) => ({
      ...state,
      lines: [...state.lines, emptyLineDraft(`line-${counter.current++}`)],
    }));
  const removeLine = (key: string) =>
    setDraft((state) => ({ ...state, lines: state.lines.filter((line) => line.key !== key) }));

  // Every variant a line may name, including one the receipt already holds that is no longer offered.
  const variantOptions = [
    ...variants.variants.map((variant) => ({
      value: variant.variantId,
      label: variantOptionLabel(variant, locale),
    })),
    ...(receipt?.lines ?? [])
      .filter((line) => !variants.variants.some((variant) => variant.variantId === line.variantId))
      .map((line) => ({
        value: line.variantId,
        label: variantOptionLabel(line, locale),
      })),
  ];
  const supplierOptions = suppliers.suppliers
    .filter((supplier) => supplier.isActive || supplier.id === draft.supplierId)
    .map((supplier) => ({ value: supplier.id, label: supplier.name }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending || !branch) return;
    setChecked(true);
    setError(null);
    const mode = { cost, today };
    setPending(true);
    try {
      if (receipt) {
        const body = receiptEditRequest(draft, receipt.rowVersion, mode);
        if (!body) {
          setPending(false);
          return;
        }
        await api.post<StockReceiptResponse>(`/api/v1/stock-receipts/${receipt.id}/edit`, body);
        notify(f.saved);
        navigate?.(`${base}/inventory/receipts/${receipt.id}`);
      } else {
        const body = receiptCreateRequest(draft, branch.id, mode);
        if (!body) {
          setPending(false);
          return;
        }
        const created = await api.post<StockReceiptResponse>('/api/v1/stock-receipts', body);
        notify(f.created);
        navigate?.(`${base}/inventory/receipts/${created.id}`);
      }
    } catch (failure) {
      setError(inventoryErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  if (!branch) return <Notice tone="info">{f.noBranch}</Notice>;
  if (receipt && receipt.status !== 'DRAFT') return <Notice tone="info">{f.cannotEdit}</Notice>;
  const linesInvalid = checked && !receiptDraftValid(errors);
  return (
    <form
      noValidate
      onSubmit={(event) => void submit(event)}
      aria-label={receipt ? f.editTitle : f.createTitle}
    >
      <Stack gap="block">
        <Card as="section" aria-label={receipt ? f.editTitle : f.createTitle}>
          <Stack gap="page">
            <p className="ls-hint">{f.intro}</p>
            <FormGrid cols={2}>
              <Field label={f.branch}>
                {(control) => <TextInput {...control} value={branch.name} readOnly disabled />}
              </Field>
              <Field label={f.supplier}>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.supplierId}
                    placeholder={f.supplierNone}
                    options={supplierOptions}
                    onChange={(event) => set({ supplierId: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label={f.date}
                required
                error={checked && errors.receiptDate ? text.errors.fields.receiptDate : undefined}
              >
                {(control) => (
                  <DateTextInput
                    {...control}
                    value={draft.receiptDate}
                    onChange={(event) => set({ receiptDate: event.target.value })}
                  />
                )}
              </Field>
              <Field
                label={f.notes}
                full
                error={checked && errors.notes ? text.invalid : undefined}
              >
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
          </Stack>
        </Card>
        <Card as="section" aria-label={f.lines}>
          <Stack gap="page">
            <CardHeader
              title={f.lines}
              actions={
                <Button variant="secondary" icon="plus" onClick={addLine}>
                  {f.addLine}
                </Button>
              }
            />
            {draft.lines.length === 0 ? (
              <Notice tone={checked ? 'error' : 'info'}>{f.noLines}</Notice>
            ) : null}
            {draft.lines.map((line, index) => {
              const issues = checked ? (errors.lines[line.key] ?? {}) : {};
              return (
                <Stack gap="block" key={line.key}>
                  <CardHeader
                    title={fill(f.lineTitle, { n: index + 1 })}
                    headingLevel={3}
                    actions={
                      <IconButton
                        icon="trash"
                        label={fill(f.removeLine, { n: index + 1 })}
                        onClick={() => removeLine(line.key)}
                      />
                    }
                  />
                  <FormGrid cols={2}>
                    <Field
                      label={f.variant}
                      required
                      full
                      error={issues.variantId ? text.required : undefined}
                    >
                      {(control) => (
                        <Combobox
                          {...control}
                          options={variantOptions}
                          value={line.variantId === '' ? null : line.variantId}
                          onValueChange={(value) => setLine(line.key, { variantId: value ?? '' })}
                          emptyLabel={f.noVariant}
                          placeholder={f.variantPlaceholder}
                          resultsLabel={(count) => resultsText(t, count)}
                        />
                      )}
                    </Field>
                    <Field
                      label={f.quantity}
                      required
                      error={
                        issues.quantity
                          ? issues.quantity === 'required'
                            ? text.required
                            : text.errors.fields.quantity
                          : undefined
                      }
                    >
                      {(control) => (
                        <NumberInput
                          {...control}
                          inputMode="numeric"
                          min={1}
                          value={line.quantity}
                          onChange={(event) => setLine(line.key, { quantity: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field
                      label={f.lot}
                      hint={f.lotHint}
                      error={issues.lotCode ? text.invalid : undefined}
                    >
                      {(control) => (
                        <TextInput
                          {...control}
                          autoComplete="off"
                          maxLength={64}
                          value={line.lotCode}
                          onChange={(event) => setLine(line.key, { lotCode: event.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={f.expiry} error={issues.expiryDate ? f.expiryPast : undefined}>
                      {(control) => (
                        <DateTextInput
                          {...control}
                          min={today}
                          value={line.expiryDate}
                          onChange={(event) =>
                            setLine(line.key, { expiryDate: event.target.value })
                          }
                        />
                      )}
                    </Field>
                    {cost ? (
                      <Field
                        label={f.cost}
                        error={issues.unitCost ? text.errors.fields.unitCostVnd : undefined}
                      >
                        {(control) => (
                          <MoneyInput
                            {...control}
                            value={line.unitCost === '' ? null : Number(line.unitCost)}
                            onValueChange={(value) =>
                              setLine(line.key, { unitCost: value === null ? '' : String(value) })
                            }
                          />
                        )}
                      </Field>
                    ) : null}
                  </FormGrid>
                </Stack>
              );
            })}
            {linesInvalid ? <Notice tone="error">{f.missing}</Notice> : null}
            {error ? <Notice tone="error">{error}</Notice> : null}
          </Stack>
        </Card>
        <FormActions
          cancel={
            <Button variant="secondary" onClick={() => navigate?.(back)} disabled={pending}>
              {t.common.cancel}
            </Button>
          }
          primary={
            <Button type="submit" variant="primary" loading={pending}>
              {pending ? text.saving : receipt ? f.submitEdit : f.submitCreate}
            </Button>
          }
        />
      </Stack>
    </form>
  );
}

'use client';

import type {
  InventoryVariantOptionsResponse,
  StockCountLineResponse,
  StockCountListItem,
  StockCountListResponse,
  StockCountResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Combobox,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  IconButton,
  ListSection,
  ListToolbar,
  NumberInput,
  RowActions,
  Stack,
  Textarea,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState, type ReactNode } from 'react';
import { inventoryDictionary } from '../../../i18n/inventory';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDateTime } from '../../../lib/workforce/format';
import {
  changedCountLines,
  countAddRequest,
  countDifference,
  countLinesRequest,
  countTone,
  countValues,
  differenceText,
  inventoryErrorText,
  isConflict,
  itemTitle,
  parseCounted,
  variantOptionLabel,
  type InventoryListState,
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
} from '../ui';
import { useInventoryCommand } from './use-inventory-command';

const ZONE = 'Asia/Ho_Chi_Minh';

// ------------------------------------------------------------------------------------------------------ the tab

/** The "Kiểm kê" tab: the counts of one branch, newest first. */
export function CountsTab({
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
  const { api, t, locale, base, navigate } = useWorkforce();
  const text = inventoryDictionary(locale);
  const c = text.counts;
  const counts = useResource(
    () =>
      api.get<StockCountListResponse>(
        `/api/v1/stock-counts?branchId=${encodeURIComponent(branchId)}`,
      ),
    [api, branchId],
  );
  const rows = counts.data?.counts ?? [];
  const open = (count: StockCountListItem) => `${base}/inventory/counts/${count.id}`;
  const columns: DataTableColumn<StockCountListItem>[] = [
    {
      key: 'code',
      header: c.columns.code,
      mobileTitle: true,
      cell: (count) => (
        <Link className="ls-link" href={open(count)}>
          {count.code}
        </Link>
      ),
    },
    {
      key: 'status',
      header: c.columns.status,
      cell: (count) => <Badge tone={countTone(count.status)}>{c.statuses[count.status]}</Badge>,
    },
    { key: 'lines', header: c.columns.lines, numeric: true, cell: (count) => count.lineCount },
    {
      key: 'units',
      header: c.columns.units,
      numeric: true,
      hideBelow: 'md',
      cell: (count) => count.differenceUnits ?? text.none,
    },
    {
      key: 'createdBy',
      header: c.columns.createdBy,
      truncate: true,
      width: 'sm',
      hideBelow: 'lg',
      cell: (count) => count.createdByName,
    },
    {
      key: 'createdAt',
      header: c.columns.createdAt,
      hideBelow: 'md',
      cell: (count) => formatDateTime(count.createdAt, ZONE, locale),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (count) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: count.code })}
          items={[
            {
              id: 'open',
              label: c.open,
              icon: 'eye',
              onSelect: () => navigate?.(open(count)),
            },
          ]}
        />
      ),
    },
  ];
  return (
    <>
      {counts.data && rows.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          resultCount={resultsText(t, rows.length)}
          reload={{ label: t.common.reload, onClick: () => void counts.reload() }}
          filters={branchControl}
        />
      ) : (
        branchControl && <ListToolbar labels={toolbarLabels(t)} filters={branchControl} />
      )}
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: text.tabs.counts })}
        columns={columns}
        rows={rows}
        rowKey={(count) => `${count.id}:${count.status}`}
        loading={counts.loading}
        loadingLabel={t.common.loading}
        error={
          counts.error ? (
            <ErrorState error={counts.error} t={t} onRetry={() => void counts.reload()} />
          ) : undefined
        }
        empty={counts.data ? <Empty>{c.empty}</Empty> : undefined}
        paging={{
          page: list.cpage,
          pageSize: list.cpageSize,
          onPageChange: (cpage) => updateList({ cpage }),
          onPageSizeChange: (cpageSize) => updateList({ cpageSize }),
          labels: paginationLabels(t, text.tabs.counts),
        }}
      />
    </>
  );
}

/** "Tạo đợt kiểm kê": a short form (dialog) with a note; the count lists every item that has stock. */
export function CountCreateDialog({
  branchId,
  onClose,
}: {
  branchId: string;
  onClose: () => void;
}) {
  const { t, locale, base, navigate } = useWorkforce();
  const text = inventoryDictionary(locale);
  const c = text.counts;
  const notify = useSuccessToast();
  const [notes, setNotes] = useState('');
  const command = useInventoryCommand();

  async function submit() {
    const result = await command.run<StockCountResponse>('/api/v1/stock-counts', {
      branchId,
      notes: notes.trim() === '' ? null : notes.trim(),
      variantIds: null,
    });
    if (result.ok) {
      notify(c.created);
      navigate?.(`${base}/inventory/counts/${result.data.id}`);
    }
  }

  return (
    <FormDialog
      title={c.createTitle}
      labels={{ ...formOverlayLabels(t, c.submit), submitting: text.saving }}
      busy={command.pending}
      dirty={notes !== ''}
      error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <p className="ls-hint">{c.createIntro}</p>
        <Field label={c.notes}>
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              maxLength={500}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------------- the count page

export function CountScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const count = useResource(
    () => api.get<StockCountResponse>(`/api/v1/stock-counts/${encodeURIComponent(id)}`),
    [api, id],
  );
  const [notice, setNotice] = useState<string | null>(null);
  if (count.error && !count.data) {
    return <ErrorState error={count.error} t={t} onRetry={() => void count.reload()} />;
  }
  if (!count.data) return <Loading t={t} page />;
  return (
    <CountView
      key={count.data.rowVersion}
      count={count.data}
      reload={count.reload}
      notice={notice}
      onNotice={setNotice}
    />
  );
}

type Overlay = 'approve' | 'cancel' | 'add' | null;

/**
 * One physical count. While it is OPEN and the person may adjust, each line has an editable "Đếm được"; the primary action is
 * "Duyệt kiểm kê", offered only when nothing is unsaved. An approved or cancelled count is read-only. The page is remounted when
 * the count's version changes, so the typed values always start from what is saved.
 */
export function CountView({
  count,
  reload,
  notice = null,
  onNotice = () => undefined,
}: {
  count: StockCountResponse;
  reload: () => Promise<void>;
  notice?: string | null;
  onNotice?: (message: string | null) => void;
}) {
  const { api, t, locale, base } = useWorkforce();
  const text = inventoryDictionary(locale);
  const c = text.count;
  const notify = useSuccessToast();
  const open = count.status === 'OPEN';
  const editable = open && count.canAdjust;
  const [values, setValues] = useState<Record<string, string>>(() => countValues(count));
  const [removed, setRemoved] = useState<string[]>([]);
  const [overlay, setOverlay] = useState<Overlay>(null);
  const command = useInventoryCommand(reload);
  const visible = count.lines.filter((line) => !removed.includes(line.variantId));
  const changed = changedCountLines(count, values);
  const invalid = changed === null;
  const dirty = invalid || (changed?.length ?? 0) > 0 || removed.length > 0;
  const describeError = (error: unknown) => ({
    message: inventoryErrorText(error, locale, (cause) => errorMessage(cause, t)),
    reference: error instanceof ApiError ? error.requestId : null,
  });

  async function save() {
    onNotice(null);
    const body = countLinesRequest(count, values, removed);
    if (!body) return;
    const result = await command.run(`/api/v1/stock-counts/${count.id}/lines`, body);
    if (result.ok) notify(c.saved);
  }

  const columns: DataTableColumn<StockCountLineResponse>[] = [
    { key: 'sku', header: c.columns.sku, hideBelow: 'lg', cell: (line) => line.sku },
    {
      key: 'product',
      header: c.columns.product,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (line) => itemTitle(line, locale),
    },
    {
      key: 'system',
      header: c.columns.system,
      numeric: true,
      cell: (line) => line.systemQuantity ?? line.currentOnHand ?? text.none,
    },
    {
      key: 'counted',
      header: c.columns.counted,
      numeric: true,
      cell: (line) =>
        editable ? (
          <NumberInput
            aria-label={fill(c.countedLabel, { sku: line.sku })}
            inputMode="numeric"
            min={0}
            value={values[line.variantId] ?? String(line.countedQuantity)}
            invalid={parseCounted(values[line.variantId] ?? '') === null}
            onChange={(event) =>
              setValues((state) => ({ ...state, [line.variantId]: event.target.value }))
            }
          />
        ) : (
          line.countedQuantity
        ),
    },
    {
      key: 'difference',
      header: c.columns.difference,
      numeric: true,
      cell: (line) => {
        const difference = editable
          ? countDifference(line, parseCounted(values[line.variantId] ?? ''))
          : line.difference;
        return (
          <Badge
            tone={
              difference === null || difference === 0
                ? 'neutral'
                : difference > 0
                  ? 'info'
                  : 'warning'
            }
          >
            {differenceText(difference)}
          </Badge>
        );
      },
    },
    ...(editable
      ? [
          {
            key: 'remove',
            header: t.common.actions,
            actions: true,
            cell: (line: StockCountLineResponse) => (
              <IconButton
                icon="trash"
                label={fill(c.removeLine, { sku: line.sku })}
                onClick={() => setRemoved((state) => [...state, line.variantId])}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={count.code}
        {...(editable && dirty ? { intro: c.saveFirst } : {})}
        {...(!open ? { intro: c.closedHint } : {})}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={Link}
            items={[
              {
                label: text.title,
                href: `${base}/inventory?tab=counts&branch=${encodeURIComponent(count.branchId)}`,
              },
              { label: count.code },
            ]}
          />
        }
      >
        {editable ? (
          <Button
            variant="primary"
            disabled={dirty || count.lines.length === 0}
            onClick={() => setOverlay('approve')}
          >
            {c.approve}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        {notice ? <Notice tone="error">{notice}</Notice> : null}
        <Section
          title={c.info}
          actions={
            editable ? (
              <RowActions
                menuLabel={c.moreActions}
                items={[
                  {
                    id: 'cancel',
                    label: c.cancel,
                    tone: 'danger',
                    onSelect: () => setOverlay('cancel'),
                  },
                ]}
              />
            ) : undefined
          }
        >
          <DescriptionList
            columns={2}
            items={[
              { label: c.fields.branch, value: count.branchName },
              {
                label: c.fields.status,
                value: (
                  <Badge tone={countTone(count.status)}>{text.counts.statuses[count.status]}</Badge>
                ),
              },
              {
                label: c.fields.createdBy,
                value: `${count.createdByName} · ${formatDateTime(count.createdAt, ZONE, locale)}`,
              },
              ...(count.approvedAt
                ? [
                    {
                      label: c.fields.approvedBy,
                      value: `${count.approvedByName ?? text.none} · ${formatDateTime(count.approvedAt, ZONE, locale)}`,
                    },
                  ]
                : []),
              ...(count.cancelledAt
                ? [
                    {
                      label: c.fields.cancelledAt,
                      value: formatDateTime(count.cancelledAt, ZONE, locale),
                    },
                  ]
                : []),
              { label: c.fields.notes, value: count.notes ?? text.none },
            ]}
          />
        </Section>
        <ListSection
          title={c.items}
          actions={
            editable ? (
              <>
                <Button variant="secondary" icon="plus" onClick={() => setOverlay('add')}>
                  {c.add}
                </Button>
                <Button
                  variant="secondary"
                  loading={command.pending}
                  disabled={!dirty || invalid}
                  onClick={() => void save()}
                >
                  {c.save}
                </Button>
              </>
            ) : undefined
          }
        >
          {editable && invalid ? <Notice tone="error">{c.invalidCounted}</Notice> : null}
          {command.message ? <Notice tone="error">{command.message}</Notice> : null}
          <CountLines columns={columns} rows={visible} />
        </ListSection>
      </Stack>
      {overlay === 'add' ? (
        <AddItemDialog
          count={count}
          reload={reload}
          onClose={() => setOverlay(null)}
          onDone={() => {
            setOverlay(null);
            notify(c.addDone);
          }}
        />
      ) : null}
      {overlay === 'approve' ? (
        <ConfirmDialog
          title={c.approveTitle}
          description={c.approveBody}
          facts={[{ label: c.codeFact, value: count.code }]}
          tone="warning"
          confirmLabel={c.approve}
          busyLabel={text.working}
          cancelLabel={t.common.cancel}
          referenceLabel={t.errors.reference}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            try {
              await api.post(`/api/v1/stock-counts/${count.id}/approve`, {
                expectedRowVersion: count.rowVersion,
              });
            } catch (error) {
              if (isConflict(error)) {
                onNotice(describeError(error).message);
                await reload();
              }
              throw error;
            }
            await reload();
            setOverlay(null);
            notify(c.approveDone);
          }}
        />
      ) : null}
      {overlay === 'cancel' ? (
        <ConfirmDialog
          title={c.cancelTitle}
          description={c.cancelBody}
          facts={[{ label: c.codeFact, value: count.code }]}
          tone="warning"
          confirmLabel={c.cancel}
          busyLabel={text.working}
          cancelLabel={c.keep}
          referenceLabel={t.errors.reference}
          describeError={describeError}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            try {
              await api.post(`/api/v1/stock-counts/${count.id}/cancel`, {
                expectedRowVersion: count.rowVersion,
              });
            } catch (error) {
              if (isConflict(error)) {
                onNotice(describeError(error).message);
                await reload();
              }
              throw error;
            }
            await reload();
            setOverlay(null);
            notify(c.cancelDone);
          }}
        />
      ) : null}
    </>
  );
}

function CountLines({
  columns,
  rows,
}: {
  columns: DataTableColumn<StockCountLineResponse>[];
  rows: StockCountLineResponse[];
}) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const [page, setPage] = useState({ page: 1, pageSize: 20 });
  return (
    <DataTable
      mode="client"
      caption={fill(t.common.list.table, { list: text.count.items })}
      columns={columns}
      rows={rows}
      rowKey={(line) => line.variantId}
      empty={<Empty>{text.count.itemsEmpty}</Empty>}
      paging={{
        ...page,
        onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
        onPageSizeChange: (pageSize) => setPage({ page: 1, pageSize }),
        labels: paginationLabels(t, text.count.items),
      }}
    />
  );
}

/** "Thêm mặt hàng": a short form (dialog): an item that is not in the count yet and the quantity counted. */
function AddItemDialog({
  count,
  reload,
  onClose,
  onDone,
}: {
  count: StockCountResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { api, t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const c = text.count;
  const options = useResource(
    () => api.get<InventoryVariantOptionsResponse>('/api/v1/inventory/variant-options'),
    [api],
  );
  const [variantId, setVariantId] = useState('');
  const [counted, setCounted] = useState('0');
  const [checked, setChecked] = useState(false);
  const command = useInventoryCommand(reload);
  const taken = new Set(count.lines.map((line) => line.variantId));
  const choices = (options.data?.variants ?? [])
    .filter((variant) => !taken.has(variant.variantId))
    .map((variant) => ({ value: variant.variantId, label: variantOptionLabel(variant, locale) }));

  async function submit() {
    setChecked(true);
    const body = countAddRequest(count, variantId, counted);
    if (!body) return;
    const result = await command.run(`/api/v1/stock-counts/${count.id}/lines`, body);
    if (result.ok) onDone();
  }

  return (
    <FormDialog
      title={c.addTitle}
      labels={{ ...formOverlayLabels(t, c.addSubmit), submitting: text.saving }}
      busy={command.pending}
      dirty={variantId !== ''}
      submitDisabled={!options.data}
      error={
        command.message ? (
          <Notice tone="error">{command.message}</Notice>
        ) : options.error ? (
          <ErrorState error={options.error} t={t} onRetry={() => void options.reload()} />
        ) : undefined
      }
      onClose={onClose}
      onSubmit={submit}
    >
      <FormGrid cols={1}>
        <Field
          label={c.addVariant}
          required
          error={checked && variantId === '' ? text.required : undefined}
        >
          {(control) => (
            <Combobox
              {...control}
              options={choices}
              value={variantId === '' ? null : variantId}
              onValueChange={(value) => setVariantId(value ?? '')}
              loading={options.loading}
              loadingLabel={t.common.loading}
              emptyLabel={text.form.noVariant}
              placeholder={text.form.variantPlaceholder}
              resultsLabel={(n) => resultsText(t, n)}
            />
          )}
        </Field>
        <Field
          label={c.addCounted}
          required
          error={checked && parseCounted(counted) === null ? c.invalidCounted : undefined}
        >
          {(control) => (
            <NumberInput
              {...control}
              inputMode="numeric"
              min={0}
              value={counted}
              onChange={(event) => setCounted(event.target.value)}
            />
          )}
        </Field>
      </FormGrid>
    </FormDialog>
  );
}

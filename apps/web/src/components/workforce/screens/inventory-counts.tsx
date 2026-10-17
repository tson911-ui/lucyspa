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
  Icon,
  IconButton,
  ListSection,
  ListToolbar,
  NumberInput,
  RowActions,
  Stack,
  Textarea,
  useUnsavedChangesGuard,
  type DataTableColumn,
  PageHeader as KitPageHeader,
  useOptionalToast,
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
  inventoryErrorText,
  INVENTORY_LIST_DEFAULTS,
  isConflict,
  itemTitle,
  parseCounted,
  variantOptionLabel,
  type InventoryListState,
} from '../../../lib/workforce/inventory';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import { errorMessage } from '../../../lib/workforce/workflows';
import { ListCrumbLink, PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  Empty,
  ErrorState,
  Loading,
  Notice,
  Section,
  useResource,
  useSuccessToast,
} from '../ui';
import { RouterMenuLink } from './pos-links';
import { useInventoryCommand } from './use-inventory-command';
import { listFormat, signedNumber } from './pos-format';
import { focusFirstInvalid } from './pos-dom';
import { backParam, useBackQuery, useUrlPage } from './pos-url';

// The notice that names the rows with a wrong count; each such count field points at it.
const INVALID_ID = 'count-invalid-rows';

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
  const { api, t, locale, base } = useWorkforce();
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
  const open = (count: StockCountListItem) =>
    `${base}/inventory/counts/${count.id}${backParam({ ...list, tab: 'counts' }, INVENTORY_LIST_DEFAULTS)}`;
  const columns: DataTableColumn<StockCountListItem>[] = [
    {
      key: 'code',
      header: c.columns.code,
      mobileTitle: true,
      cell: (count) => (
        <Link className="ls-link" href={open(count)} translate="no">
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
      wrap: true,
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
          LinkComponent={RouterMenuLink}
          menuLabel={fill(t.common.list.actionsFor, { name: count.code })}
          items={[
            {
              id: 'open',
              label: c.open,
              icon: 'eye',
              href: open(count),
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
      ) : branchControl ? (
        <ListToolbar labels={toolbarLabels(t)} filters={branchControl} />
      ) : null}
      <DataTable
        drillDown
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
  // The page of the count sheet lives above the remount on every save, so saving keeps the counter where they were (wig :584),
  // and in the address, so Back/Forward and a shared link show the same page (wig Navigation & State); 20 rows a page.
  const sheet = useUrlPage('lpage');
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
      page={{ page: sheet.page, pageSize: sheet.pageSize }}
      onPage={(next) => sheet.onPageChange(next.page)}
    />
  );
}

type SheetPage = { page: number; pageSize: number };

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
  page,
  onPage,
}: {
  count: StockCountResponse;
  reload: () => Promise<void>;
  notice?: string | null;
  onNotice?: (message: string | null) => void;
  /** The sheet's page, held by the caller so a save (which remounts this view) keeps it. */
  page?: SheetPage;
  onPage?: (page: SheetPage) => void;
}) {
  const { api, t, locale, base } = useWorkforce();
  // The counts tab's view the count was opened from (C70): the breadcrumb returns to the same branch and page.
  const backQuery = useBackQuery();
  const text = inventoryDictionary(locale);
  const c = text.count;
  const notify = useSuccessToast();
  const open = count.status === 'OPEN';
  const editable = open && count.canAdjust;
  const [values, setValues] = useState<Record<string, string>>(() => countValues(count));
  const [removed, setRemoved] = useState<string[]>([]);
  // C72 for the count sheet: the line just removed (removal is a draft until "Lưu số đếm") can be put back with one click.
  const [lastRemoved, setLastRemoved] = useState<StockCountLineResponse | null>(null);
  const toast = useOptionalToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const command = useInventoryCommand(reload);
  const removedIds = new Set(removed);
  const visible = count.lines.filter((line) => !removedIds.has(line.variantId));
  const changed = changedCountLines(count, values);
  const invalid = changed === null;
  const dirty = invalid || (changed?.length ?? 0) > 0 || removed.length > 0;
  const describeError = (error: unknown) => ({
    message: inventoryErrorText(error, locale, (cause) => errorMessage(cause, t)),
    reference: error instanceof ApiError ? error.requestId : null,
  });
  // Typed counts are not lost by leaving the page by accident (wig :300).
  useUnsavedChangesGuard(editable && dirty && !command.pending);

  // Lines whose typed count is not a whole number of 0 or more, named in the notice and marked on the row (wig :341).
  const invalidLines = visible.filter(
    (line) => parseCounted(values[line.variantId] ?? String(line.countedQuantity)) === null,
  );

  async function save() {
    onNotice(null);
    const body = countLinesRequest(count, values, removed);
    if (!body) {
      // "Lưu số đếm" stays enabled (wig :486): a refused save opens the page of the first wrong row and puts the cursor there.
      const first = invalidLines[0];
      if (first && page && onPage) {
        const index = visible.indexOf(first);
        onPage({ ...page, page: Math.floor(index / page.pageSize) + 1 });
      }
      focusFirstInvalid();
      return;
    }
    const result = await command.run(`/api/v1/stock-counts/${count.id}/lines`, body);
    if (result.ok) notify(c.saved);
  }

  const columns: DataTableColumn<StockCountLineResponse>[] = [
    {
      key: 'sku',
      header: c.columns.sku,
      hideBelow: 'lg',
      cell: (line) => <span translate="no">{line.sku}</span>,
    },
    {
      key: 'product',
      header: c.columns.product,
      mobileTitle: true,
      wrap: true,
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
            // The row's product is named, not only its SKU (wig :336).
            aria-label={fill(c.countedLabelOf, { name: itemTitle(line, locale), sku: line.sku })}
            inputMode="numeric"
            min={0}
            value={values[line.variantId] ?? String(line.countedQuantity)}
            invalid={parseCounted(values[line.variantId] ?? '') === null}
            {...(parseCounted(values[line.variantId] ?? '') === null
              ? { 'aria-describedby': INVALID_ID }
              : {})}
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
        // Data, not a decoration: a signed tabular number (no circled pill); a shortfall or a surplus carries an arrow icon
        // and the status colour, a match stays plain. Nothing animates while it recalculates (G5).
        if (difference === null) return text.none;
        if (difference === 0)
          return <span className="ls-pos-figure">{signedNumber(locale, 0)}</span>;
        return (
          <span
            className={`ls-pos-figure ls-pos-diff ${difference < 0 ? 'ls-pos-diff-under' : 'ls-pos-diff-over'}`}
          >
            <Icon name={difference < 0 ? 'arrow-down' : 'arrow-up'} size={16} />
            {signedNumber(locale, difference)}
          </span>
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
                onClick={() => {
                  setRemoved((state) => [...state, line.variantId]);
                  // C72: "Hoàn tác" in the toast (8 s); without a toast provider, an inline line above the sheet.
                  if (toast) {
                    toast.push({
                      tone: 'info',
                      message: fill(c.removedLine, { sku: itemTitle(line, locale) }),
                      action: {
                        label: c.undo,
                        onAction: () =>
                          setRemoved((state) => state.filter((id) => id !== line.variantId)),
                      },
                    });
                  } else setLastRemoved(line);
                }}
              />
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <KitPageHeader
        title={fill(c.title, { code: count.code })}
        {...(editable && dirty ? { description: c.saveFirst } : {})}
        {...(!open ? { description: c.closedHint } : {})}
        // The count's status under the title (kit status slot), not buried among the facts (plan).
        status={<Badge tone={countTone(count.status)}>{text.counts.statuses[count.status]}</Badge>}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[
              {
                label: text.title,
                href: `${base}/inventory?${backQuery || `tab=counts&branch=${encodeURIComponent(count.branchId)}`}`,
              },
              { label: count.code },
            ]}
          />
        }
        actions={
          editable ? (
            // One filled button at a time: while counts are unsaved, "Lưu số đếm" is the primary and this waits as a secondary.
            <Button
              variant={dirty ? 'secondary' : 'primary'}
              disabled={dirty || count.lines.length === 0}
              // The blocked approve says why (wig Forms: no silently disabled action); the header says it too.
              {...(dirty ? { disabledReason: c.saveFirst } : {})}
              onClick={() => setOverlay('approve')}
            >
              {c.approve}
            </Button>
          ) : undefined
        }
      />
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
                label: c.fields.createdBy,
                value: fill(c.actorAt, {
                  name: count.createdByName,
                  time: formatDateTime(count.createdAt, ZONE, locale),
                }),
              },
              ...(count.approvedAt
                ? [
                    {
                      label: c.fields.approvedBy,
                      value: fill(c.actorAt, {
                        name: count.approvedByName ?? text.none,
                        time: formatDateTime(count.approvedAt, ZONE, locale),
                      }),
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
                  variant={dirty ? 'primary' : 'secondary'}
                  loading={command.pending}
                  disabled={!dirty}
                  onClick={() => void save()}
                >
                  {c.save}
                </Button>
              </>
            ) : undefined
          }
        >
          {editable && invalid ? (
            <div id={INVALID_ID}>
              <Notice tone="error">
                {fill(c.invalidCountedRows, {
                  names: listFormat(locale).format(
                    invalidLines.map((line) => itemTitle(line, locale)),
                  ),
                })}
              </Notice>
            </div>
          ) : null}
          {command.message ? <Notice tone="error">{command.message}</Notice> : null}
          {editable && lastRemoved && removed.includes(lastRemoved.variantId) ? (
            <div className="ls-pos-undo" role="status">
              <span>{fill(c.removedLine, { sku: itemTitle(lastRemoved, locale) })}</span>
              <Button
                variant="secondary"
                onClick={() => {
                  setRemoved((state) => state.filter((id) => id !== lastRemoved.variantId));
                  setLastRemoved(null);
                }}
              >
                {c.undo}
              </Button>
            </div>
          ) : null}
          <CountLines
            columns={columns}
            rows={visible}
            {...(page && onPage ? { page, onPage } : {})}
          />
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
  page: heldPage,
  onPage,
}: {
  columns: DataTableColumn<StockCountLineResponse>[];
  rows: StockCountLineResponse[];
  page?: SheetPage;
  onPage?: (page: SheetPage) => void;
}) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const [ownPage, setOwnPage] = useState<SheetPage>({ page: 1, pageSize: 20 });
  const page = heldPage ?? ownPage;
  const setPage = (update: (state: SheetPage) => SheetPage) =>
    onPage ? onPage(update(page)) : setOwnPage(update);
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
        // 20 rows a page, no page-size choice (DESIGN 8.8).
        onPageChange: (next) => setPage((state) => ({ ...state, page: next })),
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
    // A refused add moves focus to the first field that needs attention (wig Forms).
    if (!body) return focusFirstInvalid();
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

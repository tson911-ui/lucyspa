'use client';

import type {
  ProductOrderAllocateResponse,
  ProductOrderContextResponse,
  ProductOrderDetailLine,
  ProductOrderDetailResponse,
  ProductOrderQueueResponse,
  ProductOrderQueueRow,
  ProductOrderToOrderGroup,
  ProductOrderToOrderResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Cluster,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  MoneyInput,
  RadioGroup,
  RowActions,
  SearchInput,
  Select,
  Stack,
  Tabs,
  Textarea,
  TextInput,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useRef, useState } from 'react';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { fill } from '../../../i18n/workforce';
import { ApiError } from '../../../lib/workforce/api';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  cancelRequest,
  CANCEL_METHODS,
  declineNoteProblem,
  emptyCancelDraft,
  emptyHandOverDraft,
  expectedText,
  handOverRequest,
  HANDOVER_TARGETS,
  isQueueConflict,
  normalizeQueueList,
  orderStatusTone,
  QUEUE_LIST_DEFAULTS,
  QUEUE_PAGE_KEYS,
  QUEUE_TABS,
  queueErrorText,
  queueTab,
  validAmount,
  validateCancel,
  validateHandOver,
  type CancelDraft,
  type HandOverDraft,
  type QueueListState,
} from '../../../lib/workforce/product-orders';
import { productTitle } from '../../../lib/workforce/product-sale';
import { withReauthentication } from '../../../lib/workforce/reauth';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { errorMessage } from '../../../lib/workforce/workflows';
import { PrefetchLink as Link } from '../link';
import { useReauthentication } from '../reauth-dialog';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  PageHeader,
  Section,
  useResource,
  useSuccessToast,
  type Resource,
} from '../ui';

const ZONE = 'Asia/Ho_Chi_Minh';
const PAGE_SIZE = 20;
const NOTE_MAX = 500;
const REASON_MAX = 4000;

/** The branches the signed-in person may work the orders in, as the API reports them (it decides again on every request). */
function useOrderContext() {
  const { api } = useWorkforce();
  return useResource(
    () => api.get<ProductOrderContextResponse>('/api/v1/product-orders/context'),
    [api],
  );
}

/** The chosen branch when the person works the orders there, else the first such branch (null when none). */
function resolveBranch(context: ProductOrderContextResponse, chosen: string) {
  const working = context.branches.filter((branch) => branch.work);
  return working.find((branch) => branch.id === chosen) ?? working[0] ?? null;
}

// ----------------------------------------------------------------------------------------------------- the queue

export function ProductOrdersScreen() {
  const { t } = useWorkforce();
  const context = useOrderContext();
  if (context.error && !context.data) {
    return <ErrorState error={context.error} t={t} onRetry={() => void context.reload()} />;
  }
  if (!context.data) return <Loading t={t} page />;
  return <ProductOrdersView context={context.data} />;
}

/** The page: it fetches what the chosen tab shows and hands it to the list (which a test renders with data). */
export function ProductOrdersView({ context }: { context: ProductOrderContextResponse }) {
  const { api } = useWorkforce();
  const [list, updateList] = useUrlState(QUEUE_LIST_DEFAULTS, {
    normalize: normalizeQueueList,
    resetOnChange: QUEUE_PAGE_KEYS,
  });
  const branch = resolveBranch(context, list.branch);
  const tab = queueTab(list.tab);
  const queue = useResource(
    () =>
      branch && tab !== 'TO_ORDER'
        ? api.get<ProductOrderQueueResponse>('/api/v1/product-orders', {
            branchId: branch.id,
            tab,
            q: list.q,
            page: list.page,
          })
        : Promise.resolve(null),
    [api, branch?.id, tab, list.q, list.page],
  );
  const toOrder = useResource(
    () =>
      branch && tab === 'TO_ORDER'
        ? api.get<ProductOrderToOrderResponse>('/api/v1/product-orders/to-order', {
            branchId: branch.id,
          })
        : Promise.resolve(null),
    [api, branch?.id, tab],
  );
  return (
    <ProductOrdersList
      context={context}
      list={list}
      updateList={updateList}
      queue={queue}
      toOrder={toOrder}
    />
  );
}

/** "Hàng đặt trước": the lines of one branch by tab, oldest paid first; the tab, the search and the page live in the address bar. */
export function ProductOrdersList({
  context,
  list,
  updateList,
  queue,
  toOrder,
}: {
  context: ProductOrderContextResponse;
  list: QueueListState;
  updateList: (patch: Partial<QueueListState>, change?: { replace?: boolean }) => void;
  queue: Resource<ProductOrderQueueResponse | null>;
  toOrder: Resource<ProductOrderToOrderResponse | null>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const q = text.queue;
  const notify = useSuccessToast();
  const branch = resolveBranch(context, list.branch);
  const tab = queueTab(list.tab);
  const [allocating, setAllocating] = useState(false);
  const [allocateError, setAllocateError] = useState<string | null>(null);
  const [marking, setMarking] = useState<ProductOrderToOrderGroup | null>(null);
  const [handing, setHanding] = useState<ProductOrderQueueRow | null>(null);

  if (!branch) {
    return (
      <>
        <PageHeader title={q.title} />
        <Notice tone="info">{q.noAccess}</Notice>
      </>
    );
  }

  const reload = async () => {
    await Promise.all([queue.reload(), toOrder.reload()]);
  };

  async function allocate() {
    if (!branch || allocating) return;
    setAllocating(true);
    setAllocateError(null);
    try {
      const result = await api.post<ProductOrderAllocateResponse>(
        '/api/v1/product-orders/allocate',
        { branchId: branch.id },
      );
      notify(
        result.allocated > 0 ? fill(q.allocated, { count: result.allocated }) : q.allocatedNone,
      );
      await reload();
    } catch (error) {
      setAllocateError(queueErrorText(error, locale, (cause) => errorMessage(cause, t)));
    } finally {
      setAllocating(false);
    }
  }

  const branchControl =
    context.branches.filter((entry) => entry.work).length > 1 ? (
      <Select
        aria-label={q.branch}
        value={branch.id}
        options={context.branches
          .filter((entry) => entry.work)
          .map((entry) => ({ value: entry.id, label: entry.name }))}
        onChange={(event) => updateList({ branch: event.target.value })}
      />
    ) : null;

  const search = list.q.trim().toLocaleLowerCase(locale);
  const groups = (toOrder.data?.groups ?? []).filter(
    (group) =>
      search === '' ||
      [
        group.sku,
        group.nameVi,
        group.nameEn,
        group.supplier?.name ?? '',
        ...group.lines.map((l) => l.orderCode),
      ]
        .join(' ')
        .toLocaleLowerCase(locale)
        .includes(search),
  );
  const loaded = tab === 'TO_ORDER' ? toOrder.data !== null : queue.data !== null;
  const total = tab === 'TO_ORDER' ? groups.length : (queue.data?.total ?? 0);

  const panel = (
    <Stack gap="block">
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={list.q ? 1 : 0}
        resultCount={loaded ? resultsText(t, total) : undefined}
        onReset={() => updateList({ q: '' })}
        reload={{ label: t.common.reload, onClick: () => void reload() }}
        search={
          <SearchInput
            id="order-q"
            value={list.q}
            label={q.search}
            placeholder={q.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => updateList({ q: value }, { replace: true })}
          />
        }
        filters={branchControl}
      />
      {tab === 'TO_ORDER' ? (
        <ToOrderTable
          groups={groups}
          resource={toOrder}
          searching={list.q !== ''}
          onMark={setMarking}
        />
      ) : (
        <LinesTable
          rows={queue.data?.rows ?? []}
          resource={queue}
          tab={tab}
          list={list}
          updateList={updateList}
          onHandOver={setHanding}
        />
      )}
    </Stack>
  );

  return (
    <>
      <PageHeader title={q.title} intro={q.intro}>
        <Button icon="refresh" loading={allocating} onClick={() => void allocate()}>
          {allocating ? q.allocating : q.allocate}
        </Button>
      </PageHeader>
      {allocateError ? <Notice tone="error">{allocateError}</Notice> : null}
      <Tabs
        label={q.tabsLabel}
        value={tab}
        onChange={(next) => updateList({ tab: next })}
        tabs={QUEUE_TABS.map((id) => ({
          id,
          label: q.tabs[id],
          panel: id === tab ? panel : null,
        }))}
      />
      {marking ? (
        <MarkOrderedDialog
          group={marking}
          onClose={() => setMarking(null)}
          onDone={async () => {
            setMarking(null);
            notify(q.ordered);
            await reload();
          }}
          onConflict={reload}
        />
      ) : null}
      {handing ? (
        <HandOverDialog
          line={{
            id: handing.lineId,
            rowVersion: handing.rowVersion,
            name: productTitle(handing, locale),
            quantity: handing.quantity,
          }}
          onClose={() => setHanding(null)}
          onDone={async () => {
            setHanding(null);
            notify(text.handOver.done);
            await reload();
          }}
          onConflict={reload}
        />
      ) : null}
    </>
  );
}

function ToOrderTable({
  groups,
  resource,
  searching,
  onMark,
}: {
  groups: ProductOrderToOrderGroup[];
  resource: Resource<ProductOrderToOrderResponse | null>;
  searching: boolean;
  onMark: (group: ProductOrderToOrderGroup) => void;
}) {
  const { t, locale } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const q = text.queue;
  const paging = useClientPaging(t, q.title);
  const columns: DataTableColumn<ProductOrderToOrderGroup>[] = [
    {
      key: 'supplier',
      header: q.columns.supplier,
      truncate: true,
      width: 'lg',
      sortable: true,
      sortValue: (group) => group.supplier?.name ?? '￿',
      cell: (group) => group.supplier?.name ?? q.noSupplier,
    },
    {
      key: 'product',
      header: q.columns.product,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (group) => productTitle(group, locale),
    },
    {
      key: 'quantity',
      header: q.columns.quantity,
      numeric: true,
      cell: (group) => group.totalQuantity,
    },
    {
      key: 'orders',
      header: q.columns.orders,
      numeric: true,
      hideBelow: 'md',
      cell: (group) => group.lines.length,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (group) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: productTitle(group, locale) })}
          items={[
            {
              id: 'ordered',
              label: q.markOrdered,
              icon: 'check',
              onSelect: () => onMark(group),
            },
          ]}
        />
      ),
    },
  ];
  // Nothing here is one quiet line, not a boxed empty state.
  if (resource.data && !resource.error && groups.length === 0) {
    return <p className="ls-hint">{searching ? q.noMatch : q.empty.TO_ORDER}</p>;
  }
  return (
    <DataTable
      caption={fill(t.common.list.table, { list: q.tabs.TO_ORDER })}
      columns={columns}
      rows={groups}
      rowKey={(group) => group.variantId}
      loading={resource.loading && !resource.data}
      loadingLabel={t.common.loading}
      defaultSort={{ key: 'supplier', direction: 'asc' }}
      error={
        resource.error ? (
          <ErrorState error={resource.error} t={t} onRetry={() => void resource.reload()} />
        ) : undefined
      }
      paging={paging}
    />
  );
}

function LinesTable({
  rows,
  resource,
  tab,
  list,
  updateList,
  onHandOver,
}: {
  rows: ProductOrderQueueRow[];
  resource: Resource<ProductOrderQueueResponse | null>;
  tab: ReturnType<typeof queueTab>;
  list: QueueListState;
  updateList: (patch: Partial<QueueListState>) => void;
  onHandOver: (row: ProductOrderQueueRow) => void;
}) {
  const { t, locale, base, navigate } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const q = text.queue;
  const open = (row: ProductOrderQueueRow) => `${base}/product-orders/${row.orderId}`;
  const columns: DataTableColumn<ProductOrderQueueRow>[] = [
    {
      key: 'code',
      header: q.columns.code,
      mobileTitle: true,
      cell: (row) => (
        <Link className="ls-link" href={open(row)}>
          {row.orderCode}
        </Link>
      ),
    },
    {
      key: 'product',
      header: q.columns.product,
      phoneEmphasis: true,
      truncate: true,
      width: 'md',
      cell: (row) => productTitle(row, locale),
    },
    {
      key: 'quantity',
      header: q.columns.quantity,
      numeric: true,
      hidePhone: true,
      cell: (row) => row.quantity,
    },
    {
      key: 'customer',
      header: q.columns.customer,
      truncate: true,
      width: 'md',
      hideBelow: 'lg',
      hidePhone: true,
      cell: (row) => row.customerName ?? row.contactName ?? '—',
    },
    {
      key: 'phone',
      header: q.columns.phone,
      // The staff call the customer when the goods have arrived: there the number stays in view on a laptop.
      hideBelow: tab === 'ARRIVED' ? 'lg' : '2xl',
      hidePhone: tab !== 'ARRIVED',
      cell: (row) => row.contactPhone,
    },
    {
      key: 'status',
      header: q.columns.status,
      cell: (row) => (
        <Cluster gap="tight">
          <Badge tone={orderStatusTone(row.status)}>{text.status[row.status]}</Badge>
          {row.late ? <Badge tone="warning">{q.late}</Badge> : null}
          {row.heldTooLong ? <Badge tone="warning">{q.held}</Badge> : null}
        </Cluster>
      ),
    },
    // One date column that fits the tab: when it should come (ordered), when it came (arrived), when it was paid (the rest).
    tab === 'ORDERED'
      ? {
          key: 'expected',
          header: q.columns.expected,
          hideBelow: 'lg',
          hidePhone: true,
          cell: (row) => expectedText(row, locale, text.card),
        }
      : {
          key: 'when',
          header: tab === 'ARRIVED' ? q.columns.arrivedAt : q.columns.paidAt,
          hideBelow: tab === 'ARRIVED' ? 'lg' : 'xl',
          hidePhone: true,
          cell: (row) => {
            const instant = tab === 'ARRIVED' ? row.arrivedAt : row.paidAt;
            return instant ? formatDateTime(instant, ZONE, locale) : '—';
          },
        },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.orderCode })}
          items={[
            { id: 'open', label: q.open, icon: 'eye', onSelect: () => navigate?.(open(row)) },
            ...(row.status === 'ARRIVED'
              ? [
                  {
                    id: 'handover',
                    label: q.handOver,
                    icon: 'check' as const,
                    onSelect: () => onHandOver(row),
                  },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // Nothing here is one quiet line, not a boxed empty state.
  if (resource.data && !resource.error && rows.length === 0) {
    return <p className="ls-hint">{list.q ? q.noMatch : q.empty[tab]}</p>;
  }
  return (
    <DataTable
      phoneRows="compact"
      mode="server"
      caption={fill(t.common.list.table, { list: q.tabs[tab] })}
      columns={columns}
      rows={rows}
      rowKey={(row) => `${row.lineId}:${row.status}`}
      loading={resource.loading && !resource.data}
      loadingLabel={t.common.loading}
      error={
        resource.error ? (
          <ErrorState error={resource.error} t={t} onRetry={() => void resource.reload()} />
        ) : undefined
      }
      paging={{
        page: list.page,
        pageSize: PAGE_SIZE,
        total: resource.data?.total ?? rows.length,
        onPageChange: (page) => updateList({ page }),
        labels: paginationLabels(t, q.title),
      }}
    />
  );
}

// ------------------------------------------------------------------------------------------------ mark ordered

function MarkOrderedDialog({
  group,
  onClose,
  onDone,
  onConflict,
}: {
  group: ProductOrderToOrderGroup;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const q = productOrdersDictionary(locale).queue;
  return (
    <ConfirmDialog
      title={q.markTitle}
      description={fill(q.markBody, {
        quantity: group.totalQuantity,
        name: productTitle(group, locale),
      })}
      facts={[
        { label: q.markFactProduct, value: group.sku },
        { label: q.markFactOrders, value: String(group.lines.length) },
      ]}
      tone="neutral"
      confirmLabel={q.markConfirm}
      busyLabel={q.working}
      cancelLabel={q.markKeep}
      referenceLabel={t.errors.reference}
      describeError={(error) => ({
        message: queueErrorText(error, locale, (cause) => errorMessage(cause, t)),
        reference: error instanceof ApiError ? error.requestId : null,
      })}
      onCancel={onClose}
      onConfirm={async () => {
        try {
          await api.post('/api/v1/product-orders/mark-ordered', {
            lines: group.lines.map((line) => ({ id: line.lineId, rowVersion: line.rowVersion })),
          });
        } catch (error) {
          if (isQueueConflict(error)) await onConflict();
          throw error;
        }
        await onDone();
      }}
    />
  );
}

// ----------------------------------------------------------------------------------------------- hand over

export function HandOverDialog({
  line,
  onClose,
  onDone,
  onConflict,
}: {
  line: { id: string; rowVersion: number; name: string; quantity: number };
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const h = productOrdersDictionary(locale).handOver;
  const [draft, setDraft] = useState<HandOverDraft>(emptyHandOverDraft);
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problems = validateHandOver(draft);
  const set = (patch: Partial<HandOverDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = handOverRequest(draft, line.rowVersion);
    if (!body) return;
    setPending(true);
    try {
      await api.post(`/api/v1/product-orders/lines/${line.id}/hand-over`, body);
      await onDone();
    } catch (failure) {
      if (isQueueConflict(failure)) await onConflict();
      setError(queueErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={h.title}
      description={h.description}
      labels={{ ...formOverlayLabels(t, h.submit), submitting: h.submitting }}
      busy={pending}
      dirty={draft.orderCode !== '' || draft.last4 !== '' || draft.note !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <Notice tone="info">{`${line.quantity} × ${line.name}`}</Notice>
        <RadioGroup
          legend={h.to}
          name="handover-to"
          value={draft.to}
          onValueChange={(to) => set({ to: to as HandOverDraft['to'], representative: '' })}
          options={HANDOVER_TARGETS.map((value) => ({
            value,
            label: value === 'CUSTOMER' ? h.toCustomer : h.toRepresentative,
          }))}
        />
        <FormGrid>
          {draft.to === 'REPRESENTATIVE' ? (
            <Field
              label={h.representative}
              error={checked && problems.representative ? h.needRepresentative : undefined}
              required
              full
            >
              {(control) => (
                <TextInput
                  {...control}
                  autoComplete="off"
                  maxLength={120}
                  value={draft.representative}
                  onChange={(event) => set({ representative: event.target.value })}
                />
              )}
            </Field>
          ) : null}
          <Field
            label={h.code}
            error={checked && problems.orderCode ? h.needCode : undefined}
            required
          >
            {(control) => (
              <TextInput
                {...control}
                autoComplete="off"
                maxLength={40}
                value={draft.orderCode}
                onChange={(event) => set({ orderCode: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={h.last4}
            hint={h.last4Hint}
            error={checked && problems.last4 ? h.needLast4 : undefined}
            required
          >
            {(control) => (
              <TextInput
                {...control}
                inputMode="numeric"
                autoComplete="off"
                maxLength={4}
                value={draft.last4}
                onChange={(event) => set({ last4: event.target.value.replace(/\D/g, '') })}
              />
            )}
          </Field>
        </FormGrid>
        <FormGrid cols={1}>
          <Field label={h.note} hint={h.noteHint} full>
            {(control) => (
              <Textarea
                {...control}
                rows={2}
                maxLength={NOTE_MAX}
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      </Stack>
    </FormDialog>
  );
}

// ------------------------------------------------------------------------------------------------ one order

export function ProductOrderDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const found = useResource(
    () => api.get<ProductOrderDetailResponse>(`/api/v1/product-orders/${encodeURIComponent(id)}`),
    [api, id],
  );
  if (found.error && !found.data) {
    return <ErrorState error={found.error} t={t} onRetry={() => void found.reload()} />;
  }
  if (!found.data) return <Loading t={t} page />;
  return <ProductOrderDetailView order={found.data} reload={found.reload} />;
}

type Overlay =
  | { kind: 'handover'; line: ProductOrderDetailLine }
  | { kind: 'cancel'; line: ProductOrderDetailLine }
  | { kind: 'decline'; line: ProductOrderDetailLine }
  | { kind: 'correct'; line: ProductOrderDetailLine }
  | { kind: 'mark'; line: ProductOrderDetailLine }
  | null;

/** One order with its lines. The page has no primary action: every action belongs to a line, in its row menu. */
export function ProductOrderDetailView({
  order,
  reload,
}: {
  order: ProductOrderDetailResponse;
  reload: () => Promise<void>;
}) {
  const { api, t, locale, base } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const d = text.detail;
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const paging = useClientPaging(t, d.lines);
  const money = (value: string) => formatVnd(value, locale);

  /** What was given back and how (shown to those who may see the money): the amount, the way, the code, the reference. */
  const refundText = (refund: NonNullable<ProductOrderDetailLine['refund']>) =>
    [
      fill(d.refundLine, {
        amount: money(refund.amountVnd),
        method: d.methods[refund.method],
        code: refund.code,
      }),
      refund.bankReference ? fill(d.refundReference, { reference: refund.bankReference }) : '',
      refund.corrections > 0 ? fill(d.refundCorrected, { count: refund.corrections }) : '',
    ]
      .filter(Boolean)
      .join(' ');

  const columns: DataTableColumn<ProductOrderDetailLine>[] = [
    {
      key: 'product',
      header: d.columns.product,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (line) => productTitle(line, locale),
    },
    { key: 'quantity', header: d.columns.quantity, numeric: true, cell: (line) => line.quantity },
    {
      key: 'status',
      header: d.columns.status,
      cell: (line) => (
        <span className="ls-cell-stack">
          <Cluster gap="tight">
            <Badge tone={orderStatusTone(line.status)}>{text.status[line.status]}</Badge>
            {line.late ? <Badge tone="warning">{text.queue.late}</Badge> : null}
            {line.heldTooLong ? <Badge tone="warning">{text.queue.held}</Badge> : null}
          </Cluster>
          {line.cancelCause ? (
            <span className="ls-cell-sub">{text.card.cancelCause[line.cancelCause]}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'expected',
      header: d.columns.expected,
      hideBelow: 'lg',
      cell: (line) => expectedText(line, locale, text.card),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) => {
        const items = [
          ...(line.actions.markOrdered
            ? [
                {
                  id: 'mark',
                  label: d.markOrdered,
                  icon: 'check' as const,
                  onSelect: () => setOverlay({ kind: 'mark', line }),
                },
              ]
            : []),
          ...(line.actions.handOver
            ? [
                {
                  id: 'handover',
                  label: d.handOver,
                  icon: 'check' as const,
                  onSelect: () => setOverlay({ kind: 'handover', line }),
                },
              ]
            : []),
          ...(line.actions.cancelCauses.length > 0
            ? [
                {
                  id: 'cancel',
                  label: d.cancel,
                  tone: 'danger' as const,
                  onSelect: () => setOverlay({ kind: 'cancel', line }),
                },
              ]
            : []),
          ...(line.actions.cancelCauses.includes('CUSTOMER_CHANGED_MIND')
            ? [
                {
                  id: 'decline',
                  label: d.decline,
                  onSelect: () => setOverlay({ kind: 'decline', line }),
                },
              ]
            : []),
          ...(line.actions.correctReference
            ? [
                {
                  id: 'correct',
                  label: d.correct,
                  icon: 'edit' as const,
                  onSelect: () => setOverlay({ kind: 'correct', line }),
                },
              ]
            : []),
        ];
        return items.length > 0 ? (
          <RowActions
            menuLabel={fill(d.actionsFor, { name: productTitle(line, locale) })}
            items={items}
          />
        ) : null;
      },
    },
  ];

  const notices = [
    order.lines.some((line) => line.heldTooLong) ? d.held : null,
    order.lines.some((line) => line.late) ? d.late : null,
    order.invoiceStatus === 'CANCELLED' ? d.invoiceCancelled : null,
    order.invoiceStatus === 'PENDING_PAYMENT' ? d.notPaid : null,
  ].filter((entry): entry is string => entry !== null);

  const done = async (message: string) => {
    setOverlay(null);
    notify(message);
    await reload();
  };

  return (
    <>
      <PageHeader
        title={fill(d.title, { code: order.code })}
        breadcrumbs={
          <Breadcrumbs
            label={text.queue.breadcrumbs}
            LinkComponent={Link}
            items={[
              {
                label: text.queue.title,
                href: `${base}/product-orders?branch=${encodeURIComponent(order.branchId)}`,
              },
              { label: order.code },
            ]}
          />
        }
      />
      <Stack gap="page">
        {notices.map((notice) => (
          <Notice key={notice} tone="warning">
            {notice}
          </Notice>
        ))}
        <Section title={d.info}>
          <DescriptionList
            columns={2}
            items={[
              {
                label: d.fields.status,
                value: (
                  <Badge tone={orderStatusTone(order.status)}>{text.status[order.status]}</Badge>
                ),
              },
              { label: d.fields.invoice, value: order.invoiceCode },
              {
                label: order.contactMasked ? d.fields.phoneMasked : d.fields.phone,
                value: order.contactPhone,
              },
              ...(order.contactName ? [{ label: d.fields.name, value: order.contactName }] : []),
              ...(order.customer
                ? [{ label: d.fields.customer, value: order.customer.displayName }]
                : []),
              { label: d.fields.created, value: formatDateTime(order.createdAt, ZONE, locale) },
              // What was given back for a cancelled line (only for those who may see the money): one row each, full width of the card.
              ...order.lines.flatMap((line) =>
                line.refund
                  ? [
                      {
                        label: `${d.columns.refund}: ${productTitle(line, locale)}`,
                        value: refundText(line.refund),
                      },
                    ]
                  : [],
              ),
            ]}
          />
        </Section>
        <ListSection title={d.lines}>
          <DataTable
            caption={fill(t.common.list.table, { list: d.lines })}
            columns={columns}
            rows={order.lines}
            rowKey={(line) => `${line.id}:${line.status}:${line.rowVersion}`}
            loadingLabel={t.common.loading}
            paging={paging}
          />
        </ListSection>
      </Stack>
      {overlay?.kind === 'mark' ? (
        <ConfirmDialog
          title={text.queue.markTitle}
          description={fill(text.queue.markBody, {
            quantity: overlay.line.quantity,
            name: productTitle(overlay.line, locale),
          })}
          facts={[{ label: text.queue.markFactProduct, value: overlay.line.sku }]}
          tone="neutral"
          confirmLabel={text.queue.markConfirm}
          busyLabel={text.queue.working}
          cancelLabel={text.queue.markKeep}
          referenceLabel={t.errors.reference}
          describeError={(error) => ({
            message: queueErrorText(error, locale, (cause) => errorMessage(cause, t)),
            reference: error instanceof ApiError ? error.requestId : null,
          })}
          onCancel={() => setOverlay(null)}
          onConfirm={async () => {
            const line = overlay.line;
            try {
              await api.post('/api/v1/product-orders/mark-ordered', {
                lines: [{ id: line.id, rowVersion: line.rowVersion }],
              });
            } catch (error) {
              if (isQueueConflict(error)) await reload();
              throw error;
            }
            await done(text.queue.ordered);
          }}
        />
      ) : null}
      {overlay?.kind === 'handover' ? (
        <HandOverDialog
          line={{
            id: overlay.line.id,
            rowVersion: overlay.line.rowVersion,
            name: productTitle(overlay.line, locale),
            quantity: overlay.line.quantity,
          }}
          onClose={() => setOverlay(null)}
          onDone={() => done(text.handOver.done)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'cancel' ? (
        <CancelDialog
          line={overlay.line}
          onClose={() => setOverlay(null)}
          onDone={(refunded) => done(refunded ? text.cancel.done : text.cancel.doneNoMoney)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'decline' ? (
        <DeclineDialog
          line={overlay.line}
          onClose={() => setOverlay(null)}
          onDone={() => done(text.decline.done)}
          onConflict={reload}
        />
      ) : null}
      {overlay?.kind === 'correct' ? (
        <CorrectDialog
          line={overlay.line}
          onClose={() => setOverlay(null)}
          onDone={() => done(text.correct.done)}
          onConflict={reload}
        />
      ) : null}
    </>
  );
}

// ------------------------------------------------------------------------------------------ cancel + refund

export function CancelDialog({
  line,
  onClose,
  onDone,
  onConflict,
}: {
  line: ProductOrderDetailLine;
  onClose: () => void;
  onDone: (refunded: boolean) => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const c = text.cancel;
  const { confirm, dialog } = useReauthentication();
  const [draft, setDraft] = useState<CancelDraft>(() => ({
    ...emptyCancelDraft(),
    cause: line.actions.cancelCauses.length === 1 ? (line.actions.cancelCauses[0] as never) : '',
    // A change of mind starts at the whole share; the Owner or a manager lowers it when they decide so.
    amount: line.actions.cancelCauses.length === 1 ? line.actions.refundVnd : '',
  }));
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(globalThis.crypto.randomUUID());
  const share = line.actions.refundVnd;
  const problems = validateCancel(draft, share);
  const set = (patch: Partial<CancelDraft>) => setDraft((state) => ({ ...state, ...patch }));
  const money = share !== '0';
  const partial =
    money &&
    draft.cause === 'CUSTOMER_CHANGED_MIND' &&
    validAmount(draft.amount, share) &&
    draft.amount.trim() !== share;
  const causes = line.actions.cancelCauses.filter((cause) => cause !== 'INVOICE_CANCELLED');
  const arrived = line.status === 'ARRIVED';

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    const body = cancelRequest(draft, line.rowVersion, requestId.current, share);
    if (!body) return;
    setPending(true);
    try {
      await withReauthentication(
        () => api.post(`/api/v1/product-orders/lines/${line.id}/cancel`, body),
        confirm,
      );
      await onDone(money);
    } catch (failure) {
      // Cancelling the password confirmation is not an error: nothing was saved.
      if (!(failure instanceof Error && failure.name === 'ReauthenticationCancelled')) {
        if (isQueueConflict(failure)) await onConflict();
        setError(queueErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      }
      setPending(false);
    }
  }

  return (
    <>
      <FormDialog
        title={c.title}
        description={c.description}
        labels={{ ...formOverlayLabels(t, c.submit), submitting: c.submitting }}
        busy={pending}
        dirty={draft.note !== '' || draft.bankReference !== '' || partial}
        error={error ? <Notice tone="error">{error}</Notice> : undefined}
        onClose={onClose}
        onSubmit={submit}
      >
        <Stack gap="page">
          <Notice tone="info">{`${line.quantity} × ${productTitle(line, locale)}`}</Notice>
          {causes.length === 0 ? <Notice tone="warning">{c.noCause}</Notice> : null}
          <FormGrid>
            <Field
              label={c.cause}
              hint={c.causeHint}
              error={checked && problems.cause ? c.required : undefined}
              required
              full
            >
              {(control) => (
                <Select
                  {...control}
                  value={draft.cause}
                  placeholder={c.causePlaceholder}
                  options={causes.map((value) => ({
                    value,
                    label: text.card.cancelCause[value],
                  }))}
                  onChange={(event) => {
                    const cause = event.target.value as CancelDraft['cause'];
                    set({ cause, amount: cause === 'CUSTOMER_CHANGED_MIND' ? share : '' });
                  }}
                />
              )}
            </Field>
            {money && draft.cause === 'CUSTOMER_CHANGED_MIND' ? (
              <Field
                label={c.amountField}
                hint={c.amountHint}
                error={
                  checked && problems.amount
                    ? fill(c.badAmount, { share: formatVnd(share, locale) })
                    : undefined
                }
                required
                full
              >
                {(control) => (
                  <MoneyInput
                    {...control}
                    unit="₫"
                    value={draft.amount === '' ? null : Number(draft.amount)}
                    onValueChange={(value) => set({ amount: value === null ? '' : String(value) })}
                  />
                )}
              </Field>
            ) : null}
            {money ? (
              <Field label={c.method} required>
                {(control) => (
                  <Select
                    {...control}
                    value={draft.method}
                    options={CANCEL_METHODS.map((value) => ({
                      value,
                      label: c.methodOptions[value],
                    }))}
                    onChange={(event) =>
                      set({
                        method: event.target.value as CancelDraft['method'],
                        bankReference: '',
                      })
                    }
                  />
                )}
              </Field>
            ) : null}
            {money && draft.method === 'BANK_TRANSFER_MANUAL' ? (
              <Field
                label={c.reference}
                hint={c.referenceHint}
                error={checked && problems.bankReference ? c.badReference : undefined}
                required
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
          <FormGrid cols={1}>
            <Field
              label={c.note}
              hint={c.noteHint}
              error={checked && problems.note ? c.required : undefined}
              required
              full
            >
              {(control) => (
                <Textarea
                  {...control}
                  rows={3}
                  maxLength={REASON_MAX}
                  value={draft.note}
                  onChange={(event) => set({ note: event.target.value })}
                />
              )}
            </Field>
          </FormGrid>
          <Notice tone="info">
            {!money
              ? c.noAmount
              : partial
                ? fill(c.partial, {
                    amount: formatVnd(draft.amount.trim(), locale),
                    share: formatVnd(share, locale),
                  })
                : fill(c.amount, { amount: formatVnd(share, locale) })}
          </Notice>
          {arrived ? <p className="ls-hint">{c.goods}</p> : null}
          {money ? <Notice tone="warning">{c.warning}</Notice> : null}
          {money ? <p className="ls-hint">{c.owner}</p> : null}
        </Stack>
      </FormDialog>
      {dialog}
    </>
  );
}

// ------------------------------------------------------------------------------------ decline a change of mind

function DeclineDialog({
  line,
  onClose,
  onDone,
  onConflict,
}: {
  line: ProductOrderDetailLine;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const f = text.decline;
  const [note, setNote] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bad = declineNoteProblem(note);

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    if (bad) return;
    setPending(true);
    try {
      await api.post(`/api/v1/product-orders/lines/${line.id}/decline`, {
        expectedVersion: line.rowVersion,
        note: note.trim(),
      });
      await onDone();
    } catch (failure) {
      if (isQueueConflict(failure)) await onConflict();
      setError(queueErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={f.title}
      description={f.description}
      labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
      busy={pending}
      dirty={note !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <Notice tone="info">{`${line.quantity} × ${productTitle(line, locale)}`}</Notice>
        <FormGrid cols={1}>
          <Field
            label={f.reason}
            hint={f.reasonHint}
            error={checked && bad ? text.cancel.required : undefined}
            required
            full
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={REASON_MAX}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </Stack>
    </FormDialog>
  );
}

// ---------------------------------------------------------------------------------------- correct a reference

function CorrectDialog({
  line,
  onClose,
  onDone,
  onConflict,
}: {
  line: ProductOrderDetailLine;
  onClose: () => void;
  onDone: () => Promise<void>;
  onConflict: () => Promise<void>;
}) {
  const { api, t, locale } = useWorkforce();
  const text = productOrdersDictionary(locale);
  const f = text.correct;
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const badReference = reference.trim() === '' || [...reference.trim()].length > 64;
  const badReason = reason.trim() === '';

  async function submit() {
    if (pending) return;
    setChecked(true);
    setError(null);
    if (badReference || badReason) return;
    setPending(true);
    try {
      await api.post(`/api/v1/product-orders/lines/${line.id}/reference-correction`, {
        bankReference: reference.trim(),
        reason: reason.trim(),
      });
      await onDone();
    } catch (failure) {
      if (isQueueConflict(failure)) await onConflict();
      setError(queueErrorText(failure, locale, (cause) => errorMessage(cause, t)));
      setPending(false);
    }
  }

  return (
    <FormDialog
      title={f.title}
      description={f.description}
      labels={{ ...formOverlayLabels(t, f.submit), submitting: f.submitting }}
      busy={pending}
      dirty={reference !== '' || reason !== ''}
      error={error ? <Notice tone="error">{error}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      <Stack gap="page">
        <FormGrid cols={1}>
          <Field
            label={f.reference}
            error={checked && badReference ? text.cancel.badReference : undefined}
            required
            full
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
            label={f.reason}
            error={checked && badReason ? text.cancel.required : undefined}
            required
            full
          >
            {(control) => (
              <Textarea
                {...control}
                rows={3}
                maxLength={REASON_MAX}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
        </FormGrid>
      </Stack>
    </FormDialog>
  );
}

'use client';

import type {
  OnlineContextResponse,
  OnlineQueueResponse,
  OnlineQueueRow,
  OnlineStaffLine,
  OnlineStaffOrderResponse,
  OnlineStaffReturnCase,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Cluster,
  DataTable,
  DescriptionList,
  ListSection,
  ListToolbar,
  RowActions,
  SearchInput,
  Select,
  Stack,
  Tabs,
  useUrlState,
  type DataTableColumn,
  type DescriptionItem,
} from '@lucy-spa/ui';
import { useEffect, useState } from 'react';
import { onlineFulfilmentDictionary } from '../../../i18n/online-fulfilment';
import { productOrdersDictionary } from '../../../i18n/product-orders';
import { fill } from '../../../i18n/workforce';
import { formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { paginationLabels, resultsText, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  bigOf,
  logKindsFor,
  normalizeOnlineList,
  ONLINE_LIST_DEFAULTS,
  ONLINE_PAGE_KEYS,
  ONLINE_TABS,
  onlineStateTone,
  onlineTab,
  resolveOnlineBranch,
  seeableBranches,
  type OnlineListState,
} from '../../../lib/workforce/online-orders';
import { expectedText, orderStatusTone } from '../../../lib/workforce/product-orders';
import { productTitle } from '../../../lib/workforce/product-sale';
import { useClientPaging } from '../../../lib/workforce/use-client-paging';
import { PrefetchLink as Link } from '../link';
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
import {
  AddressDialog,
  CorrectShipmentDialog,
  DeliveredDialog,
  LogDialog,
  OnlineCancelDialog,
  ReturnCostDialog,
  ReturnedDialog,
  SettleDialog,
  ShipDialog,
} from './online-order-dialogs';

const ZONE = 'Asia/Ho_Chi_Minh';
const PAGE_SIZE = 20;

type Order = OnlineStaffOrderResponse;

// ----------------------------------------------------------------------------------------------------- the queue

export function OnlineOrdersScreen() {
  const { api, t } = useWorkforce();
  const context = useResource(
    () => api.get<OnlineContextResponse>('/api/v1/online-orders/context'),
    [api],
  );
  if (context.error && !context.data) {
    return <ErrorState error={context.error} t={t} onRetry={() => void context.reload()} />;
  }
  if (!context.data) return <Loading t={t} page />;
  return <OnlineOrdersView context={context.data} />;
}

/** The page: it fetches what the chosen tab shows and hands it to the list (which a test renders with data). */
export function OnlineOrdersView({ context }: { context: OnlineContextResponse }) {
  const { api } = useWorkforce();
  const [list, updateList] = useUrlState(ONLINE_LIST_DEFAULTS, {
    normalize: normalizeOnlineList,
    resetOnChange: ONLINE_PAGE_KEYS,
  });
  const branch = resolveOnlineBranch(context, list.branch);
  const tab = onlineTab(list.tab);
  const queue = useResource(
    () =>
      branch
        ? api.get<OnlineQueueResponse>('/api/v1/online-orders', {
            branchId: branch.id,
            tab,
            q: list.q,
            page: list.page,
          })
        : Promise.resolve(null),
    [api, branch?.id, tab, list.q, list.page],
  );
  return <OnlineOrdersList context={context} list={list} updateList={updateList} queue={queue} />;
}

/** "Đơn online": the orders of one branch by tab; the tab, the search and the page live in the address bar. */
export function OnlineOrdersList({
  context,
  list,
  updateList,
  queue,
}: {
  context: OnlineContextResponse;
  list: OnlineListState;
  updateList: (patch: Partial<OnlineListState>, change?: { replace?: boolean }) => void;
  queue: Resource<OnlineQueueResponse | null>;
}) {
  const { t, locale } = useWorkforce();
  const q = onlineFulfilmentDictionary(locale).queue;
  const branch = resolveOnlineBranch(context, list.branch);
  const tab = onlineTab(list.tab);

  if (!branch) {
    return (
      <>
        <PageHeader title={q.title} />
        <Notice tone="info">{q.noAccess}</Notice>
      </>
    );
  }

  const branches = seeableBranches(context);
  const panel = (
    <Stack gap="block">
      <ListToolbar
        labels={toolbarLabels(t)}
        activeFilters={list.q ? 1 : 0}
        resultCount={queue.data ? resultsText(t, queue.data.total) : undefined}
        onReset={() => updateList({ q: '' })}
        reload={{ label: t.common.reload, onClick: () => void queue.reload() }}
        search={
          <SearchInput
            id="online-q"
            value={list.q}
            label={q.search}
            placeholder={q.search}
            clearLabel={t.common.list.clearSearch}
            onSearch={(value) => updateList({ q: value }, { replace: true })}
          />
        }
        filters={
          branches.length > 1 ? (
            <Select
              aria-label={q.branch}
              value={branch.id}
              options={branches.map((entry) => ({ value: entry.id, label: entry.name }))}
              onChange={(event) => updateList({ branch: event.target.value })}
            />
          ) : null
        }
      />
      <OrdersTable
        rows={queue.data?.rows ?? []}
        resource={queue}
        tab={tab}
        list={list}
        updateList={updateList}
      />
    </Stack>
  );

  return (
    <>
      <PageHeader title={q.title} intro={q.intro} />
      <Tabs
        label={q.tabsLabel}
        value={tab}
        onChange={(next) => updateList({ tab: next })}
        tabs={ONLINE_TABS.map((id) => ({
          id,
          label: q.tabs[id],
          panel: id === tab ? panel : null,
        }))}
      />
    </>
  );
}

function OrdersTable({
  rows,
  resource,
  tab,
  list,
  updateList,
}: {
  rows: OnlineQueueRow[];
  resource: Resource<OnlineQueueResponse | null>;
  tab: ReturnType<typeof onlineTab>;
  list: OnlineListState;
  updateList: (patch: Partial<OnlineListState>) => void;
}) {
  const { t, locale, base, navigate } = useWorkforce();
  const text = onlineFulfilmentDictionary(locale);
  const q = text.queue;
  const open = (row: OnlineQueueRow) => `${base}/online-orders/${row.orderId}`;
  const shipped = tab === 'SHIPPED' || tab === 'DELIVERY_FAILED' || tab === 'DONE';
  const when = (row: OnlineQueueRow) => {
    const instant =
      tab === 'TO_SHIP'
        ? row.readyAt
        : tab === 'SHIPPED' || tab === 'DELIVERY_FAILED'
          ? row.shippedAt
          : tab === 'CANCELLED'
            ? row.placedAt
            : row.paidAt;
    return instant ? formatDateTime(instant, ZONE, locale) : '—';
  };
  const columns: DataTableColumn<OnlineQueueRow>[] = [
    {
      key: 'code',
      header: q.columns.code,
      mobileTitle: true,
      cell: (row) => (
        <Link className="ls-link" href={open(row)}>
          {row.code}
        </Link>
      ),
    },
    {
      key: 'recipient',
      header: q.columns.recipient,
      phoneEmphasis: true,
      truncate: true,
      width: 'md',
      cell: (row) => (
        <span className="ls-cell-stack">
          <span>{row.recipientName}</span>
          <span className="ls-cell-sub">{row.recipientPhoneMasked}</span>
        </span>
      ),
    },
    {
      key: 'province',
      header: q.columns.province,
      truncate: true,
      width: 'sm',
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => row.provinceName,
    },
    {
      key: 'items',
      header: q.columns.items,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => (
        <span className="ls-cell-stack">
          <span>{fill(q.items, { lines: row.lineCount, quantity: row.quantity })}</span>
          {row.hasPreOrder ? <span className="ls-cell-sub">{q.preOrder}</span> : null}
        </span>
      ),
    },
    {
      key: 'total',
      header: q.columns.total,
      numeric: true,
      cell: (row) => formatVnd(row.totalVnd, locale),
    },
    {
      key: 'status',
      header: q.columns.status,
      cell: (row) => (
        // One badge a row keeps every row one height: a missed deadline is the more useful word than the state.
        <Badge tone={row.late || row.overdueDelivery ? 'warning' : onlineStateTone(row.state)}>
          {row.late ? q.late : row.overdueDelivery ? q.overdue : text.states[row.state]}
        </Badge>
      ),
    },
    {
      key: 'when',
      header:
        tab === 'TO_SHIP'
          ? q.columns.readyAt
          : tab === 'SHIPPED' || tab === 'DELIVERY_FAILED'
            ? q.columns.shippedAt
            : tab === 'CANCELLED'
              ? q.columns.placedAt
              : q.columns.paidAt,
      hideBelow: 'xl',
      hidePhone: true,
      cell: when,
    },
    ...(shipped
      ? [
          {
            key: 'carrier',
            header: q.columns.carrier,
            truncate: true,
            width: 'sm' as const,
            hideBelow: '2xl' as const,
            cell: (row: OnlineQueueRow) =>
              row.carrierName
                ? row.trackingCode
                  ? `${row.carrierName}, ${row.trackingCode}`
                  : row.carrierName
                : '—',
          },
        ]
      : []),
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (row) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: row.code })}
          items={[
            { id: 'open', label: q.open, icon: 'eye', onSelect: () => navigate?.(open(row)) },
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
      mode="server"
      phoneRows="compact"
      caption={fill(t.common.list.table, { list: q.tabs[tab] })}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.orderId}
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

// ------------------------------------------------------------------------------------------------ one order

export function OnlineOrderDetailScreen({ id }: { id: string }) {
  const { api, t } = useWorkforce();
  const found = useResource(
    () => api.get<Order>(`/api/v1/online-orders/${encodeURIComponent(id)}`),
    [api, id],
  );
  // A command answers with the whole order: it is shown at once; a reload (a conflict) replaces it again.
  const [current, setCurrent] = useState<Order | null>(null);
  useEffect(() => setCurrent(null), [found.data]);
  const order = current ?? found.data;
  if (found.error && !order) {
    return <ErrorState error={found.error} t={t} onRetry={() => void found.reload()} />;
  }
  if (!order) return <Loading t={t} page />;
  return <OnlineOrderDetailView order={order} reload={found.reload} onChange={setCurrent} />;
}

type Overlay =
  | { kind: 'ship' }
  | { kind: 'correctShipment' }
  | { kind: 'delivered' }
  | { kind: 'log' }
  | { kind: 'returned' }
  | { kind: 'address' }
  | { kind: 'settle' }
  | { kind: 'cancel'; line: OnlineStaffLine }
  | { kind: 'cost'; returnCase: OnlineStaffReturnCase }
  | null;

type Step = 'ship' | 'settle' | 'returned' | 'delivered';

/** The next step of the order for this person, or null: it is the page's one primary action. */
export function nextStep(order: Pick<Order, 'can' | 'returnStarted'>): Step | null {
  if (order.can.ship) return 'ship';
  if (order.can.settleFailedDelivery) return 'settle';
  if (order.can.markReturned) return 'returned';
  if (order.can.markDelivered) return 'delivered';
  return null;
}

/** One order: its facts in cards, its lines, delivery log and returns as lists, every action where the rules put it. */
export function OnlineOrderDetailView({
  order,
  reload,
  onChange,
}: {
  order: Order;
  reload: () => Promise<void>;
  onChange?: (order: Order) => void;
}) {
  const { t, locale, base } = useWorkforce();
  const text = onlineFulfilmentDictionary(locale);
  const d = text.detail;
  const orders = productOrdersDictionary(locale);
  const notify = useSuccessToast();
  const [overlay, setOverlay] = useState<Overlay>(null);
  const money = (value: string) => formatVnd(value, locale);
  const when = (instant: string) => formatDateTime(instant, ZONE, locale);
  const step = nextStep(order);
  const kinds = logKindsFor(order);
  const linesPaging = useClientPaging(t, d.lines);
  const logPaging = useClientPaging(t, d.log);
  const returnsPaging = useClientPaging(t, d.returns);

  const done = (message: string) => async (next: Order) => {
    setOverlay(null);
    notify(message);
    onChange?.(next);
  };
  const common = {
    order,
    onClose: () => setOverlay(null),
    onConflict: reload,
  };

  const waiting = order.lines.filter((line) => line.status !== 'CANCELLED' && !line.ready);
  const notices = [
    order.state === 'AWAITING_PAYMENT' ? d.notices.awaitingPayment : null,
    order.state === 'WAITING_GOODS' && waiting.length > 0
      ? fill(d.notices.waitingGoods, {
          names: waiting.map((line) => productTitle(line, locale)).join(', '),
        })
      : null,
    order.state === 'CANCELLED' && order.settlement === null ? d.notices.cancelled : null,
    order.returnedToShop && order.settlement === null ? d.notices.returnedToShop : null,
    order.returnStarted && !order.returnedToShop ? d.notices.returnStarted : null,
    order.deliveryFailed && !order.returnStarted && !order.returnedToShop
      ? d.notices.deliveryFailed
      : null,
  ].filter((entry): entry is string => entry !== null);

  const recipient = order.recipient;
  const address = [recipient.street, recipient.ward, recipient.provinceName]
    .filter((part) => part !== '')
    .join(', ');

  // A column that is empty on every row only adds noise: expected dates belong to pre-orders, refunds to cancelled lines.
  const showExpected = order.lines.some(
    (line) =>
      line.mode === 'PRE_ORDER' && line.status !== 'CANCELLED' && line.status !== 'COMPLETED',
  );
  const showRefunded = order.lines.some((line) => line.refundedVnd !== null);
  const lineColumns: DataTableColumn<OnlineStaffLine>[] = [
    {
      key: 'product',
      header: d.linesColumns.product,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (line) => (
        <span className="ls-cell-stack">
          <span className="ls-cell-title">{`${line.sequence}. ${productTitle(line, locale)}`}</span>
          <span className="ls-cell-sub">{line.sku}</span>
          {line.cancelCause ? (
            <span className="ls-cell-sub">{orders.card.cancelCause[line.cancelCause]}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'quantity',
      header: d.linesColumns.quantity,
      numeric: true,
      cell: (line) => line.quantity,
    },
    {
      key: 'unit',
      header: d.linesColumns.unit,
      numeric: true,
      hideBelow: 'lg',
      cell: (line) => money(line.unitPriceVnd),
    },
    {
      key: 'total',
      header: d.linesColumns.total,
      numeric: true,
      cell: (line) => money(line.lineTotalVnd),
    },
    {
      key: 'status',
      header: d.linesColumns.status,
      cell: (line) => (
        <span className="ls-cell-stack">
          <Cluster gap="tight">
            <Badge tone={orderStatusTone(line.status)}>{orders.status[line.status]}</Badge>
            {line.mode === 'PRE_ORDER' ? <Badge tone="info">{d.preOrder}</Badge> : null}
            {line.ready && order.can.ship ? <Badge tone="success">{d.ready}</Badge> : null}
          </Cluster>
        </span>
      ),
    },
    ...(showExpected
      ? ([
          {
            key: 'expected',
            header: d.linesColumns.expected,
            hideBelow: 'xl',
            cell: (line) =>
              line.mode === 'PRE_ORDER' &&
              line.status !== 'CANCELLED' &&
              line.status !== 'COMPLETED'
                ? expectedText(line, locale, orders.card)
                : '—',
          },
        ] as DataTableColumn<OnlineStaffLine>[])
      : []),
    ...(showRefunded
      ? ([
          {
            key: 'refunded',
            header: d.linesColumns.refunded,
            numeric: true,
            hideBelow: 'lg',
            cell: (line) => (line.refundedVnd ? money(line.refundedVnd) : '—'),
          },
        ] as DataTableColumn<OnlineStaffLine>[])
      : []),
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (line) =>
        line.cancelCauses.length > 0 ? (
          <RowActions
            menuLabel={fill(d.actionsFor, { name: productTitle(line, locale) })}
            items={[
              {
                id: 'cancel',
                label: d.cancelLine,
                tone: 'danger' as const,
                onSelect: () => setOverlay({ kind: 'cancel', line }),
              },
            ]}
          />
        ) : null,
    },
  ];

  const logColumns: DataTableColumn<Order['logs'][number]>[] = [
    {
      key: 'time',
      header: d.logColumns.time,
      cell: (log) => when(log.occurredAt),
    },
    {
      key: 'kind',
      header: d.logColumns.kind,
      mobileTitle: true,
      cell: (log) => text.log.kinds[log.kind],
    },
    {
      key: 'reason',
      header: d.logColumns.reason,
      hideBelow: 'md',
      cell: (log) => (log.reasonCode ? text.log.reasons[log.reasonCode] : '—'),
    },
    {
      key: 'note',
      header: d.logColumns.note,
      wrap: true,
      width: 'lg',
      cell: (log) => log.note ?? '—',
    },
    {
      key: 'by',
      header: d.logColumns.by,
      hideBelow: 'lg',
      truncate: true,
      width: 'sm',
      cell: (log) =>
        log.actorKind === 'STAFF' ? (log.actorName ?? '—') : d.logActors[log.actorKind],
    },
  ];

  const returnColumns: DataTableColumn<OnlineStaffReturnCase>[] = [
    { key: 'code', header: d.returnsColumns.code, mobileTitle: true, cell: (item) => item.code },
    {
      key: 'status',
      header: d.returnsColumns.status,
      cell: (item) => (
        <Badge tone={item.status === 'ACCEPTED' ? 'success' : 'neutral'}>
          {d.returnStatus[item.status]}
        </Badge>
      ),
    },
    {
      key: 'reason',
      header: d.returnsColumns.reason,
      hideBelow: 'md',
      cell: (item) => d.returnReason[item.reason],
    },
    {
      key: 'quantity',
      header: d.returnsColumns.quantity,
      numeric: true,
      cell: (item) => item.quantity,
    },
    {
      key: 'cost',
      header: d.returnsColumns.cost,
      numeric: true,
      hideBelow: 'md',
      cell: (item) => (item.returnCostVnd === null ? '—' : money(item.returnCostVnd)),
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => {
        const items = [
          ...(order.can.recordReturnCost && item.returnCostVnd !== null
            ? [
                {
                  id: 'cost',
                  label: d.recordCost,
                  icon: 'edit' as const,
                  onSelect: () => setOverlay({ kind: 'cost', returnCase: item }),
                },
              ]
            : []),
        ];
        return items.length > 0 ? (
          <RowActions menuLabel={fill(d.actionsFor, { name: item.code })} items={items} />
        ) : null;
      },
    },
  ];

  const shipment = order.shipment;
  const shipmentItems: DescriptionItem[] = shipment
    ? [
        { label: d.shipmentFields.carrier, value: shipment.carrierName },
        {
          label: d.shipmentFields.tracking,
          value: shipment.trackingUrl ? (
            <a
              className="ls-link"
              href={shipment.trackingUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {shipment.trackingCode}
              <span className="ls-hint">{` (${d.shipmentFields.track})`}</span>
            </a>
          ) : (
            shipment.trackingCode
          ),
        },
        { label: d.shipmentFields.shippedAt, value: when(shipment.shippedAt) },
        { label: d.shipmentFields.shippedBy, value: shipment.shippedByName },
        ...(shipment.carrierFeeOutVnd !== null
          ? [{ label: d.shipmentFields.fee, value: money(shipment.carrierFeeOutVnd) }]
          : []),
        ...(order.deliveredAt
          ? [
              {
                label: d.shipmentFields.deliveredAt,
                value: order.deliveredBy
                  ? `${when(order.deliveredAt)} (${d.shipmentFields.deliveredBy[order.deliveredBy]})`
                  : when(order.deliveredAt),
              },
            ]
          : []),
        ...shipment.corrections.map((fix, index) => ({
          label: fill(d.shipmentFields.correction, { number: shipment.corrections.length - index }),
          value: `${fill(d.shipmentFields.correctionText, {
            time: when(fix.occurredAt),
            actor: fix.actorName,
            code: fix.trackingCode,
            reason: fix.reason,
          })}${
            fix.carrierFeeOutVnd === null
              ? ''
              : ` ${fill(d.shipmentFields.correctionFee, { fee: money(fix.carrierFeeOutVnd) })}`
          }`,
        })),
      ]
    : [];

  const settlement = order.settlement;

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
                href: `${base}/online-orders?branch=${encodeURIComponent(order.branchId)}`,
              },
              { label: order.code },
            ]}
          />
        }
      >
        {order.can.markDelivered && step !== 'delivered' ? (
          <Button
            variant="secondary"
            icon="check"
            onClick={() => setOverlay({ kind: 'delivered' })}
          >
            {d.actions.markDelivered}
          </Button>
        ) : null}
        {step ? (
          <Button
            variant="primary"
            icon={step === 'ship' ? 'truck' : 'check'}
            onClick={() => setOverlay({ kind: step })}
          >
            {step === 'ship'
              ? d.actions.ship
              : step === 'settle'
                ? d.actions.settle
                : step === 'returned'
                  ? d.actions.markReturned
                  : d.actions.markDelivered}
          </Button>
        ) : null}
      </PageHeader>
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
                  <Badge tone={onlineStateTone(order.state)}>{text.states[order.state]}</Badge>
                ),
              },
              { label: d.fields.invoice, value: order.invoiceCode },
              ...(order.customer
                ? [{ label: d.fields.customer, value: order.customer.displayName }]
                : []),
              { label: d.fields.placedAt, value: when(order.placedAt) },
              ...(order.paidAt ? [{ label: d.fields.paidAt, value: when(order.paidAt) }] : []),
              { label: d.fields.total, value: money(order.totalVnd) },
              {
                label: d.fields.shippingFee,
                value:
                  bigOf(order.shippingFeeVnd) > 0n ? money(order.shippingFeeVnd) : d.fields.free,
              },
            ]}
          />
        </Section>
        <Section
          title={d.address}
          actions={
            order.can.correctAddress ? (
              <Button
                variant="secondary"
                icon="edit"
                onClick={() => setOverlay({ kind: 'address' })}
              >
                {d.actions.correctAddress}
              </Button>
            ) : undefined
          }
        >
          <Stack gap="block">
            <DescriptionList
              columns={2}
              items={[
                { label: d.addressFields.recipient, value: recipient.name },
                { label: d.addressFields.phone, value: recipient.phone },
                { label: d.addressFields.address, value: address },
              ]}
            />
            {recipient.corrected ? <p className="ls-hint">{d.addressCorrected}</p> : null}
          </Stack>
        </Section>
        <Section
          title={d.shipment}
          actions={
            order.can.correctShipment ? (
              <Button
                variant="secondary"
                icon="edit"
                onClick={() => setOverlay({ kind: 'correctShipment' })}
              >
                {d.actions.correctShipment}
              </Button>
            ) : undefined
          }
        >
          {shipment ? (
            <Stack gap="block">
              <DescriptionList columns={2} items={shipmentItems} />
              {shipment.carrierFeeOutVnd !== null ? (
                <p className="ls-hint">{d.internalFee}</p>
              ) : null}
            </Stack>
          ) : (
            <p className="ls-hint">{d.notShipped}</p>
          )}
        </Section>
        <ListSection title={d.lines}>
          <DataTable
            caption={fill(t.common.list.table, { list: d.lines })}
            columns={lineColumns}
            rows={order.lines}
            rowKey={(line) => `${line.id}:${line.status}:${line.rowVersion}`}
            loadingLabel={t.common.loading}
            paging={linesPaging}
          />
        </ListSection>
        <ListSection
          title={d.log}
          actions={
            order.can.log && kinds.length > 0 ? (
              <Button variant="secondary" icon="plus" onClick={() => setOverlay({ kind: 'log' })}>
                {d.actions.log}
              </Button>
            ) : undefined
          }
        >
          {order.logs.length === 0 ? (
            <p className="ls-hint">{d.logEmpty}</p>
          ) : (
            <DataTable
              caption={fill(t.common.list.table, { list: d.log })}
              columns={logColumns}
              rows={order.logs}
              rowKey={(log) => log.id}
              loadingLabel={t.common.loading}
              paging={logPaging}
            />
          )}
        </ListSection>
        {order.returns.length > 0 ? (
          <ListSection title={d.returns}>
            <DataTable
              caption={fill(t.common.list.table, { list: d.returns })}
              columns={returnColumns}
              rows={order.returns}
              rowKey={(item) => item.id}
              loadingLabel={t.common.loading}
              paging={returnsPaging}
            />
          </ListSection>
        ) : null}
        {settlement ? (
          <Section title={d.settlement}>
            <DescriptionList
              columns={2}
              items={[
                { label: d.settlementFields.goods, value: money(settlement.goodsPaidVnd) },
                { label: d.settlementFields.out, value: money(settlement.carrierFeeOutVnd) },
                { label: d.settlementFields.back, value: money(settlement.carrierFeeBackVnd) },
                {
                  label: d.settlementFields.refund,
                  value: money(settlement.refundVnd),
                  strong: true,
                },
                {
                  label: d.settlementFields.restock,
                  value: d.restockResult[settlement.returnedToStock],
                },
                {
                  label: d.settlementFields.by,
                  value: fill(d.settledBy, {
                    name: settlement.settledByName,
                    time: when(settlement.settledAt),
                  }),
                },
                { label: d.settlementFields.reason, value: settlement.reason },
              ]}
            />
          </Section>
        ) : null}
      </Stack>
      {overlay?.kind === 'ship' ? <ShipDialog {...common} onDone={done(text.ship.done)} /> : null}
      {overlay?.kind === 'correctShipment' ? (
        <CorrectShipmentDialog {...common} onDone={done(text.correctShipment.done)} />
      ) : null}
      {overlay?.kind === 'delivered' ? (
        <DeliveredDialog {...common} onDone={done(text.delivered.done)} />
      ) : null}
      {overlay?.kind === 'log' ? <LogDialog {...common} onDone={done(text.log.done)} /> : null}
      {overlay?.kind === 'returned' ? (
        <ReturnedDialog {...common} onDone={done(text.returned.done)} />
      ) : null}
      {overlay?.kind === 'address' ? (
        <AddressDialog {...common} onDone={done(text.address.done)} />
      ) : null}
      {overlay?.kind === 'settle' ? (
        <SettleDialog
          {...common}
          onDone={async (next) => {
            const refunded = next.settlement !== null && bigOf(next.settlement.refundVnd) > 0n;
            await done(refunded ? text.settle.done : text.settle.doneNoMoney)(next);
          }}
        />
      ) : null}
      {overlay?.kind === 'cancel' ? (
        <OnlineCancelDialog
          {...common}
          line={overlay.line}
          onDone={done(
            overlay.line.refundShareVnd !== '0' ? text.cancel.done : text.cancel.doneNoMoney,
          )}
        />
      ) : null}
      {overlay?.kind === 'cost' ? (
        <ReturnCostDialog
          returnCase={overlay.returnCase}
          onClose={() => setOverlay(null)}
          onConflict={reload}
          onDone={done(text.returnCost.done)}
        />
      ) : null}
    </>
  );
}

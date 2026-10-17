'use client';

import type {
  InventoryItem,
  InventoryLotResponse,
  InventoryMovementResponse,
  InventoryOverviewResponse,
  InventoryVariantDetailResponse,
} from '@lucy-spa/contracts';
import {
  Breadcrumbs,
  Cluster,
  DataTable,
  DescriptionList,
  EmptyState,
  FacetedFilter,
  Field,
  FormDialog,
  FormGrid,
  ListSection,
  ListToolbar,
  MediaThumb,
  NumberInput,
  PageHeader,
  RowActions,
  SearchInput,
  Select,
  Stack,
  Textarea,
  useUrlState,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { inventoryDictionary } from '../../../i18n/inventory';
import { fill } from '../../../i18n/workforce';
import { formOverlayLabels } from '../../../lib/workforce/form-labels';
import { formatDate, formatDateTime, formatVnd } from '../../../lib/workforce/format';
import { crumbLabel } from '../../../lib/workforce/products';
import {
  ADJUST_REASONS,
  adjustRequest,
  defaultLot,
  emptyAdjustDraft,
  filterStock,
  itemLabel,
  itemName,
  itemTitle,
  stockFlags,
  stockSortValue,
  STOCK_STATUSES,
  validateAdjustDraft,
  type AdjustDraft,
  type InventoryListState,
} from '../../../lib/workforce/inventory';
import {
  paginationLabels,
  resultsText,
  sortLabels,
  toolbarLabels,
} from '../../../lib/workforce/list-view';
import { mediaVariantUrl } from '../../../lib/workforce/media';
import { opensInput } from '../../../lib/workforce/opens-input';
import { ListCrumbLink, PrefetchLink as Link } from '../link';
import { useWorkforce } from '../session';
import {
  Badge,
  Button,
  ErrorState,
  Loading,
  Notice,
  Section,
  useResource,
  type Resource,
  useSuccessToast,
} from '../ui';
import { signedNumber } from './pos-format';
import { focusInvalidSoon, RouterButtonLink, RouterMenuLink, urlPaging } from './products-links';
import { useInventoryCommand } from './use-inventory-command';

// Pagers kept in the address bar (Back/Forward and shared links restore them).
const useLotsPaging = urlPaging('lpage', 'lsize');
const useMovesPaging = urlPaging('mpage', 'msize');

const ZONE = 'Asia/Ho_Chi_Minh';

const issueText = (
  show: boolean,
  issue: 'required' | 'invalid' | undefined,
  text: ReturnType<typeof inventoryDictionary>,
): string | undefined =>
  show && issue ? (issue === 'required' ? text.required : text.invalid) : undefined;

/**
 * The "Tồn kho" tab: the stock of one branch as a table (every variant that can take stock, plus any that still has some). The API
 * returns everything, so search, the status filter, sorting and paging run in the browser and live in the address bar.
 */
export function StockTab({
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
  const overview = useResource(
    () =>
      api.get<InventoryOverviewResponse>(
        `/api/v1/inventory/overview?branchId=${encodeURIComponent(branchId)}`,
      ),
    [api, branchId],
  );
  return (
    <StockList
      branchId={branchId}
      overview={overview}
      branchControl={branchControl}
      list={list}
      updateList={updateList}
    />
  );
}

/** The stock table and its toolbar (the part of the tab that needs no request, so a test can render it with data). */
export function StockList({
  branchId,
  overview,
  branchControl,
  list,
  updateList,
}: {
  branchId: string;
  overview: Resource<InventoryOverviewResponse>;
  /** The branch chooser (when the caller works in several branches), placed in the toolbar. */
  branchControl: ReactNode;
  list: InventoryListState;
  updateList: (patch: Partial<InventoryListState>, change?: { replace?: boolean }) => void;
}) {
  const { t, locale, base } = useWorkforce();
  const text = inventoryDictionary(locale);
  const s = text.stock;
  const all = overview.data?.items ?? [];
  const rows = filterStock(all, list);
  const active = (list.q ? 1 : 0) + (list.status ? 1 : 0);
  const itemHref = (item: InventoryItem) =>
    `${base}/inventory/items/${item.variantId}?branch=${encodeURIComponent(branchId)}`;

  const columns: DataTableColumn<InventoryItem>[] = [
    {
      key: 'image',
      header: s.columns.image,
      leading: true,
      cell: (item) => (
        <MediaThumb src={item.coverMediaId ? mediaVariantUrl(item.coverMediaId, 'thumb') : null} />
      ),
    },
    {
      key: 'name',
      header: s.columns.product,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      sortable: true,
      sortValue: (item) => stockSortValue(item, 'name', locale),
      cell: (item) => (
        <Link className="ls-link" href={itemHref(item)}>
          {itemTitle(item, locale)}
        </Link>
      ),
    },
    {
      key: 'sku',
      header: s.columns.sku,
      // The name keeps room to wrap by word (E4 review: at 1024-1279 px it was squeezed to two words a line): the SKU shows from 1280 px,
      // the nearest expiry from 1440 px; search still finds by SKU and the item page shows both.
      hideBelow: 'xl',
      sortable: true,
      sortValue: (item) => stockSortValue(item, 'sku', locale),
      cell: (item) => <span translate="no">{item.sku}</span>,
    },
    {
      key: 'onHand',
      header: s.columns.onHand,
      numeric: true,
      sortable: true,
      sortValue: (item) => stockSortValue(item, 'onHand', locale),
      cell: (item) => item.onHand,
    },
    {
      key: 'available',
      header: s.columns.available,
      numeric: true,
      sortable: true,
      sortValue: (item) => stockSortValue(item, 'available', locale),
      cell: (item) => item.available,
    },
    {
      key: 'expired',
      header: s.columns.expired,
      numeric: true,
      hideBelow: '2xl',
      cell: (item) => (item.expiredQuantity > 0 ? item.expiredQuantity : text.none),
    },
    {
      key: 'threshold',
      header: s.columns.threshold,
      numeric: true,
      hideBelow: '2xl',
      cell: (item) => item.lowStockThreshold ?? text.none,
    },
    {
      key: 'expiry',
      header: s.columns.nextExpiry,
      hideBelow: 'wide',
      sortable: true,
      sortValue: (item) => stockSortValue(item, 'expiry', locale),
      cell: (item) => (item.nextExpiry ? formatDate(item.nextExpiry, locale) : text.none),
    },
    {
      key: 'status',
      header: s.columns.status,
      cell: (item) => <StockBadges item={item} />,
    },
    {
      key: 'actions',
      header: t.common.actions,
      actions: true,
      cell: (item) => (
        <RowActions
          menuLabel={fill(t.common.list.actionsFor, { name: itemTitle(item, locale) })}
          LinkComponent={RouterMenuLink}
          items={[{ id: 'details', label: s.details, icon: 'eye', href: itemHref(item) }]}
        />
      ),
    },
  ];

  return (
    <>
      {overview.data && all.length > 0 ? (
        <ListToolbar
          labels={toolbarLabels(t)}
          activeFilters={active}
          resultCount={resultsText(t, rows.length)}
          onReset={() => updateList({ q: '', status: '' })}
          reload={{ label: t.common.reload, onClick: () => void overview.reload() }}
          search={
            <SearchInput
              id="stock-q"
              value={list.q}
              label={s.search}
              hint={s.searchPlaceholder}
              clearLabel={t.common.list.clearSearch}
              onSearch={(q) => updateList({ q }, { replace: true })}
            />
          }
          filters={
            <>
              {branchControl}
              <FacetedFilter
                label={s.status}
                clearLabel={t.common.list.clearChoice}
                options={STOCK_STATUSES.map((status) => ({
                  value: status,
                  label: s.statuses[status],
                }))}
                selected={list.status ? [list.status] : []}
                onChange={([status]) => updateList({ status: status ?? '' })}
              />
            </>
          }
        />
      ) : branchControl ? (
        <ListToolbar labels={toolbarLabels(t)} filters={branchControl} />
      ) : null}
      <DataTable
        drillDown
        mode="client"
        caption={fill(t.common.list.table, { list: text.tabs.stock })}
        columns={columns}
        rows={rows}
        rowKey={(item) => `${item.variantId}:${item.onHand}:${item.available}`}
        sort={{ key: list.sort, direction: list.dir === 'desc' ? 'desc' : 'asc' }}
        onSortChange={(sort) => updateList({ sort: sort.key, dir: sort.direction })}
        sortLabels={sortLabels(t)}
        loading={overview.loading}
        loadingLabel={t.common.loading}
        error={
          overview.error ? (
            <ErrorState error={overview.error} t={t} onRetry={() => void overview.reload()} />
          ) : undefined
        }
        empty={
          overview.data ? (
            all.length === 0 ? (
              <EmptyState icon="tag" title={s.emptyTitle}>
                {s.empty}
              </EmptyState>
            ) : (
              <EmptyState
                icon="search"
                title={s.noMatchTitle}
                action={
                  <Button variant="secondary" onClick={() => updateList({ q: '', status: '' })}>
                    {t.common.list.reset}
                  </Button>
                }
              >
                {s.noMatch}
              </EmptyState>
            )
          ) : undefined
        }
        paging={{
          page: list.page,
          pageSize: list.pageSize,
          onPageChange: (page) => updateList({ page }),
          onPageSizeChange: (pageSize) => updateList({ pageSize }),
          labels: paginationLabels(t, text.tabs.stock),
        }}
      />
    </>
  );
}

/** The state of one stock row in words (never colour alone): out of stock, low, expired or expiring lots, or fine. */
export function StockBadges({ item }: { item: InventoryItem }) {
  const { locale } = useWorkforce();
  const b = inventoryDictionary(locale).stock.badges;
  const flags = stockFlags(item);
  const shown = [
    flags.out && (
      <Badge key="out" tone="error">
        {b.out}
      </Badge>
    ),
    flags.low && (
      <Badge key="low" tone="warning">
        {b.low}
      </Badge>
    ),
    flags.expired && (
      <Badge key="expired" tone="error">
        {b.expired}
      </Badge>
    ),
    flags.expiring && (
      <Badge key="expiring" tone="warning">
        {b.expiring}
      </Badge>
    ),
  ].filter(Boolean);
  if (shown.length === 0) return <Badge tone="success">{b.ok}</Badge>;
  return <Cluster gap="tight">{shown}</Cluster>;
}

// ------------------------------------------------------------------------------------------------ the item page

const ITEM_URL_DEFAULTS = { branch: '' };
const subscribeNothing = () => () => undefined;

/**
 * One variant at one branch: its stock, lots and history. The branch comes from `?branch=`. The address bar is read only after
 * hydration (the server snapshot has no query), so the page waits for it instead of asking the API for branch '' (that request was
 * `GET /api/v1/inventory/branches//variants/<id>`, a 404 on every direct visit: the E2 console errors of session 10).
 */
export function InventoryItemScreen({ variantId }: { variantId: string }) {
  const { t, locale, base } = useWorkforce();
  const [{ branch }] = useUrlState(ITEM_URL_DEFAULTS);
  const hydrated = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  if (branch === '') {
    const s = inventoryDictionary(locale).stock;
    // An item address without its branch: a heading, a sentence and the one way on (empty-state rule).
    return hydrated ? (
      <EmptyState
        icon="search"
        title={s.itemMissingTitle}
        action={<RouterButtonLink href={`${base}/inventory`}>{s.backToStock}</RouterButtonLink>}
      >
        {s.itemMissing}
      </EmptyState>
    ) : (
      <Loading t={t} page />
    );
  }
  return <InventoryItemLoader branch={branch} variantId={variantId} />;
}

function InventoryItemLoader({ branch, variantId }: { branch: string; variantId: string }) {
  const { api, t } = useWorkforce();
  const detail = useResource(
    () =>
      api.get<InventoryVariantDetailResponse>(
        `/api/v1/inventory/branches/${encodeURIComponent(branch)}/variants/${encodeURIComponent(variantId)}`,
      ),
    [api, branch, variantId],
  );
  if (detail.error && !detail.data) {
    return <ErrorState error={detail.error} t={t} onRetry={() => void detail.reload()} />;
  }
  if (!detail.data) return <Loading t={t} page />;
  return <InventoryItemView detail={detail.data} reload={detail.reload} />;
}

/** The page's content (also rendered on its own by the tests). The one primary action is the adjustment, for ADJUST_STOCK. */
export function InventoryItemView({
  detail,
  reload,
}: {
  detail: InventoryVariantDetailResponse;
  reload: () => Promise<void>;
}) {
  const { locale, base } = useWorkforce();
  const text = inventoryDictionary(locale);
  const i = text.item;
  const { item } = detail;
  const notify = useSuccessToast();
  const [adjusting, setAdjusting] = useState(false);
  const name = itemName(item, locale);
  const label = itemLabel(item, locale);
  const hasStockLot = defaultLot(detail.lots) !== null;
  return (
    <>
      <PageHeader
        title={label ? `${name} (${label})` : name}
        status={<StockBadges item={item} />}
        breadcrumbs={
          <Breadcrumbs
            label={text.breadcrumbs}
            LinkComponent={ListCrumbLink}
            items={[
              {
                label: text.title,
                href: `${base}/inventory?branch=${encodeURIComponent(detail.branchId)}`,
              },
              { label: crumbLabel(name) },
            ]}
          />
        }
        actions={
          detail.canAdjust ? (
            <Button variant="primary" disabled={!hasStockLot} onClick={() => setAdjusting(true)}>
              {opensInput(i.adjust)}
            </Button>
          ) : undefined
        }
      />
      <Stack gap="page">
        <Section title={i.info}>
          <DescriptionList
            columns={2}
            items={[
              { label: i.branch, value: detail.branchName },
              { label: i.sku, value: <span translate="no">{item.sku}</span> },
              { label: i.onHand, value: item.onHand },
              { label: i.available, value: item.available },
              { label: i.expired, value: item.expiredQuantity },
              {
                label: i.threshold,
                value: item.lowStockThreshold === null ? i.notSet : item.lowStockThreshold,
              },
              {
                label: i.nextExpiry,
                value: item.nextExpiry ? formatDate(item.nextExpiry, locale) : text.none,
              },
              {
                label: i.warning,
                value: fill(i.warningValue, { days: detail.expiryWarningDays }),
              },
            ]}
          />
        </Section>
        <LotsSection detail={detail} />
        <HistorySection movements={detail.movements} />
      </Stack>
      {adjusting ? (
        <AdjustDialog
          detail={detail}
          reload={reload}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            notify(text.adjust.done);
          }}
        />
      ) : null}
    </>
  );
}

function LotsSection({ detail }: { detail: InventoryVariantDetailResponse }) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const i = text.item;
  const paging = useLotsPaging(t, i.lots);
  const hasCost = detail.lots.some((lot) => 'unitCostVnd' in lot);
  const columns: DataTableColumn<InventoryLotResponse>[] = [
    {
      key: 'code',
      header: i.lotColumns.code,
      mobileTitle: true,
      wrap: true,
      cell: (lot) => <span translate="no">{lot.lotCode}</span>,
    },
    {
      key: 'expiry',
      header: i.lotColumns.expiry,
      cell: (lot) => (
        <Cluster gap="tight">
          {lot.expiryDate ? formatDate(lot.expiryDate, locale) : i.noExpiry}
          {lot.expired && lot.quantityOnHand > 0 ? (
            <Badge tone="error">{i.expiredBadge}</Badge>
          ) : null}
        </Cluster>
      ),
    },
    {
      key: 'quantity',
      header: i.lotColumns.quantity,
      numeric: true,
      cell: (lot) => lot.quantityOnHand,
    },
    {
      key: 'received',
      header: i.lotColumns.received,
      numeric: true,
      hideBelow: 'md',
      cell: (lot) => lot.receivedQuantity,
    },
    {
      key: 'receipt',
      header: i.lotColumns.receipt,
      hideBelow: 'lg',
      cell: (lot) => (lot.receiptCode ? <span translate="no">{lot.receiptCode}</span> : text.none),
    },
    {
      key: 'date',
      header: i.lotColumns.date,
      hideBelow: 'xl',
      cell: (lot) => formatDateTime(lot.createdAt, ZONE, locale),
    },
    ...(hasCost
      ? [
          {
            key: 'cost',
            header: i.lotColumns.cost,
            numeric: true,
            hideBelow: 'xl' as const,
            cell: (lot: InventoryLotResponse) =>
              lot.unitCostVnd ? formatVnd(lot.unitCostVnd, locale) : text.none,
          },
        ]
      : []),
  ];
  return (
    <ListSection title={i.lots}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: i.lots })}
        columns={columns}
        rows={detail.lots}
        rowKey={(lot) => `${lot.id}:${lot.quantityOnHand}`}
        empty={<EmptyState title={i.lotsEmptyTitle}>{i.lotsEmpty}</EmptyState>}
        paging={paging}
      />
    </ListSection>
  );
}

function HistorySection({ movements }: { movements: InventoryMovementResponse[] }) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const i = text.item;
  const paging = useMovesPaging(t, i.history);
  const columns: DataTableColumn<InventoryMovementResponse>[] = [
    {
      key: 'time',
      header: i.historyColumns.time,
      mobileTitle: true,
      cell: (move) => formatDateTime(move.createdAt, ZONE, locale),
    },
    { key: 'kind', header: i.historyColumns.kind, cell: (move) => i.kinds[move.kind] },
    {
      key: 'delta',
      header: i.historyColumns.delta,
      numeric: true,
      cell: (move) => signedNumber(locale, move.quantityDelta),
    },
    {
      key: 'reason',
      header: i.historyColumns.reason,
      hideBelow: 'md',
      cell: (move) => (move.reason ? i.reasons[move.reason] : text.none),
    },
    {
      key: 'lot',
      header: i.historyColumns.lot,
      hideBelow: 'lg',
      cell: (move) => <span translate="no">{move.lotCode}</span>,
    },
    {
      key: 'actor',
      header: i.historyColumns.actor,
      hideBelow: 'lg',
      wrap: true,
      cell: (move) => move.actorName,
    },
    {
      key: 'source',
      header: i.historyColumns.source,
      hideBelow: 'xl',
      cell: (move) => move.receiptCode ?? move.countCode ?? text.none,
    },
    {
      key: 'note',
      header: i.historyColumns.note,
      hideBelow: 'xl',
      wrap: true,
      cell: (move) => move.note ?? text.none,
    },
  ];
  return (
    <ListSection title={i.history}>
      <DataTable
        mode="client"
        caption={fill(t.common.list.table, { list: i.history })}
        columns={columns}
        rows={movements}
        rowKey={(move) => move.id}
        empty={<EmptyState title={i.historyEmptyTitle}>{i.historyEmpty}</EmptyState>}
        paging={paging}
      />
    </ListSection>
  );
}

// ---------------------------------------------------------------------------------------------- the adjustment

/**
 * "Điều chỉnh tồn kho": a short form (dialog). It takes stock OUT of one chosen lot with a reason. A fresh request key is made
 * when the dialog opens and kept for every retry, so sending the same request twice never takes the goods out twice.
 */
export function AdjustDialog({
  detail,
  reload,
  onClose,
  onDone,
}: {
  detail: InventoryVariantDetailResponse;
  reload: () => Promise<void>;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useWorkforce();
  const text = inventoryDictionary(locale);
  const a = text.adjust;
  const lots = detail.lots.filter((lot) => lot.quantityOnHand > 0);
  const [requestKey] = useState(() => crypto.randomUUID());
  const [initial] = useState<AdjustDraft>(() => emptyAdjustDraft(detail.lots));
  const [draft, setDraft] = useState<AdjustDraft>(initial);
  const [checked, setChecked] = useState(false);
  const command = useInventoryCommand(reload);
  const errors = validateAdjustDraft(draft, detail.lots);
  const lot = lots.find((entry) => entry.id === draft.lotId);
  const set = (patch: Partial<AdjustDraft>) => setDraft((state) => ({ ...state, ...patch }));

  async function submit() {
    setChecked(true);
    const body = adjustRequest(draft, detail.lots, {
      requestKey,
      branchId: detail.branchId,
      variantId: detail.item.variantId,
    });
    if (!body) {
      focusInvalidSoon();
      return;
    }
    const result = await command.run('/api/v1/stock-adjustments', body);
    if (result.ok) onDone();
  }

  return (
    <FormDialog
      title={a.title}
      labels={{ ...formOverlayLabels(t, a.submit), submitting: text.saving }}
      busy={command.pending}
      dirty={JSON.stringify(draft) !== JSON.stringify(initial)}
      submitDisabled={lots.length === 0}
      error={command.message ? <Notice tone="error">{command.message}</Notice> : undefined}
      onClose={onClose}
      onSubmit={submit}
    >
      {lots.length === 0 ? (
        <Notice tone="info">{a.noLots}</Notice>
      ) : (
        <FormGrid cols={1}>
          <Field label={a.lot} required error={issueText(checked, errors.lotId, text)}>
            {(control) => (
              <Select
                {...control}
                name="lotId"
                autoComplete="off"
                value={draft.lotId}
                options={lots.map((entry) => ({
                  value: entry.id,
                  label: fill(a.lotOption, {
                    code: entry.lotCode,
                    expiry: entry.expiryDate
                      ? formatDate(entry.expiryDate, locale)
                      : text.item.noExpiry,
                    quantity: entry.quantityOnHand,
                  }),
                }))}
                onChange={(event) => set({ lotId: event.target.value })}
              />
            )}
          </Field>
          <Field
            label={a.quantity}
            required
            hint={lot ? fill(a.quantityHint, { max: lot.quantityOnHand }) : undefined}
            error={
              checked && errors.quantity
                ? errors.quantity === 'required'
                  ? text.required
                  : text.errors.fields.quantity
                : undefined
            }
          >
            {(control) => (
              <NumberInput
                {...control}
                name="quantity"
                autoComplete="off"
                inputMode="numeric"
                min={1}
                {...(lot ? { max: lot.quantityOnHand } : {})}
                value={draft.quantity}
                onChange={(event) => set({ quantity: event.target.value })}
              />
            )}
          </Field>
          <Field label={a.reason} required error={issueText(checked, errors.reason, text)}>
            {(control) => (
              <Select
                {...control}
                name="reason"
                autoComplete="off"
                value={draft.reason}
                placeholder={a.reasonPlaceholder}
                options={ADJUST_REASONS.map((reason) => ({
                  value: reason,
                  label: text.item.reasons[reason],
                }))}
                onChange={(event) => set({ reason: event.target.value })}
              />
            )}
          </Field>
          <Field label={a.note} hint={a.noteHint} error={issueText(checked, errors.note, text)}>
            {(control) => (
              <Textarea
                {...control}
                name="note"
                autoComplete="off"
                rows={3}
                maxLength={500}
                value={draft.note}
                onChange={(event) => set({ note: event.target.value })}
              />
            )}
          </Field>
        </FormGrid>
      )}
    </FormDialog>
  );
}

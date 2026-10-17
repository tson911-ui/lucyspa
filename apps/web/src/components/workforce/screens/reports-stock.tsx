'use client';

import {
  STOCK_ROW_LIMIT,
  type BestSellerReport,
  type ExpiryReport,
  type LowStockReport,
  type SlowMoverReport,
  type StockMovementReport,
  type StockReceiptReport,
  type StockValueReport,
} from '@lucy-spa/contracts';
import { Stack, type DataTableColumn } from '@lucy-spa/ui';
import { inventoryDictionary } from '../../../i18n/inventory';
import type { Locale } from '../../../i18n/locales';
import { reportsBDictionary, type ReportsBDictionary } from '../../../i18n/reports-b';
import { formatDate } from '../../../lib/workforce/format';
import { vndNumber } from '../../../lib/workforce/reports';
import { bpToPercent, pickName, formatCount } from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Badge } from '../ui';
import {
  Kpi,
  KpiRow,
  ReportData,
  ReportNote,
  ReportScreen,
  ReportTable,
  TruncatedNote,
  type PanelContext,
  type ReportTabDef,
} from './reports-kit';
import { shareText, vndText } from './reports-format';

/**
 * "Kho hàng" (Phase 8 P8-10, docs/PHASE8_REPORTS.md 4.5): best sellers, items running low, slow movers, expiry, what the stock is worth at cost
 * (with the share of stock that has a cost, never a guess), movements and receipts. Needs VIEW_INVENTORY at the branch; every cost figure also
 * needs VIEW_PRODUCT_COST, and the column is simply not there without it.
 */
export function StockScreen() {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  return <ReportScreen title={b.stock.title} intro={b.stock.intro} tabs={stockTabs(b)} />;
}

export function stockTabs(b: ReportsBDictionary): ReportTabDef[] {
  const period = (context: PanelContext) => ({
    from: context.range?.from,
    to: context.range?.to,
    branchId: context.branch || undefined,
  });
  const now = (context: PanelContext) => ({ branchId: context.branch || undefined });
  const window = (context: PanelContext) => ({
    branchId: context.branch || undefined,
    days: context.state.days,
  });
  return [
    {
      id: 'best',
      label: b.stock.tabs.best,
      report: 'stock-best-sellers',
      kind: 'range',
      exportLabel: b.exportChoices['stock-best-sellers']!,
      panel: (context) => (
        <ReportData<BestSellerReport>
          path="/api/v1/reports/stock/best-sellers"
          params={period(context)}
          nonce={context.nonce}
        >
          {(data) => <BestBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'low',
      label: b.stock.tabs.low,
      report: 'stock-low',
      kind: 'asof',
      exportLabel: b.exportChoices['stock-low']!,
      panel: (context) => (
        <ReportData<LowStockReport>
          path="/api/v1/reports/stock/low"
          params={now(context)}
          nonce={context.nonce}
        >
          {(data) => <LowBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'slow',
      label: b.stock.tabs.slow,
      report: 'stock-slow',
      kind: 'days',
      exportLabel: b.exportChoices['stock-slow']!,
      panel: (context) => (
        <ReportData<SlowMoverReport>
          path="/api/v1/reports/stock/slow"
          params={window(context)}
          nonce={context.nonce}
        >
          {(data) => <SlowBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'expiry',
      label: b.stock.tabs.expiry,
      report: 'stock-expiry',
      kind: 'days',
      exportLabel: b.exportChoices['stock-expiry']!,
      panel: (context) => (
        <ReportData<ExpiryReport>
          path="/api/v1/reports/stock/expiry"
          params={window(context)}
          nonce={context.nonce}
        >
          {(data) => <ExpiryBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'value',
      label: b.stock.tabs.value,
      report: 'stock-value',
      kind: 'asof',
      exportLabel: b.exportChoices['stock-value']!,
      panel: (context) => (
        <ReportData<StockValueReport>
          path="/api/v1/reports/stock/value"
          params={now(context)}
          nonce={context.nonce}
        >
          {(data) => <ValueBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'movements',
      label: b.stock.tabs.movements,
      report: 'stock-movements',
      kind: 'range',
      exportLabel: b.exportChoices['stock-movements']!,
      panel: (context) => (
        <ReportData<StockMovementReport>
          path="/api/v1/reports/stock/movements"
          params={period(context)}
          nonce={context.nonce}
        >
          {(data) => <MovementsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'receipts',
      label: b.stock.tabs.receipts,
      report: 'stock-receipts',
      kind: 'range',
      exportLabel: b.exportChoices['stock-receipts']!,
      panel: (context) => (
        <ReportData<StockReceiptReport>
          path="/api/v1/reports/stock/receipts"
          params={period(context)}
          nonce={context.nonce}
        >
          {(data) => <ReceiptsBody data={data} />}
        </ReportData>
      ),
    },
  ];
}

interface ItemRow {
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  branch?: { id: string; code: string; name: string };
}

/** The columns every item list starts with: branch (only when the person reads more than one), SKU and name. */
function itemColumns<Row extends ItemRow>(
  b: ReportsBDictionary,
  locale: Locale,
  withBranch: boolean,
): DataTableColumn<Row>[] {
  return [
    ...(withBranch
      ? [
          {
            key: 'branch',
            header: b.col['branch']!,
            hideBelow: 'lg' as const,
            wrap: true,
            width: 'sm' as const,
            cell: (row: Row) => row.branch?.name ?? '—',
          },
        ]
      : []),
    {
      key: 'sku',
      header: b.col['sku']!,
      hideBelow: 'md' as const,
      cell: (row: Row) => <span translate="no">{row.sku}</span>,
    },
    {
      key: 'name',
      header: b.col['name']!,
      mobileTitle: true,
      wrap: true,
      width: 'lg' as const,
      cell: (row: Row) => pickName(locale, row.nameVi, row.nameEn),
    },
  ];
}

const hasManyBranches = (branches: readonly unknown[]) => branches.length > 1;
const itemKey = (row: ItemRow, extra = '') => `${row.branch?.id ?? ''}-${row.variantId}${extra}`;

export function BestBody({ data }: { data: BestSellerReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<BestSellerReport['rows'][number]>[] = [
    ...itemColumns<BestSellerReport['rows'][number]>(b, locale, false),
    { key: 'sold', header: c['unitsSold']!, numeric: true, cell: (row) => count(row.unitsSold) },
    {
      key: 'returned',
      header: c['unitsReturned']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.unitsReturned),
    },
    { key: 'net', header: c['unitsNet']!, numeric: true, cell: (row) => count(row.unitsNet) },
    {
      key: 'revenue',
      header: c['net']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vndText(row.netVnd, locale),
    },
    {
      key: 'share',
      header: c['share']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => shareText(locale, row.shareBp),
    },
  ];
  return (
    <Stack gap="page">
      <TruncatedNote truncated={data.truncated} count={STOCK_ROW_LIMIT} />
      <ReportTable
        label={b.stock.tabs.best}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.variantId}
        empty={b.stock.empty.best}
      />
    </Stack>
  );
}

export function LowBody({ data }: { data: LowStockReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<LowStockReport['rows'][number]>[] = [
    ...itemColumns<LowStockReport['rows'][number]>(b, locale, hasManyBranches(data.branches)),
    { key: 'onHand', header: c['onHand']!, numeric: true, cell: (row) => count(row.onHand) },
    {
      key: 'reserved',
      header: c['reserved']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.reserved),
    },
    {
      key: 'available',
      header: c['available']!,
      numeric: true,
      cell: (row) => count(row.available),
    },
    {
      key: 'threshold',
      header: c['threshold']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.threshold),
    },
  ];
  return (
    <Stack gap="page">
      <p className="ls-hint">{b.stock.lowIntro}</p>
      <TruncatedNote truncated={data.truncated} count={STOCK_ROW_LIMIT} />
      <ReportTable
        label={b.stock.tabs.low}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => itemKey(row)}
        empty={b.stock.empty.low}
      />
    </Stack>
  );
}

export function SlowBody({ data }: { data: SlowMoverReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<SlowMoverReport['rows'][number]>[] = [
    ...itemColumns<SlowMoverReport['rows'][number]>(b, locale, hasManyBranches(data.branches)),
    { key: 'onHand', header: c['onHand']!, numeric: true, cell: (row) => count(row.onHand) },
    {
      key: 'lastSold',
      header: c['lastSold']!,
      cell: (row) =>
        row.lastSoldOn === null ? (
          <Badge tone="neutral">{b.stock.neverSold}</Badge>
        ) : (
          formatDate(row.lastSoldOn, locale)
        ),
    },
    {
      key: 'days',
      header: c['daysSinceSale']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => (row.daysSinceSale === null ? '—' : count(row.daysSinceSale)),
    },
    ...(data.costColumn
      ? [
          {
            key: 'cost',
            header: c['costValue']!,
            numeric: true,
            hideBelow: 'lg' as const,
            cell: (row: SlowMoverReport['rows'][number]) =>
              row.costValueVnd === null ? b.stock.noCost : vndText(row.costValueVnd, locale),
          },
        ]
      : []),
  ];
  return (
    <Stack gap="page">
      <p className="ls-hint">{b.stock.slowIntro}</p>
      {!data.costColumn ? <ReportNote>{b.stock.noCostColumn}</ReportNote> : null}
      <TruncatedNote truncated={data.truncated} count={STOCK_ROW_LIMIT} />
      <ReportTable
        label={b.stock.tabs.slow}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => itemKey(row)}
        empty={b.stock.empty.slow}
      />
    </Stack>
  );
}

export function ExpiryBody({ data }: { data: ExpiryReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<ExpiryReport['rows'][number]>[] = [
    ...itemColumns<ExpiryReport['rows'][number]>(b, locale, hasManyBranches(data.branches)),
    {
      key: 'lot',
      header: c['lot']!,
      hideBelow: 'md',
      cell: (row) => <span translate="no">{row.lotCode}</span>,
    },
    { key: 'expiry', header: c['expiry']!, cell: (row) => formatDate(row.expiryDate, locale) },
    {
      key: 'left',
      header: c['daysLeft']!,
      numeric: true,
      cell: (row) =>
        row.daysLeft < 0 ? (
          <Badge tone="error">{b.stock.expired}</Badge>
        ) : row.daysLeft === 0 ? (
          <Badge tone="warning">{b.stock.today}</Badge>
        ) : (
          count(row.daysLeft)
        ),
    },
    { key: 'quantity', header: c['quantity']!, numeric: true, cell: (row) => count(row.quantity) },
  ];
  return (
    <Stack gap="page">
      <p className="ls-hint">{b.stock.expiryIntro}</p>
      <TruncatedNote truncated={data.truncated} count={STOCK_ROW_LIMIT} />
      <ReportTable
        label={b.stock.tabs.expiry}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => itemKey(row, `-${row.lotCode}`)}
        empty={b.stock.empty.expiry}
      />
    </Stack>
  );
}

export function ValueBody({ data }: { data: StockValueReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const k = b.stock.kpi;
  const columns: DataTableColumn<StockValueReport['rows'][number]>[] = [
    ...itemColumns<StockValueReport['rows'][number]>(b, locale, hasManyBranches(data.branches)),
    { key: 'onHand', header: c['onHand']!, numeric: true, cell: (row) => count(row.onHand) },
    {
      key: 'withCost',
      header: c['unitsWithCost']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.unitsWithCost),
    },
    {
      key: 'value',
      header: c['value']!,
      numeric: true,
      cell: (row) => vndText(row.valueVnd, locale),
    },
  ];
  return (
    <Stack gap="page">
      <p className="ls-hint">{b.stock.valueIntro}</p>
      <KpiRow>
        <Kpi
          label={k.value}
          info={k.valueInfo}
          value={vndNumber(data.totals.valueVnd)}
          format="vnd"
        />
        <Kpi label={k.onHand} value={data.totals.onHand} format="count" />
        <Kpi
          label={k.coverage}
          info={k.coverageInfo}
          value={bpToPercent(data.totals.coverageBp)}
          format="percent"
        />
        <Kpi label={k.withoutCost} value={data.totals.variantsWithoutCost} format="count" />
      </KpiRow>
      <TruncatedNote truncated={data.truncated} count={STOCK_ROW_LIMIT} />
      <ReportTable
        label={b.stock.tabs.value}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => itemKey(row)}
        empty={b.stock.empty.value}
      />
    </Stack>
  );
}

export function MovementsBody({ data }: { data: StockMovementReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const inventory = inventoryDictionary(locale).item;
  const columns: DataTableColumn<StockMovementReport['rows'][number]>[] = [
    ...(hasManyBranches(data.branches)
      ? [
          {
            key: 'branch',
            header: c['branch']!,
            hideBelow: 'lg' as const,
            wrap: true,
            width: 'sm' as const,
            cell: (row: StockMovementReport['rows'][number]) => row.branch.name,
          },
        ]
      : []),
    {
      key: 'kind',
      header: c['movement']!,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (row) => (inventory.kinds as Record<string, string>)[row.kind] ?? row.kind,
    },
    {
      key: 'reason',
      header: c['reason']!,
      hideBelow: 'md',
      cell: (row) =>
        row.reason === null
          ? '—'
          : ((inventory.reasons as Record<string, string>)[row.reason] ?? row.reason),
    },
    {
      key: 'entries',
      header: c['entriesCount']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.entries),
    },
    { key: 'in', header: c['unitsIn']!, numeric: true, cell: (row) => count(row.unitsIn) },
    { key: 'out', header: c['unitsOut']!, numeric: true, cell: (row) => count(row.unitsOut) },
  ];
  return (
    <ReportTable
      label={b.stock.tabs.movements}
      columns={columns}
      rows={data.rows}
      rowKey={(row) => `${row.branch.id}-${row.kind}-${row.reason ?? ''}`}
      empty={b.stock.empty.movements}
    />
  );
}

export function ReceiptsBody({ data }: { data: StockReceiptReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<StockReceiptReport['rows'][number]>[] = [
    {
      key: 'supplier',
      header: c['supplier']!,
      mobileTitle: true,
      wrap: true,
      width: 'lg',
      cell: (row) => row.supplierName ?? b.stock.noSupplier,
    },
    { key: 'receipts', header: c['receipts']!, numeric: true, cell: (row) => count(row.receipts) },
    { key: 'units', header: c['units']!, numeric: true, cell: (row) => count(row.units) },
    ...(data.costColumn
      ? [
          {
            key: 'cost',
            header: c['receiptCost']!,
            numeric: true,
            cell: (row: StockReceiptReport['rows'][number]) =>
              row.costVnd === null ? b.stock.noCost : vndText(row.costVnd, locale),
          },
        ]
      : []),
    {
      key: 'noCost',
      header: c['noCostLines']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.linesWithoutCost),
    },
  ];
  return (
    <Stack gap="page">
      {!data.costColumn ? <ReportNote>{b.stock.noCostColumn}</ReportNote> : null}
      <ReportTable
        label={b.stock.tabs.receipts}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.supplierId ?? 'none'}
        empty={b.stock.empty.receipts}
      />
    </Stack>
  );
}

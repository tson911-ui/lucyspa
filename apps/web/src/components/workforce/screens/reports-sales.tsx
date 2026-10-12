'use client';

import {
  SALES_ROW_LIMIT,
  type ComboReport,
  type DiscountReport,
  type OnlineOrderReport,
  type OnlineOrderRow,
  type ProductRevenueReport,
  type ServiceRevenueReport,
} from '@lucy-spa/contracts';
import { DataTable, ListSection, Select, Stack, type DataTableColumn } from '@lucy-spa/ui';
import { reportsBDictionary, type ReportsBDictionary } from '../../../i18n/reports-b';
import { fill } from '../../../i18n/workforce';
import { formatDate } from '../../../lib/workforce/format';
import { paginationLabels } from '../../../lib/workforce/list-view';
import { vnd, vndNumber } from '../../../lib/workforce/reports';
import {
  bpToPercent,
  percentFromBp,
  pickName,
  formatCount,
} from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Badge, Empty } from '../ui';
import {
  Kpi,
  KpiRow,
  ReportData,
  ReportScreen,
  ReportTable,
  TruncatedNote,
  type PanelContext,
  type ReportTabDef,
} from './reports-kit';
import type { Locale } from '../../../i18n/locales';

/**
 * "Bán hàng" (Phase 8 P8-10, docs/PHASE8_REPORTS.md 4.2): services, products, combos, discounts and online orders. The money on every tab is the
 * very revenue of the Doanh thu page (collected minus given back, on the day it happened), split by what was sold, so a tab can never show a
 * figure the headline does not contain. Quantities are counted on invoices paid in the period.
 */
export function SalesScreen() {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  return <ReportScreen title={b.sales.title} intro={b.sales.intro} tabs={salesTabs(b)} />;
}

export function salesTabs(b: ReportsBDictionary): ReportTabDef[] {
  const range = (context: PanelContext) => ({
    from: context.range?.from,
    to: context.range?.to,
    branchId: context.branch || undefined,
  });
  return [
    {
      id: 'services',
      label: b.sales.tabs.services,
      report: 'revenue-by-service',
      kind: 'range',
      exportLabel: b.exportChoices['revenue-by-service']!,
      panel: (context) => (
        <ReportData<ServiceRevenueReport>
          path="/api/v1/reports/revenue/services"
          params={range(context)}
          nonce={context.nonce}
        >
          {(data) => <ServicesBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'products',
      label: b.sales.tabs.products,
      report: 'revenue-by-product',
      kind: 'range',
      grouped: true,
      exportLabel: b.exportChoices['revenue-by-product']!,
      filters: (context) => (
        <Select
          aria-label={b.sales.byLabel}
          value={context.state.by}
          onChange={(event) => context.update({ by: event.target.value as 'variant' })}
          options={(['variant', 'brand', 'category'] as const).map((id) => ({
            value: id,
            label: b.sales.by[id],
          }))}
        />
      ),
      panel: (context) => (
        <ReportData<ProductRevenueReport>
          path="/api/v1/reports/revenue/products"
          params={{ ...range(context), by: context.state.by }}
          nonce={context.nonce}
        >
          {(data) => <ProductsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'combos',
      label: b.sales.tabs.combos,
      report: 'combos',
      kind: 'range',
      exportLabel: b.exportChoices['combos']!,
      panel: (context) => (
        <ReportData<ComboReport>
          path="/api/v1/reports/revenue/combos"
          params={range(context)}
          nonce={context.nonce}
        >
          {(data) => <CombosBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'discounts',
      label: b.sales.tabs.discounts,
      report: 'discounts-campaigns',
      kind: 'range',
      exportLabel: b.exportChoices['discounts-campaigns']!,
      panel: (context) => (
        <ReportData<DiscountReport>
          path="/api/v1/reports/revenue/discounts"
          params={range(context)}
          nonce={context.nonce}
        >
          {(data) => <DiscountsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'online',
      label: b.sales.tabs.online,
      report: 'online-orders',
      kind: 'range',
      exportLabel: b.exportChoices['online-orders']!,
      panel: (context) => (
        <ReportData<OnlineOrderReport>
          path="/api/v1/reports/online-orders"
          params={{ ...range(context), page: context.state.page }}
          nonce={context.nonce}
        >
          {(data) => (
            <OnlineBody
              data={data}
              page={context.state.page}
              onPage={(page) => context.update({ page })}
            />
          )}
        </ReportData>
      ),
    },
  ];
}

function nameOf(locale: Locale, row: { nameVi: string; nameEn: string }): string {
  return pickName(locale, row.nameVi, row.nameEn);
}

export function ServicesBody({ data }: { data: ServiceRevenueReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<ServiceRevenueReport['rows'][number]>[] = [
    {
      key: 'name',
      header: c['name']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => (row.serviceId === null ? b.sales.other : nameOf(locale, row)),
    },
    {
      key: 'category',
      header: c['category']!,
      hideBelow: 'md',
      truncate: true,
      width: 'md',
      cell: (row) =>
        row.categoryNameVi === null
          ? '—'
          : pickName(locale, row.categoryNameVi, row.categoryNameEn ?? ''),
    },
    { key: 'quantity', header: c['quantity']!, numeric: true, cell: (row) => count(row.quantity) },
    { key: 'net', header: c['net']!, numeric: true, cell: (row) => vnd(row.netVnd, locale) },
    {
      key: 'share',
      header: c['share']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => percentFromBp(row.shareBp, locale),
    },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={b.sales.kpi.net} value={vndNumber(data.totals.netVnd)} format="vnd" />
        <Kpi label={b.sales.kpi.quantity} value={data.totals.quantity} format="count" />
      </KpiRow>
      <TruncatedNote truncated={data.truncated} count={SALES_ROW_LIMIT} />
      <ReportTable
        label={b.sales.tabs.services}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.serviceId ?? 'other'}
        empty={b.sales.empty.services}
      />
    </Stack>
  );
}

export function ProductsBody({ data }: { data: ProductRevenueReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const variant = data.by === 'variant';
  const columns: DataTableColumn<ProductRevenueReport['rows'][number]>[] = [
    ...(variant
      ? [
          {
            key: 'sku',
            header: c['sku']!,
            hideBelow: 'md' as const,
            cell: (row: ProductRevenueReport['rows'][number]) => row.sku ?? '—',
          },
        ]
      : []),
    {
      key: 'name',
      header: c['name']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => (row.key === null ? b.sales.other : nameOf(locale, row)),
    },
    ...(variant
      ? [
          {
            key: 'brand',
            header: c['brand']!,
            hideBelow: 'lg' as const,
            truncate: true,
            width: 'sm' as const,
            cell: (row: ProductRevenueReport['rows'][number]) =>
              row.brandNameVi === null
                ? '—'
                : pickName(locale, row.brandNameVi, row.brandNameEn ?? ''),
          },
          {
            key: 'category',
            header: c['category']!,
            hideBelow: 'xl' as const,
            hidePhone: true,
            truncate: true,
            width: 'sm' as const,
            cell: (row: ProductRevenueReport['rows'][number]) =>
              row.categoryNameVi === null
                ? '—'
                : pickName(locale, row.categoryNameVi, row.categoryNameEn ?? ''),
          },
        ]
      : []),
    { key: 'sold', header: c['unitsSold']!, numeric: true, cell: (row) => count(row.unitsSold) },
    {
      key: 'returned',
      header: c['refunded']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.unitsRefunded),
    },
    { key: 'net', header: c['net']!, numeric: true, cell: (row) => vnd(row.netVnd, locale) },
    {
      key: 'share',
      header: c['share']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => percentFromBp(row.shareBp, locale),
    },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={b.sales.kpi.net} value={vndNumber(data.totals.netVnd)} format="vnd" />
        <Kpi label={c['unitsSold']!} value={data.totals.unitsSold} format="count" />
        <Kpi label={c['refunded']!} value={data.totals.unitsRefunded} format="count" />
      </KpiRow>
      <TruncatedNote truncated={data.truncated} count={SALES_ROW_LIMIT} />
      <ReportTable
        label={b.sales.tabs.products}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.key ?? 'other'}
        empty={b.sales.empty.products}
      />
    </Stack>
  );
}

export function CombosBody({ data }: { data: ComboReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const columns: DataTableColumn<ComboReport['rows'][number]>[] = [
    {
      key: 'name',
      header: c['name']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => nameOf(locale, row),
    },
    { key: 'sold', header: c['sold']!, numeric: true, cell: (row) => count(row.sold) },
    {
      key: 'voided',
      header: c['voided']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.voided),
    },
    {
      key: 'price',
      header: c['soldPrice']!,
      numeric: true,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => vnd(row.soldPriceVnd, locale),
    },
    {
      key: 'revenue',
      header: c['revenue']!,
      numeric: true,
      cell: (row) => vnd(row.revenueVnd, locale),
    },
    {
      key: 'sessionsSold',
      header: c['sessionsSold']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => count(row.sessionsSold),
    },
    {
      key: 'sessionsUsed',
      header: c['sessionsUsed']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.sessionsUsed),
    },
    {
      key: 'sessionsRemaining',
      header: c['sessionsRemaining']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => count(row.sessionsRemaining),
    },
    {
      key: 'sessionsExpired',
      header: c['sessionsExpired']!,
      numeric: true,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => count(row.sessionsExpired),
    },
  ];
  const k = b.sales.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.sold} value={data.totals.sold} format="count" />
        <Kpi label={k.revenue} value={vndNumber(data.totals.revenueVnd)} format="vnd" />
        <Kpi label={k.sessionsUsed} value={data.totals.sessionsUsed} format="count" />
        <Kpi label={k.sessionsRemaining} value={data.totals.sessionsRemaining} format="count" />
        <Kpi label={k.sessionsExpired} value={data.totals.sessionsExpired} format="count" />
      </KpiRow>
      <TruncatedNote truncated={data.truncated} count={SALES_ROW_LIMIT} />
      <ReportTable
        label={b.sales.tabs.combos}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.comboId}
        empty={b.sales.empty.combos}
      />
    </Stack>
  );
}

export function DiscountsBody({ data }: { data: DiscountReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const k = b.sales.kpi;
  const columns: DataTableColumn<DiscountReport['rows'][number]>[] = [
    {
      key: 'type',
      header: c['type']!,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => b.sales.discountTypes[row.type] ?? row.type,
    },
    {
      key: 'name',
      header: c['name']!,
      truncate: true,
      width: 'lg',
      cell: (row) => (row.nameVi === '' && row.nameEn === '' ? '—' : nameOf(locale, row)),
    },
    {
      key: 'code',
      header: c['code']!,
      hideBelow: 'md',
      cell: (row) => row.code ?? '—',
    },
    {
      key: 'invoices',
      header: c['invoices']!,
      numeric: true,
      cell: (row) => (row.type === 'OTHER' && row.invoices === 0 ? '—' : count(row.invoices)),
    },
    {
      key: 'amount',
      header: c['amount']!,
      numeric: true,
      cell: (row) => vnd(row.amountVnd, locale),
    },
  ];
  const campaignColumns: DataTableColumn<DiscountReport['campaigns'][number]>[] = [
    {
      key: 'name',
      header: c['name']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => nameOf(locale, row),
    },
    { key: 'units', header: c['units']!, numeric: true, cell: (row) => count(row.units) },
    { key: 'net', header: c['net']!, numeric: true, cell: (row) => vnd(row.netVnd, locale) },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi
          label={k.discount}
          info={k.discountInfo}
          value={vndNumber(data.totals.discountVnd)}
          format="vnd"
        />
        <Kpi label={k.discountedInvoices} value={data.totals.discountedInvoices} format="count" />
        <Kpi
          label={k.discountShare}
          value={bpToPercent(data.totals.discountShareBp)}
          format="percent"
        />
      </KpiRow>
      <ReportTable
        label={b.sales.tabs.discounts}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => `${row.type}-${row.discountId ?? row.code ?? row.nameVi}`}
        empty={b.sales.empty.discounts}
      />
      {data.campaigns.length > 0 ? (
        <ListSection title={b.sales.campaigns}>
          <ReportTable
            label={b.sales.campaigns}
            columns={campaignColumns}
            rows={data.campaigns}
            rowKey={(row) => row.campaignId}
            empty={b.sales.empty.products}
          />
        </ListSection>
      ) : null}
    </Stack>
  );
}

export function OnlineBody({
  data,
  page,
  onPage,
}: {
  data: OnlineOrderReport;
  page: number;
  onPage: (page: number) => void;
}) {
  const { t, locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const c = b.col;
  const k = b.sales.kpi;
  const tone = (state: OnlineOrderRow['state']) =>
    state === 'DELIVERED' ? 'success' : state === 'CANCELLED' ? 'neutral' : 'warning';
  const columns: DataTableColumn<OnlineOrderRow>[] = [
    { key: 'date', header: c['date']!, cell: (row) => formatDate(row.date, locale) },
    { key: 'order', header: c['order']!, mobileTitle: true, cell: (row) => row.orderCode },
    {
      key: 'invoice',
      header: c['invoice']!,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => row.invoiceCode,
    },
    {
      key: 'state',
      header: c['state']!,
      cell: (row) => (
        <Badge tone={tone(row.state)}>{b.sales.onlineStates[row.state] ?? row.state}</Badge>
      ),
    },
    {
      key: 'customer',
      header: c['customer']!,
      hideBelow: 'md',
      truncate: true,
      width: 'md',
      cell: (row) => row.contactName ?? '—',
    },
    { key: 'phone', header: c['phone']!, hideBelow: 'lg', cell: (row) => row.contactPhone },
    { key: 'total', header: c['total']!, numeric: true, cell: (row) => vnd(row.totalVnd, locale) },
    {
      key: 'collected',
      header: c['collected']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => vnd(row.collectedVnd, locale),
    },
    {
      key: 'refunded',
      header: c['refunded']!,
      numeric: true,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => vnd(row.refundedVnd, locale),
    },
    {
      key: 'delivered',
      header: c['deliveredOn']!,
      hideBelow: 'lg',
      cell: (row) => (row.deliveredOn === null ? '—' : formatDate(row.deliveredOn, locale)),
    },
    {
      key: 'staffCode',
      header: c['staffCode']!,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => row.staffCode ?? '—',
    },
  ];
  const s = data.summary;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.orders} value={s.orders} format="count" />
        <Kpi label={k.awaiting} value={s.awaitingDelivery} format="count" />
        <Kpi label={k.delivered} value={s.delivered} format="count" />
        <Kpi label={k.cancelled} value={s.cancelled} format="count" />
      </KpiRow>
      <KpiRow>
        <Kpi label={k.held} info={k.heldInfo} value={vndNumber(s.heldVnd)} format="vnd" />
        <Kpi label={k.failedRefunds} value={vndNumber(s.failedDeliveryRefundsVnd)} format="vnd" />
        <Kpi label={k.staffCode} value={s.staffCodeOrders} format="count" />
      </KpiRow>
      <DataTable
        mode="server"
        caption={fill(t.common.list.table, { list: b.sales.tabs.online })}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.orderCode}
        empty={<Empty>{b.sales.empty.online}</Empty>}
        paging={{
          page,
          pageSize: data.pageSize,
          total: data.total,
          onPageChange: onPage,
          labels: paginationLabels(t, b.sales.tabs.online),
        }}
      />
    </Stack>
  );
}

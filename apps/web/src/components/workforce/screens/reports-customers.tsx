'use client';

import type {
  BookingFunnelReport,
  CustomerVisitsReport,
  LoyaltyReport,
  ReportBucket,
  TopCustomersReport,
} from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  LineChart,
  ListSection,
  Select,
  Stack,
  type DataTableColumn,
} from '@lucy-spa/ui';
import { loyaltyDictionary } from '../../../i18n/loyalty';
import { reportsDictionary, type ReportsDictionary } from '../../../i18n/reports';
import { reportsBDictionary, type ReportsBDictionary } from '../../../i18n/reports-b';
import { fill } from '../../../i18n/workforce';
import { vnd } from '../../../lib/workforce/reports';
import { bpToPercent, formatCount } from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Empty, Notice } from '../ui';
import {
  Kpi,
  KpiRow,
  ReportData,
  ReportScreen,
  ReportTable,
  type PanelContext,
  type ReportTabDef,
} from './reports-kit';

/**
 * "Khách hàng" (Phase 8 P8-10, docs/PHASE8_REPORTS.md 4.3): visits (lượt đến) with new and returning customers, the booking funnel, loyalty
 * points, and the customers who paid most (phone numbers in full, Owner OQ-P8-6). Facts only: nothing here changes any data.
 */
export function CustomersScreen() {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  return (
    <ReportScreen
      title={b.customers.title}
      intro={b.customers.intro}
      tabs={customersTabs(b, reportsDictionary(locale))}
    />
  );
}

export function customersTabs(b: ReportsBDictionary, w: ReportsDictionary): ReportTabDef[] {
  const period = (context: PanelContext) => ({
    from: context.range?.from,
    to: context.range?.to,
    branchId: context.branch || undefined,
  });
  const grouping = (context: PanelContext) => (
    <Select
      aria-label={w.common.group}
      value={context.state.bucket}
      onChange={(event) => context.update({ bucket: event.target.value as '' | ReportBucket })}
      placeholder={w.common.groupAuto}
      options={(['day', 'week', 'month', 'quarter', 'year'] as const).map((id) => ({
        value: id,
        label: w.bucketsBy[id],
      }))}
    />
  );
  return [
    {
      id: 'visits',
      label: b.customers.tabs.visits,
      report: 'customers-visits',
      kind: 'range',
      bucketed: true,
      exportLabel: b.exportChoices['customers-visits']!,
      filters: grouping,
      panel: (context) => (
        <ReportData<CustomerVisitsReport>
          path="/api/v1/reports/customers/visits"
          params={{ ...period(context), bucket: context.state.bucket || undefined }}
          nonce={context.nonce}
        >
          {(data) => <VisitsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'bookings',
      label: b.customers.tabs.bookings,
      report: 'bookings-funnel',
      kind: 'range',
      bucketed: true,
      exportLabel: b.exportChoices['bookings-funnel']!,
      filters: grouping,
      panel: (context) => (
        <ReportData<BookingFunnelReport>
          path="/api/v1/reports/bookings/funnel"
          params={{ ...period(context), bucket: context.state.bucket || undefined }}
          nonce={context.nonce}
        >
          {(data) => <BookingsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'loyalty',
      label: b.customers.tabs.loyalty,
      report: 'loyalty',
      kind: 'range',
      exportLabel: b.exportChoices['loyalty']!,
      panel: (context) => (
        <ReportData<LoyaltyReport>
          path="/api/v1/reports/loyalty"
          params={period(context)}
          nonce={context.nonce}
        >
          {(data) => <LoyaltyBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'top',
      label: b.customers.tabs.top,
      report: 'top-customers',
      kind: 'range',
      exportLabel: b.exportChoices['top-customers']!,
      panel: (context) => (
        <ReportData<TopCustomersReport>
          path="/api/v1/reports/customers/top"
          params={period(context)}
          nonce={context.nonce}
        >
          {(data) => <TopBody data={data} />}
        </ReportData>
      ),
    },
  ];
}

/** The words every line chart of these screens needs. */
function useChartLabels() {
  const { t } = useWorkforce();
  const kit = t.dashboard.kit;
  return {
    up: kit.up,
    down: kit.down,
    flat: kit.flat,
    comparedTo: '',
    xHeader: kit.xHeader,
    previous: kit.previous,
    showTable: kit.showTable,
    showChart: kit.showChart,
    plotHint: kit.plotHint,
  };
}

export function VisitsBody({ data }: { data: CustomerVisitsReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const w = reportsDictionary(locale);
  const k = b.customers.kpi;
  const labels = useChartLabels();
  const totals = data.totals;
  const branchColumns: DataTableColumn<CustomerVisitsReport['byBranch'][number]>[] = [
    {
      key: 'branch',
      header: b.col['branch']!,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => row.branch.name,
    },
    { key: 'visits', header: b.col['visits']!, numeric: true, cell: (row) => count(row.visits) },
    { key: 'people', header: b.col['people']!, numeric: true, cell: (row) => count(row.people) },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.visits} value={totals.visits} format="count" />
        <Kpi label={k.people} value={totals.people} format="count" />
        <Kpi label={k.newPeople} value={totals.newPeople} format="count" />
        <Kpi label={k.returningPeople} value={totals.returningPeople} format="count" />
        {totals.unidentified > 0 ? (
          <Kpi
            label={k.unidentified}
            info={k.unidentifiedInfo}
            value={totals.unidentified}
            format="count"
          />
        ) : null}
      </KpiRow>
      <Card as="section" aria-label={b.customers.chartVisits}>
        <CardHeader
          title={b.customers.chartVisits}
          description={fill(b.customers.chartBy, {
            bucket: w.buckets[data.bucket].toLowerCase(),
          })}
        />
        {totals.visits === 0 ? (
          <Empty>{b.customers.empty.visits}</Empty>
        ) : (
          <LineChart
            title={b.customers.chartVisits}
            data={{
              current: [
                {
                  id: 'visits',
                  label: b.col['visits']!,
                  points: data.series.map((p) => ({ x: p.start, y: p.visits })),
                },
                {
                  id: 'people',
                  label: b.col['people']!,
                  points: data.series.map((p) => ({ x: p.start, y: p.people })),
                },
              ],
            }}
            format={{ valueFormat: 'count', locale }}
            labels={labels}
          />
        )}
      </Card>
      {data.byBranch.length > 1 ? (
        <ListSection title={b.customers.byBranch}>
          <ReportTable
            label={b.customers.byBranch}
            columns={branchColumns}
            rows={data.byBranch}
            rowKey={(row) => row.branch.id}
            empty={b.customers.empty.visits}
          />
        </ListSection>
      ) : null}
    </Stack>
  );
}

export function BookingsBody({ data }: { data: BookingFunnelReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const w = reportsDictionary(locale);
  const k = b.customers.kpi;
  const labels = useChartLabels();
  const channelColumns: DataTableColumn<BookingFunnelReport['byChannel'][number]>[] = [
    {
      key: 'channel',
      header: b.col['channel']!,
      mobileTitle: true,
      cell: (row) => b.customers.channels[row.channel] ?? row.channel,
    },
    {
      key: 'bookings',
      header: b.col['bookings']!,
      numeric: true,
      cell: (row) => count(row.bookings),
    },
    {
      key: 'came',
      header: b.col['checkedIn']!,
      numeric: true,
      cell: (row) => count(row.checkedIn),
    },
    {
      key: 'cancelled',
      header: b.col['cancelled']!,
      numeric: true,
      cell: (row) => count(row.cancelled),
    },
    { key: 'noShow', header: b.col['noShow']!, numeric: true, cell: (row) => count(row.noShow) },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.bookings} value={data.totals.bookings} format="count" />
        <Kpi label={k.came} info={k.cameInfo} value={bpToPercent(data.cameBp)} format="percent" />
        <Kpi
          label={k.noShow}
          info={k.noShowInfo}
          value={bpToPercent(data.noShowBp)}
          format="percent"
        />
        <Kpi label={b.col['cancelled']!} value={data.totals.cancelled} format="count" />
      </KpiRow>
      <Card as="section" aria-label={b.customers.chartBookings}>
        <CardHeader
          title={b.customers.chartBookings}
          description={fill(b.customers.chartBy, {
            bucket: w.buckets[data.bucket].toLowerCase(),
          })}
        />
        {data.totals.bookings === 0 ? (
          <Empty>{b.customers.empty.bookings}</Empty>
        ) : (
          <LineChart
            title={b.customers.chartBookings}
            data={{
              current: [
                {
                  id: 'bookings',
                  label: b.col['bookings']!,
                  points: data.series.map((p) => ({ x: p.start, y: p.bookings })),
                },
                {
                  id: 'checkedIn',
                  label: b.col['checkedIn']!,
                  points: data.series.map((p) => ({ x: p.start, y: p.checkedIn })),
                },
              ],
            }}
            format={{ valueFormat: 'count', locale }}
            labels={labels}
          />
        )}
      </Card>
      <ListSection title={b.customers.byChannel}>
        <ReportTable
          label={b.customers.byChannel}
          columns={channelColumns}
          rows={data.byChannel}
          rowKey={(row) => row.channel}
          empty={b.customers.empty.bookings}
        />
      </ListSection>
    </Stack>
  );
}

export function LoyaltyBody({ data }: { data: LoyaltyReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const loyalty = loyaltyDictionary(locale);
  const k = b.customers.kpi;
  const pointColumns: DataTableColumn<LoyaltyReport['points'][number]>[] = [
    {
      key: 'wallet',
      header: b.col['wallet']!,
      mobileTitle: true,
      cell: (row) => (loyalty.wallets as Record<string, string>)[row.wallet] ?? row.wallet,
    },
    {
      key: 'kind',
      header: b.col['kind']!,
      truncate: true,
      width: 'lg',
      cell: (row) => (loyalty.kinds as Record<string, string>)[row.kind] ?? row.kind,
    },
    { key: 'points', header: b.col['points']!, numeric: true, cell: (row) => count(row.points) },
    {
      key: 'entries',
      header: b.col['entries']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.entries),
    },
  ];
  const tierColumns: DataTableColumn<LoyaltyReport['tiers'][number]>[] = [
    {
      key: 'tier',
      header: b.col['tier']!,
      mobileTitle: true,
      cell: (row) => (loyalty.tiers as Record<string, string>)[row.tier] ?? row.tier,
    },
    {
      key: 'spa',
      header: (loyalty.wallets as Record<string, string>)['SPA'] ?? 'SPA',
      numeric: true,
      cell: (row) => count(row.spa),
    },
    {
      key: 'beauty',
      header: (loyalty.wallets as Record<string, string>)['BEAUTY'] ?? 'BEAUTY',
      numeric: true,
      cell: (row) => count(row.beauty),
    },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.outstandingSpa} value={data.outstanding.spa} format="count" />
        <Kpi label={k.outstandingBeauty} value={data.outstanding.beauty} format="count" />
        <Kpi
          label={k.referrals}
          value={data.referrals.bound}
          format="count"
          asOf={fill(k.referralsNote, { count: String(data.referrals.rewarded) })}
        />
        <Kpi label={k.rewards} value={data.rewardRedemptions} format="count" />
        <Kpi
          label={k.birthday}
          value={data.birthday.redeemed}
          format="count"
          asOf={vnd(data.birthday.amountVnd, locale)}
        />
      </KpiRow>
      {!data.includesBranchless ? <Notice tone="info">{b.customers.branchless}</Notice> : null}
      <ListSection title={b.customers.points}>
        <ReportTable
          label={b.customers.points}
          columns={pointColumns}
          rows={data.points}
          rowKey={(row) => `${row.wallet}-${row.kind}`}
          empty={b.customers.empty.loyalty}
        />
      </ListSection>
      <ListSection title={b.customers.tiers}>
        <ReportTable
          label={b.customers.tiers}
          columns={tierColumns}
          rows={data.tiers}
          rowKey={(row) => row.tier}
          empty={b.customers.empty.loyalty}
        />
      </ListSection>
    </Stack>
  );
}

export function TopBody({ data }: { data: TopCustomersReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const columns: DataTableColumn<TopCustomersReport['rows'][number]>[] = [
    {
      key: 'name',
      header: b.col['customer']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => row.name,
    },
    { key: 'phone', header: b.col['phone']!, hideBelow: 'md', cell: (row) => row.phone ?? '—' },
    {
      key: 'invoices',
      header: b.col['invoices']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.invoices),
    },
    {
      key: 'visits',
      header: b.col['visits']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => count(row.visits),
    },
    {
      key: 'paid',
      header: b.col['paid']!,
      numeric: true,
      cell: (row) => vnd(row.collectedVnd, locale),
    },
  ];
  return (
    <Stack gap="page">
      <Notice tone="info">{fill(b.customers.topNote, { count: String(data.limit) })}</Notice>
      <ReportTable
        label={b.customers.top}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.userId}
        empty={b.customers.empty.top}
      />
    </Stack>
  );
}

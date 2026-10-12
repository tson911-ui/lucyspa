'use client';

import type {
  ReportBucket,
  ReportRegistryResponse,
  RevenueReport,
  RevenueMethodRow,
} from '@lucy-spa/contracts';
import { REPORT_LIMITS } from '@lucy-spa/contracts';
import {
  Card,
  CardHeader,
  DataTable,
  DateRangePicker,
  DonutChart,
  Grid,
  KpiCard,
  LineChart,
  ListToolbar,
  Select,
  Stack,
  Tabs,
  useUrlState,
  type DataTableColumn,
  type DateRange,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useState } from 'react';
import { reportsDictionary, type ReportsDictionary } from '../../../i18n/reports';
import { fill } from '../../../i18n/workforce';
import { formatTime, todayIn } from '../../../lib/workforce/format';
import { toolbarLabels } from '../../../lib/workforce/list-view';
import {
  exportRequest,
  isEmptyRevenue,
  REPORT_ZONE,
  REVENUE_PAGE_DEFAULTS,
  revenueRange,
  revenueSeries,
  normalizeRevenuePage,
  vnd as formatVnd,
  reportErrorMessage,
  sideSlices,
  vndNumber,
  type RevenuePageState,
} from '../../../lib/workforce/reports';
import { useWorkforce } from '../session';
import { Button, Empty, ErrorState, Loading, Notice, PageHeader, useResource } from '../ui';
import { ExportDialog, type ExportChoice } from './reports-export';

const REVENUE_REPORTS = [
  'revenue-overview',
  'revenue-by-branch',
  'revenue-by-kind',
  'revenue-by-method',
] as const;

/**
 * "Doanh thu" (Phase 8 P8-5, docs/PHASE8_REPORTS.md 4.1-4.2): the headline, what it is made of and how it moved. Everything on the page is
 * one API answer (`GET /reports/revenue`), so the numbers, the chart, the tables and the file always agree. The primary action opens the
 * export dialog; the toolbar holds the period, branch, comparison and grouping. The API decides every permission again.
 */
export function RevenueScreen() {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const registry = useResource(() => api.get<ReportRegistryResponse>('/api/v1/reports'), [api]);
  if (registry.error && !registry.data) {
    return (
      <>
        <PageHeader title={w.revenue.title} intro={w.revenue.intro} />
        <ErrorState error={registry.error} t={t} onRetry={() => void registry.reload()} />
      </>
    );
  }
  if (!registry.data) return <Loading t={t} page />;
  return <RevenueView registry={registry.data} />;
}

export function RevenueView({ registry }: { registry: ReportRegistryResponse }) {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const [state, update] = useUrlState(REVENUE_PAGE_DEFAULTS, { normalize: normalizeRevenuePage });
  // "Today" is read in the browser after the page has loaded, never during the first render.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIn(REPORT_ZONE)), []);
  const [exporting, setExporting] = useState(false);

  const entry = registry.reports.find((report) => report.id === 'revenue-overview');
  const allowed = useMemo(
    () => registry.branches.filter((branch) => entry?.branchIds.includes(branch.id)),
    [registry.branches, entry],
  );
  const branch = allowed.some((item) => item.id === state.branch) ? state.branch : '';
  const range: DateRange | null = today ? revenueRange(state, today) : null;

  const report = useResource(
    () =>
      range
        ? api.get<RevenueReport>('/api/v1/reports/revenue', {
            from: range.from,
            to: range.to,
            branchId: branch || undefined,
            bucket: state.bucket || undefined,
            compare: state.compare === 'previous' ? 'previous' : undefined,
          })
        : Promise.resolve(null as unknown as RevenueReport),
    [api, range?.from, range?.to, branch, state.bucket, state.compare],
  );

  if (!entry?.available || allowed.length === 0) {
    return (
      <>
        <PageHeader title={w.revenue.title} intro={w.revenue.intro} />
        <Empty>{w.revenue.emptyBranches}</Empty>
      </>
    );
  }
  const data = report.data && range ? report.data : null;
  const choices: ExportChoice[] = REVENUE_REPORTS.map((id) => ({
    id,
    label: w.exportChoices[id] ?? id,
  }));
  const activeFilters =
    (state.from !== '' ? 1 : 0) +
    (branch !== '' ? 1 : 0) +
    (state.compare !== 'none' ? 1 : 0) +
    (state.bucket !== '' ? 1 : 0);

  return (
    <>
      <PageHeader title={w.revenue.title} intro={w.revenue.intro}>
        {entry.exportable ? (
          <Button variant="primary" icon="download" onClick={() => setExporting(true)}>
            {w.common.export}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        <ListToolbar
          className="ls-no-print"
          labels={toolbarLabels(t)}
          activeFilters={activeFilters}
          onReset={() => update({ ...REVENUE_PAGE_DEFAULTS, tab: state.tab })}
          reload={{
            label: w.common.reload,
            onClick: () => void report.reload(),
            busy: report.loading,
          }}
          resultCount={
            data
              ? fill(w.common.updated, { time: formatTime(data.generatedAt, REPORT_ZONE, locale) })
              : undefined
          }
          filters={
            <>
              {today && range ? (
                <DateRangePicker
                  value={range}
                  today={today}
                  locale={locale}
                  labels={w.picker}
                  maxDays={REPORT_LIMITS.maxDays}
                  onChange={(next) => update({ from: next.from, to: next.to })}
                />
              ) : null}
              {allowed.length > 1 ? (
                <Select
                  aria-label={w.common.branch}
                  value={branch}
                  onChange={(event) => update({ branch: event.target.value })}
                  placeholder={w.common.allBranches}
                  options={allowed.map((item) => ({ value: item.id, label: item.name }))}
                />
              ) : null}
              <Select
                aria-label={w.common.compare}
                value={state.compare === 'previous' ? 'previous' : ''}
                onChange={(event) =>
                  update({ compare: event.target.value === 'previous' ? 'previous' : 'none' })
                }
                placeholder={w.common.compareNone}
                options={[{ value: 'previous', label: w.common.compareVsPrevious }]}
              />
              <Select
                aria-label={w.common.group}
                value={state.bucket}
                onChange={(event) => update({ bucket: event.target.value as '' | ReportBucket })}
                placeholder={w.common.groupAuto}
                options={(['day', 'week', 'month', 'quarter', 'year'] as const).map((id) => ({
                  value: id,
                  label: w.bucketsBy[id],
                }))}
              />
            </>
          }
        />
        {report.error && !data ? (
          <ErrorState error={report.error} t={t} onRetry={() => void report.reload()} />
        ) : !data ? (
          <Loading t={t} />
        ) : (
          <RevenueBody data={data} w={w} state={state} update={update} />
        )}
      </Stack>
      {exporting ? (
        <ExportDialog
          choices={choices}
          initial="revenue-overview"
          build={(id, format) =>
            exportRequest(
              id,
              format,
              { range, branch, compare: state.compare, bucket: state.bucket },
              locale,
            )
          }
          onClose={() => setExporting(false)}
        />
      ) : null}
      {report.error && data ? (
        <Notice tone="error">{reportErrorMessage(report.error, w, t)}</Notice>
      ) : null}
    </>
  );
}

export function RevenueBody({
  data,
  w,
  state,
  update,
}: {
  data: RevenueReport;
  w: ReportsDictionary;
  state: RevenuePageState;
  update: (patch: Partial<RevenuePageState>) => void;
}) {
  const { t, locale } = useWorkforce();
  const kit = t.dashboard.kit;
  const format = { valueFormat: 'vnd', locale } as const;
  const count = { valueFormat: 'count', locale } as const;
  const words = {
    up: kit.up,
    down: kit.down,
    flat: kit.flat,
    comparedTo: w.common.vsPrevious,
  };
  const previous = data.previousTotals;
  const prev = (value: string | undefined) =>
    previous && value !== undefined ? vndNumber(value) : undefined;
  const k = w.revenue.kpi;
  const period = data.period.previous
    ? `${data.period.from} → ${data.period.to}`
    : `${data.period.from} → ${data.period.to}`;
  const names = data.branches.map((branch) => branch.name).join(', ');
  const unclassified = vndNumber(data.unclassifiedVnd);

  return (
    <Stack gap="page">
      <div className="ls-print-only">
        <p>{fill(w.print.period, { period })}</p>
        <p>{fill(w.print.branches, { names })}</p>
      </div>
      <Grid min="sm" gap="page">
        <KpiCard
          label={k.net}
          info={k.netInfo}
          value={vndNumber(data.totals.netVnd)}
          previous={prev(previous?.netVnd)}
          format={format}
          labels={words}
        />
        <KpiCard
          label={k.collected}
          info={k.collectedInfo}
          value={vndNumber(data.totals.collectedVnd)}
          previous={prev(previous?.collectedVnd)}
          format={format}
          labels={words}
        />
        <KpiCard
          label={k.givenBack}
          info={k.givenBackInfo}
          value={vndNumber(data.totals.refundsVnd) + vndNumber(data.totals.exchangesVnd)}
          previous={
            previous ? vndNumber(previous.refundsVnd) + vndNumber(previous.exchangesVnd) : undefined
          }
          format={format}
          labels={words}
        />
      </Grid>
      <Grid min="sm" gap="page">
        <KpiCard
          label={k.paidInvoices}
          info={k.paidInvoicesInfo}
          value={data.paidInvoices.count}
          format={count}
          labels={words}
          asOf={
            data.paidInvoices.count > 0
              ? fill(k.average, { amount: formatVnd(data.paidInvoices.averageVnd, locale) })
              : undefined
          }
        />
        <KpiCard
          label={k.visits}
          info={k.visitsInfo}
          value={data.visits}
          format={count}
          labels={words}
        />
        <KpiCard
          label={k.held}
          info={k.heldInfo}
          value={vndNumber(data.onlineHeldVnd)}
          format={format}
          labels={words}
        />
      </Grid>
      {unclassified > 0 ? (
        <Notice tone="warning">
          {fill(w.revenue.unclassified, { amount: formatVnd(data.unclassifiedVnd, locale) })}
        </Notice>
      ) : null}
      <Card as="section" aria-label={w.revenue.chart.title}>
        <CardHeader
          title={w.revenue.chart.title}
          description={`${fill(w.revenue.chart.subtitle, { bucket: w.buckets[data.bucket].toLowerCase() })}${data.bucket === 'day' ? '' : '. ' + w.revenue.chart.partial}`}
        />
        {isEmptyRevenue(data) ? (
          <Empty>{w.revenue.empty}</Empty>
        ) : (
          <LineChart
            title={w.revenue.chart.title}
            data={revenueSeries(data, w)}
            format={format}
            area
            labels={{
              ...words,
              xHeader: kit.xHeader,
              previous: w.revenue.chart.previous,
              showTable: kit.showTable,
              showChart: kit.showChart,
              plotHint: kit.plotHint,
            }}
          />
        )}
      </Card>
      <Tabs
        label={w.revenue.title}
        value={state.tab}
        onChange={(tab) => update({ tab: tab as RevenuePageState['tab'] })}
        tabs={[
          { id: 'branch', label: w.revenue.tabs.branch, panel: <BranchTable data={data} w={w} /> },
          { id: 'kind', label: w.revenue.tabs.kind, panel: <KindPanel data={data} w={w} /> },
          { id: 'method', label: w.revenue.tabs.method, panel: <MethodTable data={data} w={w} /> },
        ]}
      />
      <Notice tone="info">
        <strong>{w.revenue.definitionTitle}.</strong> {w.revenue.definition}
      </Notice>
    </Stack>
  );
}

function BranchTable({ data, w }: { data: RevenueReport; w: ReportsDictionary }) {
  const { t, locale } = useWorkforce();
  const c = w.revenue.columns;
  const comparing = data.previousTotals !== null;
  const columns: DataTableColumn<RevenueReport['byBranch'][number]>[] = [
    {
      key: 'branch',
      header: c.branch,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => row.branch.name,
    },
    { key: 'net', header: c.net, numeric: true, cell: (row) => formatVnd(row.netVnd, locale) },
    ...(comparing
      ? [
          {
            key: 'previous',
            header: c.previous,
            numeric: true,
            hideBelow: 'lg' as const,
            cell: (row: RevenueReport['byBranch'][number]) =>
              formatVnd(row.previousNetVnd ?? '0', locale),
          },
        ]
      : []),
    {
      key: 'collected',
      header: c.collected,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => formatVnd(row.collectedVnd, locale),
    },
    {
      key: 'refunds',
      header: c.refunds,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => formatVnd(row.refundsVnd, locale),
    },
    {
      key: 'exchanges',
      header: c.exchanges,
      numeric: true,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => formatVnd(row.exchangesVnd, locale),
    },
    {
      key: 'invoices',
      header: c.paidInvoices,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => row.paidInvoices,
    },
    { key: 'visits', header: c.visits, numeric: true, hideBelow: 'md', cell: (row) => row.visits },
  ];
  return (
    <DataTable
      mode="client"
      caption={w.revenue.tabs.branch}
      columns={columns}
      rows={data.byBranch}
      rowKey={(row) => row.branch.id}
      paging={{ off: 'one row per branch the person may read' }}
      empty={<Empty>{w.revenue.empty}</Empty>}
      loadingLabel={t.common.loading}
    />
  );
}

interface PartRow {
  id: string;
  dimension: string;
  label: string;
  net: string;
  share: number;
}

function KindPanel({ data, w }: { data: RevenueReport; w: ReportsDictionary }) {
  const { t, locale } = useWorkforce();
  const c = w.revenue.columns;
  const rows: PartRow[] = [
    ...data.bySide.map((part) => ({
      id: `side-${part.key}`,
      dimension: c.group,
      label: w.revenue.side[part.key] ?? part.key,
      net: part.netVnd,
      share: part.shareBp,
    })),
    ...data.byKind.map((part) => ({
      id: `kind-${part.key}`,
      dimension: c.kind,
      label: w.revenue.kind[part.key] ?? part.key,
      net: part.netVnd,
      share: part.shareBp,
    })),
    ...data.byChannel.map((part) => ({
      id: `channel-${part.key}`,
      dimension: c.channel,
      label: w.revenue.channel[part.key] ?? part.key,
      net: part.netVnd,
      share: part.shareBp,
    })),
  ];
  const slices = sideSlices(data, w);
  return (
    <Stack gap="block">
      {slices.length > 1 ? (
        <DonutChart
          title={w.revenue.donutTitle}
          slices={slices}
          size={240}
          innerRadius={0.72}
          format={{ valueFormat: 'vnd', locale }}
          labels={{
            other: w.revenue.donutOther,
            total: w.revenue.donutTotal,
            showTable: t.dashboard.kit.showTable,
            showChart: t.dashboard.kit.showChart,
            plotHint: t.dashboard.kit.plotHint,
            nameHeader: c.group,
            valueHeader: c.net,
            shareHeader: c.share,
          }}
        />
      ) : null}
      <DataTable
        mode="client"
        caption={w.revenue.tabs.kind}
        columns={[
          {
            key: 'dimension',
            header: c.by,
            hidePhone: true,
            cell: (row: PartRow) => row.dimension,
          },
          { key: 'label', header: c.item, mobileTitle: true, cell: (row: PartRow) => row.label },
          {
            key: 'net',
            header: c.net,
            numeric: true,
            cell: (row: PartRow) => formatVnd(row.net, locale),
          },
          {
            key: 'share',
            header: c.share,
            numeric: true,
            cell: (row: PartRow) => `${(row.share / 100).toFixed(1)}%`,
          },
        ]}
        rows={rows}
        rowKey={(row) => row.id}
        paging={{ off: 'a fixed short breakdown' }}
        empty={<Empty>{w.revenue.empty}</Empty>}
        loadingLabel={t.common.loading}
      />
    </Stack>
  );
}

function MethodTable({ data, w }: { data: RevenueReport; w: ReportsDictionary }) {
  const { t, locale } = useWorkforce();
  const c = w.revenue.columns;
  const columns: DataTableColumn<RevenueMethodRow>[] = [
    {
      key: 'method',
      header: c.method,
      mobileTitle: true,
      cell: (row) => w.revenue.method[row.method] ?? row.method,
    },
    { key: 'in', header: c.moneyIn, numeric: true, cell: (row) => formatVnd(row.inVnd, locale) },
    { key: 'out', header: c.moneyOut, numeric: true, cell: (row) => formatVnd(row.outVnd, locale) },
    { key: 'net', header: c.net, numeric: true, cell: (row) => formatVnd(row.netVnd, locale) },
  ];
  return (
    <DataTable
      mode="client"
      caption={w.revenue.tabs.method}
      columns={columns}
      rows={data.byMethod}
      rowKey={(row) => row.method}
      paging={{ off: 'three payment methods' }}
      empty={<Empty>{w.revenue.empty}</Empty>}
      loadingLabel={t.common.loading}
    />
  );
}

'use client';

import type { RefundReport, RefundRow, ReportRegistryResponse } from '@lucy-spa/contracts';
import { REPORT_LIMITS } from '@lucy-spa/contracts';
import {
  DataTable,
  DateRangePicker,
  ListToolbar,
  Select,
  Stack,
  useUrlState,
  type DataTableColumn,
  type DateRange,
} from '@lucy-spa/ui';
import { useEffect, useMemo, useState } from 'react';
import { reportsDictionary } from '../../../i18n/reports';
import { fill } from '../../../i18n/workforce';
import { formatDate, todayIn } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  exportRequest,
  normalizeRefundPage,
  REFUND_PAGE_DEFAULTS,
  REFUND_RESET_KEYS,
  REPORT_ZONE,
  revenueRange,
  vndNumber,
} from '../../../lib/workforce/reports';
import { useWorkforce } from '../session';
import { Badge, Button, Empty, ErrorState, Loading, Notice, PageHeader, useResource } from '../ui';
import { ExportDialog } from './reports-export';
import { Kpi, KpiRow } from './reports-kit';
import { vndText } from './reports-format';

/**
 * "Hoàn tiền và điều chỉnh" (Phase 8 P8-5, R10): every product refund, every difference paid back on an exchange and every cash payment
 * reversed as a mistake in the period, newest first, 20 a page. A refund of a failed delivery says so. The page changes nothing.
 */
export function RefundsScreen() {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const registry = useResource(() => api.get<ReportRegistryResponse>('/api/v1/reports'), [api]);
  if (registry.error && !registry.data) {
    return (
      <>
        <PageHeader title={w.refunds.title} intro={w.refunds.intro} />
        <ErrorState error={registry.error} t={t} onRetry={() => void registry.reload()} />
      </>
    );
  }
  if (!registry.data) return <Loading t={t} page />;
  return <RefundsView registry={registry.data} />;
}

export function RefundsView({ registry }: { registry: ReportRegistryResponse }) {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const [state, update] = useUrlState(REFUND_PAGE_DEFAULTS, {
    normalize: normalizeRefundPage,
    resetOnChange: REFUND_RESET_KEYS,
  });
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIn(REPORT_ZONE)), []);
  const [exporting, setExporting] = useState(false);
  const entry = registry.reports.find((report) => report.id === 'refunds');
  const allowed = useMemo(
    () => registry.branches.filter((branch) => entry?.branchIds.includes(branch.id)),
    [registry.branches, entry],
  );
  const branch = allowed.some((item) => item.id === state.branch) ? state.branch : '';
  const range: DateRange | null = today ? revenueRange(state, today) : null;
  const report = useResource(
    () =>
      range
        ? api.get<RefundReport>('/api/v1/reports/refunds', {
            from: range.from,
            to: range.to,
            branchId: branch || undefined,
            page: state.page,
          })
        : Promise.resolve(null as unknown as RefundReport),
    [api, range?.from, range?.to, branch, state.page],
  );
  if (!entry?.available || allowed.length === 0) {
    return (
      <>
        <PageHeader title={w.refunds.title} intro={w.refunds.intro} />
        <Empty>{w.revenue.emptyBranches}</Empty>
      </>
    );
  }
  const data = report.data && range ? report.data : null;
  const filtered = (state.from !== '' ? 1 : 0) + (branch !== '' ? 1 : 0);
  return (
    <>
      <PageHeader title={w.refunds.title} intro={w.refunds.intro}>
        {entry.exportable ? (
          <Button variant="primary" icon="download" onClick={() => setExporting(true)}>
            {w.common.export}
          </Button>
        ) : null}
      </PageHeader>
      <Stack gap="page">
        {data && data.totals.paymentAnomalies > 0 ? (
          <Notice tone="warning">
            {fill(w.refunds.anomalies, { count: String(data.totals.paymentAnomalies) })}
          </Notice>
        ) : null}
        {/* The period totals are the report's figures (Stat cards, as on every report), not a middle-dot line in the toolbar. */}
        {data ? (
          <KpiRow>
            <Kpi
              label={w.refunds.kpi.refunds}
              value={vndNumber(data.totals.refundsVnd)}
              format="vnd"
            />
            <Kpi
              label={w.refunds.kpi.exchanges}
              value={vndNumber(data.totals.exchangesVnd)}
              format="vnd"
            />
            <Kpi
              label={w.refunds.kpi.reversals}
              value={vndNumber(data.totals.reversalsVnd)}
              format="vnd"
            />
          </KpiRow>
        ) : null}
        <div className="ls-list-section">
          <ListToolbar
            className="ls-no-print"
            labels={toolbarLabels(t)}
            activeFilters={filtered}
            onReset={() => update({ from: '', to: '', branch: '' })}
            reload={{
              label: w.common.reload,
              onClick: () => void report.reload(),
              busy: report.loading,
            }}
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
              </>
            }
          />
          <DataTable
            mode="server"
            caption={fill(t.common.list.table, { list: w.refunds.title })}
            columns={columns(w, locale, allowed.length > 1)}
            rows={data?.rows ?? []}
            rowKey={(row) =>
              `${row.kind}-${row.code ?? row.invoiceCode}-${row.date}-${row.amountVnd}`
            }
            loading={report.loading && !data}
            loadingLabel={t.common.loading}
            error={
              report.error ? (
                <ErrorState error={report.error} t={t} onRetry={() => void report.reload()} />
              ) : undefined
            }
            empty={data ? <Empty>{w.refunds.empty}</Empty> : undefined}
            paging={{
              page: state.page,
              pageSize: data?.pageSize ?? 20,
              total: data?.total ?? 0,
              onPageChange: (page) => update({ page }),
              labels: paginationLabels(t, w.refunds.title),
            }}
          />
        </div>
      </Stack>
      {exporting ? (
        <ExportDialog
          choices={[{ id: 'refunds', label: w.exportChoices['refunds'] ?? w.refunds.title }]}
          initial="refunds"
          build={(id, format) => exportRequest(id, format, { range, branch }, locale)}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </>
  );
}

function columns(
  w: ReturnType<typeof reportsDictionary>,
  locale: 'vi' | 'en',
  withBranch: boolean,
): DataTableColumn<RefundRow>[] {
  const c = w.refunds.columns;
  return [
    {
      key: 'date',
      header: c.date,
      cell: (row) => <span className="ls-adminb-code">{formatDate(row.date, locale)}</span>,
    },
    {
      key: 'type',
      header: c.type,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      cell: (row) => (
        <>
          {w.refunds.kinds[row.kind] ?? row.kind}
          {row.failedDelivery ? (
            <>
              {' '}
              <Badge tone="warning">{w.refunds.failedDelivery}</Badge>
            </>
          ) : null}
        </>
      ),
    },
    ...(withBranch
      ? [
          {
            key: 'branch',
            header: c.branch,
            hideBelow: 'lg' as const,
            wrap: true,
            width: 'sm' as const,
            cell: (row: RefundRow) => row.branch.name,
          },
        ]
      : []),
    {
      key: 'invoice',
      header: c.invoice,
      cell: (row) => <span translate="no">{row.invoiceCode}</span>,
    },
    {
      key: 'code',
      header: c.code,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => (row.code ? <span translate="no">{row.code}</span> : '—'),
    },
    {
      key: 'amount',
      header: c.amount,
      numeric: true,
      cell: (row) => vndText(row.amountVnd, locale),
    },
    {
      key: 'method',
      header: c.method,
      hideBelow: 'md',
      cell: (row) => w.refunds.methods[row.method] ?? row.method,
    },
    {
      key: 'reason',
      header: c.reason,
      hideBelow: 'lg',
      hidePhone: true,
      wrap: true,
      width: 'lg',
      cell: (row) => row.reason,
    },
  ];
}

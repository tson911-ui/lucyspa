'use client';

import type { ReportRegistryResponse } from '@lucy-spa/contracts';
import { REPORT_LIMITS } from '@lucy-spa/contracts';
import {
  DataTable,
  DateRangePicker,
  ListToolbar,
  Grid,
  KpiCard,
  Select,
  Stack,
  Tabs,
  useUrlState,
  type DataTableColumn,
  type DateRange,
  type ValueFormat,
} from '@lucy-spa/ui';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { reportsDictionary } from '../../../i18n/reports';
import { reportsBDictionary } from '../../../i18n/reports-b';
import { fill } from '../../../i18n/workforce';
import { todayIn } from '../../../lib/workforce/format';
import { paginationLabels, toolbarLabels } from '../../../lib/workforce/list-view';
import {
  exportRequest,
  REPORT_ZONE,
  reportErrorMessage,
  revenueRange,
} from '../../../lib/workforce/reports';
import {
  normalizeReportPage,
  REPORT_PAGE_DEFAULTS,
  REPORT_RESET_KEYS,
  STOCK_DAY_CHOICES,
  type ReportPageState,
} from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Button, Empty, ErrorState, Loading, Notice, PageHeader, useResource } from '../ui';
import { ExportDialog, type ExportChoice } from './reports-export';

/**
 * The frame of the Wave B report screens (Phase 8 P8-10): a page with a toolbar (period, branch, the filters of the tab), the tabs the person
 * may open, and the one export action. Each tab says which report it is (the registry decides whether it is available and at which
 * branches), how it is dated (a period, a window of days, or "now") and what it shows. The API authorizes every request again.
 */
export interface PanelContext {
  range: DateRange | null;
  branch: string;
  state: ReportPageState;
  /** Bumped by the reload button so a panel loads again. */
  nonce: number;
  update: (patch: Partial<ReportPageState>) => void;
}

export interface ReportTabDef {
  id: string;
  label: string;
  /** The registry id of the report behind the tab (it also names the exported file). */
  report: string;
  /** `range`: the period picker; `days`: the window choice; `asof`: figures as of now. */
  kind: 'range' | 'days' | 'asof';
  /** The export dialog entry label. */
  exportLabel: string;
  /** The tab's export honours the grouping (visits and bookings). */
  bucketed?: boolean;
  /** The tab's export honours "view by" (products). */
  grouped?: boolean;
  /** Extra toolbar controls of the tab. */
  filters?: (context: PanelContext) => ReactNode;
  panel: (context: PanelContext) => ReactNode;
}

export function ReportScreen({
  title,
  intro,
  tabs,
}: {
  title: string;
  intro: string;
  tabs: readonly ReportTabDef[];
}) {
  const { api, t } = useWorkforce();
  const registry = useResource(() => api.get<ReportRegistryResponse>('/api/v1/reports'), [api]);
  if (registry.error && !registry.data) {
    return (
      <>
        <PageHeader title={title} intro={intro} />
        <ErrorState error={registry.error} t={t} onRetry={() => void registry.reload()} />
      </>
    );
  }
  if (!registry.data) return <Loading t={t} page />;
  return <ReportView title={title} intro={intro} tabs={tabs} registry={registry.data} />;
}

export function ReportView({
  title,
  intro,
  tabs,
  registry,
}: {
  title: string;
  intro: string;
  tabs: readonly ReportTabDef[];
  registry: ReportRegistryResponse;
}) {
  const { t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const b = reportsBDictionary(locale);
  const ids = useMemo(() => tabs.map((tab) => tab.id), [tabs]);
  const normalize = useCallback((state: ReportPageState) => normalizeReportPage(state, ids), [ids]);
  const [state, update] = useUrlState(REPORT_PAGE_DEFAULTS, {
    normalize,
    resetOnChange: REPORT_RESET_KEYS,
  });
  // "Today" is read in the browser after the page has loaded, never during the first render.
  const [today, setToday] = useState<string | null>(null);
  useEffect(() => setToday(todayIn(REPORT_ZONE)), []);
  const [exporting, setExporting] = useState(false);
  const [nonce, setNonce] = useState(0);

  const entryOf = (tab: ReportTabDef) =>
    registry.reports.find((report) => report.id === tab.report);
  const visible = tabs.filter((tab) => {
    const entry = entryOf(tab);
    return entry?.available === true && entry.branchIds.length > 0;
  });
  const active = visible.find((tab) => tab.id === state.tab) ?? visible[0];
  const entry = active ? entryOf(active) : undefined;
  const allowed = useMemo(
    () => registry.branches.filter((branch) => entry?.branchIds.includes(branch.id)),
    [registry.branches, entry],
  );

  if (!active || !entry || allowed.length === 0) {
    return (
      <>
        <PageHeader title={title} intro={intro} />
        <Empty>{w.revenue.emptyBranches}</Empty>
      </>
    );
  }
  const branch = allowed.some((item) => item.id === state.branch) ? state.branch : '';
  const range: DateRange | null =
    active.kind === 'range' && today ? revenueRange(state, today) : null;
  const ready = active.kind !== 'range' || range !== null;
  const context: PanelContext = { range, branch, state, nonce, update };
  const choices: ExportChoice[] = visible
    .filter((tab) => entryOf(tab)?.exportable)
    .map((tab) => ({
      id: tab.report,
      label: tab.exportLabel,
      reauth: entryOf(tab)?.exportReauth === true,
    }));
  const activeFilters =
    (active.kind === 'range' && state.from !== '' ? 1 : 0) +
    (branch !== '' ? 1 : 0) +
    (active.kind === 'days' && state.days !== '60' ? 1 : 0) +
    (state.bucket !== '' ? 1 : 0) +
    (state.by !== 'variant' && active.id === 'products' ? 1 : 0);
  const branchNames = (branch === '' ? allowed : allowed.filter((item) => item.id === branch))
    .map((item) => item.name)
    .join(', ');

  return (
    <>
      <PageHeader title={title} intro={intro}>
        {entry.exportable && choices.length > 0 ? (
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
          onReset={() => update({ ...REPORT_PAGE_DEFAULTS, tab: active.id })}
          reload={{ label: w.common.reload, onClick: () => setNonce((n) => n + 1), busy: false }}
          filters={
            <>
              {active.kind === 'range' && today && range ? (
                <DateRangePicker
                  value={range}
                  today={today}
                  locale={locale}
                  labels={w.picker}
                  maxDays={REPORT_LIMITS.maxDays}
                  onChange={(next) => update({ from: next.from, to: next.to })}
                />
              ) : null}
              {active.kind === 'days' ? (
                <Select
                  aria-label={b.common.days}
                  value={state.days}
                  onChange={(event) =>
                    update({ days: event.target.value as ReportPageState['days'] })
                  }
                  options={STOCK_DAY_CHOICES.map((days) => ({
                    value: days,
                    label: b.common.daysOptions[days],
                  }))}
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
              {active.filters?.(context)}
            </>
          }
        />
        <div className="ls-print-only">
          {range ? <p>{fill(w.print.period, { period: `${range.from} → ${range.to}` })}</p> : null}
          <p>{fill(w.print.branches, { names: branchNames })}</p>
        </div>
        {visible.length > 1 ? (
          <Tabs
            label={title}
            value={active.id}
            onChange={(id) => update({ tab: id })}
            tabs={visible.map((tab) => ({
              id: tab.id,
              label: tab.label,
              panel: tab.id !== active.id ? null : ready ? tab.panel(context) : <Loading t={t} />,
            }))}
          />
        ) : ready ? (
          active.panel(context)
        ) : (
          <Loading t={t} />
        )}
      </Stack>
      {exporting ? (
        <ExportDialog
          choices={choices}
          initial={choices.find((choice) => choice.id === active.report)?.id ?? choices[0]!.id}
          build={(id, format) => {
            const tab = visible.find((item) => item.report === id) ?? active;
            return exportRequest(
              id,
              format,
              {
                range: tab.kind === 'range' ? range : null,
                branch,
                ...(tab.bucketed && state.bucket !== '' ? { bucket: state.bucket } : {}),
                ...(tab.grouped ? { by: state.by } : {}),
                ...(tab.kind === 'days' ? { days: state.days } : {}),
              },
              locale,
            );
          }}
          onClose={() => setExporting(false)}
        />
      ) : null}
    </>
  );
}

/** Loads one report for a panel and shows it, or the loading / error state; the reload button bumps `nonce`. */
export function ReportData<T>({
  path,
  params,
  nonce,
  children,
}: {
  path: string;
  params: Record<string, string | number | undefined>;
  nonce: number;
  children: (data: T) => ReactNode;
}) {
  const { api, t, locale } = useWorkforce();
  const w = reportsDictionary(locale);
  const key = JSON.stringify(params);
  const resource = useResource(() => api.get<T>(path, params), [api, path, key, nonce]);
  if (resource.error && !resource.data) {
    return <ErrorState error={resource.error} t={t} onRetry={() => void resource.reload()} />;
  }
  if (!resource.data) return <Loading t={t} />;
  return (
    <>
      {children(resource.data)}
      {resource.error ? (
        <Notice tone="error">{reportErrorMessage(resource.error, w, t)}</Notice>
      ) : null}
    </>
  );
}

/** A table of the report's rows, sorted and paged (20 a page) in the browser. */
export function ReportTable<Row>({
  label,
  columns,
  rows,
  rowKey,
  empty,
}: {
  label: string;
  columns: DataTableColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  empty: string;
}) {
  const { t } = useWorkforce();
  const [paging, setPaging] = useState({ page: 1, pageSize: 20 });
  const last = Math.max(1, Math.ceil(rows.length / paging.pageSize));
  const page = Math.min(paging.page, last);
  return (
    <DataTable
      mode="client"
      caption={fill(t.common.list.table, { list: label })}
      columns={columns}
      rows={[...rows]}
      rowKey={rowKey}
      empty={<Empty>{empty}</Empty>}
      paging={{
        page,
        pageSize: paging.pageSize,
        onPageChange: (next) => setPaging((current) => ({ ...current, page: next })),
        onPageSizeChange: (pageSize) => setPaging({ page: 1, pageSize }),
        labels: paginationLabels(t, label),
      }}
    />
  );
}

/** "Only the first N rows" note for a report that was cut at its row limit. */
export function TruncatedNote({ truncated, count }: { truncated: boolean; count: number }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  return truncated ? (
    <Notice tone="info">{fill(b.common.truncated, { count: String(count) })}</Notice>
  ) : null;
}

/** One headline figure of a report (no comparison): a count, an amount, a percent or a duration in minutes. */
export function Kpi({
  label,
  value,
  format,
  info,
  asOf,
}: {
  label: string;
  value: number;
  format: ValueFormat;
  info?: string | undefined;
  asOf?: string | undefined;
}) {
  const { t, locale } = useWorkforce();
  const kit = t.dashboard.kit;
  return (
    <KpiCard
      label={label}
      info={info}
      value={value}
      format={{ valueFormat: format, locale }}
      labels={{ up: kit.up, down: kit.down, flat: kit.flat, comparedTo: '' }}
      asOf={asOf}
    />
  );
}

/** The figures of a report, in a row of cards that wraps on a narrow screen. */
export function KpiRow({ children }: { children: ReactNode }) {
  return (
    <Grid min="sm" gap="page">
      {children}
    </Grid>
  );
}

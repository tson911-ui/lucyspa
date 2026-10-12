'use client';

import {
  MONEY_ROW_LIMIT,
  type CashDailyReport,
  type CashDifferencesReport,
  type CashFundsReport,
  type MoneyReportBase,
} from '@lucy-spa/contracts';
import { ListSection, Stack, type DataTableColumn } from '@lucy-spa/ui';
import { reportsCDictionary, type ReportsCDictionary } from '../../../i18n/reports-c';
import { formatDate } from '../../../lib/workforce/format';
import { vnd, vndNumber } from '../../../lib/workforce/reports';
import { useWorkforce } from '../session';
import { Badge, Empty, Notice } from '../ui';
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

/**
 * "Báo cáo quỹ" (Phase 8 P8-14, docs/PHASE8_REPORTS.md 4.6): the cash of each day (a closed day shows what its closing stored, an open day the
 * book so far), the balance of every fund, and the days whose count differed from the book. Read-only: the cash book itself is the "Sổ quỹ" page.
 * Before the Owner starts the book the tabs say so instead of showing zeros.
 */
export function CashReportScreen() {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  return <ReportScreen title={c.cash.title} intro={c.cash.intro} tabs={cashTabs(c)} />;
}

export function cashTabs(c: ReportsCDictionary): ReportTabDef[] {
  const params = (context: PanelContext) => ({
    from: context.range?.from,
    to: context.range?.to,
    branchId: context.branch || undefined,
  });
  return [
    {
      id: 'daily',
      label: c.cash.tabs.daily,
      report: 'cash-daily',
      kind: 'range',
      exportLabel: c.exportChoices['cash-daily']!,
      panel: (context) => (
        <ReportData<CashDailyReport>
          path="/api/v1/reports/cash/daily"
          params={params(context)}
          nonce={context.nonce}
        >
          {(data) => <DailyBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'funds',
      label: c.cash.tabs.funds,
      report: 'cash-funds',
      kind: 'range',
      exportLabel: c.exportChoices['cash-funds']!,
      panel: (context) => (
        <ReportData<CashFundsReport>
          path="/api/v1/reports/cash/funds"
          params={params(context)}
          nonce={context.nonce}
        >
          {(data) => <FundsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'differences',
      label: c.cash.tabs.differences,
      report: 'cash-differences',
      kind: 'range',
      exportLabel: c.exportChoices['cash-differences']!,
      panel: (context) => (
        <ReportData<CashDifferencesReport>
          path="/api/v1/reports/cash/differences"
          params={params(context)}
          nonce={context.nonce}
        >
          {(data) => <DifferencesBody data={data} />}
        </ReportData>
      ),
    },
  ];
}

function NotStarted({ data }: { data: MoneyReportBase }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  return data.started ? null : <Empty>{c.cash.notStarted}</Empty>;
}

/** A signed difference: a minus sign in front of what is missing, a plus in front of what is over. */
function signed(value: string, locale: 'vi' | 'en'): string {
  const text = vnd(value, locale);
  return value !== '0' && !value.startsWith('-') ? `+${text}` : text;
}

export function DailyBody({ data }: { data: CashDailyReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  if (!data.started) return <NotStarted data={data} />;
  const many = data.branches.length > 1;
  const columns: DataTableColumn<CashDailyReport['rows'][number]>[] = [
    {
      key: 'date',
      header: col['date']!,
      mobileTitle: true,
      cell: (row) => formatDate(row.date, locale),
    },
    ...(many
      ? [
          {
            key: 'branch',
            header: col['branch']!,
            hideBelow: 'lg' as const,
            truncate: true,
            width: 'sm' as const,
            cell: (row: CashDailyReport['rows'][number]) => row.branch.name,
          },
        ]
      : []),
    {
      key: 'state',
      header: col['state']!,
      cell: (row) =>
        row.closed ? (
          <Badge tone="success">{c.cash.status.closed}</Badge>
        ) : (
          <Badge tone="neutral">{c.cash.status.open}</Badge>
        ),
    },
    {
      key: 'opening',
      header: col['openingFloat']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => vnd(row.openingFloatVnd, locale),
    },
    { key: 'in', header: col['cashIn']!, numeric: true, cell: (row) => vnd(row.cashInVnd, locale) },
    {
      key: 'out',
      header: col['cashOut']!,
      numeric: true,
      cell: (row) => vnd(row.cashOutVnd, locale),
    },
    {
      key: 'expected',
      header: col['expected']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vnd(row.expectedVnd, locale),
    },
    {
      key: 'counted',
      header: col['counted']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => (row.countedVnd === null ? '—' : vnd(row.countedVnd, locale)),
    },
    {
      key: 'difference',
      header: col['difference']!,
      numeric: true,
      cell: (row) => (row.differenceVnd === null ? '—' : signed(row.differenceVnd, locale)),
    },
    {
      key: 'withdrawal',
      header: col['withdrawal']!,
      numeric: true,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => (row.withdrawalVnd === null ? '—' : vnd(row.withdrawalVnd, locale)),
    },
  ];
  const categoryColumns: DataTableColumn<CashDailyReport['byCategory'][number]>[] = [
    {
      key: 'category',
      header: col['category']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => c.cash.categories[row.category] ?? row.category,
    },
    { key: 'in', header: col['cashIn']!, numeric: true, cell: (row) => vnd(row.inVnd, locale) },
    { key: 'out', header: col['cashOut']!, numeric: true, cell: (row) => vnd(row.outVnd, locale) },
  ];
  const k = c.cash.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.cashIn} value={vndNumber(data.totals.cashInVnd)} format="vnd" />
        <Kpi label={k.cashOut} value={vndNumber(data.totals.cashOutVnd)} format="vnd" />
        <Kpi
          label={k.difference}
          info={k.differenceInfo}
          value={vndNumber(data.totals.differenceVnd)}
          format="vnd"
        />
        <Kpi label={k.closedDays} value={data.totals.closedDays} format="count" />
        <Kpi label={k.openDays} value={data.totals.openDays} format="count" />
      </KpiRow>
      <TruncatedNote truncated={data.truncated} count={MONEY_ROW_LIMIT} />
      <ReportTable
        label={c.cash.tabs.daily}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => `${row.branch.id}-${row.date}`}
        empty={c.cash.empty.daily}
      />
      {data.byCategory.length > 0 ? (
        <ListSection title={c.cash.byCategory}>
          <ReportTable
            label={c.cash.byCategory}
            columns={categoryColumns}
            rows={data.byCategory}
            rowKey={(row) => row.category}
            empty={c.cash.empty.daily}
          />
        </ListSection>
      ) : null}
    </Stack>
  );
}

export function FundsBody({ data }: { data: CashFundsReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  if (!data.started) return <NotStarted data={data} />;
  const columns: DataTableColumn<CashFundsReport['rows'][number]>[] = [
    {
      key: 'fund',
      header: col['fund']!,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => row.name,
    },
    {
      key: 'kind',
      header: col['fundKind']!,
      hideBelow: 'md',
      cell: (row) => c.cash.kinds[row.kind],
    },
    {
      key: 'opening',
      header: col['openingBalance']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => vnd(row.openingBalanceVnd, locale),
    },
    {
      key: 'in',
      header: col['cashIn']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vnd(row.inVnd, locale),
    },
    {
      key: 'out',
      header: col['cashOut']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vnd(row.outVnd, locale),
    },
    {
      key: 'balance',
      header: col['balance']!,
      numeric: true,
      cell: (row) => vnd(row.balanceVnd, locale),
    },
    {
      key: 'closed',
      header: col['lastClosed']!,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => (row.lastClosedDate === null ? '—' : formatDate(row.lastClosedDate, locale)),
    },
  ];
  const sum = (kind: 'CASH' | 'BANK') =>
    data.rows
      .filter((row) => row.kind === kind)
      .reduce((total, row) => total + vndNumber(row.balanceVnd), 0);
  const k = c.cash.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.cashBalance} value={sum('CASH')} format="vnd" />
        {data.bankIncluded ? <Kpi label={k.bankBalance} value={sum('BANK')} format="vnd" /> : null}
      </KpiRow>
      {!data.bankIncluded ? <Notice tone="info">{c.cash.bankNote}</Notice> : null}
      <ReportTable
        label={c.cash.tabs.funds}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.fundId}
        empty={c.cash.empty.funds}
      />
    </Stack>
  );
}

export function DifferencesBody({ data }: { data: CashDifferencesReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  if (!data.started) return <NotStarted data={data} />;
  const many = data.branches.length > 1;
  const columns: DataTableColumn<CashDifferencesReport['rows'][number]>[] = [
    {
      key: 'date',
      header: col['date']!,
      mobileTitle: true,
      cell: (row) => formatDate(row.date, locale),
    },
    ...(many
      ? [
          {
            key: 'branch',
            header: col['branch']!,
            hideBelow: 'lg' as const,
            truncate: true,
            width: 'sm' as const,
            cell: (row: CashDifferencesReport['rows'][number]) => row.branch.name,
          },
        ]
      : []),
    {
      key: 'expected',
      header: col['expected']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vnd(row.expectedVnd, locale),
    },
    {
      key: 'counted',
      header: col['counted']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vnd(row.countedVnd, locale),
    },
    {
      key: 'difference',
      header: col['difference']!,
      numeric: true,
      cell: (row) => (
        <>
          {signed(row.differenceVnd, locale)}
          {row.alert ? (
            <>
              {' '}
              <Badge tone="warning">{c.cash.alert}</Badge>
            </>
          ) : null}
        </>
      ),
    },
    {
      key: 'reason',
      header: col['reason']!,
      hideBelow: 'lg',
      truncate: true,
      width: 'lg',
      cell: (row) => row.reason ?? '—',
    },
    {
      key: 'by',
      header: col['closedBy']!,
      hideBelow: 'xl',
      hidePhone: true,
      truncate: true,
      width: 'sm',
      cell: (row) => row.closedByName ?? '—',
    },
  ];
  const k = c.cash.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi
          label={k.difference}
          info={k.differenceInfo}
          value={vndNumber(data.totals.differenceVnd)}
          format="vnd"
        />
        <Kpi label={k.days} value={data.totals.days} format="count" />
        <Kpi label={k.alerts} info={k.alertsInfo} value={data.totals.alerts} format="count" />
      </KpiRow>
      <ReportTable
        label={c.cash.tabs.differences}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => `${row.branch.id}-${row.date}`}
        empty={c.cash.empty.differences}
      />
    </Stack>
  );
}

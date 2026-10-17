'use client';

import {
  PAYROLL_KINDS,
  type AdvancesReport,
  type LabourCostReport,
  type MoneyReportBase,
  type PayrollMonthlyReport,
  type TipsReport,
} from '@lucy-spa/contracts';
import { Badge as KitBadge, Stack, type DataTableColumn } from '@lucy-spa/ui';
import { reportsCDictionary, type ReportsCDictionary } from '../../../i18n/reports-c';
import { formatDate } from '../../../lib/workforce/format';
import { vndNumber } from '../../../lib/workforce/reports';
import { formatCount, monthLabel } from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Empty } from '../ui';
import {
  Kpi,
  KpiRow,
  ReportData,
  ReportNote,
  ReportScreen,
  ReportTable,
  type PanelContext,
  type ReportTabDef,
} from './reports-kit';
import { shareText, vndText } from './reports-format';

/**
 * "Báo cáo lương" (Phase 8 P8-14, docs/PHASE8_REPORTS.md 4.6): tips by person, the payroll of each month by kind of item, labour cost against
 * revenue, and salary advances not yet recovered. Pay data: the API shows it only to people who hold the pay permission, the payroll, labour cost
 * and advances tabs only to people who hold it at every branch (one pay run pays the whole shop). Read-only; the payroll itself is its own page.
 */
export function PayReportScreen() {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  return <ReportScreen title={c.pay.title} intro={c.pay.intro} tabs={payTabs(c)} />;
}

export function payTabs(c: ReportsCDictionary): ReportTabDef[] {
  const params = (context: PanelContext) => ({
    from: context.range?.from,
    to: context.range?.to,
    branchId: context.branch || undefined,
  });
  return [
    {
      id: 'tips',
      label: c.pay.tabs.tips,
      report: 'tips',
      kind: 'range',
      exportLabel: c.exportChoices['tips']!,
      panel: (context) => (
        <ReportData<TipsReport>
          path="/api/v1/reports/tips"
          params={params(context)}
          nonce={context.nonce}
        >
          {(data) => <TipsBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'payroll',
      noBranch: true,
      label: c.pay.tabs.payroll,
      report: 'payroll-monthly',
      kind: 'range',
      exportLabel: c.exportChoices['payroll-monthly']!,
      panel: (context) => (
        <ReportData<PayrollMonthlyReport>
          path="/api/v1/reports/payroll/monthly"
          params={params(context)}
          nonce={context.nonce}
        >
          {(data) => <PayrollBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'labour',
      noBranch: true,
      label: c.pay.tabs.labour,
      report: 'labour-cost',
      kind: 'range',
      exportLabel: c.exportChoices['labour-cost']!,
      panel: (context) => (
        <ReportData<LabourCostReport>
          path="/api/v1/reports/payroll/labour-cost"
          params={params(context)}
          nonce={context.nonce}
        >
          {(data) => <LabourBody data={data} />}
        </ReportData>
      ),
    },
    {
      id: 'advances',
      noBranch: true,
      label: c.pay.tabs.advances,
      report: 'advances',
      kind: 'asof',
      exportLabel: c.exportChoices['advances']!,
      panel: (context) => (
        <ReportData<AdvancesReport>
          path="/api/v1/reports/payroll/advances"
          params={{}}
          nonce={context.nonce}
        >
          {(data) => <AdvancesBody data={data} />}
        </ReportData>
      ),
    },
  ];
}

function NotStarted({ data }: { data: MoneyReportBase }) {
  const { locale } = useWorkforce();
  return data.started ? null : <Empty>{reportsCDictionary(locale).pay.notStarted}</Empty>;
}

export function TipsBody({ data }: { data: TipsReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  const count = (value: number) => formatCount(value, locale);
  if (!data.started) return <NotStarted data={data} />;
  const columns: DataTableColumn<TipsReport['rows'][number]>[] = [
    {
      key: 'name',
      header: col['name']!,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      cell: (row) => row.name,
    },
    {
      key: 'code',
      header: col['code']!,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (row) => (row.employeeCode ? <span translate="no">{row.employeeCode}</span> : '—'),
    },
    {
      key: 'cash',
      header: col['tipsCash']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vndText(row.cashVnd, locale),
    },
    {
      key: 'transfer',
      header: col['tipsTransfer']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vndText(row.transferVnd, locale),
    },
    {
      key: 'total',
      header: col['tipsTotal']!,
      numeric: true,
      cell: (row) => vndText(row.totalVnd, locale),
    },
    {
      key: 'inRun',
      header: col['tipsInRun']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => vndText(row.inRunVnd, locale),
    },
    {
      key: 'owed',
      header: col['tipsOwed']!,
      numeric: true,
      cell: (row) => vndText(row.owedVnd, locale),
    },
    {
      key: 'entries',
      header: col['entries']!,
      numeric: true,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => count(row.entries),
    },
  ];
  const k = c.pay.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.tipsTotal} value={vndNumber(data.totals.totalVnd)} format="vnd" />
        <Kpi label={k.tipsCash} value={vndNumber(data.totals.cashVnd)} format="vnd" />
        <Kpi label={k.tipsTransfer} value={vndNumber(data.totals.transferVnd)} format="vnd" />
        <Kpi
          label={k.tipsOwed}
          info={k.tipsOwedInfo}
          value={vndNumber(data.totals.owedVnd)}
          format="vnd"
        />
      </KpiRow>
      <ReportTable
        label={c.pay.tabs.tips}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.userId}
        empty={c.pay.empty.tips}
      />
    </Stack>
  );
}

function StatusBadge({ status }: { status: 'DRAFT' | 'CLOSED' | 'PAID' }) {
  const { locale } = useWorkforce();
  const label = reportsCDictionary(locale).pay.status[status];
  return (
    <KitBadge
      tone={status === 'PAID' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral'}
      {...(status === 'CLOSED' ? { icon: 'check' as const } : {})}
    >
      {label}
    </KitBadge>
  );
}

export function PayrollBody({ data }: { data: PayrollMonthlyReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  const count = (value: number) => formatCount(value, locale);
  if (!data.started) return <NotStarted data={data} />;
  const kindColumns: DataTableColumn<PayrollMonthlyReport['rows'][number]>[] = PAYROLL_KINDS.map(
    (kind) => ({
      key: kind,
      header: c.pay.kinds[kind]!,
      numeric: true,
      hideBelow:
        kind === 'BASE_SALARY' ? 'md' : kind === 'TOUR' || kind === 'COMMISSION' ? 'xl' : '2xl',
      hidePhone: kind !== 'BASE_SALARY',
      cell: (row: PayrollMonthlyReport['rows'][number]) => vndText(row.byKind[kind], locale),
    }),
  );
  const columns: DataTableColumn<PayrollMonthlyReport['rows'][number]>[] = [
    {
      key: 'month',
      header: col['month']!,
      mobileTitle: true,
      cell: (row) => monthLabel(row.month),
    },
    { key: 'status', header: col['state']!, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'people',
      header: col['people']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.people),
    },
    ...kindColumns,
    { key: 'net', header: col['net']!, numeric: true, cell: (row) => vndText(row.netVnd, locale) },
    {
      key: 'tips',
      header: col['tips']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => vndText(row.tipsVnd, locale),
    },
    {
      key: 'paid',
      header: col['paymentDay']!,
      hideBelow: '2xl',
      hidePhone: true,
      cell: (row) => (row.paymentDay === null ? '—' : formatDate(row.paymentDay, locale)),
    },
  ];
  const k = c.pay.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi label={k.net} info={k.netInfo} value={vndNumber(data.totals.netVnd)} format="vnd" />
        <Kpi label={k.tips} value={vndNumber(data.totals.tipsVnd)} format="vnd" />
      </KpiRow>
      <ReportTable
        label={c.pay.tabs.payroll}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.month}
        empty={c.pay.empty.payroll}
      />
    </Stack>
  );
}

export function LabourBody({ data }: { data: LabourCostReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  if (!data.started) return <NotStarted data={data} />;
  const columns: DataTableColumn<LabourCostReport['rows'][number]>[] = [
    {
      key: 'month',
      header: col['month']!,
      mobileTitle: true,
      cell: (row) => monthLabel(row.month),
    },
    { key: 'status', header: col['state']!, cell: (row) => <StatusBadge status={row.status} /> },
    {
      key: 'labour',
      header: col['labour']!,
      numeric: true,
      cell: (row) => vndText(row.labourVnd, locale),
    },
    {
      key: 'revenue',
      header: col['revenue']!,
      numeric: true,
      cell: (row) => vndText(row.revenueVnd, locale),
    },
    {
      key: 'share',
      header: col['share']!,
      numeric: true,
      cell: (row) => (row.shareBp === null ? c.pay.noRevenue : shareText(locale, row.shareBp)),
    },
  ];
  return (
    <Stack gap="page">
      <ReportNote>{c.pay.labourNote}</ReportNote>
      <ReportTable
        label={c.pay.tabs.labour}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.month}
        empty={c.pay.empty.labour}
      />
    </Stack>
  );
}

export function AdvancesBody({ data }: { data: AdvancesReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const col = c.col;
  const count = (value: number) => formatCount(value, locale);
  if (!data.started) return <NotStarted data={data} />;
  const columns: DataTableColumn<AdvancesReport['rows'][number]>[] = [
    {
      key: 'name',
      header: col['name']!,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      cell: (row) => row.name,
    },
    {
      key: 'code',
      header: col['code']!,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (row) => (row.employeeCode ? <span translate="no">{row.employeeCode}</span> : '—'),
    },
    {
      key: 'paid',
      header: col['advPaid']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vndText(row.paidVnd, locale),
    },
    {
      key: 'recovered',
      header: col['advRecovered']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => vndText(row.recoveredVnd, locale),
    },
    {
      key: 'outstanding',
      header: col['advOutstanding']!,
      numeric: true,
      cell: (row) => vndText(row.outstandingVnd, locale),
    },
    {
      key: 'pendingCount',
      header: col['advPendingCount']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => count(row.pendingCount),
    },
    {
      key: 'pending',
      header: col['advPending']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => vndText(row.pendingVnd, locale),
    },
  ];
  const k = c.pay.kpi;
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi
          label={k.outstanding}
          info={k.outstandingInfo}
          value={vndNumber(data.totals.outstandingVnd)}
          format="vnd"
        />
        <Kpi label={k.pending} value={vndNumber(data.totals.pendingVnd)} format="vnd" />
      </KpiRow>
      <ReportTable
        label={c.pay.tabs.advances}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.userId}
        empty={c.pay.empty.advances}
      />
    </Stack>
  );
}

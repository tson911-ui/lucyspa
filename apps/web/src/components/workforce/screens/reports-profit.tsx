'use client';

import type { ProfitReport } from '@lucy-spa/contracts';
import { ListSection, Stack, type DataTableColumn } from '@lucy-spa/ui';
import { reportsCDictionary } from '../../../i18n/reports-c';
import { fill } from '../../../i18n/workforce';
import { vnd, vndNumber } from '../../../lib/workforce/reports';
import {
  bpToPercent,
  formatCount,
  percentFromBp,
  pickName,
} from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Notice } from '../ui';
import {
  Kpi,
  KpiRow,
  ReportData,
  ReportScreen,
  ReportTable,
  type ReportTabDef,
} from './reports-kit';

/**
 * "Lãi tạm tính" (Phase 8 P8-14, docs/PHASE8_REPORTS.md 4.7): revenue minus the costs the system holds, line by line, with how much of it is
 * complete (the share of goods sold that had a cost, the salary months counted). Owner only (a shop-wide permission) and always labelled as a
 * provisional figure: rent, electricity and tax are not in the system and are not guessed. Read-only.
 */
export function ProfitScreen() {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const tabs: ReportTabDef[] = [
    {
      id: 'profit',
      label: c.profit.title,
      report: 'profit',
      kind: 'range',
      noBranch: true,
      exportLabel: c.exportChoices['profit']!,
      panel: (context) => (
        <ReportData<ProfitReport>
          path="/api/v1/reports/profit"
          params={{ from: context.range?.from, to: context.range?.to }}
          nonce={context.nonce}
        >
          {(data) => <ProfitBody data={data} />}
        </ReportData>
      ),
    },
  ];
  return <ReportScreen title={c.profit.title} intro={c.profit.intro} tabs={tabs} />;
}

interface StatementRow {
  key: string;
  label: string;
  amount: string;
  note: string;
  strong: boolean;
}

/** An amount that is taken off: shown with a minus sign, nothing for zero. */
const minus = (value: string): string => (value === '0' ? '0' : `-${value}`);

export function ProfitBody({ data }: { data: ProfitReport }) {
  const { locale } = useWorkforce();
  const c = reportsCDictionary(locale);
  const p = c.profit;
  const col = c.col;
  const l = data.lines;
  const coverage = percentFromBp(data.goods.coverageBp, locale);
  const s = data.salaries;
  const salaryExtras = [
    ...(s.monthsMissing > 0 ? [fill(p.notes.missingMonths, { count: s.monthsMissing })] : []),
    ...(s.monthsPartial > 0 ? [fill(p.notes.partialMonths, { count: s.monthsPartial })] : []),
    ...(s.monthsDraft > 0 ? [fill(p.notes.draftMonths, { count: s.monthsDraft })] : []),
  ];
  const rows: StatementRow[] = [
    { key: 'revenue', label: p.lines.revenue, amount: l.revenueVnd, note: '', strong: false },
    {
      key: 'cogs',
      label: p.lines.cogs,
      amount: minus(l.costOfGoodsVnd),
      note: fill(p.notes.cogs, { percent: coverage }),
      strong: false,
    },
    { key: 'tour', label: p.lines.tour, amount: minus(l.tourVnd), note: '', strong: false },
    {
      key: 'commission',
      label: p.lines.commission,
      amount: minus(l.commissionVnd),
      note: '',
      strong: false,
    },
    {
      key: 'salaries',
      label: p.lines.salaries,
      amount: minus(l.salariesVnd),
      note: fill(p.notes.salaries, { counted: s.monthsCounted }),
      strong: false,
    },
    {
      key: 'expenses',
      label: p.lines.expenses,
      amount: minus(l.manualExpensesVnd),
      note: '',
      strong: false,
    },
    { key: 'profit', label: p.lines.profit, amount: l.profitVnd, note: '', strong: true },
  ];
  const columns: DataTableColumn<StatementRow>[] = [
    {
      key: 'line',
      header: col['line']!,
      mobileTitle: true,
      cell: (row) => (row.strong ? <strong>{row.label}</strong> : row.label),
    },
    {
      key: 'amount',
      header: col['amount']!,
      numeric: true,
      cell: (row) =>
        row.strong ? <strong>{vnd(row.amount, locale)}</strong> : vnd(row.amount, locale),
    },
    {
      key: 'note',
      header: col['note']!,
      hideBelow: 'md',
      truncate: true,
      width: 'lg',
      cell: (row) => row.note || '—',
    },
  ];
  const missingColumns: DataTableColumn<ProfitReport['withoutCost'][number]>[] = [
    { key: 'sku', header: col['sku']!, hideBelow: 'md', cell: (row) => row.sku },
    {
      key: 'name',
      header: col['product']!,
      mobileTitle: true,
      truncate: true,
      width: 'lg',
      cell: (row) => pickName(locale, row.nameVi, row.nameEn),
    },
    {
      key: 'units',
      header: col['units']!,
      numeric: true,
      cell: (row) => formatCount(row.unitsWithoutCost, locale),
    },
  ];
  return (
    <Stack gap="page">
      <KpiRow>
        <Kpi
          label={p.kpi.profit}
          info={p.kpi.profitInfo}
          value={vndNumber(l.profitVnd)}
          format="vnd"
        />
        <Kpi label={p.kpi.revenue} value={vndNumber(l.revenueVnd)} format="vnd" />
        <Kpi
          label={p.kpi.coverage}
          info={p.coverageInfo}
          value={bpToPercent(data.goods.coverageBp)}
          format="percent"
        />
      </KpiRow>
      <Notice tone="info">
        <strong>{p.disclaimerTitle}.</strong> {p.disclaimer}
      </Notice>
      {!data.started ? <Notice tone="warning">{p.notStarted}</Notice> : null}
      {salaryExtras.length > 0 ? <Notice tone="warning">{salaryExtras.join('. ')}.</Notice> : null}
      <ListSection title={p.statement}>
        <ReportTable
          label={p.statement}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.key}
          empty={p.statement}
        />
      </ListSection>
      {data.goods.coverageBp < 10_000 || data.withoutCost.length > 0 ? (
        <Stack gap="page">
          <Notice tone="warning">{p.coverageWarning}</Notice>
          <ListSection title={p.withoutCost}>
            <ReportTable
              label={p.withoutCost}
              columns={missingColumns}
              rows={data.withoutCost}
              rowKey={(row) => row.variantId}
              empty={p.emptyWithoutCost}
            />
          </ListSection>
        </Stack>
      ) : null}
    </Stack>
  );
}

'use client';

import type { RatingSummary, ReviewsReport } from '@lucy-spa/contracts';
import { ListSection, Stack, type DataTableColumn } from '@lucy-spa/ui';
import { reportsDDictionary } from '../../../i18n/reports-d';
import { bpToPercent, formatCount } from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import { Badge, Notice } from '../ui';
import {
  Kpi,
  KpiRow,
  ReportData,
  ReportScreen,
  ReportTable,
  type ReportTabDef,
} from './reports-kit';

/**
 * "Đánh giá của khách" (Phase 8 P8-17, docs/PHASE8_REPORTS.md 4.9): the average and the distribution of the stars customers gave, per branch and
 * per person who served, with the number of ratings; fewer than 5 ratings is "chưa đủ đánh giá" and shows no average. Numbers only, no comments.
 * Private: the people rated do not see it unless the Owner decides so. Read-only.
 */
export function ReviewsScreen() {
  const { locale } = useWorkforce();
  const d = reportsDDictionary(locale);
  const tabs: ReportTabDef[] = [
    {
      id: 'reviews',
      label: d.title,
      report: 'reviews',
      kind: 'range',
      exportLabel: d.exportChoice,
      panel: (context) => (
        <ReportData<ReviewsReport>
          path="/api/v1/reports/reviews"
          params={{
            from: context.range?.from,
            to: context.range?.to,
            branchId: context.branch || undefined,
          }}
          nonce={context.nonce}
        >
          {(data) => <ReviewsBody data={data} />}
        </ReportData>
      ),
    },
  ];
  return <ReportScreen title={d.title} intro={d.intro} tabs={tabs} />;
}

/** The average as stars with two decimals, or the words "not enough ratings". */
function AverageCell({ summary }: { summary: RatingSummary }) {
  const { locale } = useWorkforce();
  const d = reportsDDictionary(locale);
  if (summary.averageHundredths === null) return <>—</>;
  if (!summary.enough) return <Badge tone="neutral">{d.notEnough}</Badge>;
  return (
    <strong>
      {new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(summary.averageHundredths / 100)}
    </strong>
  );
}

function distributionColumns<Row extends RatingSummary>(
  d: ReturnType<typeof reportsDDictionary>,
  locale: 'vi' | 'en',
): DataTableColumn<Row>[] {
  return ([5, 4, 3, 2, 1] as const).map((stars) => ({
    key: `star${stars}`,
    header: d.col[`star${stars}`]!,
    numeric: true,
    hideBelow: stars === 5 || stars === 1 ? ('md' as const) : ('lg' as const),
    hidePhone: true,
    cell: (row: Row) => formatCount(row.distribution[stars - 1]!, locale),
  }));
}

export function ReviewsBody({ data }: { data: ReviewsReport }) {
  const { locale } = useWorkforce();
  const d = reportsDDictionary(locale);
  const k = d.kpi;
  const many = data.byBranch.length > 1;
  const branchColumns: DataTableColumn<ReviewsReport['byBranch'][number]>[] = [
    {
      key: 'branch',
      header: d.col['branch']!,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => row.branch.name,
    },
    {
      key: 'count',
      header: d.col['count']!,
      numeric: true,
      cell: (row) => formatCount(row.count, locale),
    },
    {
      key: 'average',
      header: d.col['average']!,
      numeric: true,
      cell: (row) => <AverageCell summary={row} />,
    },
    ...distributionColumns<ReviewsReport['byBranch'][number]>(d, locale),
  ];
  const staffColumns: DataTableColumn<ReviewsReport['staff'][number]>[] = [
    {
      key: 'name',
      header: d.col['name']!,
      mobileTitle: true,
      truncate: true,
      width: 'md',
      cell: (row) => row.name,
    },
    {
      key: 'code',
      header: d.col['code']!,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (row) => row.employeeCode ?? '—',
    },
    {
      key: 'count',
      header: d.col['count']!,
      numeric: true,
      cell: (row) => formatCount(row.count, locale),
    },
    {
      key: 'average',
      header: d.col['average']!,
      numeric: true,
      cell: (row) => <AverageCell summary={row} />,
    },
    ...distributionColumns<ReviewsReport['staff'][number]>(d, locale),
  ];
  return (
    <Stack gap="page">
      <Notice tone="info">{d.privateNote}</Notice>
      <KpiRow>
        <Kpi
          label={k.ratings}
          value={data.totals.count}
          format="count"
          asOf={data.totals.enough ? undefined : d.notEnough}
        />
        {data.totals.enough && data.totals.averageHundredths !== null ? (
          <Kpi
            label={k.average}
            info={k.averageInfo}
            value={data.totals.averageHundredths / 100}
            format="decimal"
          />
        ) : null}
        <Kpi
          label={k.response}
          info={k.responseInfo}
          value={bpToPercent(data.responseBp)}
          format="percent"
        />
      </KpiRow>
      {many || data.byBranch.length === 1 ? (
        <ListSection title={d.byBranch}>
          <ReportTable
            label={d.byBranch}
            columns={branchColumns}
            rows={data.byBranch}
            rowKey={(row) => row.branch.id}
            empty={d.empty}
          />
        </ListSection>
      ) : null}
      <ListSection title={d.byStaff}>
        <ReportTable
          label={d.byStaff}
          columns={staffColumns}
          rows={data.staff}
          rowKey={(row) => row.userId}
          empty={d.emptyStaff}
        />
      </ListSection>
    </Stack>
  );
}

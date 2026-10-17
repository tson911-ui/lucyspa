'use client';

import type { StaffActivityReport, StaffRow } from '@lucy-spa/contracts';
import { Stack, type DataTableColumn } from '@lucy-spa/ui';
import { reportsBDictionary } from '../../../i18n/reports-b';

import { durationText, formatCount } from '../../../lib/workforce/reports-b';
import { useWorkforce } from '../session';
import {
  ReportData,
  ReportNote,
  ReportScreen,
  ReportTable,
  type ReportTabDef,
} from './reports-kit';
import { vndText } from './reports-format';

/**
 * "Nhân viên" (Phase 8 P8-10, docs/PHASE8_REPORTS.md 4.4): what each employee did in the period. Facts only, listed by name, never ranked.
 * The sales columns are there only for a person who may see revenue at every covered branch, the pay columns only for a person who may see pay;
 * the API leaves the figures out otherwise, and so does this table.
 */
export function StaffScreen() {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const tabs: ReportTabDef[] = [
    {
      id: 'staff',
      label: b.staff.title,
      report: 'staff-activity',
      kind: 'range',
      exportLabel: b.exportChoices['staff-activity']!,
      panel: (context) => (
        <ReportData<StaffActivityReport>
          path="/api/v1/reports/staff"
          params={{
            from: context.range?.from,
            to: context.range?.to,
            branchId: context.branch || undefined,
          }}
          nonce={context.nonce}
        >
          {(data) => <StaffBody data={data} />}
        </ReportData>
      ),
    },
  ];
  return <ReportScreen title={b.staff.title} intro={b.staff.intro} tabs={tabs} />;
}

export function StaffBody({ data }: { data: StaffActivityReport }) {
  const { locale } = useWorkforce();
  const b = reportsBDictionary(locale);
  const count = (value: number) => formatCount(value, locale);
  const c = b.col;
  const { sales, pay } = data.columns;
  const money = (value: string | null) => (value === null ? '—' : vndText(value, locale));
  const salesColumns: DataTableColumn<StaffRow>[] = sales
    ? [
        {
          key: 'serviceSales',
          header: c['serviceSales']!,
          numeric: true,
          cell: (row) => money(row.serviceSalesVnd),
        },
        {
          key: 'productSales',
          header: c['productSales']!,
          numeric: true,
          hideBelow: 'md',
          cell: (row) => money(row.productSalesVnd),
        },
      ]
    : [];
  const payColumns: DataTableColumn<StaffRow>[] = pay
    ? [
        {
          key: 'tips',
          header: c['tips']!,
          numeric: true,
          hideBelow: 'lg',
          cell: (row) => money(row.tipsVnd),
        },
        {
          key: 'tour',
          header: c['tour']!,
          numeric: true,
          hideBelow: 'xl',
          hidePhone: true,
          cell: (row) => money(row.tourVnd),
        },
        {
          key: 'commission',
          header: c['commission']!,
          numeric: true,
          hideBelow: 'xl',
          hidePhone: true,
          cell: (row) => money(row.commissionVnd),
        },
      ]
    : [];
  const columns: DataTableColumn<StaffRow>[] = [
    {
      key: 'name',
      header: c['employee']!,
      mobileTitle: true,
      wrap: true,
      width: 'md',
      cell: (row) => row.name,
    },
    {
      key: 'code',
      header: c['code']!,
      hideBelow: 'lg',
      hidePhone: true,
      cell: (row) => row.employeeCode ?? '—',
    },
    {
      key: 'services',
      header: c['services']!,
      numeric: true,
      cell: (row) => count(row.servicesPerformed),
    },
    {
      key: 'customers',
      header: c['customersServed']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.customersServed),
    },
    {
      key: 'time',
      header: c['actualMinutes']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => durationText(row.actualMinutes, locale),
    },
    {
      key: 'planned',
      header: c['plannedMinutes']!,
      numeric: true,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => durationText(row.plannedMinutes, locale),
    },
    ...salesColumns,
    {
      key: 'referrals',
      header: c['referralOrders']!,
      numeric: true,
      hideBelow: 'xl',
      hidePhone: true,
      cell: (row) => count(row.referralOrders),
    },
    ...payColumns,
    {
      key: 'attendance',
      header: c['attendanceDays']!,
      numeric: true,
      hideBelow: 'md',
      cell: (row) => count(row.attendanceDays),
    },
    {
      key: 'leave',
      header: c['leaveDays']!,
      numeric: true,
      hideBelow: 'lg',
      cell: (row) => count(row.leaveDays),
    },
  ];
  return (
    <Stack gap="page">
      <ReportNote>{b.staff.note}</ReportNote>
      <ReportTable
        label={b.staff.title}
        columns={columns}
        rows={data.rows}
        rowKey={(row) => row.userId}
        empty={b.staff.empty}
      />
    </Stack>
  );
}

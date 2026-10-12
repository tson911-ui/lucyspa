import type { ReportExportRequest } from '@lucy-spa/contracts';
import type { ExportCell, ExportColumn, ExportSheet } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import type { ExportWords } from './export.labels.js';
import { loadRefundRows } from './refunds.core.js';
import {
  bookingFunnel,
  customerVisits,
  loyaltyReport,
  staffActivity,
  topCustomers,
} from './people.core.js';
import {
  comboReport,
  discountReport,
  loadOnlineOrderRows,
  productRevenue,
  serviceRevenue,
} from './sales.core.js';
import { parseRange } from './report.dates.js';
import { profitReport } from './profit.core.js';
import {
  advancesReport,
  cashDaily,
  cashDifferences,
  cashFunds,
  labourCost,
  payrollMonthly,
  tipsReport,
} from './money.core.js';
import {
  bestSellers,
  expiringLots,
  lowStock,
  slowMovers,
  stockMovements,
  stockReceipts,
  stockValue,
} from './stock.core.js';
import type { ReportBranch, ReportContext } from './report.frame.js';
import { revenueData } from './revenue.core.js';

/**
 * Phase 8 P8-4: what each exportable report puts in its file. A builder reads in the report's own read-only snapshot and returns the
 * table of exactly what the screen shows (same filters, same numbers: the revenue ones are the very `revenueData` of the screen).
 * `covered` is the set of branches where the person may both see the report and take it out; builders never widen it.
 */

export interface BuiltExport {
  /** The data sheet. */
  main: ExportSheet;
  /** More sheets of the workbook (an Excel file only; a CSV holds the data sheet). */
  extra?: ExportSheet[];
  /** The data rows (header excluded): checked against the row cap by the caller. */
  rows: number;
  /** The period of the report, for the file name and the information sheet; null for a report that is not about a period. */
  period: { from: string; to: string } | null;
  compared: { from: string; to: string } | null;
}

export type ExportBuilder = (
  context: ReportContext,
  covered: readonly ReportBranch[],
  request: ReportExportRequest,
  words: ExportWords,
  limit: number,
) => Promise<BuiltExport>;

const day = (iso: string): Date => new Date(`${iso}T00:00:00.000Z`);
const money = (value: string): bigint => BigInt(value);

const revenueQuery = (covered: readonly ReportBranch[], request: ReportExportRequest) => ({
  from: request.from,
  to: request.to,
  bucket: request.bucket,
  compare: request.compare,
  restrictTo: covered,
});

const overview: ExportBuilder = async (context, covered, request, words) => {
  const { report } = await revenueData(context, revenueQuery(covered, request));
  const c = words.col;
  const withPrevious = report.previousSeries !== null;
  const rows: ExportCell[][] = report.series.map((point, index) => [
    day(point.start),
    money(point.collectedVnd),
    money(point.refundsVnd),
    money(point.exchangesVnd),
    money(point.netVnd),
    ...(withPrevious ? [money(report.previousSeries?.[index]?.netVnd ?? '0')] : []),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['periodStart']!, kind: 'date' },
        { header: c['collected']!, kind: 'money' },
        { header: c['refunds']!, kind: 'money' },
        { header: c['exchanges']!, kind: 'money' },
        { header: c['net']!, kind: 'money' },
        ...(withPrevious ? [{ header: c['previousNet']!, kind: 'money' as const }] : []),
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: report.period.previous,
  };
};

const byBranch: ExportBuilder = async (context, covered, request, words) => {
  const { report } = await revenueData(context, revenueQuery(covered, request));
  const c = words.col;
  const withPrevious = report.previousTotals !== null;
  const rows: ExportCell[][] = report.byBranch.map((row) => [
    row.branch.code,
    row.branch.name,
    money(row.collectedVnd),
    money(row.refundsVnd),
    money(row.exchangesVnd),
    money(row.netVnd),
    row.paidInvoices,
    row.visits,
    ...(withPrevious ? [money(row.previousNetVnd ?? '0')] : []),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['branch']!, kind: 'text' },
        { header: c['collected']!, kind: 'money' },
        { header: c['refunds']!, kind: 'money' },
        { header: c['exchanges']!, kind: 'money' },
        { header: c['net']!, kind: 'money' },
        { header: c['paidInvoices']!, kind: 'int' },
        { header: c['visits']!, kind: 'int' },
        ...(withPrevious ? [{ header: c['previousNet']!, kind: 'money' as const }] : []),
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: report.period.previous,
  };
};

const byKind: ExportBuilder = async (context, covered, request, words) => {
  const { report, facts } = await revenueData(context, revenueQuery(covered, request));
  const c = words.col;
  const sums = new Map<string, bigint>();
  for (const fact of facts) {
    const key = `${fact.side}|${fact.kind}|${fact.channel}`;
    sums.set(key, (sums.get(key) ?? 0n) + fact.amountVnd);
  }
  const rows: ExportCell[][] = [...sums.entries()]
    .filter(([, amount]) => amount !== 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, amount]) => {
      const [side, kind, channel] = key.split('|') as [string, string, string];
      return [
        words.side[side] ?? side,
        words.kind[kind] ?? kind,
        words.channel[channel] ?? channel,
        amount,
      ];
    });
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['side']!, kind: 'text' },
        { header: c['kind']!, kind: 'text' },
        { header: c['channel']!, kind: 'text' },
        { header: c['net']!, kind: 'money' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const byMethod: ExportBuilder = async (context, covered, request, words) => {
  const { report } = await revenueData(context, revenueQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.byMethod.map((row) => [
    words.method[row.method] ?? row.method,
    money(row.inVnd),
    money(row.outVnd),
    money(row.netVnd),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['method']!, kind: 'text' },
        { header: c['moneyIn']!, kind: 'money' },
        { header: c['moneyOut']!, kind: 'money' },
        { header: c['net']!, kind: 'money' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const refunds: ExportBuilder = async (context, covered, request, words, limit) => {
  const range = parseRange(request);
  // One more than the cap, so the caller can tell "exactly the cap" from "more than the cap".
  const list = await loadRefundRows(context, covered, range, { limit: limit + 1, offset: 0 });
  const c = words.col;
  const rows: ExportCell[][] = list.map((row) => [
    day(row.date),
    row.branch.code,
    words.refundKind[row.kind] ?? row.kind,
    row.invoiceCode,
    row.code,
    money(row.amountVnd),
    words.method[row.method] ?? row.method,
    row.reason,
    row.failedDelivery ? c['yes']! : c['no']!,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['date']!, kind: 'date' },
        { header: c['branchCode']!, kind: 'text' },
        { header: c['type']!, kind: 'text' },
        { header: c['invoice']!, kind: 'text' },
        { header: c['code']!, kind: 'text' },
        { header: c['amount']!, kind: 'money' },
        { header: c['method']!, kind: 'text' },
        { header: c['reason']!, kind: 'text' },
        { header: c['failedDelivery']!, kind: 'text' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: range.from, to: range.to },
    compared: null,
  };
};

const name = (words: ExportWords, vi: string, en: string) => (words.locale === 'en' ? en : vi);
const pct = (bp: number) => bp / 10000;

const salesQuery = (covered: readonly ReportBranch[], request: ReportExportRequest) => ({
  from: request.from,
  to: request.to,
  restrictTo: covered,
});

const byService: ExportBuilder = async (context, covered, request, words) => {
  const report = await serviceRevenue(context, salesQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((row) => [
    row.code ?? '',
    name(words, row.nameVi, row.nameEn),
    row.categoryNameVi === null ? '' : name(words, row.categoryNameVi, row.categoryNameEn ?? ''),
    row.quantity,
    money(row.netVnd),
    pct(row.shareBp),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['code2']!, kind: 'text' },
        { header: c['service']!, kind: 'text' },
        { header: c['category']!, kind: 'text' },
        { header: c['quantity']!, kind: 'int' },
        { header: c['net']!, kind: 'money' },
        { header: c['share']!, kind: 'percent' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const byProduct: ExportBuilder = async (context, covered, request, words) => {
  const report = await productRevenue(context, { ...salesQuery(covered, request), by: request.by });
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((row) => [
    row.sku ?? '',
    name(words, row.nameVi, row.nameEn),
    row.brandNameVi === null ? '' : name(words, row.brandNameVi, row.brandNameEn ?? ''),
    row.categoryNameVi === null ? '' : name(words, row.categoryNameVi, row.categoryNameEn ?? ''),
    row.unitsSold,
    row.unitsRefunded,
    money(row.netVnd),
    pct(row.shareBp),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['sku']!, kind: 'text' },
        { header: c['product']!, kind: 'text' },
        { header: c['brand']!, kind: 'text' },
        { header: c['productCategory']!, kind: 'text' },
        { header: c['unitsSold']!, kind: 'int' },
        { header: c['unitsRefunded']!, kind: 'int' },
        { header: c['net']!, kind: 'money' },
        { header: c['share']!, kind: 'percent' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const combos: ExportBuilder = async (context, covered, request, words) => {
  const report = await comboReport(context, salesQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((row) => [
    name(words, row.nameVi, row.nameEn),
    row.sold,
    row.voided,
    money(row.soldPriceVnd),
    money(row.revenueVnd),
    row.sessionsSold,
    row.sessionsUsed,
    row.sessionsRemaining,
    row.sessionsExpired,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['combo']!, kind: 'text' },
        { header: c['sold']!, kind: 'int' },
        { header: c['voided']!, kind: 'int' },
        { header: c['soldPrice']!, kind: 'money' },
        { header: c['net']!, kind: 'money' },
        { header: c['sessionsSold']!, kind: 'int' },
        { header: c['sessionsUsed']!, kind: 'int' },
        { header: c['sessionsRemaining']!, kind: 'int' },
        { header: c['sessionsExpired']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const discounts: ExportBuilder = async (context, covered, request, words) => {
  const report = await discountReport(context, salesQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((row) => [
    words.discountType[row.type] ?? row.type,
    row.code ?? '',
    name(words, row.nameVi, row.nameEn),
    row.invoices,
    money(row.amountVnd),
  ]);
  const campaignRows: ExportCell[][] = report.campaigns.map((row) => [
    name(words, row.nameVi, row.nameEn),
    row.units,
    money(row.netVnd),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['discountType']!, kind: 'text' },
        { header: c['code2']!, kind: 'text' },
        { header: c['discount']!, kind: 'text' },
        { header: c['invoices']!, kind: 'int' },
        { header: c['discountAmount']!, kind: 'money' },
      ],
      rows,
    },
    extra: [
      {
        name: words.sheetCampaigns,
        columns: [
          { header: c['campaign']!, kind: 'text' },
          { header: c['units']!, kind: 'int' },
          { header: c['net']!, kind: 'money' },
        ],
        rows: campaignRows,
      },
    ],
    rows: rows.length + campaignRows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const onlineOrders: ExportBuilder = async (context, covered, request, words, limit) => {
  const range = parseRange(request);
  const list = await loadOnlineOrderRows(context, covered, range, limit + 1);
  const c = words.col;
  const rows: ExportCell[][] = list.map((row) => [
    row.orderCode,
    row.invoiceCode,
    row.branch.code,
    day(row.date),
    words.orderState[row.state] ?? row.state,
    row.contactName ?? '',
    row.contactPhone,
    money(row.totalVnd),
    money(row.collectedVnd),
    money(row.refundedVnd),
    row.deliveredOn === null ? null : day(row.deliveredOn),
    row.staffCode ?? '',
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['orderCode']!, kind: 'text' },
        { header: c['invoice']!, kind: 'text' },
        { header: c['branchCode']!, kind: 'text' },
        { header: c['date']!, kind: 'date' },
        { header: c['state']!, kind: 'text' },
        { header: c['customer']!, kind: 'text' },
        { header: c['phone']!, kind: 'text' },
        { header: c['total']!, kind: 'money' },
        { header: c['collected']!, kind: 'money' },
        { header: c['refunds']!, kind: 'money' },
        { header: c['deliveredOn']!, kind: 'date' },
        { header: c['staffCode']!, kind: 'text' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: range.from, to: range.to },
    compared: null,
  };
};

const peopleQuery = (covered: readonly ReportBranch[], request: ReportExportRequest) => ({
  from: request.from,
  to: request.to,
  bucket: request.bucket,
  restrictTo: covered,
});

const customersVisits: ExportBuilder = async (context, covered, request, words) => {
  const report = await customerVisits(context, peopleQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.series.map((point) => [
    day(point.start),
    point.visits,
    point.people,
    point.newPeople,
    point.returningPeople,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['periodStart']!, kind: 'date' },
        { header: c['visits2']!, kind: 'int' },
        { header: c['people']!, kind: 'int' },
        { header: c['newPeople']!, kind: 'int' },
        { header: c['returningPeople']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const bookingsFunnel: ExportBuilder = async (context, covered, request, words) => {
  const report = await bookingFunnel(context, peopleQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.series.map((p) => [
    day(p.start),
    p.bookings,
    p.checkedIn,
    p.cancelled,
    p.lateCancelled,
    p.noShow,
    p.open,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['periodStart']!, kind: 'date' },
        { header: c['bookings']!, kind: 'int' },
        { header: c['checkedIn']!, kind: 'int' },
        { header: c['cancelled']!, kind: 'int' },
        { header: c['lateCancelled']!, kind: 'int' },
        { header: c['noShow']!, kind: 'int' },
        { header: c['open']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const loyalty: ExportBuilder = async (context, covered, request, words) => {
  const report = await loyaltyReport(context, peopleQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.points.map((p) => [p.wallet, p.kind, p.points, p.entries]);
  const tiers: ExportCell[][] = report.tiers.map((t) => [t.tier, t.spa, t.beauty]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['wallet']!, kind: 'text' },
        { header: c['kind2']!, kind: 'text' },
        { header: c['points']!, kind: 'int' },
        { header: c['entries']!, kind: 'int' },
      ],
      rows,
    },
    extra: [
      {
        name: c['sheetTiers']!,
        columns: [
          { header: c['tier']!, kind: 'text' },
          { header: c['spaCustomers']!, kind: 'int' },
          { header: c['beautyCustomers']!, kind: 'int' },
        ],
        rows: tiers,
      },
    ],
    rows: rows.length + tiers.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const topCustomersBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await topCustomers(context, peopleQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.name,
    r.phone ?? '',
    r.invoices,
    money(r.collectedVnd),
    r.visits,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['customer']!, kind: 'text' },
        { header: c['phone']!, kind: 'text' },
        { header: c['invoices']!, kind: 'int' },
        { header: c['collectedPaid']!, kind: 'money' },
        { header: c['visits2']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const staff: ExportBuilder = async (context, covered, request, words) => {
  const report = await staffActivity(context, peopleQuery(covered, request));
  const c = words.col;
  const { sales, pay } = report.columns;
  const columns: ExportColumn[] = [
    { header: c['name']!, kind: 'text' },
    { header: c['employeeCode']!, kind: 'text' },
    { header: c['servicesPerformed']!, kind: 'int' },
    { header: c['customersServed']!, kind: 'int' },
    { header: c['actualMinutes']!, kind: 'int' },
    { header: c['plannedMinutes']!, kind: 'int' },
    ...(sales
      ? [
          { header: c['serviceSales']!, kind: 'money' as const },
          { header: c['productSales']!, kind: 'money' as const },
        ]
      : []),
    { header: c['referralOrders']!, kind: 'int' },
    ...(sales ? [{ header: c['referralTotal']!, kind: 'money' as const }] : []),
    ...(pay
      ? [
          { header: c['tips']!, kind: 'money' as const },
          { header: c['tour']!, kind: 'money' as const },
          { header: c['commission']!, kind: 'money' as const },
        ]
      : []),
    { header: c['attendanceDays']!, kind: 'int' },
    { header: c['attendanceMinutes']!, kind: 'int' },
    { header: c['leaveDays']!, kind: 'int' },
  ];
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.name,
    r.employeeCode ?? '',
    r.servicesPerformed,
    r.customersServed,
    r.actualMinutes,
    r.plannedMinutes,
    ...(sales ? [money(r.serviceSalesVnd ?? '0'), money(r.productSalesVnd ?? '0')] : []),
    r.referralOrders,
    ...(sales ? [money(r.referralInvoiceVnd ?? '0')] : []),
    ...(pay
      ? [money(r.tipsVnd ?? '0'), money(r.tourVnd ?? '0'), money(r.commissionVnd ?? '0')]
      : []),
    r.attendanceDays,
    r.attendanceMinutes,
    r.leaveDays,
  ]);
  return {
    main: { name: words.sheetData, columns, rows },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const stockQuery = (covered: readonly ReportBranch[], request: ReportExportRequest) => ({
  from: request.from,
  to: request.to,
  days: request.days,
  restrictTo: covered,
});

const stockItem = (
  words: ExportWords,
  row: { sku: string; nameVi: string; nameEn: string },
): ExportCell[] => [row.sku, name(words, row.nameVi, row.nameEn)];

const stockBestSellers: ExportBuilder = async (context, covered, request, words) => {
  const report = await bestSellers(context, stockQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    ...stockItem(words, r),
    r.unitsSold,
    r.unitsReturned,
    r.unitsNet,
    money(r.netVnd),
    pct(r.shareBp),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['sku']!, kind: 'text' },
        { header: c['product']!, kind: 'text' },
        { header: c['unitsSold']!, kind: 'int' },
        { header: c['unitsRefunded']!, kind: 'int' },
        { header: c['unitsNet']!, kind: 'int' },
        { header: c['net']!, kind: 'money' },
        { header: c['share']!, kind: 'percent' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const stockLow: ExportBuilder = async (context, covered, request, words) => {
  const report = await lowStock(context, stockQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    ...stockItem(words, r),
    r.onHand,
    r.reserved,
    r.available,
    r.threshold,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['sku']!, kind: 'text' },
        { header: c['product']!, kind: 'text' },
        { header: c['onHand']!, kind: 'int' },
        { header: c['reserved']!, kind: 'int' },
        { header: c['available']!, kind: 'int' },
        { header: c['threshold']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: null,
    compared: null,
  };
};

const stockSlow: ExportBuilder = async (context, covered, request, words) => {
  const report = await slowMovers(context, stockQuery(covered, request));
  const c = words.col;
  const cost = report.costColumn;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    ...stockItem(words, r),
    r.onHand,
    r.lastSoldOn === null ? '' : day(r.lastSoldOn),
    r.daysSinceSale ?? '',
    ...(cost ? [r.costValueVnd === null ? '' : money(r.costValueVnd)] : []),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['sku']!, kind: 'text' },
        { header: c['product']!, kind: 'text' },
        { header: c['onHand']!, kind: 'int' },
        { header: c['lastSold']!, kind: 'date' },
        { header: c['daysSinceSale']!, kind: 'int' },
        ...(cost ? [{ header: c['costValue']!, kind: 'money' as const }] : []),
      ],
      rows,
    },
    rows: rows.length,
    period: null,
    compared: null,
  };
};

const stockExpiry: ExportBuilder = async (context, covered, request, words) => {
  const report = await expiringLots(context, stockQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    ...stockItem(words, r),
    r.lotCode,
    day(r.expiryDate),
    r.daysLeft,
    r.quantity,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['sku']!, kind: 'text' },
        { header: c['product']!, kind: 'text' },
        { header: c['lot']!, kind: 'text' },
        { header: c['expiry']!, kind: 'date' },
        { header: c['daysLeft']!, kind: 'int' },
        { header: c['quantity']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: null,
    compared: null,
  };
};

const stockValueBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await stockValue(context, stockQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    ...stockItem(words, r),
    r.onHand,
    r.unitsWithCost,
    money(r.valueVnd),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['sku']!, kind: 'text' },
        { header: c['product']!, kind: 'text' },
        { header: c['onHand']!, kind: 'int' },
        { header: c['unitsWithCost']!, kind: 'int' },
        { header: c['value']!, kind: 'money' },
      ],
      rows,
    },
    rows: rows.length,
    period: null,
    compared: null,
  };
};

const stockMovementsBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await stockMovements(context, stockQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    r.kind,
    r.reason ?? '',
    r.entries,
    r.unitsIn,
    r.unitsOut,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['movementKind']!, kind: 'text' },
        { header: c['reason']!, kind: 'text' },
        { header: c['entries']!, kind: 'int' },
        { header: c['unitsIn']!, kind: 'int' },
        { header: c['unitsOut']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const stockReceiptsBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await stockReceipts(context, stockQuery(covered, request));
  const c = words.col;
  const cost = report.costColumn;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.supplierName ?? c['noSupplier']!,
    r.receipts,
    r.units,
    ...(cost ? [money(r.costVnd ?? '0')] : []),
    r.linesWithoutCost,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['supplier']!, kind: 'text' },
        { header: c['receipts']!, kind: 'int' },
        { header: c['receiptUnits']!, kind: 'int' },
        ...(cost ? [{ header: c['receiptCost']!, kind: 'money' as const }] : []),
        { header: c['linesWithoutCost']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const moneyQuery = (covered: readonly ReportBranch[], request: ReportExportRequest) => ({
  from: request.from,
  to: request.to,
  restrictTo: covered,
});

const optMoney = (value: string | null): ExportCell => (value === null ? '' : money(value));

const cashDailyBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await cashDaily(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    r.branch.name,
    day(r.date),
    r.closed ? c['yes']! : c['no']!,
    money(r.openingFloatVnd),
    money(r.cashInVnd),
    money(r.cashOutVnd),
    money(r.expectedVnd),
    optMoney(r.countedVnd),
    optMoney(r.differenceVnd),
    r.reason ?? '',
    optMoney(r.withdrawalVnd),
  ]);
  const categories: ExportCell[][] = report.byCategory.map((r) => [
    c['cat_' + r.category] ?? r.category,
    money(r.inVnd),
    money(r.outVnd),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['branch']!, kind: 'text' },
        { header: c['date']!, kind: 'date' },
        { header: c['closedState']!, kind: 'text' },
        { header: c['openingFloat']!, kind: 'money' },
        { header: c['cashInLabel']!, kind: 'money' },
        { header: c['cashOutLabel']!, kind: 'money' },
        { header: c['expectedCash']!, kind: 'money' },
        { header: c['countedCash']!, kind: 'money' },
        { header: c['differenceCash']!, kind: 'money' },
        { header: c['reason']!, kind: 'text' },
        { header: c['withdrawal']!, kind: 'money' },
      ],
      rows,
    },
    extra: [
      {
        name: c['sheetCategories']!,
        columns: [
          { header: c['cashCategory']!, kind: 'text' },
          { header: c['cashInLabel']!, kind: 'money' },
          { header: c['cashOutLabel']!, kind: 'money' },
        ],
        rows: categories,
      },
    ],
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const cashFundsBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await cashFunds(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.name,
    r.kind === 'CASH' ? c['fundCash']! : c['fundBank']!,
    r.branch?.code ?? '',
    money(r.openingBalanceVnd),
    money(r.inVnd),
    money(r.outVnd),
    money(r.balanceVnd),
    r.lastClosedDate === null ? '' : day(r.lastClosedDate),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['fund']!, kind: 'text' },
        { header: c['fundKind']!, kind: 'text' },
        { header: c['branchCode']!, kind: 'text' },
        { header: c['openingBalance']!, kind: 'money' },
        { header: c['cashInLabel']!, kind: 'money' },
        { header: c['cashOutLabel']!, kind: 'money' },
        { header: c['balanceEnd']!, kind: 'money' },
        { header: c['lastClosed']!, kind: 'date' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const cashDifferencesBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await cashDifferences(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.branch.code,
    r.branch.name,
    day(r.date),
    money(r.expectedVnd),
    money(r.countedVnd),
    money(r.differenceVnd),
    r.reason ?? '',
    r.closedByName ?? '',
    r.alert ? c['yes']! : c['no']!,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['branchCode']!, kind: 'text' },
        { header: c['branch']!, kind: 'text' },
        { header: c['date']!, kind: 'date' },
        { header: c['expectedCash']!, kind: 'money' },
        { header: c['countedCash']!, kind: 'money' },
        { header: c['differenceCash']!, kind: 'money' },
        { header: c['reason']!, kind: 'text' },
        { header: c['closedBy']!, kind: 'text' },
        { header: c['alertFlag']!, kind: 'text' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const tipsBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await tipsReport(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.name,
    r.employeeCode ?? '',
    money(r.cashVnd),
    money(r.transferVnd),
    money(r.totalVnd),
    money(r.inRunVnd),
    money(r.owedVnd),
    r.entries,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['name']!, kind: 'text' },
        { header: c['employeeCode']!, kind: 'text' },
        { header: c['tipsCash']!, kind: 'money' },
        { header: c['tipsTransfer']!, kind: 'money' },
        { header: c['tipsTotal']!, kind: 'money' },
        { header: c['tipsInRun']!, kind: 'money' },
        { header: c['tipsOwed']!, kind: 'money' },
        { header: c['entries']!, kind: 'int' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const PAYROLL_COLUMNS = [
  'BASE_SALARY',
  'CTV_WORK',
  'TOUR',
  'COMMISSION',
  'BONUS',
  'ADJUSTMENT',
  'DEDUCTION',
  'ADVANCE_RECOVERY',
] as const;

const payrollBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await payrollMonthly(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    day(r.month),
    c['status_' + r.status] ?? r.status,
    r.paymentDay === null ? '' : day(r.paymentDay),
    r.people,
    ...PAYROLL_COLUMNS.map((kind) => money(r.byKind[kind])),
    money(r.netVnd),
    money(r.tipsVnd),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['payMonth']!, kind: 'date' },
        { header: c['payStatus']!, kind: 'text' },
        { header: c['paymentDay']!, kind: 'date' },
        { header: c['payPeople']!, kind: 'int' },
        ...PAYROLL_COLUMNS.map((kind) => ({ header: c['kind_' + kind]!, kind: 'money' as const })),
        { header: c['payNet']!, kind: 'money' },
        { header: c['tips']!, kind: 'money' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const labourBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await labourCost(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    day(r.month),
    c['status_' + r.status] ?? r.status,
    money(r.labourVnd),
    money(r.revenueVnd),
    r.shareBp === null ? '' : pct(r.shareBp),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['payMonth']!, kind: 'date' },
        { header: c['payStatus']!, kind: 'text' },
        { header: c['labour']!, kind: 'money' },
        { header: c['net']!, kind: 'money' },
        { header: c['labourShare']!, kind: 'percent' },
      ],
      rows,
    },
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

const advancesBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await advancesReport(context, moneyQuery(covered, request));
  const c = words.col;
  const rows: ExportCell[][] = report.rows.map((r) => [
    r.name,
    r.employeeCode ?? '',
    money(r.paidVnd),
    money(r.recoveredVnd),
    money(r.outstandingVnd),
    r.pendingCount,
    money(r.pendingVnd),
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['name']!, kind: 'text' },
        { header: c['employeeCode']!, kind: 'text' },
        { header: c['advPaid']!, kind: 'money' },
        { header: c['advRecovered']!, kind: 'money' },
        { header: c['advOutstanding']!, kind: 'money' },
        { header: c['advPendingCount']!, kind: 'int' },
        { header: c['advPending']!, kind: 'money' },
      ],
      rows,
    },
    rows: rows.length,
    period: null,
    compared: null,
  };
};

const fill = (template: string, values: Record<string, string | number>): string =>
  template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? ''));

const profitBuilder: ExportBuilder = async (context, covered, request, words) => {
  const report = await profitReport(context, {
    from: request.from,
    to: request.to,
    restrictTo: covered,
  });
  const c = words.col;
  const l = report.lines;
  const negative = (value: string) => money(value === '0' ? '0' : '-' + value);
  const coverage = fill(c['profitCoverage']!, {
    percent: `${(report.goods.coverageBp / 100).toFixed(1)}%`,
  });
  const salaryNote = fill(c['profitSalaryNote']!, {
    counted: report.salaries.monthsCounted,
    missing: report.salaries.monthsMissing,
    partial: report.salaries.monthsPartial,
  });
  const rows: ExportCell[][] = [
    [c['line_revenue']!, money(l.revenueVnd), ''],
    [c['line_cogs']!, negative(l.costOfGoodsVnd), coverage],
    [c['line_tour']!, negative(l.tourVnd), ''],
    [c['line_commission']!, negative(l.commissionVnd), ''],
    [c['line_salaries']!, negative(l.salariesVnd), salaryNote],
    [c['line_expenses']!, negative(l.manualExpensesVnd), ''],
    [c['line_profit']!, money(l.profitVnd), c['profitDisclaimer']!],
  ];
  const noCost: ExportCell[][] = report.withoutCost.map((r) => [
    r.sku,
    name(words, r.nameVi, r.nameEn),
    r.unitsWithoutCost,
  ]);
  return {
    main: {
      name: words.sheetData,
      columns: [
        { header: c['profitLine']!, kind: 'text' },
        { header: c['profitAmount']!, kind: 'money' },
        { header: c['profitNote']!, kind: 'text' },
      ],
      rows,
    },
    extra: [
      {
        name: c['sheetNoCost']!,
        columns: [
          { header: c['sku']!, kind: 'text' },
          { header: c['product']!, kind: 'text' },
          { header: c['unitsNoCost']!, kind: 'int' },
        ],
        rows: noCost,
      },
    ],
    rows: rows.length,
    period: { from: report.period.from, to: report.period.to },
    compared: null,
  };
};

/** The exportable reports that are built. A listed report without a builder answers NOT_FOUND (it arrives in a later Step). */
export const EXPORT_BUILDERS: Readonly<Record<string, ExportBuilder>> = {
  'revenue-overview': overview,
  'revenue-by-branch': byBranch,
  'revenue-by-kind': byKind,
  'revenue-by-method': byMethod,
  refunds,
  'revenue-by-service': byService,
  'revenue-by-product': byProduct,
  combos,
  'discounts-campaigns': discounts,
  'online-orders': onlineOrders,
  'customers-visits': customersVisits,
  'bookings-funnel': bookingsFunnel,
  loyalty,
  'top-customers': topCustomersBuilder,
  'staff-activity': staff,
  'stock-best-sellers': stockBestSellers,
  'stock-low': stockLow,
  'stock-slow': stockSlow,
  'stock-expiry': stockExpiry,
  'stock-value': stockValueBuilder,
  'stock-movements': stockMovementsBuilder,
  'stock-receipts': stockReceiptsBuilder,
  'cash-daily': cashDailyBuilder,
  'cash-funds': cashFundsBuilder,
  'cash-differences': cashDifferencesBuilder,
  tips: tipsBuilder,
  'payroll-monthly': payrollBuilder,
  'labour-cost': labourBuilder,
  advances: advancesBuilder,
  profit: profitBuilder,
};

export function builderFor(report: string): ExportBuilder {
  const builder = EXPORT_BUILDERS[report];
  if (!builder) throw new AuthError('NOT_FOUND');
  return builder;
}

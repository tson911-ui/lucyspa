import type { ReportExportRequest } from '@lucy-spa/contracts';
import type { ExportCell, ExportSheet } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import type { ExportWords } from './export.labels.js';
import { loadRefundRows } from './refunds.core.js';
import { parseRange } from './report.dates.js';
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

/** The exportable reports that are built. A listed report without a builder answers NOT_FOUND (it arrives in a later Step). */
export const EXPORT_BUILDERS: Readonly<Record<string, ExportBuilder>> = {
  'revenue-overview': overview,
  'revenue-by-branch': byBranch,
  'revenue-by-kind': byKind,
  'revenue-by-method': byMethod,
  refunds,
};

export function builderFor(report: string): ExportBuilder {
  const builder = EXPORT_BUILDERS[report];
  if (!builder) throw new AuthError('NOT_FOUND');
  return builder;
}

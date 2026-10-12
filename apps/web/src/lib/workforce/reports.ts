import {
  REPORT_BUCKETS,
  REPORT_LIMITS,
  type RefundReport,
  type ReportBucket,
  type ReportExportFormat,
  type ReportExportRequest,
  type RevenueReport,
} from '@lucy-spa/contracts';
import {
  addDays,
  type Comparison,
  type DateRange,
  type DonutSlice,
  type SlotIndex,
} from '@lucy-spa/ui';
import type { ReportsDictionary } from '../../i18n/reports';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError, type DownloadedFile, type WorkforceApi } from './api';
import { formatVnd } from './format';
import { normalizePage } from './list-view';
import { errorMessage } from './workflows';

/**
 * Phase 8 (P8-5): the logic behind the report screens, kept apart from the markup so it is tested without a browser. Money travels as
 * a decimal string (the API's format); the charts take whole dong as numbers (every figure is far below 2^53). Dates are branch business
 * dates; all branches are in Asia/Ho_Chi_Minh today, which is also where "today" is read.
 */
export const REPORT_ZONE = 'Asia/Ho_Chi_Minh';
export const REVENUE_TABS = ['branch', 'kind', 'method'] as const;
export type RevenueTab = (typeof REVENUE_TABS)[number];

export type RevenuePageState = {
  /** Empty = the default range (the last 30 days). */
  from: string;
  to: string;
  /** Empty = all the branches the person may read. */
  branch: string;
  compare: 'none' | 'previous';
  /** Empty = chosen from the length of the range. */
  bucket: '' | ReportBucket;
  tab: RevenueTab;
};

export const REVENUE_PAGE_DEFAULTS: RevenuePageState = {
  from: '',
  to: '',
  branch: '',
  compare: 'none',
  bucket: '',
  tab: 'branch',
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function normalizeRevenuePage(state: RevenuePageState): RevenuePageState {
  const from = DATE.test(state.from) ? state.from : '';
  const to = DATE.test(state.to) ? state.to : '';
  const ordered = from !== '' && to !== '' && to >= from;
  return {
    from: ordered ? from : '',
    to: ordered ? to : '',
    branch: state.branch,
    compare: state.compare === 'previous' ? 'previous' : 'none',
    bucket: (REPORT_BUCKETS as readonly string[]).includes(state.bucket) ? state.bucket : '',
    tab: (REVENUE_TABS as readonly string[]).includes(state.tab) ? state.tab : 'branch',
  };
}

/** The range on screen: the one in the address, else the last 30 days ending today. */
export function revenueRange(state: { from: string; to: string }, today: string): DateRange {
  return state.from !== '' && state.to !== ''
    ? { from: state.from, to: state.to }
    : { from: addDays(today, -29), to: today };
}

export const REFUND_PAGE_DEFAULTS = { from: '', to: '', branch: '', page: 1 };
export type RefundPageState = typeof REFUND_PAGE_DEFAULTS;

export function normalizeRefundPage(state: RefundPageState): RefundPageState {
  const from = DATE.test(state.from) ? state.from : '';
  const to = DATE.test(state.to) ? state.to : '';
  const ordered = from !== '' && to !== '' && to >= from;
  return {
    from: ordered ? from : '',
    to: ordered ? to : '',
    branch: state.branch,
    page: normalizePage(state.page),
  };
}
export const REFUND_RESET_KEYS: readonly string[] = ['page'];

/** An amount for a table cell: grouped digits and the dong sign, a minus sign kept in front. */
export function vnd(value: string, locale: Locale): string {
  return value.startsWith('-') ? `-${formatVnd(value.slice(1), locale)}` : formatVnd(value, locale);
}

/** The API's amount string as a number for display and charts. */
export function vndNumber(value: string): number {
  return /^-?\d{1,15}$/.test(value) ? Number(value) : 0;
}

/** Most buckets are a day long, so the label of a bucket's start is the day; a week, month, quarter or year says what it is. */
export function bucketTitle(words: ReportsDictionary, bucket: ReportBucket): string {
  return words.buckets[bucket].toLowerCase();
}

/** The line chart's data: this period and, when asked for, the one before it (aligned by position). */
export function revenueSeries(report: RevenueReport, words: ReportsDictionary): Comparison {
  const points = (series: RevenueReport['series']) =>
    series.map((point) => ({ x: point.start, y: vndNumber(point.netVnd) }));
  return {
    current: [{ id: 'revenue', label: words.revenue.chart.current, points: points(report.series) }],
    ...(report.previousSeries
      ? {
          previous: [
            {
              id: 'revenue',
              label: words.revenue.chart.previous,
              points: points(report.previousSeries.slice(0, report.series.length)),
            },
          ],
        }
      : {}),
  };
}

/** True when nothing was collected or given back in the period (an empty state, not a flat chart). */
export function isEmptyRevenue(report: RevenueReport): boolean {
  return (
    report.totals.collectedVnd === '0' &&
    report.totals.refundsVnd === '0' &&
    report.totals.exchangesVnd === '0'
  );
}

const SIDE_SLOTS: Record<string, SlotIndex> = { SPA: 1, BEAUTY: 2, UNCLASSIFIED: 3 };

/** Revenue by group (Spa / Cosmetics / unclassified) for the donut: only parts above zero, a donut cannot show a negative. */
export function sideSlices(report: RevenueReport, words: ReportsDictionary): DonutSlice[] {
  return report.bySide
    .filter((part) => vndNumber(part.netVnd) > 0)
    .map((part) => ({
      id: part.key,
      label: words.revenue.side[part.key] ?? part.key,
      value: vndNumber(part.netVnd),
      color: SIDE_SLOTS[part.key] ?? 3,
    }));
}

export interface KindRow {
  id: string;
  side: string;
  kind: string;
  net: number;
}

/** "Group and kind" rows come from the by-kind and by-side parts the server already added up; they are shown as two small tables. */
export function groupLabel(words: ReportsDictionary, key: string): string {
  return words.revenue.side[key] ?? words.revenue.kind[key] ?? words.revenue.channel[key] ?? key;
}

/** A whole-dong figure with its sign shown in front, for "Hoàn lại" columns. */
export function minus(value: string): string {
  return value === '0' ? '0' : `-${value}`;
}

/** What the person is told when a report or an export fails: the report's own words first, then the common ones. */
export function reportErrorMessage(
  failure: unknown,
  words: ReportsDictionary,
  t: WorkforceDictionary,
): string {
  if (failure instanceof ApiError && failure.code in words.errors) {
    return words.errors[failure.code] as string;
  }
  return errorMessage(failure, t);
}

export function exportRequest(
  report: string,
  format: ReportExportFormat,
  state: {
    range: DateRange | null;
    branch: string;
    compare?: 'none' | 'previous';
    bucket?: string;
  },
  locale: Locale,
): ReportExportRequest {
  return {
    report,
    format,
    ...(state.range ? { from: state.range.from, to: state.range.to } : {}),
    ...(state.branch !== '' ? { branchId: state.branch } : {}),
    ...(state.compare && state.compare !== 'none' ? { compare: state.compare } : {}),
    ...(state.bucket ? { bucket: state.bucket } : {}),
    locale,
  };
}

/** Hands the file the API produced to the browser as a download. */
export function saveFile(file: DownloadedFile): void {
  const url = URL.createObjectURL(file.blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the address goes away.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function requestExport(
  api: WorkforceApi,
  request: ReportExportRequest,
): Promise<DownloadedFile> {
  return api.postFile('/api/v1/reports/export', request);
}

export const MAX_REPORT_DAYS = REPORT_LIMITS.maxDays;

export function totalRefundRows(report: RefundReport): number {
  return report.total;
}

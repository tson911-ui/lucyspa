import {
  PRODUCT_GROUPINGS,
  REPORT_BUCKETS,
  type ProductGrouping,
  type ReportBucket,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';

/**
 * Phase 8 (P8-10): the logic behind the Wave B report screens (sales, customers, staff, stock), apart from the markup so it is tested without a
 * browser. The page state lives in the address (`useUrlState`): the period, the branch and the tab are shareable, and a stale or invalid value
 * falls back to the default instead of failing. Money is the API's decimal string (see `reports.ts` for `vnd` / `vndNumber`).
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const SALES_TABS = ['services', 'products', 'combos', 'discounts', 'online'] as const;
export type SalesTab = (typeof SALES_TABS)[number];
export const CUSTOMER_TABS = ['visits', 'bookings', 'loyalty', 'top'] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];
export const STOCK_TABS = [
  'best',
  'low',
  'slow',
  'expiry',
  'value',
  'movements',
  'receipts',
] as const;
export type StockTab = (typeof STOCK_TABS)[number];
export const STAFF_TABS = ['staff'] as const;
export type StaffTab = (typeof STAFF_TABS)[number];

/** The look-back (slow movers) and look-ahead (expiry) windows offered; 60 is the Owner's default. */
export const STOCK_DAY_CHOICES = ['30', '60', '90', '180'] as const;
export type StockDays = (typeof STOCK_DAY_CHOICES)[number];

export type ReportPageState = {
  /** Empty = the default range (the last 30 days). */
  from: string;
  to: string;
  /** Empty = all the branches the person may read. */
  branch: string;
  tab: string;
  bucket: '' | ReportBucket;
  /** Products tab: how to group. */
  by: ProductGrouping;
  /** Stock tabs that look back or ahead. */
  days: StockDays;
  /** Online orders: the server pages this one (20 a page). */
  page: number;
};

export const REPORT_PAGE_DEFAULTS: ReportPageState = {
  from: '',
  to: '',
  branch: '',
  tab: '',
  bucket: '',
  by: 'variant',
  days: '60',
  page: 1,
};

/** Resets the page when anything that changes the rows changes. */
export const REPORT_RESET_KEYS: readonly string[] = ['page'];

export function normalizeReportPage(
  state: ReportPageState,
  tabs: readonly string[],
): ReportPageState {
  const from = DATE.test(state.from) ? state.from : '';
  const to = DATE.test(state.to) ? state.to : '';
  const ordered = from !== '' && to !== '' && to >= from;
  const page = Number.isInteger(state.page) && state.page >= 1 ? state.page : 1;
  return {
    from: ordered ? from : '',
    to: ordered ? to : '',
    branch: state.branch,
    tab: tabs.includes(state.tab) ? state.tab : '',
    bucket: (REPORT_BUCKETS as readonly string[]).includes(state.bucket) ? state.bucket : '',
    by: (PRODUCT_GROUPINGS as readonly string[]).includes(state.by) ? state.by : 'variant',
    days: (STOCK_DAY_CHOICES as readonly string[]).includes(state.days) ? state.days : '60',
    page,
  };
}

/** Whole-number percent of a basis-point figure, one decimal at most ("66,7%"). */
export function percentFromBp(bp: number, locale: Locale): string {
  return `${new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    maximumFractionDigits: 1,
  }).format(bp / 100)}%`;
}

/** Minutes as hours and minutes ("7 giờ 30 phút", "45 phút"). */
export function durationText(minutes: number, locale: Locale): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (locale === 'en') {
    return hours === 0 ? `${rest} min` : rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
  }
  return hours === 0 ? `${rest} phút` : rest === 0 ? `${hours} giờ` : `${hours} giờ ${rest} phút`;
}

/** A name in the person's language, falling back to the other one when it is empty. */
export function pickName(locale: Locale, vi: string, en: string): string {
  const first = locale === 'en' ? en : vi;
  const second = locale === 'en' ? vi : en;
  return first !== '' ? first : second;
}

/** The number a share of basis points shows as a percent for the KPI card (which takes a percent, not basis points). */
export function bpToPercent(bp: number): number {
  return bp / 100;
}

/** A whole number with the language's digit grouping ("1.043" / "1,043"). */
export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'en' ? 'en-US' : 'vi-VN', {
    maximumFractionDigits: 0,
  }).format(Math.round(value));
}

/** A pay month as "10/2026". */
export function monthLabel(firstOfMonth: string): string {
  return `${firstOfMonth.slice(5, 7)}/${firstOfMonth.slice(0, 4)}`;
}

import type { ReportBranchRef, ReportBucket, ReportPeriod } from './reports.js';

/**
 * Phase 8 P8-3 (docs/PHASE8_REPORTS.md section 4.1, Owner-approved definition of "doanh thu"): the revenue report.
 *
 * Net revenue = money actually collected (cash and PayOS, effective payments only) minus money given back (product refunds, which include
 * the refunds of a failed delivery, and the money paid back on an exchange), counted on the branch business day it happened. Tips are
 * never revenue, a combo counts when it is sold, an exchange invoice counts only its difference, and an online order counts on the day
 * it was delivered (until then the money is "đã thu, chưa giao"). Money is integer VND carried as a decimal string; the parts of every
 * breakdown add up to `totals.netVnd` exactly (the server checks it).
 */

export const REVENUE_SIDES = ['SPA', 'BEAUTY', 'UNCLASSIFIED'] as const;
export type RevenueSide = (typeof REVENUE_SIDES)[number];

/** What was sold: a service, a combo package, a cosmetic product; OTHER = a payment with no recorded line (never expected). */
export const REVENUE_KINDS = ['SERVICE', 'COMBO', 'PRODUCT', 'OTHER'] as const;
export type RevenueKind = (typeof REVENUE_KINDS)[number];

export const REVENUE_CHANNELS = ['COUNTER', 'ONLINE'] as const;
export type RevenueChannel = (typeof REVENUE_CHANNELS)[number];

/** Money coming in: cash and PayOS. Money going out: a refund or an exchange difference, by cash or by manual transfer. */
export const REVENUE_METHODS = ['CASH', 'PAYOS', 'TRANSFER'] as const;
export type RevenueMethod = (typeof REVENUE_METHODS)[number];

export const REVENUE_FLOWS = ['PAYMENT', 'REFUND', 'EXCHANGE'] as const;
export type RevenueFlow = (typeof REVENUE_FLOWS)[number];

export interface RevenueTotals {
  /** Collected minus given back. The headline. */
  netVnd: string;
  /** Effective payments recognised in the period. */
  collectedVnd: string;
  /** Product refunds (including failed-delivery refunds), as a positive number. */
  refundsVnd: string;
  /** Money paid back on exchanges, as a positive number. */
  exchangesVnd: string;
  /** The shipping fee inside the collected money (the online shipping fee is switched off, so normally 0). Informational. */
  shippingVnd: string;
}

export interface RevenuePoint extends RevenueTotals {
  /** First day of the bucket (`YYYY-MM-DD`). */
  start: string;
}

export interface RevenueBranchRow {
  branch: ReportBranchRef;
  netVnd: string;
  collectedVnd: string;
  refundsVnd: string;
  exchangesVnd: string;
  paidInvoices: number;
  visits: number;
  /** The previous period's net, when a comparison was asked for. */
  previousNetVnd: string | null;
}

export interface RevenuePart<K extends string> {
  key: K;
  netVnd: string;
  /** Share of the net in basis points (10000 = 100%); 0 when the net is 0. */
  shareBp: number;
}

export interface RevenueMethodRow {
  method: RevenueMethod;
  /** Money in by this method (payments) or out by this method (refunds and exchanges), both positive. */
  inVnd: string;
  outVnd: string;
  netVnd: string;
}

export interface RevenueReport {
  generatedAt: string;
  period: ReportPeriod;
  bucket: ReportBucket;
  /** The branches this report covers for the person (the filter narrowed or not). */
  branches: ReportBranchRef[];
  totals: RevenueTotals;
  /** Null when the comparison is off. */
  previousTotals: RevenueTotals | null;
  /** Every bucket of the period, empty ones included. */
  series: RevenuePoint[];
  /** The previous period's buckets, aligned by index with `series` (null when the comparison is off). */
  previousSeries: RevenuePoint[] | null;
  byBranch: RevenueBranchRow[];
  bySide: RevenuePart<RevenueSide>[];
  byKind: RevenuePart<RevenueKind>[];
  byChannel: RevenuePart<RevenueChannel>[];
  byMethod: RevenueMethodRow[];
  /** The invoices that became PAID in the period (their count and total), the figure the old dashboard widget showed. */
  paidInvoices: { count: number; totalVnd: string; averageVnd: string };
  /** Completed lượt đến (visits) in the period. */
  visits: number;
  /** Online money collected but not delivered yet, as of the moment of the report (not a period figure). */
  onlineHeldVnd: string;
  /** Money of payments with no recorded Spa/Beauty split, kept visible instead of guessed (normally 0). */
  unclassifiedVnd: string;
}

/** One line of the refunds and corrections list (R10). */
export type RefundRowKind = 'REFUND' | 'EXCHANGE' | 'PAYMENT_REVERSAL';

export interface RefundRow {
  kind: RefundRowKind;
  /** Branch business day of the event. */
  date: string;
  branch: ReportBranchRef;
  invoiceCode: string;
  amountVnd: string;
  /** CASH or TRANSFER for a refund/exchange, CASH for a reversed cash payment. */
  method: RevenueMethod;
  reason: string;
  /** The refund code (RF-…) / exchange code; null for a payment reversal. */
  code: string | null;
  /** The refund belongs to the settlement of a failed delivery. */
  failedDelivery: boolean;
}

export interface RefundReport {
  generatedAt: string;
  period: ReportPeriod;
  branches: ReportBranchRef[];
  page: number;
  pageSize: number;
  total: number;
  /** Totals of the whole filter, not of the page. */
  totals: {
    refundsVnd: string;
    exchangesVnd: string;
    reversalsVnd: string;
    paymentAnomalies: number;
  };
  rows: RefundRow[];
}

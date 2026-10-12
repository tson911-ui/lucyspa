import type { ReportBranchRef, ReportPeriod } from './reports.js';

/**
 * Phase 8 P8-7 (docs/PHASE8_REPORTS.md 4.2, R5-R9): what was sold. The revenue columns are the very facts of the revenue report (money
 * collected minus money given back, on the day it happened, split over invoice lines), so a service, a product or a combo can never show
 * a figure that the headline does not contain. Quantities are counted on the invoices that became PAID in the period. Money is integer
 * VND carried as a decimal string. Needs VIEW_REVENUE at the branch.
 */

export interface SalesReportBase {
  generatedAt: string;
  period: ReportPeriod;
  branches: ReportBranchRef[];
  /** True when more than `ROW_LIMIT` rows existed and the smallest were left out (the totals still count everything). */
  truncated: boolean;
}

/** Rows a sales report returns at most (the list is paged in the browser; an export holds them all up to the file cap). */
export const SALES_ROW_LIMIT = 5000;

export interface ServiceRevenueRow {
  /** Null for the one row "other" that holds money of service lines no service could be named for. */
  serviceId: string | null;
  code: string | null;
  nameVi: string;
  nameEn: string;
  categoryNameVi: string | null;
  categoryNameEn: string | null;
  /** Units on invoices paid in the period. */
  quantity: number;
  netVnd: string;
  /** Share of the services' net in basis points. */
  shareBp: number;
}

export interface ServiceRevenueReport extends SalesReportBase {
  rows: ServiceRevenueRow[];
  totals: { netVnd: string; quantity: number };
}

export const PRODUCT_GROUPINGS = ['variant', 'brand', 'category'] as const;
export type ProductGrouping = (typeof PRODUCT_GROUPINGS)[number];

export interface ProductRevenueRow {
  /** Variant, brand or category id (null: not named). */
  key: string | null;
  sku: string | null;
  nameVi: string;
  nameEn: string;
  brandNameVi: string | null;
  brandNameEn: string | null;
  categoryNameVi: string | null;
  categoryNameEn: string | null;
  unitsSold: number;
  unitsRefunded: number;
  netVnd: string;
  shareBp: number;
}

export interface ProductRevenueReport extends SalesReportBase {
  by: ProductGrouping;
  rows: ProductRevenueRow[];
  totals: { netVnd: string; unitsSold: number; unitsRefunded: number };
}

export interface ComboRow {
  comboId: string;
  nameVi: string;
  nameEn: string;
  /** Packages sold in the period and the ones voided since. */
  sold: number;
  voided: number;
  /** The price list value of the packages sold, and the money collected for them (revenue, counted at sale). */
  soldPriceVnd: string;
  revenueVnd: string;
  /** Sessions: given by the packages sold in the period; used in the period; still to use (now) and the unused ones of expired packages. */
  sessionsSold: number;
  sessionsUsed: number;
  sessionsRemaining: number;
  sessionsExpired: number;
}

export interface ComboReport extends SalesReportBase {
  rows: ComboRow[];
  totals: {
    sold: number;
    revenueVnd: string;
    sessionsUsed: number;
    sessionsRemaining: number;
    sessionsExpired: number;
  };
}

export const DISCOUNT_TYPES = ['PROGRAM', 'VOUCHER', 'MEMBER', 'BIRTHDAY', 'OTHER'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

export interface DiscountRow {
  type: DiscountType;
  /** The discount program (null for member and birthday discounts). */
  discountId: string | null;
  code: string | null;
  nameVi: string;
  nameEn: string;
  /** Invoices paid in the period that carry this discount. */
  invoices: number;
  /** The money taken off those invoices. */
  amountVnd: string;
}

export interface CampaignRow {
  campaignId: string;
  nameVi: string;
  nameEn: string;
  units: number;
  /** Money collected for the campaign's products (revenue basis). */
  netVnd: string;
}

export interface DiscountReport extends SalesReportBase {
  rows: DiscountRow[];
  campaigns: CampaignRow[];
  totals: {
    discountVnd: string;
    discountedInvoices: number;
    paidInvoices: number;
    /** Discount as a share of discount plus revenue-priced sales, in basis points (0 when nothing was sold). */
    discountShareBp: number;
  };
}

export const ONLINE_ORDER_REPORT_STATES = ['AWAITING_DELIVERY', 'DELIVERED', 'CANCELLED'] as const;
export type OnlineOrderReportState = (typeof ONLINE_ORDER_REPORT_STATES)[number];

export interface OnlineOrderRow {
  orderCode: string;
  invoiceCode: string;
  branch: ReportBranchRef;
  /** Branch business day the order was placed. */
  date: string;
  state: OnlineOrderReportState;
  /** Customer name (when given) and phone, in full. */
  contactName: string | null;
  contactPhone: string;
  totalVnd: string;
  collectedVnd: string;
  refundedVnd: string;
  /** Branch business day of the delivery (null until delivered). */
  deliveredOn: string | null;
  /** The staff referral code the customer entered (null when none). */
  staffCode: string | null;
}

export interface OnlineOrderReport {
  generatedAt: string;
  period: ReportPeriod;
  branches: ReportBranchRef[];
  summary: {
    orders: number;
    delivered: number;
    awaitingDelivery: number;
    cancelled: number;
    /** Money collected on orders not delivered yet and not cancelled (as of now, not a period figure). */
    heldVnd: string;
    collectedVnd: string;
    refundedVnd: string;
    /** Refunds that belong to the settlement of a failed delivery. */
    failedDeliveryRefundsVnd: string;
    staffCodeOrders: number;
    staffCodeCollectedVnd: string;
  };
  page: number;
  pageSize: number;
  total: number;
  rows: OnlineOrderRow[];
}

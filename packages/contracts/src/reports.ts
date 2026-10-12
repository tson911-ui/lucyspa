import type { PermissionCodeName } from './index.js';

/**
 * Phase 8 (docs/PHASE8_REPORTS.md, approved by the Owner on 2026-10-12): the reports. Every report is read-only, branch-scoped and
 * permission-gated; money is integer VND carried as a decimal string; dates are branch business dates (`YYYY-MM-DD`), never UTC instants.
 *
 * A report is returned for a branch only when the account holds EVERY permission in `requires` at that branch; a column that needs one
 * more permission (`columnPermissions`) is omitted, never zero-filled.
 */

export const REPORT_AREAS = [
  'revenue',
  'customers',
  'staff',
  'stock',
  'money',
  'profit',
  'reviews',
] as const;
export type ReportArea = (typeof REPORT_AREAS)[number];

/** The four deployable waves of the design (section 9); one combined deploy at the end (Owner, OQ-P8-10). */
export type ReportWave = 'A' | 'B' | 'C' | 'D';

export interface ReportDefinition {
  readonly id: string;
  readonly area: ReportArea;
  readonly wave: ReportWave;
  /** Every one of these must be held at a branch for the report to cover that branch. */
  readonly requires: readonly PermissionCodeName[];
  /** Extra permissions that unlock more columns of the same report (omitted, never zero-filled, without them). */
  readonly columnPermissions?: readonly PermissionCodeName[];
  /** A file of this report needs the fresh password (pay and profit data, design 6). */
  readonly exportReauth: boolean;
  /** False for the screens that are not tables to take away (the audit log). */
  readonly exportable: boolean;
}

const report = (
  id: string,
  area: ReportArea,
  wave: ReportWave,
  requires: readonly PermissionCodeName[],
  options: {
    columnPermissions?: readonly PermissionCodeName[];
    exportReauth?: boolean;
    exportable?: boolean;
  } = {},
): ReportDefinition => ({
  id,
  area,
  wave,
  requires,
  ...(options.columnPermissions ? { columnPermissions: options.columnPermissions } : {}),
  exportReauth: options.exportReauth ?? false,
  exportable: options.exportable ?? true,
});

/** The catalogue (design sections 4 and 7). One entry per report; the API, the web menu and the tests share it. */
export const REPORT_DEFINITIONS: readonly ReportDefinition[] = Object.freeze([
  // Revenue (R1-R4, R10 in Wave A; R5-R9 in Wave B).
  report('revenue-overview', 'revenue', 'A', ['VIEW_REVENUE']),
  report('revenue-by-branch', 'revenue', 'A', ['VIEW_REVENUE']),
  report('revenue-by-kind', 'revenue', 'A', ['VIEW_REVENUE']),
  report('revenue-by-method', 'revenue', 'A', ['VIEW_REVENUE']),
  report('refunds', 'revenue', 'A', ['VIEW_REVENUE']),
  report('revenue-by-service', 'revenue', 'B', ['VIEW_REVENUE']),
  report('revenue-by-product', 'revenue', 'B', ['VIEW_REVENUE']),
  report('combos', 'revenue', 'B', ['VIEW_REVENUE']),
  report('discounts-campaigns', 'revenue', 'B', ['VIEW_REVENUE']),
  report('online-orders', 'revenue', 'B', ['VIEW_REVENUE']),
  // Customers and bookings (Wave B).
  report('customers-visits', 'customers', 'B', ['VIEW_BOOKINGS']),
  report('bookings-funnel', 'customers', 'B', ['VIEW_BOOKINGS']),
  report('loyalty', 'customers', 'B', ['VIEW_LOYALTY']),
  report('top-customers', 'customers', 'B', ['VIEW_REVENUE', 'VIEW_LOYALTY']),
  // Staff (Wave B): factual, no ranking.
  report('staff-activity', 'staff', 'B', ['VIEW_STAFF_REPORTS'], {
    columnPermissions: ['VIEW_EMPLOYEE_PAY', 'VIEW_REVENUE'],
    exportReauth: true,
  }),
  // Cosmetics and stock (Wave B).
  report('stock-best-sellers', 'stock', 'B', ['VIEW_INVENTORY']),
  report('stock-low', 'stock', 'B', ['VIEW_INVENTORY']),
  report('stock-slow', 'stock', 'B', ['VIEW_INVENTORY']),
  report('stock-expiry', 'stock', 'B', ['VIEW_INVENTORY']),
  report('stock-value', 'stock', 'B', ['VIEW_INVENTORY', 'VIEW_PRODUCT_COST']),
  report('stock-movements', 'stock', 'B', ['VIEW_INVENTORY']),
  report('stock-receipts', 'stock', 'B', ['VIEW_INVENTORY']),
  // Cash, tips, payroll (Wave C): need the books to be started.
  report('cash-daily', 'money', 'C', ['VIEW_CASH']),
  report('cash-funds', 'money', 'C', ['VIEW_CASH']),
  report('cash-differences', 'money', 'C', ['VIEW_CASH']),
  report('tips', 'money', 'C', ['VIEW_EMPLOYEE_PAY'], { exportReauth: true }),
  report('payroll-monthly', 'money', 'C', ['VIEW_EMPLOYEE_PAY'], { exportReauth: true }),
  report('labour-cost', 'money', 'C', ['VIEW_EMPLOYEE_PAY', 'VIEW_REVENUE'], {
    exportReauth: true,
  }),
  report('advances', 'money', 'C', ['VIEW_EMPLOYEE_PAY'], { exportReauth: true }),
  // Provisional profit (Wave C, Owner only: GLOBAL_ONLY permission).
  report('profit', 'profit', 'C', ['VIEW_PROFIT'], { exportReauth: true }),
  // Customer reviews (Wave D).
  report('reviews', 'reviews', 'D', ['VIEW_REVIEWS']),
]);

export type ReportId = string;

/** Hard limits (design P8-T5, section 6). */
export const REPORT_LIMITS = Object.freeze({
  /** The longest range one report covers. */
  maxDays: 366,
  /** The most rows one exported file holds. */
  maxExportRows: 100_000,
  /** The most files one person can have in preparation at once. */
  maxParallelExports: 2,
  /** Statement timeouts, in milliseconds: dashboard widget, report screen, file. */
  dashboardTimeoutMs: 5_000,
  reportTimeoutMs: 15_000,
  exportTimeoutMs: 60_000,
});

export const REPORT_BUCKETS = ['day', 'week', 'month', 'quarter', 'year'] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];

export const REPORT_COMPARISONS = ['none', 'previous'] as const;
export type ReportComparison = (typeof REPORT_COMPARISONS)[number];

export interface ReportBranchRef {
  id: string;
  code: string;
  name: string;
}

/** The period of a request as the server read it: inclusive branch business dates. */
export interface ReportPeriod {
  from: string;
  to: string;
  /** The equal-length period immediately before (null when the comparison is off). */
  previous: { from: string; to: string } | null;
}

/** GET /api/v1/reports: what this account may open (drives the menu) and the branches each report covers. */
export interface ReportRegistryEntry {
  id: ReportId;
  area: ReportArea;
  wave: ReportWave;
  /** False when the person holds the permissions at no branch. */
  available: boolean;
  /** Needs EXPORT_REPORTS at the same branch as well. */
  exportable: boolean;
  /** Export of this report asks for the fresh password. */
  exportReauth: boolean;
  /** The branches the report covers for this person (the all-branches view is exactly this set). */
  branchIds: string[];
}

export interface ReportRegistryResponse {
  generatedAt: string;
  branches: ReportBranchRef[];
  reports: ReportRegistryEntry[];
}

import type { ReportBranchRef, ReportPeriod } from './reports.js';

/**
 * Phase 8 P8-12 (docs/PHASE8_REPORTS.md 4.6, Owner OQ-P8-4/OQ-P8-5): the cash book, tips and payroll as reports. Every figure is read from the books
 * of Phase 7 (the append-only fund entries, the closed days, the tips, the pay runs and the salary advances) and nothing is estimated. Before the
 * Owner has started the cash book (`finance_go_live`) these reports say so (`started: false`) instead of showing zeros.
 *
 * Cash reports need VIEW_CASH at the branch; the shared bank fund is shown only to a person who holds it at every active branch (the cash book's
 * own rule). Tips need VIEW_EMPLOYEE_PAY at the branch. Payroll, labour cost and advances are shop-wide (one pay run per month for the whole shop)
 * and need VIEW_EMPLOYEE_PAY (and, for labour cost, VIEW_REVENUE) at EVERY active branch. Money is integer VND carried as a string.
 */
export const MONEY_ROW_LIMIT = 5000;

export interface MoneyReportBase {
  generatedAt: string;
  branches: ReportBranchRef[];
  /** False until the Owner started the cash book and payroll; the report is then empty on purpose. */
  started: boolean;
  startedAt: string | null;
}

export interface CashDayRow {
  branch: ReportBranchRef;
  /** Branch business day. */
  date: string;
  /** A closed day shows what the closing counted; an open day shows the book so far (no count yet). */
  closed: boolean;
  openingFloatVnd: string;
  cashInVnd: string;
  cashOutVnd: string;
  expectedVnd: string;
  countedVnd: string | null;
  differenceVnd: string | null;
  reason: string | null;
  withdrawalVnd: string | null;
}

export interface CashCategoryRow {
  category: string;
  inVnd: string;
  outVnd: string;
}

export interface CashDailyReport extends MoneyReportBase {
  period: ReportPeriod;
  rows: CashDayRow[];
  /** What moved in the cash funds of the period, by kind of entry. */
  byCategory: CashCategoryRow[];
  totals: {
    cashInVnd: string;
    cashOutVnd: string;
    differenceVnd: string;
    closedDays: number;
    openDays: number;
  };
  truncated: boolean;
}

export interface CashFundRow {
  fundId: string;
  kind: 'CASH' | 'BANK';
  /** Null for the shared bank fund. */
  branch: ReportBranchRef | null;
  name: string;
  openingBalanceVnd: string;
  /** Moved in the period. */
  inVnd: string;
  outVnd: string;
  /** The book up to the end of the period (opening balance plus every entry up to that day). */
  balanceVnd: string;
  lastClosedDate: string | null;
}

export interface CashFundsReport extends MoneyReportBase {
  period: ReportPeriod;
  rows: CashFundRow[];
  bankIncluded: boolean;
}

export interface CashDifferenceRow {
  branch: ReportBranchRef;
  date: string;
  expectedVnd: string;
  countedVnd: string;
  differenceVnd: string;
  reason: string | null;
  closedByName: string | null;
  /** At or above the shop's alert threshold. */
  alert: boolean;
}

export interface CashDifferencesReport extends MoneyReportBase {
  period: ReportPeriod;
  alertThresholdVnd: string;
  rows: CashDifferenceRow[];
  totals: { differenceVnd: string; days: number; alerts: number };
  truncated: boolean;
}

export interface TipRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  cashVnd: string;
  transferVnd: string;
  totalVnd: string;
  /** Part of the total already in a pay run, and the part still owed (not yet in a run). */
  inRunVnd: string;
  owedVnd: string;
  entries: number;
}

export interface TipsReport extends MoneyReportBase {
  period: ReportPeriod;
  rows: TipRow[];
  totals: { cashVnd: string; transferVnd: string; totalVnd: string; owedVnd: string };
  truncated: boolean;
}

export const PAYROLL_KINDS = [
  'BASE_SALARY',
  'CTV_WORK',
  'TOUR',
  'COMMISSION',
  'BONUS',
  'ADJUSTMENT',
  'DEDUCTION',
  'ADVANCE_RECOVERY',
] as const;
export type PayrollKind = (typeof PAYROLL_KINDS)[number];

export interface PayrollMonthRow {
  /** First day of the pay month. */
  month: string;
  status: 'DRAFT' | 'CLOSED' | 'PAID';
  paymentDay: string | null;
  people: number;
  /** Money by kind of pay item (deductions and advance recoveries are negative). */
  byKind: Record<PayrollKind, string>;
  /** The sum of every kind: what employees receive on top of their tips. */
  netVnd: string;
  tipsVnd: string;
}

export interface PayrollMonthlyReport extends MoneyReportBase {
  period: ReportPeriod;
  rows: PayrollMonthRow[];
  totals: { netVnd: string; tipsVnd: string };
}

export interface LabourCostRow {
  month: string;
  status: 'DRAFT' | 'CLOSED' | 'PAID';
  /** What the pay run costs: net pay plus tips. */
  labourVnd: string;
  /** Revenue of the same calendar month (every branch), as the Doanh thu report counts it. */
  revenueVnd: string;
  /** Labour cost as a share of revenue in basis points; null when the month had no revenue. */
  shareBp: number | null;
}

export interface LabourCostReport extends MoneyReportBase {
  period: ReportPeriod;
  rows: LabourCostRow[];
}

export interface AdvanceRow {
  userId: string;
  name: string;
  employeeCode: string | null;
  /** Paid out and not yet fully recovered. */
  paidVnd: string;
  recoveredVnd: string;
  outstandingVnd: string;
  /** Asked for or approved, not paid yet. */
  pendingCount: number;
  pendingVnd: string;
}

export interface AdvancesReport extends MoneyReportBase {
  rows: AdvanceRow[];
  totals: { outstandingVnd: string; pendingVnd: string };
}

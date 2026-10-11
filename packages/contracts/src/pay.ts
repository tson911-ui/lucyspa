/**
 * Phase 7 Wave B (docs/PHASE7_PAYROLL_FUNDS.md section 4): pay configuration. Tour amounts, product commission rules and salary
 * versions are Owner-entered, effective-dated, append-only rows that ship EMPTY. Money is integer VND as a decimal string; a
 * commission percentage is carried as basis points (500 = 5%). Reading rules needs MANAGE_PAY_RULES, MANAGE_PAYROLL or
 * APPROVE_PAYROLL (GLOBAL); changing them needs MANAGE_PAY_RULES. Salary versions follow VIEW/MANAGE_EMPLOYEE_PAY at the branches of the
 * employee (or the payroll permissions to read).
 */

export const COMMISSION_SCOPES = ['SHOP', 'BRAND', 'CATEGORY', 'PRODUCT'] as const;
export type CommissionScopeNameValue = (typeof COMMISSION_SCOPES)[number];

export const COMMISSION_KINDS = ['PERCENT', 'FIXED_PER_UNIT'] as const;
export type CommissionKindNameValue = (typeof COMMISSION_KINDS)[number];

export const PAY_REASON_MAX = 500;
/** A rule or salary may be dated this many days back (the open period) and, for rules, this many days ahead. */
export const PAY_BACKDATE_DAYS = 62;
export const PAY_FUTURE_DAYS = 366;
export const COMMISSION_PERCENT_MAX_BP = 10_000;

export interface PayVersionRef {
  amountVnd: string;
  /** YYYY-MM-DD */
  effectiveFrom: string;
}

export interface PayActorRef {
  id: string;
  name: string;
}

// ------------------------------------------------------------------------------------------------- tour rules
export interface TourRuleServiceItem {
  service: { id: string; code: string; nameVi: string; nameEn: string; isActive: boolean };
  /** The rule in force today, or null: this service pays no tour yet (the "no rule" list). */
  current: PayVersionRef | null;
  /** The next rule that starts later, if one is recorded. */
  upcoming: PayVersionRef | null;
  versions: number;
}

export interface TourRulesResponse {
  /** The branch-local date the screen counts from. */
  today: string;
  items: TourRuleServiceItem[];
  canManage: boolean;
}

export interface TourRuleVersionItem {
  id: string;
  amountVnd: string;
  effectiveFrom: string;
  reason: string | null;
  createdBy: PayActorRef;
  createdAt: string;
}

export interface TourRuleHistoryResponse {
  service: TourRuleServiceItem['service'];
  items: TourRuleVersionItem[];
}

export interface TourRuleRequest {
  serviceId: string;
  amountVnd: string;
  effectiveFrom: string;
  reason: string | null;
}

export interface TourRuleResponse {
  item: TourRuleServiceItem;
}

// ------------------------------------------------------------------------------------------ commission rules
export type CommissionRuleState = 'CURRENT' | 'UPCOMING' | 'REPLACED';

export interface CommissionRuleItem {
  id: string;
  scope: CommissionScopeNameValue;
  /** The brand, category or product the rule is for; null for the shop-wide default. */
  target: { id: string; name: string } | null;
  /** The one employee the rule is for; null = everyone. */
  employee: PayActorRef | null;
  kind: CommissionKindNameValue;
  /** Basis points for PERCENT, whole dong per unit for FIXED_PER_UNIT. */
  value: string;
  effectiveFrom: string;
  reason: string | null;
  createdBy: PayActorRef;
  createdAt: string;
  /** CURRENT = the latest one in force for its scope today; UPCOMING = starts later; REPLACED = a later one is in force. */
  state: CommissionRuleState;
}

export interface CommissionRulesResponse {
  today: string;
  items: CommissionRuleItem[];
  brands: { id: string; name: string }[];
  categories: { id: string; name: string }[];
  /** Official employees (the ones commission is paid to). */
  employees: PayActorRef[];
  canManage: boolean;
}

export interface CommissionProductOption {
  id: string;
  name: string;
  sku: string | null;
}

export interface CommissionTargetsResponse {
  items: CommissionProductOption[];
}

export interface CommissionRuleRequest {
  scope: CommissionScopeNameValue;
  /** The brand, category or product id; null for SHOP. */
  targetId: string | null;
  employeeUserId: string | null;
  kind: CommissionKindNameValue;
  value: string;
  effectiveFrom: string;
  reason: string | null;
}

export interface CommissionRuleResponse {
  item: CommissionRuleItem;
}

// ----------------------------------------------------------------------------------------------- salaries
export interface SalaryItem {
  employee: { id: string; name: string; code: string };
  /** The recorded version in force today, or null when no version has been entered yet. */
  current: { amountVnd: string | null; effectiveFrom: string } | null;
  /** The amount on the employee's profile (the old single number); shown as "not confirmed" until a version exists. */
  profileSalaryVnd: string | null;
  confirmed: boolean;
  versions: number;
}

export interface SalariesResponse {
  today: string;
  items: SalaryItem[];
  canManage: boolean;
}

export interface SalaryVersionItem {
  id: string;
  amountVnd: string | null;
  effectiveFrom: string;
  reason: string | null;
  recordedBy: PayActorRef;
  recordedAt: string;
}

export interface SalaryHistoryResponse {
  employee: SalaryItem['employee'];
  items: SalaryVersionItem[];
}

export interface SalaryVersionRequest {
  employeeUserId: string;
  /** Whole dong, or null for "no salary from that date". */
  amountVnd: string | null;
  effectiveFrom: string;
  reason: string | null;
}

export interface SalaryVersionResponse {
  item: SalaryItem;
}

// ------------------------------------------------------------------------------------------------- earnings
export const PAY_EARNING_KINDS = ['TOUR', 'PRODUCT_COMMISSION'] as const;
export type PayEarningKindName = (typeof PAY_EARNING_KINDS)[number];

export interface PayEarningItem {
  id: string;
  kind: PayEarningKindName;
  employee: PayActorRef;
  /** Signed: positive for an earning, negative for a reversal. */
  amountVnd: string;
  businessDate: string;
  /** The line's net (commission) the amount was calculated on. */
  baseVnd: string | null;
  quantity: number | null;
  /** EPISODE_ENDED, SELLER_CHANGED or REFUND for a reversal; null for an earning. */
  reason: string | null;
  reversesId: string | null;
  /** A payroll run has claimed the row (it can no longer be part of another draft). */
  claimed: boolean;
  invoiceLineId: string;
  createdAt: string;
}

export interface InvoiceEarningLine {
  lineId: string;
  kind: 'SERVICE' | 'PRODUCT' | 'COMBO_PURCHASE';
  name: string;
  /** The KTV (service line) or the seller in force (product line), if any. */
  person: PayActorRef | null;
  /** Product lines only: the seller on the invoice line, when an override has changed it. */
  originalSeller: PayActorRef | null;
}

export interface InvoiceEarningsResponse {
  invoiceId: string;
  invoiceCode: string;
  status: 'DRAFT' | 'PENDING_PAYMENT' | 'PAID' | 'CANCELLED';
  lines: InvoiceEarningLine[];
  items: PayEarningItem[];
  canCorrectSeller: boolean;
}

export interface SellerCorrectionRequest {
  employeeUserId: string;
  reason: string;
}

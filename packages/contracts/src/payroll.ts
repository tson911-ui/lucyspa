/**
 * Phase 7 Wave B (docs/PHASE7_PAYROLL_FUNDS.md 4.3; P7-T3, P7-T11, P7-T14): the monthly payroll run. One run per calendar month for the whole
 * shop, `DRAFT -> CLOSED -> PAID`, never backwards. The draft is built from the sources (base salary in force on the last day of the month,
 * tour and commission earned, collaborator work, tips) and can be rebuilt while it is a draft; bonuses, adjustments and deductions are typed
 * by a person with a reason and are never edited (only voided with a reason). Reading needs MANAGE_PAYROLL or APPROVE_PAYROLL (GLOBAL);
 * building and changing the draft needs MANAGE_PAYROLL. Nothing here pays anyone. Money is a decimal string (signed where it can be negative).
 */
export const PAY_RUN_STATUSES = ['DRAFT', 'CLOSED', 'PAID'] as const;
export type PayRunStatusName = (typeof PAY_RUN_STATUSES)[number];

export const PAY_RUN_ITEM_KINDS = [
  'BASE_SALARY',
  'TOUR',
  'COMMISSION',
  'CTV_WORK',
  'TIP',
  'BONUS',
  'ADJUSTMENT',
  'DEDUCTION',
  'ADVANCE_RECOVERY',
] as const;
export type PayRunItemKindName = (typeof PAY_RUN_ITEM_KINDS)[number];

/** The items a person types by hand. */
export const PAY_MANUAL_ITEM_KINDS = ['BONUS', 'ADJUSTMENT', 'DEDUCTION'] as const;
export type PayManualItemKindName = (typeof PAY_MANUAL_ITEM_KINDS)[number];

/** Something a person should look at before the run is closed. */
export const PAY_LINE_WARNINGS = [
  'UNCONFIRMED_BASE',
  'NO_BASE',
  'CTV_UNAGREED',
  'NEGATIVE_NET',
] as const;
export type PayLineWarningName = (typeof PAY_LINE_WARNINGS)[number];

/** A payment day may be set this many days after the end of the period. */
export const PAY_PAYMENT_DAY_MAX_DAYS = 120;

export interface PayRunSummary {
  id: string;
  /** `YYYY-MM` */
  month: string;
  status: PayRunStatusName;
  /** The day the payslips (and the tips) are paid out; null until the Owner chooses it. */
  paymentDay: string | null;
  version: number;
  people: number;
  /** Net pay of the run (everything except tips), signed. */
  payVnd: string;
  tipsVnd: string;
}

export interface PayRunListResponse {
  today: string;
  items: PayRunSummary[];
  canManage: boolean;
  /** The first month that can start a run (the month of go-live), or null while the cash book and payroll have not started. */
  firstMonth: string | null;
  /** The month a new run would be for by default (the earliest month without a run, up to the current month), or null. */
  suggestedMonth: string | null;
}

export interface PayRunItemView {
  id: string;
  kind: PayRunItemKindName;
  /** Signed. */
  amountVnd: string;
  generated: boolean;
  /** How many sources it sums (services, sales, occurrences, tips); null for base salary and manual items. */
  quantity: number | null;
  /** The part of the amount that belongs to earlier periods (late items). */
  lateVnd: string;
  flag: 'UNCONFIRMED_BASE' | 'NO_BASE' | 'UNAGREED' | null;
  note: string | null;
  /** ADVANCE_RECOVERY only: the advance it takes back. */
  advanceId: string | null;
  reason: string | null;
  voided: boolean;
  voidReason: string | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface PayRunLineView {
  id: string;
  employee: { id: string; name: string; code: string };
  /** The classification on the last day of the month. */
  classification: 'OFFICIAL_EMPLOYEE' | 'COLLABORATOR' | 'TRAINEE' | 'ENDED' | null;
  items: PayRunItemView[];
  /** Everything except tips, voided items left out. */
  netVnd: string;
  tipsVnd: string;
  warnings: PayLineWarningName[];
  /** Read-only context for the person who decides (nothing is deducted automatically). */
  context: { attendanceDays: number; leaveDays: number };
}

export interface PayRunWarnings {
  unconfirmedBase: number;
  noBase: number;
  ctvUnagreed: number;
  negativeNet: number;
  noPaymentDay: boolean;
  /** Daily cash counts of the month with a difference (context only; never a deduction). */
  cashDifferences: number;
}

export interface PayRunDetailResponse {
  run: PayRunSummary & {
    periodFrom: string;
    periodTo: string;
    refreshedAt: string | null;
    createdBy: { id: string; name: string };
    closedAt: string | null;
  };
  lines: PayRunLineView[];
  totals: { payVnd: string; tipsVnd: string; people: number; byKind: Record<string, string> };
  warnings: PayRunWarnings;
  /** True when the sources have changed since the draft was last built (a refresh would change it). */
  stale: boolean;
  canManage: boolean;
  /** May the signed-in person close the run and pay the payslips? (APPROVE_PAYROLL) */
  canApprove: boolean;
}

export interface PayRunCreateRequest {
  /** `YYYY-MM` */
  month: string;
}

export interface PayRunRefreshRequest {
  expectedVersion: number;
}

export interface PayRunPaymentDayRequest {
  expectedVersion: number;
  paymentDay: string;
}

export interface PayRunItemRequest {
  employeeUserId: string;
  kind: PayManualItemKindName;
  /** BONUS and DEDUCTION: a positive amount (a deduction is stored as a negative); ADJUSTMENT: signed, never 0. */
  amountVnd: string;
  reason: string;
  clientRequestId: string;
}

export interface PayRunItemVoidRequest {
  expectedVersion: number;
  reason: string;
}

// ------------------------------------------------------------------------------------------------ closing, payslips, paying
/**
 * P7-14 (design 4.3; P7-T3, P7-T10, P7-T12). Closing is the Owner's approval (APPROVE_PAYROLL + a fresh password): it freezes the run, takes the
 * earnings, tips and collaborator work it shows (nothing else can change them afterwards) and makes one payslip per person with its own printed
 * totals; nobody is paid. A payslip is marked paid by a separate act (APPROVE_PAYROLL + a fresh password, not before the payment day) that writes
 * the fund outflows in the same transaction: net pay and tips are two separate amounts and two separate entries. A mistaken paid mark is
 * reversed by an explicit record (the book gets correcting entries); the run is never reopened and the correction is an adjustment in the next run.
 */
export const PAYSLIP_STATUSES = ['PENDING', 'PAID', 'REVERSED'] as const;
export type PayslipStatusName = (typeof PAYSLIP_STATUSES)[number];

export interface PayRunCloseRequest {
  expectedVersion: number;
}

export interface PayslipSummary {
  id: string;
  runId: string;
  /** `YYYY-MM` */
  month: string;
  employee: { id: string; name: string; code: string };
  /** Everything except tips; never negative on a payslip. */
  netVnd: string;
  /** Tips owed, a separate amount paid out with the payslip. */
  tipsVnd: string;
  status: PayslipStatusName;
  paymentDay: string | null;
  paidAt: string | null;
  version: number;
}

export interface PayslipView extends PayslipSummary {
  periodFrom: string;
  periodTo: string;
  /** The items as they were when the run was closed (voided ones left out), tips last. */
  items: PayRunItemView[];
  paidBy: { id: string; name: string } | null;
  paidFund: { id: string; name: string } | null;
  reversedAt: string | null;
  reversedBy: { id: string; name: string } | null;
  reversalReason: string | null;
}

export interface PayslipListResponse {
  run: PayRunSummary & { periodFrom: string; periodTo: string; closedAt: string | null };
  items: PayslipSummary[];
  /** The funds a payslip can be paid from, and whether the signed-in person may pay. */
  funds: { id: string; name: string; kind: 'CASH' | 'BANK'; balanceVnd: string }[];
  canPay: boolean;
  /** Today is on or after the payment day (paying earlier is refused). */
  payable: boolean;
}

export interface PayslipPayRequest {
  expectedVersion: number;
  fundId: string;
  /** The payslips to pay; null pays every pending one of the run. */
  payslipIds: string[] | null;
  clientRequestId: string;
}

export interface PayslipReverseRequest {
  expectedVersion: number;
  reason: string;
}

export interface MyPayslipsResponse {
  items: PayslipSummary[];
}

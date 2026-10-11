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

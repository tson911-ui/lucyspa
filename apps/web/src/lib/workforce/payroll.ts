import {
  CASH_AMOUNT_MAX_VND,
  PAY_PAYMENT_DAY_MAX_DAYS,
  PAY_REASON_MAX,
  type PayManualItemKindName,
  type PayRunDetailResponse,
  type PayRunItemRequest,
  type PayRunListResponse,
  type PayslipSummary,
  type SalaryAdvanceItem,
  type SalaryAdvanceRequest,
} from '@lucy-spa/contracts';
import { payrollDictionary } from '../../i18n/payroll';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { errorMessage } from './workflows';

/**
 * Phase 7 Wave B (P7-15): the logic behind the payroll, payslip and advance screens, kept apart from the markup so it is tested without a
 * browser. Money travels as a decimal string (the API's format); amounts are only turned into numbers for display arithmetic.
 */
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** `2026-10` -> `10/2026`. */
export function monthLabel(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  return match ? `${match[2]}/${match[1]}` : month;
}

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The months a new run can be made for: from the month of go-live up to the current one, without a run yet; the suggested one first. */
export function monthsToCreate(
  list: Pick<PayRunListResponse, 'today' | 'items' | 'firstMonth'>,
): string[] {
  if (!list.firstMonth) return [];
  const taken = new Set(list.items.map((item) => item.month));
  const current = list.today.slice(0, 7);
  const out: string[] = [];
  let cursor = list.firstMonth;
  while (cursor <= current && out.length < 36) {
    if (!taken.has(cursor)) out.push(cursor);
    const [year, month] = cursor.split('-').map(Number) as [number, number];
    cursor = new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 7);
  }
  return out;
}

/** The first and last day a payment day may be chosen for a run of the given month. */
export function paymentDayWindow(month: string): { min: string; max: string } {
  const first = `${month}-01`;
  const [year, number] = month.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(year, number, 0)).toISOString().slice(0, 10);
  return { min: first, max: shiftDay(last, PAY_PAYMENT_DAY_MAX_DAYS) };
}

export function validPaymentDay(value: string, month: string): boolean {
  if (!DATE.test(value) || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value)
    return false;
  const window = paymentDayWindow(month);
  return value >= window.min && value <= window.max;
}

// ------------------------------------------------------------------------------------------------ amounts
/**
 * Whole dong typed by a person: digits with optional thousands separators (dot, comma or space), and, when allowed, a leading minus (− or -).
 * Returns the API's string (never "-0"), or null when it is not a valid amount.
 */
export function parseVnd(text: string, options: { negative?: boolean } = {}): string | null {
  const cleaned = text
    .trim()
    .replace(/[\s.,]/g, '')
    .replace('−', '-');
  const match = /^(-?)([1-9]\d{0,14})$/.exec(cleaned);
  if (!match) return null;
  if (match[1] === '-' && !options.negative) return null;
  if (BigInt(match[2]!) > BigInt(CASH_AMOUNT_MAX_VND)) return null;
  return `${match[1]}${match[2]}`;
}

export function amountNumber(value: string): number {
  return /^-?\d{1,15}$/.test(value) ? Number(value) : 0;
}

// ------------------------------------------------------------------------------------------------ the forms
export interface ItemDraft {
  employeeUserId: string;
  kind: PayManualItemKindName;
  amount: string;
  reason: string;
}

export function itemProblems(draft: ItemDraft): string[] {
  const problems: string[] = [];
  if (draft.employeeUserId === '') problems.push('employee');
  if (parseVnd(draft.amount, { negative: draft.kind === 'ADJUSTMENT' }) === null)
    problems.push('amount');
  if (draft.reason.trim().length === 0 || draft.reason.trim().length > PAY_REASON_MAX)
    problems.push('reason');
  return problems;
}

export function itemBody(draft: ItemDraft, clientRequestId: string): PayRunItemRequest | null {
  if (itemProblems(draft).length > 0) return null;
  return {
    employeeUserId: draft.employeeUserId,
    kind: draft.kind,
    amountVnd: parseVnd(draft.amount, { negative: draft.kind === 'ADJUSTMENT' })!,
    reason: draft.reason.trim(),
    clientRequestId,
  };
}

export const reasonMissing = (text: string): boolean => {
  const value = text.trim();
  return value.length === 0 || value.length > PAY_REASON_MAX;
};

export interface AdvanceDraft {
  employeeUserId: string;
  amount: string;
  reason: string;
}

export function advanceProblems(draft: AdvanceDraft, limitVnd: string | null): string[] {
  const problems: string[] = [];
  if (draft.employeeUserId === '') problems.push('employee');
  const amount = parseVnd(draft.amount);
  if (amount === null || (limitVnd !== null && BigInt(amount) > BigInt(limitVnd)))
    problems.push('amount');
  if (reasonMissing(draft.reason)) problems.push('reason');
  return problems;
}

export function advanceBody(
  draft: AdvanceDraft,
  limitVnd: string | null,
  clientRequestId: string,
): SalaryAdvanceRequest | null {
  if (advanceProblems(draft, limitVnd).length > 0) return null;
  return {
    employeeUserId: draft.employeeUserId,
    amountVnd: parseVnd(draft.amount)!,
    reason: draft.reason.trim(),
    clientRequestId,
  };
}

// ------------------------------------------------------------------------------------------------ closing and paying
export type CloseBlocker = 'paymentDay' | 'base' | 'negative' | 'lines' | 'stale';

/** What stops a draft from being closed (the API refuses the same things again). */
export function closeBlockers(
  view: Pick<PayRunDetailResponse, 'run' | 'lines' | 'warnings' | 'stale'>,
): CloseBlocker[] {
  const out: CloseBlocker[] = [];
  if (view.run.paymentDay === null) out.push('paymentDay');
  if (view.warnings.unconfirmedBase > 0 || view.warnings.noBase > 0) out.push('base');
  if (view.warnings.negativeNet > 0) out.push('negative');
  if (view.lines.length === 0) out.push('lines');
  if (view.stale) out.push('stale');
  return out;
}

/** What paying the chosen payslips (all pending ones when `selected` is null) takes out of the fund. */
export function payTotal(
  slips: readonly PayslipSummary[],
  selected: ReadonlySet<string> | null,
): bigint {
  let total = 0n;
  for (const slip of slips) {
    if (slip.status !== 'PENDING') continue;
    if (selected !== null && !selected.has(slip.id)) continue;
    total += BigInt(slip.netVnd) + BigInt(slip.tipsVnd);
  }
  return total;
}

/** What an advance still owes and may be written off. */
export function advanceCan(
  item: SalaryAdvanceItem,
  flags: { canRequest: boolean; canApprove: boolean },
) {
  return {
    approve: flags.canApprove && item.status === 'REQUESTED',
    cancel:
      (flags.canRequest || flags.canApprove) &&
      (item.status === 'REQUESTED' || item.status === 'APPROVED'),
    pay: flags.canApprove && item.status === 'APPROVED',
    writeOff: flags.canApprove && item.status === 'PAID' && BigInt(item.outstandingVnd) > 0n,
  };
}

/** The words for a refusal of a payroll command: the feature's own messages first, then the shared ones. */
export function payrollErrorMessage(
  error: unknown,
  t: WorkforceDictionary,
  locale: Locale,
): string {
  const texts = payrollDictionary(locale).errors;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

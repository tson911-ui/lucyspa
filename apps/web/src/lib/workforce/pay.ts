import {
  CASH_AMOUNT_MAX_VND,
  COMMISSION_PERCENT_MAX_BP,
  PAY_BACKDATE_DAYS,
  PAY_FUTURE_DAYS,
  PAY_REASON_MAX,
  type CommissionKindNameValue,
  type CommissionRuleItem,
  type CommissionRuleRequest,
  type CommissionScopeNameValue,
  type SalaryVersionRequest,
  type TipMethodName,
  type TipRequest,
  type TourRuleRequest,
} from '@lucy-spa/contracts';
import { payDictionary } from '../../i18n/pay';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { canAnywhere, canGlobal, type Account } from './permissions';
import { errorMessage } from './workflows';

/**
 * Phase 7 Wave B (P7-11): the logic behind the pay configuration screens and the tip panel, kept apart from the markup so it is tested
 * without a browser. Money travels as a decimal string (the API's format); the screens hold whole dong as numbers only inside the money
 * input. A commission percentage is typed as a percent and travels as basis points (5% = "500").
 */
export const PAY_TAB_IDS = ['salaries', 'tour', 'commission', 'codes'] as const;
export type PayTabId = (typeof PAY_TAB_IDS)[number];

export const PAY_PAGE_DEFAULTS = { tab: 'salaries', q: '', missing: '', scope: '', state: '' };
export type PayPageState = typeof PAY_PAGE_DEFAULTS;

/** The tabs a person can open: the rules and codes need a shop-wide pay permission, salaries also open to branch pay permissions. */
export function payTabsFor(account: Account): PayTabId[] {
  const shopWide =
    canGlobal(account, 'MANAGE_PAY_RULES') ||
    canGlobal(account, 'MANAGE_PAYROLL') ||
    canGlobal(account, 'APPROVE_PAYROLL');
  const salaries =
    shopWide ||
    canAnywhere(account, 'VIEW_EMPLOYEE_PAY') ||
    canAnywhere(account, 'MANAGE_EMPLOYEE_PAY');
  return [
    ...(salaries ? (['salaries'] as const) : []),
    ...(shopWide ? (['tour', 'commission', 'codes'] as const) : []),
  ];
}

export function normalizePayPage(state: PayPageState, tabs: readonly PayTabId[]): PayPageState {
  return {
    tab: (tabs as readonly string[]).includes(state.tab) ? state.tab : (tabs[0] ?? 'salaries'),
    q: state.q.slice(0, 80),
    missing: state.missing === '1' ? '1' : '',
    scope: (['SHOP', 'BRAND', 'CATEGORY', 'PRODUCT'] as string[]).includes(state.scope)
      ? state.scope
      : '',
    state: (['CURRENT', 'UPCOMING', 'REPLACED'] as string[]).includes(state.state)
      ? state.state
      : '',
  };
}

/** Keys that clear the search and filters when the tab changes. */
export const PAY_RESET_KEYS: readonly string[] = ['q', 'missing', 'scope', 'state'];

/** A whole-dong amount from the money input to the API's string (null = nothing typed). */
export function vndString(value: number | null): string | null {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
  return value > CASH_AMOUNT_MAX_VND ? null : String(value);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function shiftDay(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The first and last day a pay line may start on (rules may start ahead; a salary may not). */
export function startWindow(today: string, future: boolean): { min: string; max: string } {
  return {
    min: shiftDay(today, -PAY_BACKDATE_DAYS),
    max: future ? shiftDay(today, PAY_FUTURE_DAYS) : today,
  };
}

export function validStart(value: string, today: string, future: boolean): boolean {
  if (!DATE.test(value)) return false;
  if (new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) return false;
  const window = startWindow(today, future);
  return value >= window.min && value <= window.max;
}

const cleanReason = (text: string): string | null => {
  const value = text.trim();
  return value === '' ? null : value;
};

// ------------------------------------------------------------------------------------------------ percent <-> basis points
/** "5" -> "500", "2,5" -> "250", "12.34" -> "1234"; null when it is not a percentage of 0 to 100 with at most 2 decimals. */
export function percentToBasisPoints(text: string): string | null {
  const match = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  const whole = Number(match[1]);
  const basis = whole * 100 + Number((match[2] ?? '').padEnd(2, '0') || '0');
  return basis > COMMISSION_PERCENT_MAX_BP ? null : String(basis);
}

/** "500" -> "5", "250" -> "2.5" (or "2,5" in Vietnamese), "1234" -> "12.34". */
export function basisPointsToPercent(basis: string, locale: Locale): string {
  const value = Number(basis);
  if (!Number.isInteger(value) || value < 0) return basis;
  const whole = Math.floor(value / 100);
  const rest = String(value % 100)
    .padStart(2, '0')
    .replace(/0+$/, '');
  return rest === '' ? String(whole) : `${whole}${locale === 'vi' ? ',' : '.'}${rest}`;
}

/** The rule's value in words: "5% giá trị dòng hàng", "7.000 ₫ mỗi sản phẩm", or "Không trả" for 0. */
export function commissionValueText(
  rule: Pick<CommissionRuleItem, 'kind' | 'value'>,
  locale: Locale,
  money: (amount: string) => string,
): string {
  const c = payDictionary(locale).commission;
  if (rule.value === '0') return c.zero;
  return rule.kind === 'PERCENT'
    ? c.percent.replace('{value}', basisPointsToPercent(rule.value, locale))
    : c.perUnit.replace('{amount}', money(rule.value));
}

/** What the rule applies to, in words: "Cả cửa hàng", "Thương hiệu: Dior"... */
export function commissionScopeText(
  rule: Pick<CommissionRuleItem, 'scope' | 'target'>,
  locale: Locale,
): string {
  const c = payDictionary(locale);
  const scope = c.scopes[rule.scope];
  return rule.target ? `${scope}: ${rule.target.name}` : scope;
}

// ------------------------------------------------------------------------------------------------ the forms
export interface SalaryDraft {
  amount: number | null;
  from: string;
  reason: string;
}

export function salaryProblems(draft: SalaryDraft, today: string): string[] {
  const problems: string[] = [];
  if (vndString(draft.amount) === null) problems.push('amount');
  if (!validStart(draft.from, today, false)) problems.push('from');
  if (draft.reason.trim().length > PAY_REASON_MAX) problems.push('reason');
  return problems;
}

export function salaryBody(
  employeeUserId: string,
  draft: SalaryDraft,
  today: string,
): SalaryVersionRequest | null {
  if (salaryProblems(draft, today).length > 0) return null;
  return {
    employeeUserId,
    amountVnd: vndString(draft.amount),
    effectiveFrom: draft.from,
    reason: cleanReason(draft.reason),
  };
}

export interface TourDraft {
  amount: number | null;
  from: string;
  reason: string;
}

export function tourProblems(draft: TourDraft, today: string): string[] {
  const problems: string[] = [];
  if (vndString(draft.amount) === null) problems.push('amount');
  if (!validStart(draft.from, today, true)) problems.push('from');
  if (draft.reason.trim().length > PAY_REASON_MAX) problems.push('reason');
  return problems;
}

export function tourBody(
  serviceId: string,
  draft: TourDraft,
  today: string,
): TourRuleRequest | null {
  if (tourProblems(draft, today).length > 0) return null;
  return {
    serviceId,
    amountVnd: vndString(draft.amount)!,
    effectiveFrom: draft.from,
    reason: cleanReason(draft.reason),
  };
}

export interface CommissionDraft {
  scope: CommissionScopeNameValue;
  targetId: string;
  employeeUserId: string;
  kind: CommissionKindNameValue;
  percent: string;
  amount: number | null;
  from: string;
  reason: string;
}

export function commissionProblems(draft: CommissionDraft, today: string): string[] {
  const problems: string[] = [];
  if (draft.scope !== 'SHOP' && draft.targetId === '') problems.push('target');
  if (
    draft.kind === 'PERCENT'
      ? percentToBasisPoints(draft.percent) === null
      : vndString(draft.amount) === null
  ) {
    problems.push('value');
  }
  if (!validStart(draft.from, today, true)) problems.push('from');
  if (draft.reason.trim().length > PAY_REASON_MAX) problems.push('reason');
  return problems;
}

export function commissionBody(
  draft: CommissionDraft,
  today: string,
): CommissionRuleRequest | null {
  if (commissionProblems(draft, today).length > 0) return null;
  return {
    scope: draft.scope,
    targetId: draft.scope === 'SHOP' ? null : draft.targetId,
    employeeUserId: draft.employeeUserId === '' ? null : draft.employeeUserId,
    kind: draft.kind,
    value:
      draft.kind === 'PERCENT' ? percentToBasisPoints(draft.percent)! : vndString(draft.amount)!,
    effectiveFrom: draft.from,
    reason: cleanReason(draft.reason),
  };
}

export interface TipDraft {
  employeeUserId: string;
  amount: number | null;
  method: TipMethodName;
}

export function tipProblems(draft: TipDraft): string[] {
  const problems: string[] = [];
  if (draft.employeeUserId === '') problems.push('employee');
  if (vndString(draft.amount) === null || draft.amount === 0) problems.push('amount');
  return problems;
}

export function tipBody(
  invoiceId: string,
  draft: TipDraft,
  clientRequestId: string,
): TipRequest | null {
  if (tipProblems(draft).length > 0) return null;
  return {
    invoiceId,
    employeeUserId: draft.employeeUserId,
    amountVnd: vndString(draft.amount)!,
    method: draft.method,
    clientRequestId,
  };
}

/** A required reason of at most 500 characters (reversals, resets and seller changes). */
export function reasonProblem(text: string): boolean {
  const value = text.trim();
  return value.length === 0 || value.length > PAY_REASON_MAX;
}

/** The words for a refusal of a pay command: the feature's own messages first, then the shared ones. */
export function payErrorMessage(error: unknown, t: WorkforceDictionary, locale: Locale): string {
  const texts = payDictionary(locale).errors;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

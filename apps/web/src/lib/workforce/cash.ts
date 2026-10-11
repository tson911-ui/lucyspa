import {
  CASH_AMOUNT_MAX_VND,
  CASH_MANUAL_KINDS,
  type CashBranchAccess,
  type CashCloseRequest,
  type CashFundItem,
  type CashGoLiveRequest,
  type CashManualEntryRequest,
  type CashManualKind,
  type CashTransferRequest,
} from '@lucy-spa/contracts';
import { cashDictionary } from '../../i18n/cash';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { normalizePage } from './list-view';
import { errorMessage } from './workflows';

/**
 * Phase 7 Wave A (P7-6): the logic behind the cash book screens, kept apart from the markup so it is tested without a browser.
 * Money travels as a decimal string (the API's format); the screens hold whole dong as numbers only inside the money input.
 */
export const CASH_TAB_IDS = ['book', 'closing', 'reconcile'] as const;
export type CashTabId = (typeof CASH_TAB_IDS)[number];

export const CASH_PAGE_DEFAULTS = {
  tab: 'book',
  fund: '',
  page: 1,
  category: '',
  direction: '',
  from: '',
  to: '',
};
export type CashPageState = typeof CASH_PAGE_DEFAULTS;

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: string): string => (DATE.test(value) ? value : '');

export function normalizeCashPage(state: CashPageState): CashPageState {
  const from = validDate(state.from);
  const to = validDate(state.to);
  return {
    tab: (CASH_TAB_IDS as readonly string[]).includes(state.tab) ? state.tab : 'book',
    fund: state.fund,
    page: normalizePage(state.page),
    category: state.category,
    direction: state.direction === 'IN' || state.direction === 'OUT' ? state.direction : '',
    from,
    to: from !== '' && to !== '' && to < from ? '' : to,
  };
}

/** Keys that return to page 1 when a filter or the fund changes. */
export const CASH_RESET_KEYS: readonly string[] = ['page'];

/** A whole-dong amount from the money input to the API's string (null = nothing typed). */
export function vndString(value: number | null): string | null {
  if (value === null || !Number.isSafeInteger(value) || value < 0) return null;
  return value > CASH_AMOUNT_MAX_VND ? null : String(value);
}

/** The API's amount string as a number for display arithmetic (every amount of the cash book is far below 2^53). */
export function vndNumber(value: string): number {
  return /^-?\d{1,15}$/.test(value) ? Number(value) : 0;
}

/** `12000` -> `12.000 ₫`; a negative amount keeps its minus sign in front. */
export function signedVnd(value: string | number, locale: Locale): string {
  const amount = typeof value === 'number' ? value : vndNumber(value);
  const grouped = String(Math.abs(Math.trunc(amount))).replace(
    /\B(?=(\d{3})+(?!\d))/g,
    locale === 'vi' ? '.' : ',',
  );
  return `${amount < 0 ? '−' : ''}${grouped} ₫`;
}

/** The funds a person may write to, in the order the screen offers them. */
export function writableFunds(
  funds: readonly CashFundItem[],
  branches: readonly CashBranchAccess[],
): CashFundItem[] {
  const manage = new Set(branches.filter((entry) => entry.manage).map((entry) => entry.branch.id));
  return funds.filter((fund) =>
    fund.kind === 'BANK'
      ? branches.length > 0 && branches.every((entry) => entry.manage)
      : fund.branch !== null && manage.has(fund.branch.id),
  );
}

/** What a person may do with one fund (the API decides again on every command). */
export function fundCan(
  fund: CashFundItem,
  branches: readonly CashBranchAccess[],
): { record: boolean; deposit: boolean; transfer: boolean } {
  if (fund.kind === 'BANK') {
    const manage = branches.length > 0 && branches.every((entry) => entry.manage);
    return { record: manage, deposit: false, transfer: manage };
  }
  const access = branches.find((entry) => entry.branch.id === fund.branch?.id);
  return {
    record: access?.manage ?? false,
    deposit: access?.deposit ?? false,
    transfer: access?.manage ?? false,
  };
}

/** The entry kinds a person may choose on a fund: a collector only hands cash in; the bank takes no deposit. */
export function entryKinds(options: {
  fund: CashFundItem;
  canRecord: boolean;
  canDeposit: boolean;
}): CashManualKind[] {
  const { fund, canRecord, canDeposit } = options;
  return CASH_MANUAL_KINDS.filter((kind) => {
    if (kind === 'DEPOSIT') return fund.kind === 'CASH' && (canDeposit || canRecord);
    return canRecord;
  });
}

// ---------------------------------------------------------------------------------------------- the forms
export interface EntryDraft {
  kind: CashManualKind;
  amount: number | null;
  reason: string;
  branchId: string;
}

export function entryProblems(draft: EntryDraft, bank: boolean): string[] {
  const problems: string[] = [];
  if (vndString(draft.amount) === null || draft.amount === 0) problems.push('amount');
  if (draft.reason.trim().length === 0 || draft.reason.trim().length > 500) problems.push('reason');
  if (bank && draft.branchId === '') problems.push('branch');
  return problems;
}

export function entryBody(
  fundId: string,
  draft: EntryDraft,
  bank: boolean,
  clientRequestId: string,
): CashManualEntryRequest | null {
  const amount = vndString(draft.amount);
  if (amount === null || entryProblems(draft, bank).length > 0) return null;
  return {
    fundId,
    kind: draft.kind,
    amountVnd: amount,
    reason: draft.reason.trim(),
    clientRequestId,
    ...(bank ? { branchId: draft.branchId } : {}),
  };
}

export interface TransferDraft {
  fromFundId: string;
  toFundId: string;
  amount: number | null;
  reason: string;
}

export function transferProblems(draft: TransferDraft): string[] {
  const problems: string[] = [];
  if (draft.fromFundId === '') problems.push('from');
  if (draft.toFundId === '' || draft.toFundId === draft.fromFundId) problems.push('to');
  if (vndString(draft.amount) === null || draft.amount === 0) problems.push('amount');
  if (draft.reason.trim().length === 0 || draft.reason.trim().length > 500) problems.push('reason');
  return problems;
}

export function transferBody(
  draft: TransferDraft,
  clientRequestId: string,
): CashTransferRequest | null {
  const amount = vndString(draft.amount);
  if (amount === null || transferProblems(draft).length > 0) return null;
  return {
    fromFundId: draft.fromFundId,
    toFundId: draft.toFundId,
    amountVnd: amount,
    reason: draft.reason.trim(),
    clientRequestId,
  };
}

/** A cash fund and the bank fund are the only valid pair: one side of a transfer is always a cash fund. */
export function transferTargets(
  funds: readonly CashFundItem[],
  fromFundId: string,
): CashFundItem[] {
  const from = funds.find((fund) => fund.id === fromFundId);
  if (!from) return [];
  return funds.filter((fund) => fund.id !== from.id && fund.kind !== from.kind);
}

export interface GoLiveDraft {
  branches: Record<string, number | null>;
  bank: number | null;
}

export function goLiveBody(
  draft: GoLiveDraft,
  activeBranchIds: readonly string[],
): CashGoLiveRequest | null {
  const bank = vndString(draft.bank);
  if (bank === null) return null;
  const branches: CashGoLiveRequest['branches'] = [];
  for (const branchId of activeBranchIds) {
    const counted = vndString(draft.branches[branchId] ?? null);
    if (counted === null) return null;
    branches.push({ branchId, countedVnd: counted });
  }
  return { branches, bankVnd: bank };
}

export interface CloseDraft {
  date: string;
  counted: number | null;
  withdrawal: number | null;
  reason: string;
}

/** What the screen shows while the person types: the difference, what stays, and what still blocks the button. */
export function closingFigures(expected: number, draft: CloseDraft) {
  const counted = draft.counted ?? 0;
  const withdrawal = draft.withdrawal ?? 0;
  const difference = draft.counted === null ? 0 : counted - expected;
  return {
    difference,
    nextFloat: counted - withdrawal,
    needsReason: draft.counted !== null && difference !== 0,
    withdrawalTooBig: withdrawal > counted,
  };
}

export function closeProblems(expected: number, draft: CloseDraft): string[] {
  const figures = closingFigures(expected, draft);
  const problems: string[] = [];
  if (!DATE.test(draft.date)) problems.push('date');
  if (vndString(draft.counted) === null) problems.push('counted');
  if (draft.withdrawal !== null && vndString(draft.withdrawal) === null)
    problems.push('withdrawal');
  if (figures.withdrawalTooBig) problems.push('withdrawal');
  if (figures.needsReason && draft.reason.trim().length === 0) problems.push('reason');
  if (draft.reason.trim().length > 500) problems.push('reason');
  return problems;
}

export function closeBody(
  expected: number,
  draft: CloseDraft,
  clientRequestId: string,
): CashCloseRequest | null {
  const counted = vndString(draft.counted);
  if (counted === null || closeProblems(expected, draft).length > 0) return null;
  const reason = draft.reason.trim();
  return {
    date: draft.date,
    countedVnd: counted,
    withdrawalVnd: vndString(draft.withdrawal ?? 0) ?? '0',
    reason: reason === '' ? null : reason,
    clientRequestId,
  };
}

const addDay = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Days close in order: the day after the last closing, but never a day that has not come yet. */
export function defaultCloseDate(lastClosedDate: string | null, today: string): string {
  if (lastClosedDate === null || !DATE.test(lastClosedDate)) return today;
  const next = addDay(lastClosedDate, 1);
  return next > today ? today : next;
}

/** The suggested withdrawal: everything above the usual float the owner leaves for the next day (never negative). */
export function suggestedWithdrawal(counted: number | null, defaultFloat: number): number {
  return counted === null ? 0 : Math.max(0, counted - defaultFloat);
}

/** The error text of a cash command: its own codes first, then the shared messages. */
export function cashErrorMessage(error: unknown, t: WorkforceDictionary, locale: Locale): string {
  const texts = cashDictionary(locale).errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

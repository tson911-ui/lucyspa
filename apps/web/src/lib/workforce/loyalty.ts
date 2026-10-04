import type {
  BranchSummary,
  CurrentAccountResponse,
  LoyaltyAdjustmentRequest,
  LoyaltyLedgerEntryResponse,
  LoyaltyTierName,
  LoyaltyWalletName,
} from '@lucy-spa/contracts';
import { LOYALTY_ADJUSTMENT_MAX_POINTS } from '@lucy-spa/contracts';
import { loyaltyDictionary } from '../../i18n/loyalty';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { canAt, canGlobal } from './permissions';
import { errorMessage } from './workflows';

/** Branches where this account may look customers' points up (the API decides again on every call). */
export function loyaltyBranches(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): BranchSummary[] {
  return [...(branches?.values() ?? [])]
    .filter((branch) => branch.isActive && canAt(account, 'VIEW_LOYALTY', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

/** Which tabs of the loyalty page this account is offered (UX hints only; the API authorizes every request). */
export function loyaltyTabs(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): { customers: boolean; exceptions: boolean; goLive: boolean } {
  return {
    customers: loyaltyBranches(account, branches).length > 0,
    exceptions: canGlobal(account, 'VIEW_LOYALTY_EXCEPTIONS'),
    goLive: canGlobal(account, 'ACTIVATE_LOYALTY'),
  };
}

export function tierTone(tier: LoyaltyTierName): 'neutral' | 'info' {
  return tier === 'NONE' ? 'neutral' : 'info';
}

/** Whole points with the locale's grouping; a plus or a true minus sign for adjustments. */
export function formatPoints(points: number, locale: Locale, signed = false): string {
  const text = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(Math.abs(points));
  if (!signed || points === 0) return points < 0 ? `−${text}` : text;
  return points > 0 ? `+${text}` : `−${text}`;
}

/** The error text of a loyalty command: its own codes first, then the shared messages. */
export function loyaltyErrorMessage(
  error: unknown,
  t: WorkforceDictionary,
  locale: Locale,
): string {
  const texts = loyaltyDictionary(locale).errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

export type AdjustDirection = 'add' | 'subtract';

export interface AdjustDraft {
  wallet: LoyaltyWalletName;
  direction: AdjustDirection;
  amount: string;
  reason: string;
}

/** A positive whole number of points within the bound, or null (nothing is sent). */
export function parseAmount(value: string): number | null {
  const text = value.trim();
  if (!/^[1-9][0-9]{0,6}$/.test(text)) return null;
  const amount = Number(text);
  return amount <= LOYALTY_ADJUSTMENT_MAX_POINTS ? amount : null;
}

/** The request body of an adjustment, or null while the draft is incomplete. */
export function adjustmentBody(
  draft: AdjustDraft,
  clientRequestId: string,
  correctsEntryId?: string,
): LoyaltyAdjustmentRequest | null {
  const amount = parseAmount(draft.amount);
  const reason = draft.reason.trim();
  if (amount === null || reason.length === 0 || [...reason].length > 500) return null;
  return {
    wallet: draft.wallet,
    points: draft.direction === 'add' ? amount : -amount,
    reason,
    clientRequestId,
    ...(correctsEntryId ? { correctsEntryId } : {}),
  };
}

/** A correction starts as the opposite of the entry it offsets (the staff member can still change it). */
export function correctionDraft(entry: LoyaltyLedgerEntryResponse): AdjustDraft {
  const points = entry.points - entry.shortfallPoints;
  const taken = Math.abs(entry.points);
  return {
    wallet: entry.wallet,
    direction: points >= 0 ? 'subtract' : 'add',
    amount: String(taken === 0 ? Math.abs(points) : taken),
    reason: '',
  };
}

/** Only an entry that moved the balance, in its own wallet, and has no correction yet can be corrected. */
export function canCorrect(entry: LoyaltyLedgerEntryResponse): boolean {
  return !entry.corrected && entry.kind !== 'MANUAL_CORRECTION' && entry.points !== 0;
}

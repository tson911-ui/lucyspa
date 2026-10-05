import { normalizePage } from './list-view';

/**
 * Address-bar state of the loyalty lists. The API pages them on the server at a fixed 20 rows, so only the
 * page and the filter live in the URL.
 */

export const LOYALTY_PAGE_SIZE = 20;
export const LOYALTY_TAB_IDS = [
  'customers',
  'referrals',
  'exceptions',
  'combos',
  'comboUsage',
  'birthday',
  'goLive',
] as const;
export type LoyaltyTabId = (typeof LOYALTY_TAB_IDS)[number];

export const LOYALTY_PAGE_DEFAULTS = { tab: '', page: 1, status: '' };
export type LoyaltyPageState = typeof LOYALTY_PAGE_DEFAULTS;

export function normalizeLoyaltyPage(state: LoyaltyPageState): LoyaltyPageState {
  return {
    tab: (LOYALTY_TAB_IDS as readonly string[]).includes(state.tab) ? state.tab : '',
    page: normalizePage(state.page),
    // The referral list filter (Phase 5 P5-5).
    status: state.status === 'PENDING' || state.status === 'REWARDED' ? state.status : '',
  };
}

export const LEDGER_DEFAULTS = { wallet: '', page: 1 };
export type LedgerState = typeof LEDGER_DEFAULTS;

export function normalizeLedger(state: LedgerState): LedgerState {
  return {
    wallet: state.wallet === 'SPA' || state.wallet === 'BEAUTY' ? state.wallet : '',
    page: normalizePage(state.page),
  };
}

/** Keys that return to page 1 when the tab or the filter changes. */
export const LOYALTY_RESET_KEYS: readonly string[] = ['page'];

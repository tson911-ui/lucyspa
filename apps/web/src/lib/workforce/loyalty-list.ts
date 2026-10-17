import { COMBO_SOLD_STATUSES } from '@lucy-spa/contracts';
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
  'comboSold',
  'rewardDesk',
  'rewardCatalog',
  'birthday',
  'goLive',
] as const;
export type LoyaltyTabId = (typeof LOYALTY_TAB_IDS)[number];

/**
 * Owner answer 5 (session 10): the ten sections are grouped by task into six tabs. The address bar keeps the section id
 * (`?tab=comboSold`), so every link written before the grouping still opens the same screen; the group is derived from it.
 */
export const LOYALTY_GROUPS = [
  { id: 'members', tabs: ['customers'] },
  { id: 'rewards', tabs: ['rewardDesk', 'rewardCatalog'] },
  { id: 'combos', tabs: ['combos', 'comboSold', 'comboUsage'] },
  { id: 'referrals', tabs: ['referrals', 'birthday'] },
  { id: 'exceptions', tabs: ['exceptions'] },
  { id: 'goLive', tabs: ['goLive'] },
] as const satisfies readonly { id: string; tabs: readonly LoyaltyTabId[] }[];
export type LoyaltyGroupId = (typeof LOYALTY_GROUPS)[number]['id'];

/** The group of a section. */
export function loyaltyGroupOf(tab: LoyaltyTabId): LoyaltyGroupId {
  return LOYALTY_GROUPS.find((group) => (group.tabs as readonly string[]).includes(tab))!.id;
}

/**
 * The groups this account sees (a group shows when at least one of its sections is allowed), each with its allowed
 * sections in order, and the section to open: the requested one when allowed, else the first allowed section.
 */
export function loyaltyGroups(
  shown: Readonly<Record<LoyaltyTabId, boolean>>,
  requested: string,
): {
  groups: { id: LoyaltyGroupId; tabs: LoyaltyTabId[] }[];
  current: LoyaltyTabId | null;
} {
  const groups = LOYALTY_GROUPS.map((group) => ({
    id: group.id,
    tabs: group.tabs.filter((tab) => shown[tab]) as LoyaltyTabId[],
  })).filter((group) => group.tabs.length > 0);
  const allowed = groups.flatMap((group) => group.tabs);
  const current = allowed.find((tab) => tab === requested) ?? allowed[0] ?? null;
  return { groups, current };
}

export const LOYALTY_PAGE_DEFAULTS = { tab: '', page: 1, status: '' };
export type LoyaltyPageState = typeof LOYALTY_PAGE_DEFAULTS;

function normalizeStatus(tab: string, status: string): string {
  if (tab === 'comboSold')
    return (COMBO_SOLD_STATUSES as readonly string[]).includes(status) ? status : '';
  return status === 'PENDING' || status === 'REWARDED' ? status : '';
}

export function normalizeLoyaltyPage(state: LoyaltyPageState): LoyaltyPageState {
  return {
    tab: (LOYALTY_TAB_IDS as readonly string[]).includes(state.tab) ? state.tab : '',
    page: normalizePage(state.page),
    // The status filter belongs to the referral list (Phase 5 P5-5) or to the sold-combos list (P5-10b).
    status: normalizeStatus(state.tab, state.status),
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

/**
 * Phase 5 P5-6: the birthday gift (design `PHASE5_LOYALTY_COMBOS_DESIGN.md` sections 6.3 and 8, and the Owner decisions of
 * 2026-10-04 in 2.5, OQ-8). Money gifts only. The Owner configures one gift (versioned); it ships EMPTY. The gift is a separate
 * layer applied after the single ordinary winner of the best-offer selection, only when loyalty is live and the invoice PAYER
 * has a birthday inside the configured window.
 */

export type BirthdayGiftKindName = 'PERCENT' | 'FIXED_AMOUNT';

/**
 * How the applied gift relates to the ordinary winner of the same invoice:
 * `STACKED` the configuration allows it to combine with that winner's source; `REPLACES_OFFER` it may not combine and its
 * amount is larger than the best offer (the offer is then not used); `ALONE` there was no ordinary winner.
 */
export type BirthdayGiftMode = 'STACKED' | 'REPLACES_OFFER' | 'ALONE';

/** Why a gift in the payer's window was not applied (a stable code; the UI shows a localized text). */
export type BirthdayNotAppliedReason =
  'BELOW_MIN_SPEND' | 'USAGE_LIMIT_REACHED' | 'OFFER_IS_BETTER' | 'NO_AMOUNT';

/** The usage limit is always chosen explicitly: N uses per customer per birthday year, or unlimited. */
export type BirthdayUsageLimit = { mode: 'PER_YEAR'; perYear: number } | { mode: 'UNLIMITED' };

/**
 * The gift on an invoice (`InvoiceDiscountResponse.birthday`). Present only when the payer is a member whose birthday window
 * contains the invoice business date, loyalty is live and the configuration is active; otherwise null (nothing to show).
 */
export interface InvoiceBirthdayGift {
  versionNo: number;
  kind: BirthdayGiftKindName;
  percentBp: number | null;
  fixedAmountVnd: string | null;
  minSpendVnd: string;
  /** The birthday (business date, `YYYY-MM-DD`) the invoice date belongs to; 28 February for a 29 February birthday in a non-leap year. */
  birthdayOn: string;
  /** The amount the gift is computed on: the eligible amount left after the best offer. */
  baseVnd: string;
  /** The gift computed on that base (also shown when it was not applied). */
  amountVnd: string;
  applied: boolean;
  mode: BirthdayGiftMode | null;
  reason: BirthdayNotAppliedReason | null;
}

export interface BirthdayRewardVersionResponse {
  id: string;
  versionNo: number;
  isActive: boolean;
  kind: BirthdayGiftKindName;
  percentBp: number | null;
  fixedAmountVnd: string | null;
  minSpendVnd: string;
  windowDaysBefore: number;
  windowDaysAfter: number;
  combineMember: boolean;
  combinePromotion: boolean;
  combineVoucher: boolean;
  usageLimit: BirthdayUsageLimit;
  createdAt: string;
  createdByName: string;
}

/** GET /api/v1/loyalty/birthday-reward (MANAGE_BIRTHDAY_REWARDS, Owner only). Empty until the Owner saves a first version. */
export interface BirthdayRewardConfigResponse {
  /** False while nothing was ever saved: the module ships empty and no gift exists. */
  configured: boolean;
  /** The current (highest) version; null when never configured. */
  current: BirthdayRewardVersionResponse | null;
  /** Every version, newest first. */
  versions: BirthdayRewardVersionResponse[];
  /** The gift only works once loyalty is live (go-live ON); the screen says so while it is OFF. */
  loyaltyLive: boolean;
}

/**
 * POST /api/v1/loyalty/birthday-reward: saves a NEW version (an edit, an activation and a deactivation are all versions).
 * Every field is required: there is no server default, the usage limit included.
 */
export interface BirthdayRewardSaveRequest {
  /** The version number the Owner edited from (null when none exists yet); a stale value is a conflict. */
  expectedVersionNo: number | null;
  isActive: boolean;
  kind: BirthdayGiftKindName;
  /** PERCENT: basis points 1..10000. */
  percentBp: number | null;
  /** FIXED_AMOUNT: integer VND above 0, as a decimal string. */
  fixedAmountVnd: string | null;
  /** Integer VND, 0 = no minimum spend. */
  minSpendVnd: string;
  windowDaysBefore: number;
  windowDaysAfter: number;
  combineMember: boolean;
  combinePromotion: boolean;
  combineVoucher: boolean;
  usageLimit: BirthdayUsageLimit;
}

/** Window bounds: before + after <= 364 keeps one business date inside at most one birthday (SQL CHECK). */
export const BIRTHDAY_WINDOW_MAX_TOTAL_DAYS = 364;

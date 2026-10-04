/**
 * Phase 5 P5-3: loyalty points and tiers (design `PHASE5_LOYALTY_COMBOS_DESIGN.md` sections 3-5).
 * The tier table is the locked PRD 18.5 table, version 1: a pure function of a wallet balance, never stored as
 * authority. A later table is a new version and never rewrites a snapshot.
 */

export const LOYALTY_TIER_TABLE_VERSION = 1;

export type LoyaltyWalletName = 'SPA' | 'BEAUTY';
export type LoyaltyTierName = 'NONE' | 'SILVER' | 'GOLD' | 'PLATINUM' | 'DIAMOND' | 'RUBY';
export type LoyaltyLedgerKindName =
  'EARN' | 'EARN_REVERSAL' | 'REFERRAL_AWARD' | 'MANUAL_ADJUSTMENT' | 'MANUAL_CORRECTION';

/** Lowest balance of each tier and its Member Discount in basis points (PRD 18.5, version 1). */
export const LOYALTY_TIERS_V1: readonly {
  tier: LoyaltyTierName;
  fromPoints: number;
  memberDiscountBp: number;
}[] = Object.freeze([
  { tier: 'NONE', fromPoints: 0, memberDiscountBp: 0 },
  { tier: 'SILVER', fromPoints: 500, memberDiscountBp: 300 },
  { tier: 'GOLD', fromPoints: 1000, memberDiscountBp: 400 },
  { tier: 'PLATINUM', fromPoints: 3000, memberDiscountBp: 500 },
  { tier: 'DIAMOND', fromPoints: 5000, memberDiscountBp: 700 },
  { tier: 'RUBY', fromPoints: 10000, memberDiscountBp: 900 },
]);

export interface LoyaltyTierStanding {
  tier: LoyaltyTierName;
  memberDiscountBp: number;
  /** The next tier and the points still missing for it; null at the top tier. */
  next: { tier: LoyaltyTierName; pointsToGo: number } | null;
}

/** The tier of a Spa or Beauty balance (whole points, never negative). */
export function loyaltyTierFor(balancePoints: number): LoyaltyTierStanding {
  if (!Number.isSafeInteger(balancePoints) || balancePoints < 0) {
    throw new RangeError('A loyalty balance is a non-negative whole number of points');
  }
  let index = 0;
  LOYALTY_TIERS_V1.forEach((entry, i) => {
    if (balancePoints >= entry.fromPoints) index = i;
  });
  const current = LOYALTY_TIERS_V1[index]!;
  const upper = LOYALTY_TIERS_V1[index + 1];
  return {
    tier: current.tier,
    memberDiscountBp: current.memberDiscountBp,
    next: upper ? { tier: upper.tier, pointsToGo: upper.fromPoints - balancePoints } : null,
  };
}

/** Points earned by a paid invoice: 1,000 VND = 1 point, rounded down once per invoice (P5-Q3). */
export function loyaltyPointsForPaidVnd(totalVnd: bigint): number {
  if (totalVnd < 0n) throw new RangeError('A paid amount is never negative');
  return Number(totalVnd / 1000n);
}

// ---------------------------------------------------------------------------------- admin API

/** Largest manual amount in one adjustment (a sanity bound, not a business rule). */
export const LOYALTY_ADJUSTMENT_MAX_POINTS = 1_000_000;

export interface LoyaltyWalletResponse {
  wallet: LoyaltyWalletName;
  balancePoints: number;
  tier: LoyaltyTierName;
  memberDiscountBp: number;
  nextTier: LoyaltyTierName | null;
  pointsToNextTier: number | null;
}

export interface LoyaltyGoLiveResponse {
  active: boolean;
  goLiveAt: string | null;
  activatedByName: string | null;
}

/** GET /api/v1/loyalty/branches/:branchId/customers/:userId (VIEW_LOYALTY). */
export interface LoyaltyProfileResponse {
  customer: {
    id: string;
    displayName: string;
    phoneMasked: string | null;
    emailMasked: string | null;
  };
  goLive: LoyaltyGoLiveResponse;
  /** Always both wallets (a customer with no entry yet shows 0 and no tier). */
  wallets: LoyaltyWalletResponse[];
  can: { adjust: boolean };
}

export interface LoyaltyLedgerEntryResponse {
  id: string;
  wallet: LoyaltyWalletName;
  kind: LoyaltyLedgerKindName;
  /** Signed points actually applied to the balance. */
  points: number;
  /** Points a negative entry could not take because the balance was too small (P5-Q5). */
  shortfallPoints: number;
  invoiceCode: string | null;
  paidSeq: number | null;
  /** Staff-only text (a customer never sees it, OQ-11). */
  reason: string | null;
  actorName: string | null;
  correctsEntryId: string | null;
  reversesEntryId: string | null;
  /** True once a later linked correction exists for this entry (it can be corrected once). */
  corrected: boolean;
  createdAt: string;
}

/** GET /api/v1/loyalty/branches/:branchId/customers/:userId/ledger?wallet&page (20 per page). */
export interface LoyaltyLedgerPageResponse {
  items: LoyaltyLedgerEntryResponse[];
  page: number;
  pageSize: number;
  total: number;
}

/** POST /api/v1/loyalty/customers/:userId/adjustments (ADJUST_LOYALTY_POINTS, GLOBAL, fresh re-authentication). */
export interface LoyaltyAdjustmentRequest {
  wallet: LoyaltyWalletName;
  /** Signed whole points, never 0. */
  points: number;
  reason: string;
  /** A fresh client UUID per attempt; a replay returns the stored result (design 11.3). */
  clientRequestId: string;
  /** Link to the ledger entry this offsets (PRD 18.4); one correction per entry. */
  correctsEntryId?: string;
}

export interface LoyaltyAdjustmentResponse {
  entry: LoyaltyLedgerEntryResponse;
  wallet: LoyaltyWalletResponse;
  replayed: boolean;
}

export interface LoyaltyExceptionResponse {
  entryId: string;
  customer: { id: string; displayName: string; phoneMasked: string | null };
  wallet: LoyaltyWalletName;
  kind: LoyaltyLedgerKindName;
  /** What the balance could absorb and what it could not. */
  appliedPoints: number;
  shortfallPoints: number;
  invoiceCode: string | null;
  reason: string | null;
  createdAt: string;
}

/** GET /api/v1/loyalty/exceptions?page (VIEW_LOYALTY_EXCEPTIONS, GLOBAL). Read-only. */
export interface LoyaltyExceptionPageResponse {
  items: LoyaltyExceptionResponse[];
  page: number;
  pageSize: number;
  total: number;
}

/** GET/POST /api/v1/loyalty/go-live (ACTIVATE_LOYALTY, Owner only; POST needs fresh re-authentication). */
export type LoyaltyGoLiveStatusResponse = LoyaltyGoLiveResponse;

// ------------------------------------------------------------------- member discount (P5-4)

/** Why the Member Discount is not a winning candidate of an invoice (a stable code; the UI shows a localized text). */
export type MemberIneligibleReason = 'NO_TIER' | 'NO_ELIGIBLE_LINES';

/** The Member Discount as a candidate of the best-offer selection (PRD 16.1, 18.5-18.6). Only for an identified member payer once loyalty is live. */
export interface InvoiceMemberCandidate {
  /** The payer's Spa tier from the balance BEFORE this invoice (never after it earns). */
  tier: LoyaltyTierName;
  tierTableVersion: number;
  balanceBefore: number;
  /** The tier's Member Discount in basis points (0 = no tier yet). */
  discountBp: number;
  /** All priced Spa lines before any benefit (Phase 5 has Spa lines only). */
  eligibleSubtotalVnd: string;
  /** The computed benefit; 0 when not eligible. */
  amountVnd: string;
  eligible: boolean;
  reason: MemberIneligibleReason | null;
  winner: boolean;
}

/**
 * Phase 5 P5-5: referral (design `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 7 and the Owner decisions of 2026-10-04 in 2.5).
 * A customer has at most one referrer (an existing member, by exact phone). The reward is fixed: +10 Lucy Spa and +10 Lucy Beauty points to the
 * referrer, once, when the new customer's FIRST completed visit is paid with real money. Only the Owner may change a referrer, and only
 * before the reward; every change is kept in history.
 */

/** The fixed award, a versioned constant and not Owner-editable (PRD 20.3). */
export const REFERRAL_AWARD_VERSION = 1;
export const REFERRAL_AWARD_POINTS = 10;

export type ReferralBindSourceName = 'SIGNUP' | 'COUNTER';
export type ReferralStatusFilter = 'PENDING' | 'REWARDED';

/** A person in a referral, shown to staff with a masked phone (no email, no address). */
export interface ReferralPartyResponse {
  id: string;
  displayName: string;
  phoneMasked: string | null;
}

export interface ReferralChangeResponse {
  id: string;
  oldReferrer: ReferralPartyResponse;
  newReferrer: ReferralPartyResponse;
  reason: string;
  actorName: string;
  createdAt: string;
}

/** A customer's referrer on the staff profile (`LoyaltyProfileResponse.referral`); null when none was recorded. */
export interface CustomerReferralResponse {
  referrer: ReferralPartyResponse;
  boundVia: ReferralBindSourceName;
  boundAt: string;
  /** The staff member who recorded it at the counter. */
  boundByName: string | null;
  /** Set once the reward was granted; the referrer is then locked forever. */
  awarded: { at: string; invoiceCode: string | null } | null;
  /** Owner corrections before the reward, oldest first. */
  changes: ReferralChangeResponse[];
}

/** How many customers this customer referred and how many rewards that produced (shown on the referrer's own profile). */
export interface ReferrerTotalsResponse {
  referred: number;
  rewarded: number;
}

/** GET /api/v1/referrals/branches/:branchId/lookup?phone= (MANAGE_REFERRALS at the branch; exact match, masked, no listing). */
export interface ReferralLookupResponse {
  members: { id: string; displayName: string; phoneMasked: string | null }[];
}

/** POST /api/v1/referrals/branches/:branchId/customers/:userId/bind (MANAGE_REFERRALS at the branch). */
export interface ReferralBindRequest {
  referrerPhone: string;
}

/** POST /api/v1/referrals/customers/:userId/change (CHANGE_REFERRER, Owner only, fresh re-authentication). */
export interface ReferralChangeRequest {
  referrerPhone: string;
  reason: string;
}

export interface ReferralResultResponse {
  referral: CustomerReferralResponse;
  /** True when the same binding was already recorded (a replay); nothing was written. */
  replayed: boolean;
}

export interface ReferralListItemResponse {
  id: string;
  referred: ReferralPartyResponse;
  referrer: ReferralPartyResponse;
  boundVia: ReferralBindSourceName;
  boundAt: string;
  awarded: { at: string; invoiceCode: string | null } | null;
  changed: boolean;
}

/** GET /api/v1/referrals/branches/:branchId?page&status (VIEW_LOYALTY at the branch), newest first, 20 per page. */
export interface ReferralPageResponse {
  items: ReferralListItemResponse[];
  page: number;
  pageSize: number;
  total: number;
  /** Staff view hints; the API authorizes every command again. */
  can: { change: boolean };
}

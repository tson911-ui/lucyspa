import type { LoyaltyWalletName, LoyaltyWalletResponse } from './loyalty.js';
import type { ComboSessionKindName, ComboUsedBy } from './combo.js';
import type { RewardEntitlementStatus, RewardKindName } from './reward.js';

/**
 * Phase 5 P5-10: the signed-in customer's own membership page (design `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 15, P5-Q9).
 * Everything here is read only and belongs to the session's customer; the browser sends no customer id. Another person is
 * only ever a masked name ("N••• T••• L•••"), never a full name or a phone. Staff reasons, staff names, shortfall flags and
 * invoice codes are never part of these responses. Nothing is sent as a notification (P5-Q9).
 * While the loyalty go-live switch is OFF every response is empty (`live: false`, no wallet, no row).
 */

export const CUSTOMER_LOYALTY_PAGE_SIZE = 20;

/** GET /api/v1/me/loyalty */
export interface CustomerLoyaltySummaryResponse {
  live: boolean;
  /** Spa and Beauty, always both once live; empty while OFF. The Member Discount applies to Spa (Beauty is Phase 6). */
  wallets: LoyaltyWalletResponse[];
}

export interface CustomerPageResponse<T> {
  /** False while the switch is OFF (then `items` is empty). */
  live: boolean;
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** What a points line means to a customer, in simple words (the reason a staff member typed is never shown, OQ-11). */
export type CustomerLedgerKind = 'EARNED' | 'TAKEN_BACK' | 'REFERRAL' | 'ADJUSTED';

export interface CustomerLedgerItemResponse {
  id: string;
  wallet: LoyaltyWalletName;
  kind: CustomerLedgerKind;
  /** Signed whole points actually applied. */
  points: number;
  createdAt: string;
}

/** GET /api/v1/me/loyalty/history?page= (20 per page, newest first). */
export type CustomerLedgerPageResponse = CustomerPageResponse<CustomerLedgerItemResponse>;

/** `PAUSED`: its sale was reversed after sessions were used; it comes back when the sale is paid again. */
export type CustomerComboStatus = 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'PAUSED';

export interface CustomerComboResponse {
  id: string;
  nameVi: string;
  nameEn: string;
  serviceNameVi: string;
  serviceNameEn: string;
  status: CustomerComboStatus;
  paidSessions: number;
  bonusSessions: number;
  /** Sessions with no active use, by kind (PAID sessions are used first). */
  paidLeft: number;
  bonusLeft: number;
  issuedAt: string;
  expiresAt: string | null;
}

/** GET /api/v1/me/loyalty/combos?page= */
export type CustomerComboPageResponse = CustomerPageResponse<CustomerComboResponse>;

export interface CustomerComboUseResponse {
  id: string;
  usedAt: string;
  comboNameVi: string;
  comboNameEn: string;
  serviceNameVi: string;
  serviceNameEn: string;
  sessionKind: ComboSessionKindName;
  usedBy: ComboUsedBy;
  /** For a relative: the masked name of the person who received the service; null for the owner or when unknown. */
  recipientMasked: string | null;
  branchName: string;
}

/** GET /api/v1/me/loyalty/combo-uses?page= : uses by the customer and by relatives; mistaken or cancelled uses are not listed. */
export type CustomerComboUsePageResponse = CustomerPageResponse<CustomerComboUseResponse>;

export type CustomerReferralStatus = 'WAITING' | 'REWARDED';

export interface CustomerReferralItemResponse {
  id: string;
  /** Masked: the first letter of every word. Never a phone. */
  referredMasked: string;
  boundAt: string;
  status: CustomerReferralStatus;
  rewardedAt: string | null;
}

/** GET /api/v1/me/loyalty/referrals?page= : the people this customer referred. */
export type CustomerReferralPageResponse = CustomerPageResponse<CustomerReferralItemResponse>;

export interface CustomerGiftResponse {
  id: string;
  kind: RewardKindName;
  nameVi: string;
  nameEn: string;
  /** For a free service: the service it is for. */
  serviceNameVi: string | null;
  serviceNameEn: string | null;
  status: RewardEntitlementStatus;
  quantityIssued: number;
  quantityLeft: number;
  issuedAt: string;
  expiresAt: string | null;
}

/** GET /api/v1/me/loyalty/gifts?page= */
export type CustomerGiftPageResponse = CustomerPageResponse<CustomerGiftResponse>;

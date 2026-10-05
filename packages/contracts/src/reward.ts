/**
 * Phase 5 P5-9: the gift / benefit catalog framework (design `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 10, PRD 21).
 * An Owner or manager holding `MANAGE_REWARD_CATALOG` defines catalog items (a free service, a reward voucher, a gift); the
 * catalog ships EMPTY. Staff holding `ISSUE_REWARDS` at a branch grant an item to a member and mark it used; revoking needs a
 * reason. Everything is kept as history. Rewards are a separate domain from points: nothing here reads or writes a wallet, and
 * points can never be exchanged for a reward. Nothing works until the loyalty go-live switch is ON.
 */

/** The three kinds the screens offer (the database also knows `OTHER`, unused). */
export type RewardKindName = 'FREE_SERVICE' | 'VOUCHER' | 'PRODUCT_GIFT' | 'OTHER';
export type RewardEntitlementStatus = 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'VOIDED';

export const REWARD_MAX_QUANTITY = 50;
export const REWARD_MAX_EXPIRY_DAYS = 3650;

/** An active service a free-service item can be tied to (the picker of the catalog form). */
export interface RewardServiceOption {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
}

export interface RewardCatalogItemResponse {
  id: string;
  code: string;
  kind: RewardKindName;
  /** Set exactly for a `FREE_SERVICE` item; never changes. */
  service: { id: string; nameVi: string; nameEn: string } | null;
  nameVi: string;
  nameEn: string;
  active: boolean;
  /** Days after the issue date, or null when an entitlement of this item never expires. Applies to future issues only. */
  expiryDays: number | null;
  /** Advances by one on every save; the editor sends the one it started from. */
  rowVersion: number;
  createdAt: string;
  updatedAt: string;
  createdByName: string;
}

/** GET /api/v1/rewards/catalog (MANAGE_REWARD_CATALOG). `loyaltyLive` false = no reward can be issued yet. */
export interface RewardCatalogListResponse {
  items: RewardCatalogItemResponse[];
  serviceOptions: RewardServiceOption[];
  loyaltyLive: boolean;
}

/** The editable fields of an item (the kind, the service and the code never change). */
export interface RewardCatalogValuesRequest {
  nameVi: string;
  nameEn: string;
  active: boolean;
  /** Null = never expires. */
  expiryDays: number | null;
}

/** POST /api/v1/rewards/catalog: a new item (its code is generated). `serviceId` is required for `FREE_SERVICE`, forbidden otherwise. */
export interface RewardCatalogCreateRequest extends RewardCatalogValuesRequest {
  kind: RewardKindName;
  serviceId: string | null;
}

/** POST /api/v1/rewards/catalog/:id/edit */
export interface RewardCatalogEditRequest extends RewardCatalogValuesRequest {
  expectedRowVersion: number;
}

/** GET /api/v1/rewards/branches/:branchId/options (ISSUE_REWARDS at the branch): the active items staff can grant. */
export interface RewardIssueOptionsResponse {
  items: {
    id: string;
    kind: RewardKindName;
    nameVi: string;
    nameEn: string;
    service: { nameVi: string; nameEn: string } | null;
    expiryDays: number | null;
  }[];
  loyaltyLive: boolean;
}

/** GET /api/v1/rewards/branches/:branchId/lookup?phone= : the exact phone of a member, masked; no partial match. */
export interface RewardLookupResponse {
  members: { id: string; displayName: string; phoneMasked: string | null }[];
}

export interface RewardUseResponse {
  id: string;
  usedAt: string;
  branchName: string;
  usedByName: string;
  note: string | null;
  /** A mistaken use corrected by a manager; the use itself stays as history. */
  restoration: { restoredAt: string; restoredByName: string; reason: string } | null;
}

export interface RewardEntitlementResponse {
  id: string;
  item: {
    id: string;
    kind: RewardKindName;
    nameVi: string;
    nameEn: string;
    service: { nameVi: string; nameEn: string } | null;
  };
  status: RewardEntitlementStatus;
  quantityIssued: number;
  /** Units in use now (restored uses are not counted). */
  quantityUsed: number;
  quantityLeft: number;
  issuedAt: string;
  expiresAt: string | null;
  issuedByName: string | null;
  /** The reason the staff member gave when granting it. */
  reason: string | null;
  void: { at: string; byName: string; reason: string } | null;
  /** Oldest first. */
  uses: RewardUseResponse[];
  /** What this viewer may do with it (UX hints; the API decides again on every request). */
  can: { use: boolean; revoke: boolean; restore: boolean };
}

/** GET /api/v1/rewards/branches/:branchId/customers/:userId/entitlements?page= : newest first, 20 per page. */
export interface RewardEntitlementPageResponse {
  customer: { id: string; displayName: string; phoneMasked: string | null };
  items: RewardEntitlementResponse[];
  page: number;
  pageSize: number;
  total: number;
  canIssue: boolean;
  loyaltyLive: boolean;
}

/** POST /api/v1/rewards/branches/:branchId/customers/:userId/entitlements */
export interface RewardIssueRequest {
  catalogItemId: string;
  quantity: number;
  reason: string;
}

/** POST /api/v1/rewards/branches/:branchId/entitlements/:id/use : one unit, with an optional note. */
export interface RewardUseRequest {
  note?: string;
}

/** POST /api/v1/rewards/branches/:branchId/entitlements/:id/revoke and POST /api/v1/rewards/uses/:useId/restore */
export interface RewardReasonRequest {
  reason: string;
}

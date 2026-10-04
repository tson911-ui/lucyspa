/**
 * Phase 5 P5-7: combos (design `PHASE5_LOYALTY_COMBOS_DESIGN.md` section 9). An Owner or manager holding `MANAGE_COMBOS`
 * defines combos (one service, paid and bonus sessions, a price, no expiry); every save appends a version and never edits one.
 * A combo is SOLD at the POS counter to an identified member on its own invoice (kind `COMBO_SALE`, no Visit) and is issued to
 * the buyer only when that invoice is PAID. Using the sessions is P5-8.
 */

export type InvoiceKindName = 'VISIT' | 'COMBO_SALE';

/** One version of a combo definition (append-only). Lucy Spa combos never expire, so no expiry field is exposed. */
export interface ComboVersionResponse {
  id: string;
  versionNo: number;
  nameVi: string;
  nameEn: string;
  paidSessions: number;
  bonusSessions: number;
  totalSessions: number;
  priceVnd: string;
  active: boolean;
  createdAt: string;
  createdByName: string;
}

/** A combo with its current version and the history (newest first). */
export interface ComboResponse {
  id: string;
  code: string;
  service: { id: string; code: string; nameVi: string; nameEn: string };
  current: ComboVersionResponse;
  versions: ComboVersionResponse[];
  createdAt: string;
}

/** An active service a combo can be defined for (the picker of the combo form, so a manager needs no catalog permission). */
export interface ComboServiceOption {
  id: string;
  code: string;
  nameVi: string;
  nameEn: string;
}

/** GET /api/v1/combos (MANAGE_COMBOS). `loyaltyLive` tells the screen whether combos can be sold yet (go-live is OFF = no). */
export interface ComboListResponse {
  combos: ComboResponse[];
  serviceOptions: ComboServiceOption[];
  loyaltyLive: boolean;
}

/** The fields of a version. Everything is explicit; the price is whole VND as a decimal string. */
export interface ComboValuesRequest {
  nameVi: string;
  nameEn: string;
  paidSessions: number;
  bonusSessions: number;
  priceVnd: string;
  active: boolean;
}

/** POST /api/v1/combos: a new combo (its code is generated) with its first version. */
export interface ComboCreateRequest extends ComboValuesRequest {
  serviceId: string;
}

/** POST /api/v1/combos/:id/versions: the next version. `expectedVersionNo` is the version the editor started from. */
export interface ComboVersionRequest extends ComboValuesRequest {
  expectedVersionNo: number;
}

/** One sellable combo at the counter: the current version of a combo whose current version is active. */
export interface ComboSaleOptionResponse {
  comboId: string;
  versionId: string;
  code: string;
  nameVi: string;
  nameEn: string;
  service: { id: string; nameVi: string; nameEn: string };
  paidSessions: number;
  bonusSessions: number;
  totalSessions: number;
  priceVnd: string;
}

/** GET /api/v1/pos/branches/:branchId/combos (SELL_COMBOS at the branch). `sellable` is false while go-live is OFF. */
export interface ComboSaleOptionsResponse {
  options: ComboSaleOptionResponse[];
  sellable: boolean;
}

/** POST /api/v1/pos/branches/:branchId/combo-sales: a DRAFT combo-sale invoice for an identified member. */
export interface ComboSaleRequest {
  comboId: string;
  payerUserId: string;
}

/**
 * Where the combo of a paid sale stands. The `loyalty` worker issues it right after the invoice is PAID (a few seconds),
 * so a paid invoice can briefly be `PENDING`. `REVOKED` = the paid episode ended (payment reversed or invoice cancelled)
 * before any session was used and the combo was taken back.
 */
export type ComboIssuanceState = 'NOT_PAID' | 'PENDING' | 'ISSUED' | 'REVOKED';

/** The single line of a COMBO_SALE invoice: an exact copy of the combo version sold. */
export interface InvoiceComboLineResponse {
  id: string;
  sequence: number;
  comboId: string;
  itemCode: string;
  nameVi: string;
  nameEn: string;
  service: { id: string; nameVi: string; nameEn: string };
  paidSessions: number;
  bonusSessions: number;
  totalSessions: number;
  priceVnd: string;
  issuance: ComboIssuanceState;
  issuedAt: string | null;
}

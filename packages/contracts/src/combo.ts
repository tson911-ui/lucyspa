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

// ---------------------------------------------------------------------------------------------- P5-8: using the sessions

export type ComboUsedBy = 'OWNER' | 'RELATIVE';
export type ComboSessionKindName = 'PAID' | 'BONUS';

/**
 * Where the use of a combo session on one service line stands: `SELECTED` (the staff's choice on a draft; no session is taken
 * yet), `USED` (finalized: one session is taken), `RELEASED` (the invoice was cancelled: the session returned), `RESTORED` (a
 * manager restored a mistaken use, with a reason; the line keeps its 0 VND).
 */
export type ComboUseState = 'SELECTED' | 'USED' | 'RELEASED' | 'RESTORED';

/** The combo session that pays one service line of a visit invoice (a 0 VND line, quantity 1). */
export interface InvoiceLineComboUseResponse {
  purchaseId: string;
  comboNameVi: string;
  comboNameEn: string;
  usedBy: ComboUsedBy;
  /** Only for a relative, free text, optional. */
  relationshipNote: string | null;
  state: ComboUseState;
  /** Null while `SELECTED`: the session is taken (lowest number first, so PAID before BONUS) only at finalization. */
  sessionNo: number | null;
  sessionKind: ComboSessionKindName | null;
  /** Phase 7 reads this: a BONUS session never counts as a tour for the technician (Owner, 2026-10-05). Null while `SELECTED`. */
  countsAsTour: boolean | null;
  usedAt: string | null;
}

/** POST /api/v1/pos/invoices/:id/combo-lookup (staff; exact owner phone). */
export interface ComboLookupRequest {
  phone: string;
}

/** One usable combo of the owner, for a service on this invoice. Only what staff need: no phone, no email, no history. */
export interface ComboLookupComboResponse {
  purchaseId: string;
  nameVi: string;
  nameEn: string;
  service: { id: string; nameVi: string; nameEn: string };
  sessionsLeft: number;
  totalSessions: number;
  /** The invoice lines (not yet paid with a session) this combo can pay. */
  lineIds: string[];
}

/** The owner's NAME is masked ("N••• T••• L•••"); nothing else identifies them (PRD 52). An empty list means "nothing usable found". */
export interface ComboLookupResponse {
  owners: { ownerNameMasked: string; combos: ComboLookupComboResponse[] }[];
}

/** POST /api/v1/pos/invoices/:id/lines/:lineId/combo-use: pay this line with a session of the combo (DRAFT only). */
export interface ComboUseRequest {
  expectedVersion: number;
  purchaseId: string;
  usedBy: ComboUsedBy;
  relationshipNote?: string;
}

/** POST /api/v1/pos/invoices/:id/lines/:lineId/combo-use/clear: pay this line normally again (DRAFT only). */
export interface ComboUseClearRequest {
  expectedVersion: number;
}

export type ComboUsageStatus = 'ACTIVE' | 'RELEASED' | 'RESTORED';

/** One row of the usage history (append-only). */
export interface ComboUsageItemResponse {
  consumptionId: string;
  usedAt: string;
  status: ComboUsageStatus;
  owner: { id: string; displayName: string; phoneMasked: string | null };
  comboNameVi: string;
  comboNameEn: string;
  sessionNo: number;
  sessionKind: ComboSessionKindName;
  usedBy: ComboUsedBy;
  relationshipNote: string | null;
  serviceNameVi: string;
  serviceNameEn: string;
  /** The person who received the service. */
  recipientName: string | null;
  technicianName: string | null;
  performedByName: string;
  invoiceCode: string;
  branchName: string;
  /** Present when `status` is `RESTORED`. */
  restoration: { restoredAt: string; restoredByName: string; reason: string } | null;
  /** Present when `status` is `RELEASED` (the use invoice was cancelled). */
  releasedAt: string | null;
}

/** GET /api/v1/combos/usage?page= (RESTORE_COMBO_SESSIONS or MANAGE_COMBOS, global): newest first, 20 per page. */
export interface ComboUsagePageResponse {
  items: ComboUsageItemResponse[];
  page: number;
  pageSize: number;
  total: number;
  /** The actor may restore a mistaken use (RESTORE_COMBO_SESSIONS). */
  canRestore: boolean;
}

/** POST /api/v1/combos/usage/:consumptionId/restore (RESTORE_COMBO_SESSIONS, fresh re-authentication). */
export interface ComboRestoreRequest {
  reason: string;
}

/**
 * A combo whose sale was reversed while sessions were already used: it is frozen (its unused sessions cannot be used) until the
 * sale is paid again, and the Owner is told here (Owner answer 2026-10-05, provisional). GET /api/v1/combos/frozen
 * (VIEW_LOYALTY_EXCEPTIONS, global).
 */
export interface ComboFrozenItemResponse {
  purchaseId: string;
  owner: { id: string; displayName: string; phoneMasked: string | null };
  comboNameVi: string;
  comboNameEn: string;
  sessionsUsed: number;
  sessionsLeft: number;
  saleInvoiceCode: string;
  saleInvoiceStatus: 'PENDING_PAYMENT' | 'CANCELLED';
}

export interface ComboFrozenListResponse {
  items: ComboFrozenItemResponse[];
}

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

/**
 * Phase 5 P5-10b: the state of a sold combo for staff, nothing hidden. `FROZEN`: its sale was reversed or cancelled after it was
 * issued, so it cannot be used until the sale is paid again (even when every session was used). `REVOKED`: its sale was reversed
 * or cancelled before any session was used, so it was withdrawn.
 */
export type ComboSoldStatus = 'ACTIVE' | 'USED_UP' | 'EXPIRED' | 'FROZEN' | 'REVOKED';

/** Why the sale stopped counting: its payment was reversed, or its invoice was cancelled. */
export type ComboSoldCause = 'SALE_REVERSED' | 'SALE_CANCELLED';

export const COMBO_SOLD_STATUSES: readonly ComboSoldStatus[] = [
  'ACTIVE',
  'USED_UP',
  'EXPIRED',
  'FROZEN',
  'REVOKED',
];

export interface ComboSoldItemResponse {
  purchaseId: string;
  /** The member who paid and owns the combo (name and masked phone, as in the other staff lists). */
  buyer: { id: string; displayName: string; phoneMasked: string | null };
  comboNameVi: string;
  comboNameEn: string;
  serviceNameVi: string;
  serviceNameEn: string;
  /** When the combo was issued (its sale invoice was paid). */
  soldAt: string;
  /** The branch of the sale. */
  branchName: string;
  saleInvoiceCode: string;
  paidSessions: number;
  bonusSessions: number;
  /** Sessions with no active use, by kind. */
  paidLeft: number;
  bonusLeft: number;
  expiresAt: string | null;
  status: ComboSoldStatus;
  /** For `FROZEN` and `REVOKED`: when it happened and why (a stable cause, never text typed by a person); null otherwise. */
  event: { kind: 'FROZEN' | 'REVOKED'; at: string; cause: ComboSoldCause } | null;
}

/** GET /api/v1/combos/sold?page&status (RESTORE_COMBO_SESSIONS or MANAGE_COMBOS, global), newest first, 20 per page. */
export interface ComboSoldPageResponse {
  items: ComboSoldItemResponse[];
  page: number;
  pageSize: number;
  total: number;
  /** Sessions still usable now: the sum over `ACTIVE` combos only (frozen, revoked, expired and used-up ones add nothing). */
  totals: { paidLeft: number; bonusLeft: number };
}

/** GET /api/v1/loyalty/branches/:branchId/customers/:userId/combos?page (VIEW_LOYALTY at the branch): one customer's combos, all states. */
export type ComboSoldCustomerPageResponse = ComboSoldPageResponse;

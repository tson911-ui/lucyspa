/**
 * Phase 6 P6-12: product return cases (design 8.1, T23, T35, OQ-22, OQ-79). A case records one claim about ONE product line of a PAID
 * counter invoice. It moves no money and no stock (refunds and exchanges are P6-13 and P6-14). Everything is decided at the invoice's
 * branch: `MANAGE_PRODUCT_RETURNS` opens, annotates and decides; a skin-irritation case is decided by a holder of `REFUND_PRODUCTS`
 * (the Owner or a senior manager); either permission may see a case and its evidence photos. Evidence photos are private: they are
 * reachable only through the photo endpoint, never by a public URL.
 */

export type ProductReturnReasonName =
  'PERSONAL_PREFERENCE' | 'WRONG_OR_DAMAGED' | 'SKIN_IRRITATION';
export type ProductReturnOutcomeName = 'EXCHANGE' | 'REFUND';
export type ProductReturnStatusName = 'OPEN' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
export type ProductReturnEventKindName =
  'OPENED' | 'NOTE_ADDED' | 'PHOTO_ADDED' | 'PHOTO_REMOVED' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';
export type ProductReturnPhotoVariantName = 'thumb' | 'md' | 'lg';

/** The return windows, in hours from hand-over (T23, OQ-22): 7 days for a personal preference, 48 hours for a wrong or damaged product. */
export const PRODUCT_RETURN_WINDOW_HOURS = {
  PERSONAL_PREFERENCE: 168,
  WRONG_OR_DAMAGED: 48,
} as const;
/** The most photos one case holds. */
export const PRODUCT_RETURN_MAX_PHOTOS = 8;
export const PRODUCT_RETURN_PAGE_SIZE = 20;

/** GET /api/v1/product-returns/context: the branches the caller may work in and what they may do there. */
export interface ProductReturnContextResponse {
  branches: {
    id: string;
    code: string;
    name: string;
    /** MANAGE_PRODUCT_RETURNS: open a case, add notes and photos, decide the rule-based reasons, cancel. */
    manage: boolean;
    /** REFUND_PRODUCTS: decide a skin-irritation case (Owner or senior manager). */
    decide: boolean;
  }[];
  /** Only the Owner removes a photo (OQ-79). */
  owner: boolean;
}

export interface ProductReturnWindowStatus {
  /** True when a case with this reason may be opened now. */
  open: boolean;
  /** When the window ends (ISO), or null when the reason has no window (skin irritation). */
  endsAt: string | null;
}

/** One product line of the looked-up invoice with what can still be returned. */
export interface ProductReturnLookupLine {
  lineId: string;
  sequence: number;
  sku: string;
  productNameVi: string;
  productNameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  quantity: number;
  /** Units already claimed by cases that are open or accepted. */
  claimedQuantity: number;
  availableQuantity: number;
  reasons: Record<ProductReturnReasonName, ProductReturnWindowStatus>;
}

/** GET /api/v1/product-returns/lookup?branchId=&invoiceCode= */
export interface ProductReturnLookupResponse {
  invoice: {
    id: string;
    code: string;
    paidAt: string;
    /** The payer's name, or null for a guest. Never a phone number or an address. */
    customerName: string | null;
  };
  lines: ProductReturnLookupLine[];
}

export interface ProductReturnListItem {
  id: string;
  code: string;
  invoiceCode: string;
  sku: string;
  productNameVi: string;
  productNameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  quantity: number;
  reason: ProductReturnReasonName;
  requestedOutcome: ProductReturnOutcomeName;
  status: ProductReturnStatusName;
  openedAt: string;
  openedByName: string;
  photoCount: number;
}

/** GET /api/v1/product-returns/cases?branchId=&status=&reason=&q=&page= (20 per page, newest first). */
export interface ProductReturnListResponse {
  branchId: string;
  items: ProductReturnListItem[];
  page: number;
  pageSize: number;
  total: number;
}

export interface ProductReturnPhotoResponse {
  id: string;
  width: number;
  height: number;
  uploadedAt: string;
  uploadedByName: string;
  /** Set once the photo was removed (OQ-79): the picture is gone, this record stays. */
  removedAt: string | null;
  removedByName: string | null;
  removalNote: string | null;
}

export interface ProductReturnEventResponse {
  id: string;
  kind: ProductReturnEventKindName;
  actorName: string;
  note: string | null;
  photoId: string | null;
  occurredAt: string;
}

export interface ProductReturnCaseResponse {
  id: string;
  code: string;
  branchId: string;
  branchName: string;
  invoice: {
    id: string;
    code: string;
    paidAt: string;
    customerName: string | null;
  };
  line: {
    id: string;
    sequence: number;
    sku: string;
    productNameVi: string;
    productNameEn: string;
    variantLabelVi: string | null;
    variantLabelEn: string | null;
    /** Units sold on the line. */
    soldQuantity: number;
  };
  reason: ProductReturnReasonName;
  requestedOutcome: ProductReturnOutcomeName;
  quantity: number;
  sealIntact: boolean | null;
  notes: string | null;
  handoverAt: string;
  windowEndsAt: string | null;
  status: ProductReturnStatusName;
  /** The remedy the case was accepted for (set only when ACCEPTED). */
  decidedOutcome: ProductReturnOutcomeName | null;
  closedByName: string | null;
  closedAt: string | null;
  closingNote: string | null;
  openedByName: string;
  openedAt: string;
  rowVersion: number;
  photos: ProductReturnPhotoResponse[];
  events: ProductReturnEventResponse[];
  /** What the caller may do now (the API decides again on every command). */
  can: {
    /** Add a note (while the case is open or accepted). */
    note: boolean;
    /** Add a photo (while the case is open and below the photo limit). */
    addPhoto: boolean;
    /** Accept or decline: a skin-irritation case needs REFUND_PRODUCTS, the other reasons MANAGE_PRODUCT_RETURNS. */
    decide: boolean;
    cancel: boolean;
    /** Owner only, and only when a photo is still present. */
    removePhoto: boolean;
  };
}

/** POST /api/v1/product-returns/cases */
export interface ProductReturnOpenRequest {
  branchId: string;
  invoiceLineId: string;
  reason: ProductReturnReasonName;
  requestedOutcome: ProductReturnOutcomeName;
  quantity: number;
  /** The seal/packaging check; must be true for PERSONAL_PREFERENCE. */
  sealIntact: boolean | null;
  /** What was said and seen; no diagnosis (PRD 28.3). */
  notes: string | null;
  /** A UUID made by the screen: a repeat of the same request returns the case it already opened. */
  clientRequestId: string;
}

/** POST /api/v1/product-returns/cases/:id/notes */
export interface ProductReturnNoteRequest {
  note: string;
}

/** POST /api/v1/product-returns/cases/:id/accept */
export interface ProductReturnAcceptRequest {
  expectedRowVersion: number;
  outcome: ProductReturnOutcomeName;
  note: string | null;
}

/** POST /api/v1/product-returns/cases/:id/decline and /cancel */
export interface ProductReturnCloseRequest {
  expectedRowVersion: number;
  /** Why (required): it stays on the case. */
  note: string;
}

/** POST /api/v1/product-returns/cases/:id/photos/:photoId/remove (Owner only, on the customer's request). */
export interface ProductReturnPhotoRemoveRequest {
  /** What the customer asked for (required, kept on the tombstone and in the audit log). */
  note: string;
}

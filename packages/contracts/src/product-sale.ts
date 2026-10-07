/**
 * Phase 6 P6-8: product lines on invoices (design 5, T15, T20, T33). A product line is sold at the effective price of its variant
 * (nobody types a price), carries the SELLER (required) and, when the invoice is finalized, reserves stock at the invoice branch.
 * Until the pricing engine of P6-9 a product line gets no discount and earns no points.
 */

export type InvoiceChannelName = 'COUNTER' | 'ONLINE';

/** A product line of an invoice (the admin view; the seller is never shown to the customer). */
export interface InvoiceProductLineResponse {
  id: string;
  sequence: number;
  productId: string;
  variantId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  quantity: number;
  /** The effective price of the variant at `pricedAt`; frozen when the invoice is finalized. */
  unitPriceVnd: string;
  grossVnd: string;
  listPriceVnd: string;
  /** True when a promotion price was in force at `pricedAt`. */
  onPromotion: boolean;
  pricedAt: string;
  seller: { id: string; displayName: string };
  /** The stock held for this line once the invoice is finalized (`null` while DRAFT). */
  reservation: { status: 'RESERVED' | 'CONSUMED' | 'RELEASED'; quantity: number } | null;
}

/** POST /api/v1/pos/branches/:branchId/product-sales (SELL_PRODUCTS at the branch): a DRAFT product-only invoice. */
export interface ProductSaleRequest {
  /** A member found by the exact lookup, or null/absent for a guest payer. */
  payerUserId?: string | null;
}

/**
 * POST /api/v1/pos/invoices/:id/product-lines (SELL_PRODUCTS at the invoice's branch; DRAFT of a visit or product-sale invoice).
 * There is no price field: the server resolves the effective price. `sellerUserId` defaults to the caller when the caller is an
 * active employee of the branch; otherwise it is required.
 */
export interface InvoiceProductLineAddRequest {
  expectedVersion: number;
  variantId: string;
  quantity: number;
  sellerUserId?: string;
}

/** PATCH /api/v1/pos/invoices/:id/product-lines/:lineId: change the quantity and/or the seller (DRAFT only). */
export interface InvoiceProductLineUpdateRequest {
  expectedVersion: number;
  quantity?: number;
  sellerUserId?: string;
}

/** POST /api/v1/pos/invoices/:id/product-lines/:lineId/remove: removes a draft product line (the audit log keeps the record). */
export interface InvoiceProductLineRemoveRequest {
  expectedVersion: number;
}

/**
 * Phase 6 P6-10: GET /api/v1/pos/branches/:branchId/products?q= (SELL_PRODUCTS at the branch). What the counter needs to add a
 * product line: the sellable variants that match the search (name, brand, variant label or SKU, without diacritics), each with the
 * server's effective price and what is available at THIS branch, and the staff who may be named as the seller. Never the cost, the
 * lots, the suppliers or the stock of another branch.
 */
export interface PosProductOption {
  variantId: string;
  productId: string;
  sku: string;
  nameVi: string;
  nameEn: string;
  variantLabelVi: string | null;
  variantLabelEn: string | null;
  /** The effective price now; the finalization freezes the price of that instant. */
  unitPriceVnd: string;
  listPriceVnd: string;
  onPromotion: boolean;
  /** Units a new sale can still take at this branch (expired lots and reserved units excluded); 0 = "Hết hàng". */
  available: number;
}

export interface PosSellerOption {
  id: string;
  displayName: string;
}

export interface PosProductOptionsResponse {
  products: PosProductOption[];
  /** More variants match than are listed: the cashier refines the search. */
  truncated: boolean;
  /** Active staff assigned to the branch, by name. */
  sellers: PosSellerOption[];
  /** The caller when they may be a seller here; null for an Owner without an assignment (who must choose). */
  defaultSellerId: string | null;
}

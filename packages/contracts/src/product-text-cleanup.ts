/**
 * Claude integration CI-0b: the one-click cleanup of the supplier's customer comments that earlier imports copied into
 * `products.description_vi` (`docs/PHASE_CLAUDE_INTEGRATION.md` section 3.3). Preview first, then one confirmed apply, audited with the
 * full before and after text. `MANAGE_PRODUCTS` (GLOBAL).
 */

/** The preview lists at most this many products (a sanity limit; the real catalog has a few hundred). */
export const PRODUCT_TEXT_CLEANUP_PREVIEW_MAX = 500;
/** One apply call cleans at most this many products. */
export const PRODUCT_TEXT_CLEANUP_BATCH_MAX = 100;

export interface ProductTextCleanupItem {
  id: string;
  code: string;
  nameVi: string;
  /** The row version and the description hash the preview was computed from: the apply refuses a product that changed since. */
  rowVersion: number;
  textHash: string;
  removedEntries: number;
  removedChars: number;
}

/** GET /api/v1/product-text-cleanup/preview */
export interface ProductTextCleanupPreviewResponse {
  items: ProductTextCleanupItem[];
  /** True when more products matched than `PRODUCT_TEXT_CLEANUP_PREVIEW_MAX`. */
  truncated: boolean;
}

/** GET /api/v1/product-text-cleanup/preview/:id */
export interface ProductTextCleanupDetailResponse {
  id: string;
  code: string;
  nameVi: string;
  rowVersion: number;
  textHash: string;
  before: string;
  after: string;
  /** The lines that would go, in their order. */
  removedLines: string[];
}

export interface ProductTextCleanupApplyEntry {
  id: string;
  rowVersion: number;
  textHash: string;
}

/** POST /api/v1/product-text-cleanup/apply (up to `PRODUCT_TEXT_CLEANUP_BATCH_MAX` entries). */
export interface ProductTextCleanupApplyRequest {
  items: ProductTextCleanupApplyEntry[];
}

export const PRODUCT_TEXT_CLEANUP_SKIP_REASONS = [
  /** The product was edited after the preview. */
  'CHANGED',
  /** Nothing to remove any more (already clean). */
  'NOTHING_TO_REMOVE',
  'NOT_FOUND',
] as const;
export type ProductTextCleanupSkipReason = (typeof PRODUCT_TEXT_CLEANUP_SKIP_REASONS)[number];

export interface ProductTextCleanupApplyResponse {
  cleaned: number;
  skipped: { id: string; reason: ProductTextCleanupSkipReason }[];
}

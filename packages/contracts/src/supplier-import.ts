/**
 * Phase 9 P9-6 (supplier product import; docs/PHASE9_PRODUCT_IMPORT.md section 9): the review of what the scan found. Everything here
 * needs REVIEW_SUPPLIER_IMPORTS (GLOBAL). Supplier prices are reference data: they are present only for a caller who also holds
 * MANAGE_PRODUCT_PRICES; the server removes them otherwise (the keys are absent). Nothing a reviewer does writes a cost, and a price
 * version is created only by someone holding MANAGE_PRODUCT_PRICES.
 */

export const CANDIDATE_STATES = [
  'DETECTED',
  'EXTRACTED',
  'NORMALIZED',
  'MATCHED',
  'READY_FOR_REVIEW',
  'NEEDS_REVIEW',
  'APPROVED',
  'REJECTED',
  'IGNORED',
  'IMPORTED',
] as const;
export type CandidateState = (typeof CANDIDATE_STATES)[number];

/** The states a reviewer can still act on. */
export const OPEN_CANDIDATE_STATES = [
  'DETECTED',
  'EXTRACTED',
  'NORMALIZED',
  'MATCHED',
  'READY_FOR_REVIEW',
  'NEEDS_REVIEW',
] as const;

export const CANDIDATE_PAGE_SIZE = 20;
export const CANDIDATE_NAME_MAX = 500;
export const CANDIDATE_DESCRIPTION_MAX = 20_000;
export const CANDIDATE_NOTE_MAX = 500;
export const CANDIDATE_BULK_MAX = 20;

/** What stops a candidate from being approved (the server repeats the check inside the approval). */
export const CANDIDATE_BLOCKERS = [
  'NAME_MISSING',
  'SKU_INVALID',
  'SKU_TAKEN',
  'SKU_DUPLICATE_CANDIDATE',
  'IMAGE_DECISION_REQUIRED',
  'DUPLICATE_UNRESOLVED',
] as const;
export type CandidateBlocker = (typeof CANDIDATE_BLOCKERS)[number];

/** A warning exactly as the evaluation wrote it: a code and the facts a reviewer needs (other product, texts, suggestions). */
export type CandidateWarningItem = { code: string } & Record<string, unknown>;

export interface SupplierCandidateRow {
  id: string;
  state: CandidateState;
  rowVersion: number;
  nameVi: string;
  sku: string | null;
  brand: { id: string; name: string } | null;
  category: { id: string; name: string } | null;
  supplier: { id: string; name: string };
  warnings: string[];
  needsTranslation: boolean;
  imageCount: number;
  flaggedImageCount: number;
  /** The first picture, for the thumbnail (served by the candidate's own picture route). */
  thumbImageId: string | null;
  /** Reference only. Absent without MANAGE_PRODUCT_PRICES. */
  sourcePriceVnd?: number | null;
  updatedAt: string;
}

/** GET /api/v1/supplier-imports/candidates?state=&warning=&page= (20 per page). */
export interface SupplierCandidateListResponse {
  items: SupplierCandidateRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Candidates with no warning at all: what "approve everything ready" would act on. */
  readyCount: number;
  /** Counts per state, for the filter. */
  stateCounts: Partial<Record<CandidateState, number>>;
  canSeePrices: boolean;
}

export interface SupplierCandidateImage {
  id: string;
  sourceUrl: string;
  /** The WooCommerce product id the picture was read from. */
  sourceProductKey: string;
  /** Set when the picture belongs to one variant of the product. */
  variantKey: string | null;
  flag: 'SAME_FILE' | 'SIMILAR' | 'CATALOG_SAME_FILE' | null;
  sortOrder: number;
  width: number;
  height: number;
  /** The reviewer's latest decision about this picture. */
  decision: 'KEEP' | 'DROP' | null;
  /** The other products that have the same file or a near-identical picture (never assigned, only shown). */
  sharedWith: { kind: 'CANDIDATE' | 'PRODUCT'; id: string; name: string; sku: string | null }[];
}

export interface SupplierCandidateOption {
  id: string;
  name: string;
}

export interface SupplierCandidateDetail {
  id: string;
  state: CandidateState;
  rowVersion: number;
  supplier: { id: string; name: string };
  nameVi: string;
  nameEn: string;
  needsTranslation: boolean;
  descriptionVi: string | null;
  descriptionEn: string | null;
  brandId: string | null;
  categoryId: string | null;
  proposedSku: string | null;
  warnings: CandidateWarningItem[];
  /** What the source says about the product (never edited here). */
  source: {
    sourceId: string;
    sourceName: string;
    sourceKey: string;
    url: string;
    name: string;
    sku: string | null;
    categoryNames: string[];
    brandText: string | null;
  };
  images: SupplierCandidateImage[];
  /** Reference only. Absent without MANAGE_PRODUCT_PRICES. */
  sourcePrice?: {
    priceVnd: number | null;
    promoPriceVnd: number | null;
    currency: string;
    observedAt: string;
  };
  brands: SupplierCandidateOption[];
  categories: SupplierCandidateOption[];
  approval: { canApprove: boolean; blockers: CandidateBlocker[] };
  decided: {
    by: string | null;
    at: string | null;
    note: string | null;
    productId: string | null;
  } | null;
  canSeePrices: boolean;
}

export interface SupplierCandidateDetailResponse {
  item: SupplierCandidateDetail;
}

/** POST .../candidates/:id/edit: only what changed; Lucy-owned values (the source text is kept separately). */
export interface SupplierCandidateEditRequest {
  expectedVersion: number;
  nameVi?: string;
  nameEn?: string;
  needsTranslation?: boolean;
  descriptionVi?: string | null;
  descriptionEn?: string | null;
  brandId?: string | null;
  categoryId?: string | null;
  /** Exactly Lucy's SKU shape (A-Z, 0-9, ".", "_", "-", 64 at most); nothing is upper-cased for you. */
  proposedSku?: string | null;
}

/** POST .../candidates/:id/image-decision: keep a flagged picture for this product, or drop it. */
export interface SupplierCandidateImageDecisionRequest {
  expectedVersion: number;
  imageId: string;
  decision: 'KEEP' | 'DROP';
}

/** POST .../candidates/:id/keep-separate: say a look-alike product (a `matches` entry of POSSIBLE_DUPLICATE) is not the same one. */
export interface SupplierCandidateKeepSeparateRequest {
  expectedVersion: number;
  /** `PRODUCT:<id>` or `CANDIDATE:<id>`. */
  ref: string;
}

/** POST /api/v1/supplier-imports/mappings: "this source text means this brand or category" (remembered; every candidate is re-read). */
export interface SupplierMappingRequest {
  candidateId: string;
  kind: 'BRAND' | 'CATEGORY';
  sourceText: string;
  targetId: string;
}

export interface SupplierMappingResponse {
  changed: boolean;
  /** How many candidates of the supplier were looked at again, and how many changed. */
  evaluated: number;
  updated: number;
}

/** POST .../candidates/:id/approve: creates the DRAFT product. A selling price is optional and needs MANAGE_PRODUCT_PRICES. */
export interface SupplierCandidateApproveRequest {
  expectedVersion: number;
  /** Whole VND as text; the Owner sets the price, the supplier's price is never copied. */
  listPriceVnd?: string;
}

export interface SupplierCandidateApproveResponse {
  productId: string;
  sku: string;
  images: number;
}

/** POST .../candidates/:id/reject and /ignore. */
export interface SupplierCandidateDecideRequest {
  expectedVersion: number;
  note?: string | null;
}

export interface SupplierCandidateDecideResponse {
  id: string;
  state: CandidateState;
}

/** POST /api/v1/supplier-imports/approve-ready: approves the listed candidates that are still ready (no warning), without a price. */
export interface SupplierApproveReadyRequest {
  candidates: { id: string; expectedVersion: number }[];
}

export interface SupplierApproveReadyResponse {
  approved: number;
  skipped: { id: string; reason: string }[];
}

// ------------------------------------------------------------------------------------------------ P9-9b: import and publish all

/**
 * Phase 9 P9-9b (Owner, docs/PHASE9_PRODUCT_IMPORT.md section 17): "Nhập và đăng tất cả". One preview lists every open candidate with
 * the brand, category and selling price the system chose (brand and category automatically, the price = the supplier's listed price
 * rounded to 1,000 VND); the person ticks what to import. Only ticked products are imported AND published; unticked ones become
 * IGNORED (not proposed again unless their content at the source changes). It needs REVIEW_SUPPLIER_IMPORTS, MANAGE_PRODUCTS and
 * MANAGE_PRODUCT_PRICES, so the proposed price may be shown. Real blockers are skipped and listed, never forced.
 */
export const IMPORT_ALL_BLOCKERS = [...CANDIDATE_BLOCKERS, 'PRICE_MISSING', 'NOT_OPEN'] as const;
export type ImportAllBlocker = (typeof IMPORT_ALL_BLOCKERS)[number];

/** One call imports at most this many ticked products and ignores at most `IMPORT_ALL_IGNORE_MAX`; the screen sends several calls. */
export const IMPORT_ALL_IMPORT_MAX = 20;
export const IMPORT_ALL_IGNORE_MAX = 100;

export interface SupplierImportAllRow {
  id: string;
  rowVersion: number;
  nameVi: string;
  sku: string | null;
  /** The first picture, served by the candidate's own picture route. */
  thumbImageId: string | null;
  /** The brand to use; `isNew` when Lucy Spa has none of that name yet (it is created when the import runs). */
  brand: { name: string; isNew: boolean } | null;
  /** One of the twelve fixed categories (`key` is the stable code, `name` the Vietnamese name). */
  category: { key: string; name: string };
  /** The list price proposed: the supplier's REGULAR price rounded to 1,000 VND, whole VND as text. Null when the source gave none. */
  priceVnd: string | null;
  /** The promotional price while the supplier has the product on sale (rounded to 1,000 VND), shown beside the struck list price. Null when not on sale. */
  promoPriceVnd: string | null;
  /** Why this product cannot be imported now (empty when it can). */
  blockers: ImportAllBlocker[];
}

export interface SupplierImportAllPreview {
  rows: SupplierImportAllRow[];
  total: number;
  importable: number;
  blocked: number;
  /** The brands that would be created, with how many importable products each has. */
  newBrands: { name: string; count: number }[];
  /** Importable products per category (every one of the twelve, so the Owner sees where they go). */
  categories: { key: string; name: string; count: number }[];
  /** The categories of the fixed list Lucy Spa does not have yet (created when the import runs). */
  categoriesToCreate: string[];
}

export interface SupplierImportAllRequest {
  import: { id: string; expectedVersion: number }[];
  ignore: { id: string; expectedVersion: number }[];
}

export interface SupplierImportAllResponse {
  imported: number;
  ignored: number;
  newBrands: number;
  createdCategories: number;
  /** Products that could not be imported (or ignored) now, with every reason. Nothing was changed for them. */
  skipped: { id: string; reasons: string[] }[];
}

// ------------------------------------------------------------------------------------------------------ P9-7: what changed

/**
 * Phase 9 P9-7: the "Thay đổi" queue (docs/PHASE9_PRODUCT_IMPORT.md section 10). A scan that finds a product different on the source
 * leaves a note here until a reviewer says it was seen. A note changes nothing: no candidate, product, price or picture. The source
 * price inside a price note is reference data and is cut from the response of anyone without MANAGE_PRODUCT_PRICES.
 */
export const SOURCE_CHANGE_KINDS = [
  'PRICE_CHANGED',
  'CONTENT_CHANGED',
  'IMAGE_CHANGED',
  'SOURCE_REMOVED',
  'SOURCE_RETURNED',
] as const;
export type SourceChangeKind = (typeof SOURCE_CHANGE_KINDS)[number];

export const CHANGE_PAGE_SIZE = 20;
export const CHANGE_ACKNOWLEDGE_MAX = 20;

export interface SupplierChangeDetail {
  /** CONTENT_CHANGED: the stored fields that differ, with the short before and after of each. */
  fields?: string[];
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  /** IMAGE_CHANGED: how many pictures the source lists now and before, and how many were added or taken away. */
  images?: { before: number; after: number; added: number; removed: number };
  /** SOURCE_REMOVED / SOURCE_RETURNED: how many healthy scans in a row the product was missing. */
  missingScans?: number;
  /** PRICE_CHANGED: absent without MANAGE_PRODUCT_PRICES. */
  price?: {
    before: { priceVnd: number | null; promoPriceVnd: number | null };
    after: { priceVnd: number | null; promoPriceVnd: number | null };
  };
}

export interface SupplierChangeRow {
  id: string;
  kind: SourceChangeKind;
  detectedAt: string;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  scanId: string;
  source: { id: string; name: string };
  /** The product as the source names it, its SKU there, and its page. */
  productName: string;
  productSku: string | null;
  productUrl: string;
  candidate: { id: string; nameVi: string; state: CandidateState } | null;
  detail: SupplierChangeDetail;
}

/** GET /api/v1/supplier-imports/changes?status=OPEN|DONE&kind=&page= (20 per page). */
export interface SupplierChangeListResponse {
  items: SupplierChangeRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Notes nobody has acknowledged yet, in total and per kind (for the filter). */
  openCount: number;
  kindCounts: Partial<Record<SourceChangeKind, number>>;
  canSeePrices: boolean;
}

/** POST /api/v1/supplier-imports/changes/acknowledge: says the listed notes were seen. */
export interface SupplierChangeAcknowledgeRequest {
  ids: string[];
}

export interface SupplierChangeAcknowledgeResponse {
  acknowledged: number;
  /** Notes that were already acknowledged. */
  alreadyDone: number;
}

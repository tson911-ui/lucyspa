/**
 * Claude integration Wave A (CI-R2): the review of AI drafts for product text. A draft is a row the worker wrote (`ai_items`); a person
 * reads it next to the product's current text, may edit it, and only then applies it. Nothing here changes the catalog until `apply`.
 * Authority: `USE_AI_CONTENT` (GLOBAL) for everything; `apply` also needs `MANAGE_PRODUCTS` (GLOBAL).
 */

export const AI_DRAFT_STATUSES = [
  'QUEUED',
  'GENERATING',
  'DRAFT_READY',
  'NEEDS_ATTENTION',
  'FAILED',
  'APPLIED',
  'REJECTED',
  'STALE',
] as const;
export type AiDraftStatus = (typeof AI_DRAFT_STATUSES)[number];

/** A note from the server-side checks (see `checkProductRewrite`). Notes are informational: none of them blocks an apply (Owner, 2026-10-13). */
export interface AiDraftWarning {
  code: string;
  field?: string;
  detail?: string;
}

/** A change the worker made to the draft before saving it: by code (free) or by the one targeted model call. */
export interface AiDraftAutoFix {
  code: string;
  field: string;
  how: 'CODE' | 'AI';
}

export interface AiDraftSections {
  benefits: string | null;
  ingredients: string | null;
  usage: string | null;
  suitableFor: string | null;
}

/** The fields a draft writes to the product; also the shape of the current text and of an edit. */
export interface AiDraftContent {
  descriptionVi: string;
  sectionsVi: AiDraftSections;
  descriptionEn: string;
  sectionsEn: AiDraftSections;
  nameEn: string;
  seoTitleVi: string;
  seoTitleEn: string;
  seoDescriptionVi: string;
  seoDescriptionEn: string;
}

/** What is on the product now (the "old" side of the side-by-side). Empty fields are empty strings or null sections. */
export interface AiDraftCurrent extends AiDraftContent {
  nameVi: string;
}

export const AI_DRAFT_LIMITS = {
  description: 4000,
  section: 3000,
  name: 200,
  seoTitle: 200,
  seoDescription: 400,
  instruction: 300,
  regenerationsMax: 3,
  pageSize: 20,
} as const;

export interface AiDraftRow {
  id: string;
  status: AiDraftStatus;
  errorCode: string | null;
  productId: string;
  productCode: string;
  productName: string;
  /** Notes the checks still find (informational). */
  warnings: number;
  /** Changes the worker made before saving the draft. */
  autoFixes: number;
  /** The row version the review list sends back when this draft is selected for approval. */
  rowVersion: number;
  edited: boolean;
  viewed: boolean;
  regenerations: number;
  runId: string;
  updatedAt: string;
  /** What the draft cost, in VND at the rate the Owner typed (null while no rate is typed). */
  costVnd: string | null;
}

export interface AiDraftCounts {
  all: number;
  byStatus: Record<AiDraftStatus, number>;
}

/** GET /api/v1/ai/product-drafts?status=&page= (20 per page). */
export interface AiDraftList {
  items: AiDraftRow[];
  total: number;
  page: number;
  pageSize: number;
  counts: AiDraftCounts;
  /** Drafts a person has applied one by one (the page approval needs three). */
  appliedCount: number;
}

export interface AiDraftDetail {
  id: string;
  status: AiDraftStatus;
  errorCode: string | null;
  rowVersion: number;
  runId: string;
  product: { id: string; code: string; nameVi: string; rowVersion: number; contentOrigin: string };
  /** The product changed after the draft was made: apply is refused until the draft is made again. */
  stale: boolean;
  current: AiDraftCurrent;
  /** What the model wrote (null while there is none). */
  draft: AiDraftContent | null;
  /** The reviewer's edit of the draft, if any; apply uses this when present. */
  edited: AiDraftContent | null;
  nameViSuggestion: string | null;
  /** Off until the reviewer ticks it: the official Vietnamese name is kept by default. */
  useNameSuggestion: boolean;
  /** The "who it suits" line was inferred from the product type (the supplier named no skin type). Reviewer only. */
  suitableForInferred: boolean;
  /** Reviewer notes in Vietnamese; never part of any customer-facing answer. */
  factsKept: string[];
  uncertain: string[];
  warnings: AiDraftWarning[];
  /** What the worker fixed before saving the draft (shown beside it; reviewer only). */
  autoFixes: AiDraftAutoFix[];
  instruction: string | null;
  regenerations: number;
  canRegenerate: boolean;
  viewedAt: string | null;
  appliedAt: string | null;
  updatedAt: string;
}

/** POST /api/v1/ai/product-drafts/:id/edit: the whole content as the reviewer left it; warnings are checked again. */
export interface AiDraftEditRequest {
  expectedRowVersion: number;
  content: AiDraftContent;
  useNameSuggestion?: boolean;
}

/** POST /api/v1/ai/product-drafts/:id/apply */
export interface AiDraftApplyRequest {
  expectedRowVersion: number;
}

export interface AiDraftApplyResponse {
  /** `STALE` when the product changed after the draft was made: nothing was written. */
  result: 'APPLIED' | 'STALE';
  detail: AiDraftDetail;
}

/** POST /api/v1/ai/product-drafts/:id/reject */
export interface AiDraftRejectRequest {
  expectedRowVersion: number;
  reason?: string;
}

/** POST /api/v1/ai/product-drafts/:id/regenerate: a new draft with one line of guidance (at most three times per product). */
export interface AiDraftRegenerateRequest {
  expectedRowVersion: number;
  instruction?: string;
}

/** POST /api/v1/ai/product-drafts/:id/retry: queue a failed, refused or stale item again (a stale one is re-read from the product). */
export interface AiDraftRetryRequest {
  expectedRowVersion: number;
}

/** POST /api/v1/ai/product-drafts/:id/view: records that this reviewer has opened the draft. */
export interface AiDraftViewRequest {
  expectedRowVersion?: number;
}

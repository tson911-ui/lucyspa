/**
 * Claude integration Wave B (CI-E1, design 4.4 and 4.7; Owner answer OQ-CI-8 and the message of 2026-10-13): drafts of the search
 * descriptions and the English texts of the SERVICES and the HOME PAGE (the shop profile). Few items (tens), so every draft is read and
 * applied one by one; there is no page or bulk approval for these. Existing Owner-written text is never replaced: only the search
 * descriptions, and an English text that is still empty, are drafted. Reading and reviewing is `USE_AI_CONTENT` (GLOBAL); applying also
 * needs `MANAGE_SERVICES` (a service) or `MANAGE_WEBSITE_CONTENT` (the home page). The AI only writes drafts; the worker makes the calls.
 */

export const AI_SEO_KINDS = ['SERVICE', 'SHOP'] as const;
export type AiSeoKind = (typeof AI_SEO_KINDS)[number];

export const AI_SEO_STATUSES = [
  'QUEUED',
  'GENERATING',
  'DRAFT_READY',
  'NEEDS_ATTENTION',
  'FAILED',
  'APPLIED',
  'REJECTED',
  'STALE',
] as const;
export type AiSeoStatus = (typeof AI_SEO_STATUSES)[number];

export const AI_SEO_LIMITS = Object.freeze({
  pageSize: 20,
  /** The most services one request may queue. */
  createMax: 100,
  /** House targets (Google publishes no limit): shown as soft notes, never refused. */
  descriptionTarget: 155,
  /** The database refuses anything longer. */
  descriptionMax: 300,
  englishTextMax: 2_000,
  instructionMax: 600,
  regenerationsMax: 3,
});

/** The fields of a draft (and of an edit of it). `englishText` is the English description of a service, or the English intro of the home page. */
export interface AiSeoContent {
  seoDescriptionVi: string;
  seoDescriptionEn: string;
  /** Null when this item does not draft an English text (the target already has one). */
  englishText: string | null;
}

export type AiSeoWarningCode =
  | 'CLINIC_WORD'
  | 'FORBIDDEN_PHRASE'
  | 'AUTHENTICITY_CLAIM'
  | 'TESTIMONIAL'
  | 'URL_OR_CONTACT'
  | 'MARKUP_OR_EMOJI'
  | 'SEO_DESCRIPTION_LONG'
  | 'SEO_DUPLICATE'
  | 'WRONG_LANGUAGE'
  | 'EMPTY_FIELD'
  | 'INJECTION_SIGN'
  | 'FACT_WRONG';

export interface AiSeoWarning {
  code: AiSeoWarningCode;
  field?: string;
  detail?: string;
  /** A blocking note must be edited away; the others may be accepted after reading. */
  blocking: boolean;
}

export interface AiSeoCurrent {
  /** The name shown in the list (a service's name, or the shop). */
  label: string;
  seoDescriptionVi: string;
  seoDescriptionEn: string;
  /** The Vietnamese text the draft was written from. */
  sourceVi: string;
  /** The English text now ('' when empty). */
  englishNow: string;
  /** What `englishText` means for this kind: the service's English description or the home page's English intro. */
  englishLabel: 'DESCRIPTION' | 'INTRO';
}

export interface AiSeoRow {
  id: string;
  kind: AiSeoKind;
  status: AiSeoStatus;
  errorCode: string | null;
  label: string;
  warnings: number;
  blockingWarnings: number;
  edited: boolean;
  regenerations: number;
  updatedAt: string;
  costVnd: string | null;
}

/** GET /api/v1/ai/seo-drafts?status=&kind=&page= */
export interface AiSeoList {
  items: AiSeoRow[];
  total: number;
  page: number;
  pageSize: number;
  byStatus: Record<AiSeoStatus, number>;
}

export interface AiSeoDetail {
  id: string;
  kind: AiSeoKind;
  status: AiSeoStatus;
  errorCode: string | null;
  rowVersion: number;
  current: AiSeoCurrent;
  /** True when the service or the shop profile changed after the draft was written (applying then makes it STALE). */
  stale: boolean;
  draft: AiSeoContent | null;
  edited: AiSeoContent | null;
  warnings: AiSeoWarning[];
  blocking: boolean;
  instruction: string | null;
  regenerations: number;
  canRegenerate: boolean;
  updatedAt: string;
}

/** POST /api/v1/ai/seo-drafts : queue drafts. Writes rows and an audit event; makes no call to Anthropic and changes nothing. */
export interface AiSeoCreateRequest {
  /** MISSING_SERVICES: every active service with no search description (up to 100); SERVICES: the named services; SHOP: the home page. */
  scope: 'MISSING_SERVICES' | 'SERVICES' | 'SHOP';
  serviceIds?: string[];
}

export interface AiSeoCreateResponse {
  queued: number;
  /** Targets left out because a draft for them is already open. */
  alreadyOpen: number;
}

/** GET /api/v1/ai/seo-drafts/preview?scope= : what a create would queue, and why it cannot. */
export type AiSeoBlock = 'OFF' | 'SEO_OFF' | 'NO_RATE' | 'NOTHING_TO_DRAFT';
export interface AiSeoPreview {
  scope: AiSeoCreateRequest['scope'];
  count: number;
  model: string;
  /** The most the drafts may cost in VND at the typed rate (null while no rate is typed). */
  estimateVnd: string | null;
  capLeftVnd: string | null;
  blocked: AiSeoBlock[];
}

export interface AiSeoVersioned {
  expectedRowVersion: number;
}

export interface AiSeoEditRequest extends AiSeoVersioned {
  content: AiSeoContent;
}

export interface AiSeoApplyRequest extends AiSeoVersioned {
  /** Needed when only soft notes remain. */
  acknowledgeWarnings?: boolean;
}

export interface AiSeoApplyResponse {
  result: 'APPLIED' | 'STALE';
  detail: AiSeoDetail;
}

export interface AiSeoRejectRequest extends AiSeoVersioned {
  reason?: string;
}

export interface AiSeoRegenerateRequest extends AiSeoVersioned {
  instruction?: string;
}

/**
 * Claude integration Wave A (CI-R3): the runs that write drafts. A run is the Owner's command "write drafts for these products"; the
 * worker does the calls (`rewrite-engine.ts`), the screens only start, pause, resume and cancel. Starting a run makes no call to
 * Anthropic and changes no product. Authority: `USE_AI_CONTENT` (GLOBAL); unlocking "run the rest" is `MANAGE_AI_SETTINGS`.
 *
 * The Owner's rules (OQ-CI-3, OQ-CI-5): the first run is exactly three products, written for real and kept if approved; running
 * more than three at once stays locked until the Owner has looked at those three and presses "Cho phép chạy tiếp"; a whole page of
 * up to 20 drafts may be approved at once only after the reviewer has seen that page and three drafts were applied one by one.
 */

export const AI_RUN_SCOPES = ['FIRST_THREE', 'SELECTION', 'ALL_PENDING'] as const;
export type AiRunScope = (typeof AI_RUN_SCOPES)[number];

export const AI_RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'PAUSED_CAP',
  'PAUSED_USER',
  'PAUSED_ERROR',
  'DONE',
  'CANCELLED',
] as const;
export type AiRunStatus = (typeof AI_RUN_STATUSES)[number];

export const AI_RUN_LIMITS = {
  /** The first run, and the most a run may hold before the Owner unlocks the rest. */
  firstRunSize: 3,
  /** The most products one run holds. */
  runMax: 400,
  /** Products one selection may name. */
  selectionMax: 100,
  /** Drafts that must have been applied one by one before a page may be approved at once. */
  singleApprovalsNeeded: 3,
  /** Drafts one "Duyệt các bài đã chọn" confirm may cover (Owner, 2026-10-13: every pending draft, warnings or not). */
  approveAllMax: 1000,
  /** Drafts one confirm request carries: the whole selection in one request (the server applies it ten at a time). */
  approveBatchMax: 1000,
} as const;

/** Why running is not possible right now; the screen says each in plain words. */
export type AiRunBlock =
  | 'OFF'
  | 'REWRITE_OFF'
  | 'NO_RATE'
  | 'NOTHING_TO_WRITE'
  | 'FIRST_THREE_DONE'
  | 'LOCKED'
  | 'RUN_ACTIVE';

/** GET /api/v1/ai/product-runs/preview?scope=&limit= : what a run would do, before anything is created. */
export interface AiRunPreview {
  scope: AiRunScope;
  /** Products the run would write drafts for (supplier-copy products with no open draft). */
  count: number;
  /** Products still waiting, in all. */
  pending: number;
  model: string;
  effort: string;
  /** The most the run may cost, in VND at the typed rate (null while no rate is typed). */
  estimateVnd: string | null;
  /** What is left of this month's cap for this feature (null while no rate is typed). */
  capLeftVnd: string | null;
  /** Empty when the run may start. */
  blocked: AiRunBlock[];
  /** Whether more than three at once is allowed yet. */
  unlocked: boolean;
}

/** POST /api/v1/ai/product-runs */
export interface AiRunCreateRequest {
  scope: AiRunScope;
  /** SELECTION: the products (at most 100). */
  productIds?: string[];
  /** ALL_PENDING: the most products to take now (1 to 400); the rest stay pending. */
  limit?: number;
}

export interface AiRunItemCounts {
  total: number;
  queued: number;
  generating: number;
  draftReady: number;
  needsAttention: number;
  failed: number;
  applied: number;
  rejected: number;
  stale: number;
}

export interface AiRunRow {
  id: string;
  scope: AiRunScope;
  status: AiRunStatus;
  pauseReason: string | null;
  model: string;
  effort: string;
  estimateVnd: string | null;
  spentVnd: string | null;
  counts: AiRunItemCounts;
  rowVersion: number;
  startedByName: string;
  createdAt: string;
  finishedAt: string | null;
}

/** GET /api/v1/ai/product-runs: the latest runs and what starting another needs. */
export interface AiRunList {
  runs: AiRunRow[];
  /** Drafts that were applied one by one (page approval needs three). */
  singleApplied: number;
  /** Drafts a person has opened and judged (applied or rejected): the Owner unlocks the rest after three. */
  reviewed: number;
  unlocked: boolean;
  unlockedAt: string | null;
  /** Settings row version, for the unlock. */
  settingsRowVersion: number;
  /** True while the Owner may press "Cho phép chạy tiếp" (three drafts reviewed, not unlocked yet). */
  canUnlock: boolean;
}

/** POST /api/v1/ai/product-runs/:id/(pause|resume|cancel) */
export interface AiRunCommandRequest {
  expectedRowVersion: number;
}

/** POST /api/v1/ai/product-runs/unlock (MANAGE_AI_SETTINGS) */
export interface AiRunUnlockRequest {
  expectedRowVersion: number;
}

/**
 * "Chọn tất cả" and "Duyệt các bài đã chọn" (Owner, 2026-10-13): the review list selects drafts with a checkbox, or every pending draft at
 * once. The list of all pending drafts (each with its row version) comes from the preview; the confirm sends back the selected ones, and
 * the server applies a draft only if it is still ready, unchanged since it was listed and its product is untouched. Notes never block.
 */
export interface AiApproveAllItem {
  id: string;
  rowVersion: number;
  productName: string;
  productCode: string;
  descriptionVi: string;
  seoTitleVi: string;
}

/** GET /api/v1/ai/product-drafts/approve-all : the preview. */
export interface AiApproveAllPreview {
  /** Drafts waiting for review (status ready). */
  ready: number;
  /** Of those, whose product's source text changed since the draft was written: not included. */
  changed: number;
  /** Of those, with an empty required field or a search text too long for the catalogue: they cannot be applied, so not included. */
  blocked: number;
  /** Drafts this confirm would apply (the list below holds at most `approveAllMax` of them). */
  eligible: number;
  items: AiApproveAllItem[];
  singleApplied: number;
  /** Three single approvals are done and the viewer may apply products. */
  canApprove: boolean;
}

/** POST /api/v1/ai/product-drafts/approve-all : the confirm, with the list the preview showed. */
export interface AiApproveAllRequest {
  items: { id: string; rowVersion: number }[];
}

/**
 * Why a draft of the confirmed list was left out: already handled (`NOT_READY`), edited by a person since the list (`CHANGED`), its
 * product's source text changed (`STALE`), a required field is empty (`EMPTY_FIELD`) or a search text is too long (`TOO_LONG`), or the
 * catalogue refused the write for another reason (`REJECTED`).
 */
export type AiApproveAllSkipReason =
  'NOT_READY' | 'CHANGED' | 'STALE' | 'EMPTY_FIELD' | 'TOO_LONG' | 'REJECTED';

export interface AiApproveAllResponse {
  applied: number;
  skipped: { id: string; reason: AiApproveAllSkipReason }[];
}

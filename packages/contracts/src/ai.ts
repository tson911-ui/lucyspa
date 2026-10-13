/**
 * Claude integration Wave A (docs/PHASE_CLAUDE_INTEGRATION.md sections 4 and 5; Owner answers of 2026-10-12): the AI settings, the key
 * status and the spend card. The key itself is never in any contract: only whether one is configured and the result of the last check.
 * Money is VND as a decimal string (integer, no separators); micro-USD is the ledger's unit (1 USD = 1,000,000).
 * `MANAGE_AI_SETTINGS` (GLOBAL).
 */

/** The models the Owner may choose for the rewrite (the database CHECK and the server's price table hold the same three). */
export const AI_MODEL_IDS = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'] as const;
export type AiModelId = (typeof AI_MODEL_IDS)[number];
export const AI_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export type AiEffortLevel = (typeof AI_EFFORT_LEVELS)[number];

/** The features that have their own monthly cap (the ledger also holds CHECK calls, which cost nothing). */
export const AI_CAPPED_FEATURES = ['PRODUCT_REWRITE', 'SEO', 'ASSISTANT', 'BRIEF'] as const;
export type AiCappedFeature = (typeof AI_CAPPED_FEATURES)[number];

export const AI_KEY_CHECK_STATUSES = [
  'OK',
  'KEY_MISSING',
  'AUTH_FAILED',
  'UNREACHABLE',
  'LIMIT_REACHED',
  'ERROR',
] as const;
export type AiKeyCheckStatus = (typeof AI_KEY_CHECK_STATUSES)[number];

export const AI_LIMITS = Object.freeze({
  capVndMax: '1000000000000',
  vndPerUsdMin: 1_000,
  vndPerUsdMax: 1_000_000,
  concurrencyMax: 4,
  chatDailyCapMax: 5_000,
  bannedPhrasesMax: 100,
  bannedPhraseMin: 2,
  bannedPhraseMax: 80,
});

export interface AiSettings {
  /** Master switch: nothing runs while it is off. */
  enabled: boolean;
  /** The product rewrite (feature 1). */
  rewriteEnabled: boolean;
  monthlyCapVnd: string;
  featureCapsVnd: Record<AiCappedFeature, string>;
  /** VND per USD, typed by the Owner (the system never guesses it); null = not typed yet, so no run can start. */
  vndPerUsd: number | null;
  rewriteModel: AiModelId;
  rewriteEffort: AiEffortLevel;
  concurrency: number;
  /** Anthropic's server-side refusal fallback for these models (default on). */
  refusalFallback: boolean;
  /** "chính hãng" and similar claims may be written only when this is on (default off, Owner answer to OQ-CI-8). */
  allowAuthenticityClaims: boolean;
  bannedPhrases: string[];
  /** The website chat (feature 2): visitors may talk to the n8n bot; off = no chat entry on the site. */
  chatEnabled: boolean;
  /** Most messages the chat relays to the bot per day (shop time); past it the widget shows the callback form. */
  chatDailyCap: number;
  /** SEO descriptions and English drafts of services, the home page and site blocks (feature 8). */
  seoEnabled: boolean;
  seoModel: AiModelId;
  /** The report question box (feature 4). */
  assistantEnabled: boolean;
  assistantModel: AiModelId;
  /** The customer summary for the KTV and the cosmetics talking points (features 6 and 7). */
  briefEnabled: boolean;
  briefModel: AiModelId;
  /** The Owner pressed "Cho phép chạy tiếp" after reviewing the first 3 products. */
  runAllUnlockedAt: string | null;
  rowVersion: number;
}

export interface AiKeyStatus {
  /** A key is present in this server's environment (never the key). */
  configured: boolean;
  lastCheckAt: string | null;
  lastCheckStatus: AiKeyCheckStatus | null;
  /** A check was asked for and the worker has not answered yet. */
  checkPending: boolean;
}

export interface AiUsageLine {
  feature: AiCappedFeature;
  spentVnd: string | null;
  capVnd: string;
}

export interface AiUsageCard {
  /** Null while no rate is typed. */
  spentVnd: string | null;
  capVnd: string;
  /** What calls in flight may still cost (held against the cap). */
  reservedVnd: string | null;
  spentMicroUsd: string;
  byFeature: AiUsageLine[];
}

/** What the server's environment has for the n8n side (never the secrets): the chat needs the webhook, the bot data port needs its key. */
export interface AiIntegrationStatus {
  chatWebhookConfigured: boolean;
  botDataConfigured: boolean;
}

/** GET /api/v1/ai/settings, and the answer of every change. */
export interface AiSettingsResponse {
  settings: AiSettings;
  key: AiKeyStatus;
  integrations: AiIntegrationStatus;
  usage: AiUsageCard;
}

/** POST /api/v1/ai/settings: only the keys present change. */
export interface AiSettingsEditRequest {
  expectedRowVersion: number;
  enabled?: boolean;
  rewriteEnabled?: boolean;
  monthlyCapVnd?: string;
  featureCapsVnd?: Partial<Record<AiCappedFeature, string>>;
  vndPerUsd?: number | null;
  rewriteModel?: AiModelId;
  rewriteEffort?: AiEffortLevel;
  concurrency?: number;
  refusalFallback?: boolean;
  allowAuthenticityClaims?: boolean;
  bannedPhrases?: string[];
  chatEnabled?: boolean;
  chatDailyCap?: number;
  seoEnabled?: boolean;
  seoModel?: AiModelId;
  assistantEnabled?: boolean;
  assistantModel?: AiModelId;
  briefEnabled?: boolean;
  briefModel?: AiModelId;
}

/** POST /api/v1/ai/settings/check: asks the worker to test the key (a free call). */
export interface AiKeyCheckRequest {
  expectedRowVersion: number;
}

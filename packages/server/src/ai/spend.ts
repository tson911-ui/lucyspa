import type { DatabaseClient, Prisma } from '@lucy-spa/database';
import { vndToMicroUsd, type TokenUsage } from './prices.js';

/**
 * Claude integration Wave A (CI-X3): the spending cap in the app (design section 5.4). One monthly cap and one cap per feature, in VND at the
 * rate the Owner typed. Before each paid call the caller RESERVES the most the call can cost; if the month total (ledger + open
 * reservations) plus that does not fit, nothing is called and the run pauses (PAUSED_CAP). The actual cost replaces the reservation in the
 * same transaction that writes the ledger row, so a cap is never crossed by more than the calls in flight. The month is the shop-time-zone
 * month (the Console's own limit resets at 00:00 UTC on the 1st: it is the second layer, outside this code).
 */

export type AiFeature = 'PRODUCT_REWRITE' | 'SEO' | 'ASSISTANT' | 'BRIEF' | 'SUGGESTIONS' | 'CHECK';
export const SHOP_TIME_ZONE = 'Asia/Ho_Chi_Minh';
/** A reservation that was never settled (a crash) stops counting after this long. */
export const RESERVATION_MINUTES = 10;

export type AiDatabase = DatabaseClient | Prisma.TransactionClient;

export interface AiSettings {
  enabled: boolean;
  rewriteEnabled: boolean;
  monthlyCapVnd: bigint;
  featureCapsVnd: Partial<Record<AiFeature, number>>;
  vndPerUsd: number | null;
  rewriteModel: string;
  rewriteEffort: string;
  concurrency: number;
  refusalFallback: boolean;
  allowAuthenticityClaims: boolean;
  bannedPhrases: string[];
  runAllUnlockedAt: Date | null;
  checkRequestedAt: Date | null;
  lastCheckAt: Date | null;
  lastCheckStatus: string | null;
  rowVersion: number;
}

interface SettingsRow {
  enabled: boolean;
  rewrite_enabled: boolean;
  monthly_cap_vnd: bigint;
  feature_caps_vnd: unknown;
  vnd_per_usd: number | null;
  rewrite_model: string;
  rewrite_effort: string;
  concurrency: number;
  refusal_fallback: boolean;
  allow_authenticity_claims: boolean;
  banned_phrases: unknown;
  run_all_unlocked_at: Date | null;
  check_requested_at: Date | null;
  last_check_at: Date | null;
  last_check_status: string | null;
  row_version: number;
}

const FEATURES: readonly AiFeature[] = [
  'PRODUCT_REWRITE',
  'SEO',
  'ASSISTANT',
  'BRIEF',
  'SUGGESTIONS',
];

export function readFeatureCaps(value: unknown): Partial<Record<AiFeature, number>> {
  const out: Partial<Record<AiFeature, number>> = {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out;
  for (const feature of FEATURES) {
    const entry = (value as Record<string, unknown>)[feature];
    if (typeof entry === 'number' && Number.isInteger(entry) && entry >= 0) out[feature] = entry;
  }
  return out;
}

export async function loadAiSettings(database: AiDatabase): Promise<AiSettings> {
  const rows = await database.$queryRaw<SettingsRow[]>`
    SELECT enabled, rewrite_enabled, monthly_cap_vnd, feature_caps_vnd, vnd_per_usd, rewrite_model, rewrite_effort, concurrency,
           refusal_fallback, allow_authenticity_claims, banned_phrases, run_all_unlocked_at, check_requested_at, last_check_at,
           last_check_status, row_version
      FROM ai_settings WHERE id = 1`;
  const row = rows[0];
  if (!row) throw new Error('The AI settings row is missing');
  return {
    enabled: row.enabled,
    rewriteEnabled: row.rewrite_enabled,
    monthlyCapVnd: BigInt(row.monthly_cap_vnd),
    featureCapsVnd: readFeatureCaps(row.feature_caps_vnd),
    vndPerUsd: row.vnd_per_usd,
    rewriteModel: row.rewrite_model,
    rewriteEffort: row.rewrite_effort,
    concurrency: Number(row.concurrency),
    refusalFallback: row.refusal_fallback,
    allowAuthenticityClaims: row.allow_authenticity_claims,
    bannedPhrases: Array.isArray(row.banned_phrases)
      ? (row.banned_phrases as unknown[]).filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
    runAllUnlockedAt: row.run_all_unlocked_at,
    checkRequestedAt: row.check_requested_at,
    lastCheckAt: row.last_check_at,
    lastCheckStatus: row.last_check_status,
    rowVersion: row.row_version,
  };
}

export interface MonthSpend {
  /** Cost already in the ledger this month (micro-USD). */
  spentMicroUsd: bigint;
  /** Amounts held by calls in flight. */
  reservedMicroUsd: bigint;
}

/**
 * This month's spend in micro-USD for the whole app (`feature` null) or one feature. `now` is the database clock by default; a test passes
 * its own so a month boundary can be tried.
 */
export async function monthSpend(
  database: AiDatabase,
  feature: AiFeature | null,
  now: Date | null = null,
): Promise<MonthSpend> {
  const at = now ?? new Date();
  const spent = await database.$queryRaw<{ total: bigint | null }[]>`
    SELECT COALESCE(SUM(cost_micro_usd), 0)::bigint AS total FROM ai_usage_ledger
     WHERE occurred_at >= (date_trunc('month', ${at}::timestamptz AT TIME ZONE ${SHOP_TIME_ZONE}) AT TIME ZONE ${SHOP_TIME_ZONE})
       AND occurred_at < ((date_trunc('month', ${at}::timestamptz AT TIME ZONE ${SHOP_TIME_ZONE}) + interval '1 month') AT TIME ZONE ${SHOP_TIME_ZONE})
       AND (${feature}::text IS NULL OR feature = ${feature}::text)`;
  const reserved = await database.$queryRaw<{ total: bigint | null }[]>`
    SELECT COALESCE(SUM(amount_micro_usd), 0)::bigint AS total FROM ai_reservations
     WHERE expires_at > ${at}::timestamptz AND (${feature}::text IS NULL OR feature = ${feature}::text)`;
  return {
    spentMicroUsd: BigInt(spent[0]?.total ?? 0n),
    reservedMicroUsd: BigInt(reserved[0]?.total ?? 0n),
  };
}

export type ReserveRefusal = 'NO_RATE' | 'CAP_MONTH' | 'CAP_FEATURE';
export type ReserveResult =
  { ok: true; reservationId: string } | { ok: false; reason: ReserveRefusal };

/**
 * Holds `amountMicroUsd` against the month's caps. Check and insert are one transaction under an advisory lock, so two workers cannot both
 * take the last dollar. Without a typed VND rate nothing can be converted, so nothing starts (`NO_RATE`).
 */
export async function reserveSpend(
  database: AiDatabase,
  input: {
    feature: Exclude<AiFeature, 'CHECK'>;
    itemId: string | null;
    amountMicroUsd: bigint;
    settings: AiSettings;
    now?: Date;
  },
): Promise<ReserveResult> {
  const { settings } = input;
  if (settings.vndPerUsd === null) return { ok: false, reason: 'NO_RATE' };
  const monthCap = vndToMicroUsd(settings.monthlyCapVnd, settings.vndPerUsd);
  const featureCapVnd = settings.featureCapsVnd[input.feature];
  const featureCap =
    featureCapVnd === undefined
      ? monthCap
      : vndToMicroUsd(BigInt(featureCapVnd), settings.vndPerUsd);
  const now = input.now ?? new Date();
  // The worker passes its client (a transaction is opened here); a test may pass a transaction client so everything rolls back.
  const inTransaction = <T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> =>
    '$transaction' in database ? database.$transaction(work) : work(database);
  return inTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lucy-ai-spend'))`;
    const all = await monthSpend(tx, null, now);
    if (all.spentMicroUsd + all.reservedMicroUsd + input.amountMicroUsd > monthCap) {
      return { ok: false, reason: 'CAP_MONTH' } as const;
    }
    const own = await monthSpend(tx, input.feature, now);
    if (own.spentMicroUsd + own.reservedMicroUsd + input.amountMicroUsd > featureCap) {
      return { ok: false, reason: 'CAP_FEATURE' } as const;
    }
    const rows = await tx.$queryRaw<{ id: string }[]>`
      INSERT INTO ai_reservations (feature, item_id, amount_micro_usd, created_at, expires_at)
      VALUES (${input.feature}, ${input.itemId}::uuid, ${input.amountMicroUsd}, ${now}::timestamptz,
              ${now}::timestamptz + make_interval(mins => ${RESERVATION_MINUTES}))
      RETURNING id`;
    return { ok: true, reservationId: (rows[0] as { id: string }).id } as const;
  });
}

export interface LedgerEntry {
  feature: AiFeature;
  runId: string | null;
  itemId: string | null;
  model: string;
  outcome: 'SUCCEEDED' | 'REFUSED' | 'FAILED';
  usage: TokenUsage;
  costMicroUsd: bigint;
  requestId: string | null;
}

/** Writes the ledger row (inside the caller's transaction) and releases the reservation. */
export async function writeLedger(
  tx: Prisma.TransactionClient,
  entry: LedgerEntry,
  reservationId: string | null,
): Promise<void> {
  await tx.$executeRaw`
    INSERT INTO ai_usage_ledger (feature, run_id, item_id, model, outcome, input_tokens, cache_read_tokens, cache_write_tokens,
                                 output_tokens, cost_micro_usd, request_id)
    VALUES (${entry.feature}, ${entry.runId}::uuid, ${entry.itemId}::uuid, ${entry.model}, ${entry.outcome}, ${entry.usage.inputTokens},
            ${entry.usage.cacheReadTokens}, ${entry.usage.cacheWriteTokens}, ${entry.usage.outputTokens}, ${entry.costMicroUsd},
            ${entry.requestId})`;
  if (reservationId !== null) {
    await tx.$executeRaw`DELETE FROM ai_reservations WHERE id = ${reservationId}::uuid`;
  }
}

/** Releases a reservation whose call produced nothing billable (the request never left, or failed before any token). */
export async function releaseReservation(
  database: AiDatabase,
  reservationId: string,
): Promise<void> {
  await database.$executeRaw`DELETE FROM ai_reservations WHERE id = ${reservationId}::uuid`;
}

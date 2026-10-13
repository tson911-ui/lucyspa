import type { Prisma } from '@lucy-spa/database';
import { AiCallError, type ClaudeClient, type GenerateResult } from './claude-client.js';
import { costMicroUsd, isAiEffort, isAiModel, maxCostMicroUsd, type AiModel } from './prices.js';
import {
  SEO_DRAFT_SCHEMA,
  SEO_DRAFT_SYSTEM,
  buildSeoUserMessage,
  checkSeoDraft,
  parseSeoDraft,
  seoDraftContent,
  type SeoSnapshot,
} from './seo-draft.js';
import { shopCity } from './rewrite-engine.js';
import {
  loadAiSettings,
  releaseReservation,
  reserveSpend,
  writeLedger,
  type AiDatabase,
} from './spend.js';

/**
 * Claude integration Wave B (CI-E1): the worker side of the search-description and English drafts for services and the home page. One tick
 * leases up to `concurrency` queued drafts (`ai_seo_drafts`) and writes a draft for each; nothing here changes a service or the shop profile:
 * a person reads each draft and applies it. Same discipline as the product rewrite: the switches are read before every call, the most a call
 * may cost is reserved first, the answer is checked on the server, and the ledger row, the released reservation and the draft are written in
 * ONE transaction. There are no runs: a problem only a person can fix (no rate, a cap, the key, the Owner's spend limit) fails the draft with
 * that reason and the page offers "Thử lại"; a problem of one draft fails or re-queues that draft only.
 */

const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 3_000;
const CALL_TIMEOUT_MS = 120_000;
const LEASE_MINUTES = 4;
const BACKOFF_MS = [30_000, 120_000];

export interface SeoEngineState {
  consecutiveFailures: number;
}

export interface SeoEngineOptions {
  now?: () => Date;
  timeoutMs?: number;
  maxTokens?: number;
  backoffMs?: readonly number[];
  onError?: (error: unknown) => void;
}

interface LeasedSeoItem {
  id: string;
  kind: 'SERVICE' | 'SHOP';
  target_id: string;
  attempts: number;
  base_snapshot: unknown;
  instruction: string | null;
  model: string;
  effort: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The stored snapshot as the prompt input, or null when it is not usable (the draft then fails with BAD_SNAPSHOT). */
export function seoSnapshotOf(value: unknown): SeoSnapshot | null {
  if (!isObject(value)) return null;
  const kind = value['kind'];
  if ((kind !== 'SERVICE' && kind !== 'SHOP') || typeof value['nameVi'] !== 'string') return null;
  const number = (entry: unknown): number | null =>
    typeof entry === 'number' && Number.isFinite(entry) ? entry : null;
  return {
    kind,
    label: typeof value['label'] === 'string' ? value['label'] : value['nameVi'],
    nameVi: value['nameVi'],
    nameEn: typeof value['nameEn'] === 'string' ? value['nameEn'] : '',
    category: typeof value['category'] === 'string' ? value['category'] : null,
    sourceVi: typeof value['sourceVi'] === 'string' ? value['sourceVi'] : '',
    englishNow: typeof value['englishNow'] === 'string' ? value['englishNow'] : '',
    needsEnglishText: value['needsEnglishText'] === true,
    priceMinVnd: number(value['priceMinVnd']),
    priceMaxVnd: number(value['priceMaxVnd']),
    durationMinMinutes: number(value['durationMinMinutes']),
    durationMaxMinutes: number(value['durationMaxMinutes']),
    perNail: value['perNail'] === true,
  };
}

/** The snapshot of one service for a draft, with the row version it was read at (apply refuses a service that changed since). */
export async function buildSeoSnapshot(
  database: AiDatabase,
  kind: 'SERVICE' | 'SHOP',
  targetId: string,
): Promise<{ snapshot: SeoSnapshot; rowVersion: number } | null> {
  if (kind === 'SHOP') {
    const shop = await database.websiteShopInfo.findUnique({
      where: { id: 'shop' },
      select: { rowVersion: true, taglineVi: true, introVi: true, introEn: true },
    });
    if (shop === null) return null;
    const introVi = (shop.introVi ?? '').trim();
    const introEn = (shop.introEn ?? '').trim();
    return {
      rowVersion: shop.rowVersion,
      snapshot: {
        kind,
        label: 'Trang chủ',
        nameVi: 'Trang chủ Lucy Spa',
        nameEn: 'Lucy Spa home page',
        category: null,
        sourceVi: introVi === '' ? shop.taglineVi : introVi,
        englishNow: introEn,
        needsEnglishText: introVi !== '' && introEn === '',
        priceMinVnd: null,
        priceMaxVnd: null,
        durationMinMinutes: null,
        durationMaxMinutes: null,
        perNail: false,
      },
    };
  }
  const service = await database.service.findUnique({
    where: { id: targetId },
    select: {
      rowVersion: true,
      nameVi: true,
      nameEn: true,
      descriptionVi: true,
      descriptionEn: true,
      priceVnd: true,
      priceMaxVnd: true,
      pricingUnit: true,
      estimatedMinMinutes: true,
      estimatedMaxMinutes: true,
      category: { select: { nameVi: true } },
    },
  });
  if (service === null) return null;
  const descriptionVi = (service.descriptionVi ?? '').trim();
  const descriptionEn = (service.descriptionEn ?? '').trim();
  return {
    rowVersion: service.rowVersion,
    snapshot: {
      kind,
      label: service.nameVi,
      nameVi: service.nameVi,
      nameEn: service.nameEn,
      category: service.category.nameVi,
      sourceVi: descriptionVi,
      englishNow: descriptionEn,
      needsEnglishText: descriptionVi !== '' && descriptionEn === '',
      priceMinVnd: Number(service.priceVnd),
      priceMaxVnd: Number(service.priceMaxVnd),
      durationMinMinutes: service.estimatedMinMinutes,
      durationMaxMinutes: service.estimatedMaxMinutes,
      perNail: service.pricingUnit === 'PER_NAIL',
    },
  };
}

/**
 * The other search descriptions of the site and of the other open drafts, compared after trimming and lower-casing: two pages must not
 * read the same (Google asks for a unique description per page).
 */
export async function seoSeenDescriptions(
  database: AiDatabase,
  draftId: string,
  targetId: string,
): Promise<ReadonlySet<string>> {
  const seen = await database.$queryRaw<{ text: string | null }[]>`
    SELECT seo_description_vi AS text FROM services WHERE seo_description_vi IS NOT NULL AND id::text <> ${targetId}
    UNION ALL SELECT seo_description_en FROM services WHERE seo_description_en IS NOT NULL AND id::text <> ${targetId}
    UNION ALL SELECT seo_description_vi FROM website_shop_info WHERE seo_description_vi IS NOT NULL AND 'shop' <> ${targetId}
    UNION ALL SELECT seo_description_en FROM website_shop_info WHERE seo_description_en IS NOT NULL AND 'shop' <> ${targetId}
    UNION ALL SELECT draft ->> 'seoDescriptionVi' FROM ai_seo_drafts WHERE id <> ${draftId}::uuid AND draft IS NOT NULL AND status <> 'REJECTED'
    UNION ALL SELECT draft ->> 'seoDescriptionEn' FROM ai_seo_drafts WHERE id <> ${draftId}::uuid AND draft IS NOT NULL AND status <> 'REJECTED'`;
  return new Set(
    seen.flatMap((row) => (row.text ? [row.text.normalize('NFC').toLowerCase().trim()] : [])),
  );
}

function inTransaction<T>(
  database: AiDatabase,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return '$transaction' in database ? database.$transaction(work) : work(database);
}

async function requeue(
  database: AiDatabase,
  id: string,
  options: { until: Date | null; giveAttemptBack: boolean },
): Promise<void> {
  await database.$executeRaw`
    UPDATE ai_seo_drafts
       SET status = 'QUEUED', locked_until = ${options.until}::timestamptz,
           attempts = GREATEST(attempts - ${options.giveAttemptBack ? 1 : 0}, 0),
           row_version = row_version + 1
     WHERE id = ${id}::uuid AND status = 'GENERATING'`;
}

async function failItem(
  database: AiDatabase,
  id: string,
  status: 'FAILED' | 'NEEDS_ATTENTION',
  errorCode: string,
): Promise<void> {
  await database.$executeRaw`
    UPDATE ai_seo_drafts
       SET status = ${status}, error_code = ${errorCode}, locked_until = NULL, row_version = row_version + 1
     WHERE id = ${id}::uuid AND status = 'GENERATING'`;
}

/** Takes up to `count` queued drafts (or drafts whose lease ran out); the same draft is never given twice. */
export async function leaseSeoItems(
  database: AiDatabase,
  count: number,
  now: Date,
): Promise<LeasedSeoItem[]> {
  await database.$executeRaw`
    UPDATE ai_seo_drafts
       SET status = 'FAILED', error_code = 'LEASE_EXPIRED', locked_until = NULL, row_version = row_version + 1
     WHERE status = 'GENERATING' AND locked_until <= ${now}::timestamptz AND attempts >= ${MAX_ATTEMPTS}`;
  return database.$queryRaw<LeasedSeoItem[]>`
    WITH picked AS (
      SELECT id FROM ai_seo_drafts
       WHERE (status = 'QUEUED' AND (locked_until IS NULL OR locked_until <= ${now}::timestamptz))
          OR (status = 'GENERATING' AND locked_until <= ${now}::timestamptz)
       ORDER BY created_at, id
       LIMIT ${count}
         FOR UPDATE SKIP LOCKED)
    UPDATE ai_seo_drafts d
       SET status = 'GENERATING', attempts = d.attempts + 1,
           locked_until = ${now}::timestamptz + make_interval(mins => ${LEASE_MINUTES}),
           row_version = d.row_version + 1
      FROM picked
     WHERE d.id = picked.id
 RETURNING d.id, d.kind, d.target_id, d.attempts, d.base_snapshot, d.instruction, d.model, d.effort`;
}

export async function runSeoTick(
  database: AiDatabase,
  client: ClaudeClient,
  state: SeoEngineState,
  options: SeoEngineOptions = {},
): Promise<{ leased: number; idle?: 'OFF' }> {
  const clock = options.now ?? (() => new Date());
  const settings = await loadAiSettings(database);
  if (!settings.enabled || !settings.seoEnabled) return { leased: 0, idle: 'OFF' };
  const items = await leaseSeoItems(database, settings.concurrency, clock());
  if (items.length === 0) return { leased: 0 };
  const city = await shopCity(database);
  await Promise.all(
    items.map((item) =>
      processItem(database, client, state, item, city, options).catch((error: unknown) => {
        options.onError?.(error);
      }),
    ),
  );
  return { leased: items.length };
}

async function processItem(
  database: AiDatabase,
  client: ClaudeClient,
  state: SeoEngineState,
  item: LeasedSeoItem,
  city: string,
  options: SeoEngineOptions,
): Promise<void> {
  const clock = options.now ?? (() => new Date());
  const settings = await loadAiSettings(database);
  if (!settings.enabled || !settings.seoEnabled) {
    await requeue(database, item.id, { until: null, giveAttemptBack: true });
    return;
  }
  const snapshot = seoSnapshotOf(item.base_snapshot);
  if (snapshot === null || !isAiModel(item.model) || !isAiEffort(item.effort)) {
    await failItem(database, item.id, 'FAILED', 'BAD_SNAPSHOT');
    return;
  }
  const model: AiModel = item.model;
  const user = buildSeoUserMessage({
    snapshot,
    city,
    authenticityClaimsAllowed: settings.allowAuthenticityClaims,
    instruction: item.instruction,
  });
  const estimatedInput = Math.ceil((SEO_DRAFT_SYSTEM.length + user.length) / 2) + 500;
  const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS;
  const reservation = await reserveSpend(database, {
    feature: 'SEO',
    itemId: item.id,
    amountMicroUsd: maxCostMicroUsd(model, estimatedInput, maxTokens),
    settings,
    now: clock(),
  });
  if (!reservation.ok) {
    // A cap or a missing rate is for a person to fix: the draft says why and waits for "Thử lại".
    await failItem(database, item.id, 'FAILED', reservation.reason);
    return;
  }

  let result: GenerateResult;
  try {
    result = await client.generateJson({
      model,
      effort: item.effort,
      system: SEO_DRAFT_SYSTEM,
      user,
      schema: SEO_DRAFT_SCHEMA as unknown as Record<string, unknown>,
      maxTokens,
      timeoutMs: options.timeoutMs ?? CALL_TIMEOUT_MS,
      refusalFallback: settings.refusalFallback,
    });
  } catch (error) {
    await releaseReservation(database, reservation.reservationId);
    const code = error instanceof AiCallError ? error.code : 'ERROR';
    if (error instanceof AiCallError && error.blocksEverything) {
      await failItem(
        database,
        item.id,
        'FAILED',
        error.code === 'SPEND_LIMIT'
          ? 'LIMIT_REACHED'
          : error.code === 'AUTH_FAILED'
            ? 'AUTH_FAILED'
            : 'KEY_MISSING',
      );
      return;
    }
    state.consecutiveFailures += 1;
    if (error instanceof AiCallError && error.retryable && item.attempts < MAX_ATTEMPTS) {
      const backoff = options.backoffMs ?? BACKOFF_MS;
      const wait = backoff[Math.min(item.attempts - 1, backoff.length - 1)] ?? 30_000;
      await requeue(database, item.id, {
        until: new Date(clock().getTime() + wait),
        giveAttemptBack: false,
      });
    } else {
      await failItem(database, item.id, 'FAILED', code);
    }
    return;
  }

  state.consecutiveFailures = 0;
  const billedModel = isAiModel(result.modelUsed) ? result.modelUsed : model;
  const cost = costMicroUsd(billedModel, result.usage);
  const draft = result.outcome === 'OK' ? parseSeoDraft(result.json) : null;
  const outcome: 'SUCCEEDED' | 'REFUSED' | 'FAILED' =
    result.outcome === 'REFUSED' ? 'REFUSED' : draft === null ? 'FAILED' : 'SUCCEEDED';

  let warnings: unknown[] = [];
  if (draft !== null) {
    warnings = checkSeoDraft(draft, snapshot, {
      authenticityClaimsAllowed: settings.allowAuthenticityClaims,
      bannedPhrases: settings.bannedPhrases,
      seenDescriptions: await seoSeenDescriptions(database, item.id, item.target_id),
    });
  }

  const retryAnswer = outcome === 'FAILED' && item.attempts < MAX_ATTEMPTS;
  const status = draft !== null ? 'DRAFT_READY' : retryAnswer ? 'QUEUED' : 'NEEDS_ATTENTION';
  const errorCode = draft !== null ? null : outcome === 'REFUSED' ? 'REFUSED' : result.outcome;
  const lockedUntil = retryAnswer
    ? new Date(clock().getTime() + ((options.backoffMs ?? BACKOFF_MS)[0] ?? 30_000))
    : null;
  await inTransaction(database, async (tx) => {
    await writeLedger(
      tx,
      {
        feature: 'SEO',
        runId: null,
        itemId: item.id,
        model: result.modelUsed,
        outcome,
        usage: result.usage,
        costMicroUsd: cost,
        requestId: result.requestId,
      },
      reservation.reservationId,
    );
    await tx.$executeRaw`
      UPDATE ai_seo_drafts
         SET status = ${status}, error_code = ${errorCode}, locked_until = ${lockedUntil}::timestamptz,
             draft = coalesce(${draft === null ? null : JSON.stringify(seoDraftContent(draft))}::jsonb, draft),
             warnings = CASE WHEN ${draft !== null} THEN ${JSON.stringify(warnings)}::jsonb ELSE warnings END,
             input_tokens = input_tokens + ${result.usage.inputTokens},
             cache_read_tokens = cache_read_tokens + ${result.usage.cacheReadTokens},
             cache_write_tokens = cache_write_tokens + ${result.usage.cacheWriteTokens},
             output_tokens = output_tokens + ${result.usage.outputTokens},
             cost_micro_usd = cost_micro_usd + ${cost},
             row_version = row_version + 1
       WHERE id = ${item.id}::uuid AND status = 'GENERATING'`;
  });
}

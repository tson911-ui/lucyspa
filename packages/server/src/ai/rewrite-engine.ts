import type { Prisma } from '@lucy-spa/database';
import { AiCallError, type ClaudeClient, type GenerateResult } from './claude-client.js';
import {
  isAiEffort,
  isAiModel,
  costMicroUsd,
  maxCostMicroUsd,
  type AiModel,
  type TokenUsage,
} from './prices.js';
import {
  PRODUCT_REWRITE_SCHEMA,
  PRODUCT_REWRITE_SYSTEM,
  buildProductRewriteUserMessage,
  parseProductRewrite,
  type DraftWarning,
  type ProductRewriteDraft,
  type ProductRewriteInput,
} from './product-rewrite.js';
import {
  PRODUCT_REPAIR_SCHEMA,
  PRODUCT_REPAIR_SYSTEM,
  applyRepair,
  buildRepairUserMessage,
  parseRepair,
} from './rewrite-repair.js';
import { fixDraft, sourceIngredients, type FixOptions, type RepairTarget } from './rewrite-fix.js';
import {
  loadAiSettings,
  releaseReservation,
  reserveSpend,
  writeLedger,
  type AiDatabase,
  type AiSettings,
} from './spend.js';
import { stripSupplierReviewText } from '../supplier-import/text.js';

/**
 * Claude integration Wave A (CI-R1): the draft engine for product rewrites. One call of `runRewriteTick` leases up to `concurrency` queued
 * items, writes a draft for each and returns. Nothing here changes the catalog: a draft is a row in `ai_items` that a person approves later.
 *
 * Per item: re-read the settings (the kill switch is honoured before every call), reserve the most the call may cost, call Claude without
 * tools, check the answer on the server, and write the ledger row, release the reservation and store the draft in ONE transaction, so a
 * crash can never leave money spent without a record. Failure never leaves this file: a problem that only a person can fix (key, spend limit,
 * cap, missing rate, five failures in a row) pauses the active runs; a problem of one item fails or queues that item only.
 */

export const MAX_ATTEMPTS = 3;
const MAX_OUTPUT_TOKENS = 16_000;
const CALL_TIMEOUT_MS = 180_000;
const LEASE_MINUTES = 6;
const BACKOFF_MS = [30_000, 120_000];
const CIRCUIT_LIMIT = 5;

/** What the engine knows about a product when the run is created; stored in `ai_items.base_snapshot` so a draft is always about that text. */
export interface ProductSnapshot {
  nameVi: string;
  brand: string | null;
  category: string | null;
  variantLabels: string[];
  /** The supplier's description as the catalog holds it (supplier review text already removed). */
  supplierText: string;
  attributes: { name: string; values: string[] }[];
}

export interface RewriteEngineState {
  consecutiveFailures: number;
}

export interface RewriteEngineOptions {
  now?: () => Date;
  timeoutMs?: number;
  maxTokens?: number;
  backoffMs?: readonly number[];
  /** Called with an unexpected error of one item (the item is retried by its lease); the worker logs the error name only. */
  onError?: (error: unknown) => void;
}

export interface TickResult {
  /** Items this tick took. */
  leased: number;
  /** `OFF` when the switches are off and nothing was taken. */
  idle?: 'OFF';
}

export interface LeasedItem {
  id: string;
  run_id: string;
  target_id: string;
  attempts: number;
  base_snapshot: unknown;
  instruction: string | null;
  model: string;
  effort: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
    : [];

/** The stored snapshot as the prompt input, or null when it is not usable (the item then fails with BAD_SNAPSHOT). */
export function snapshotOf(value: unknown): ProductSnapshot | null {
  if (!isObject(value) || typeof value['nameVi'] !== 'string' || value['nameVi'].trim() === '') {
    return null;
  }
  const attributes = Array.isArray(value['attributes'])
    ? value['attributes'].flatMap((entry) =>
        isObject(entry) && typeof entry['name'] === 'string'
          ? [{ name: entry['name'], values: strings(entry['values']) }]
          : [],
      )
    : [];
  return {
    nameVi: value['nameVi'],
    brand: typeof value['brand'] === 'string' ? value['brand'] : null,
    category: typeof value['category'] === 'string' ? value['category'] : null,
    variantLabels: strings(value['variantLabels']),
    supplierText: typeof value['supplierText'] === 'string' ? value['supplierText'] : '',
    attributes,
  };
}

/** The supplier's attributes as stored by the importers: a list of `{name, value}` or an object of name to value(s). */
export function attributesOf(value: unknown): { name: string; values: string[] }[] {
  const out: { name: string; values: string[] }[] = [];
  const add = (name: unknown, raw: unknown) => {
    if (typeof name !== 'string' || name.trim() === '') return;
    const values = Array.isArray(raw)
      ? strings(raw)
      : typeof raw === 'string' && raw.trim() !== ''
        ? [raw]
        : [];
    if (values.length > 0) out.push({ name: name.trim(), values });
  };
  if (Array.isArray(value)) {
    for (const entry of value)
      if (isObject(entry)) add(entry['name'], entry['value'] ?? entry['values']);
  } else if (isObject(value)) {
    for (const [name, raw] of Object.entries(value)) add(name, raw);
  }
  return out;
}

/**
 * The snapshot of one product for a draft: its names, brand, category, variant labels, the catalog's description (the supplier's copy) with
 * the supplier's customer comments removed again, and the supplier attributes of the source record the product was imported from.
 * Returns the row version it was read at: apply refuses a product that changed since.
 */
export async function buildProductSnapshot(
  database: AiDatabase,
  productId: string,
): Promise<{ snapshot: ProductSnapshot; rowVersion: number } | null> {
  const product = await database.product.findUnique({
    where: { id: productId },
    select: {
      rowVersion: true,
      nameVi: true,
      descriptionVi: true,
      brand: { select: { nameVi: true } },
      category: { select: { nameVi: true } },
      variants: {
        where: { isActive: true },
        orderBy: { sortOrder: 'asc' },
        select: { labelVi: true },
      },
      importedCandidates: {
        take: 1,
        orderBy: { createdAt: 'desc' },
        select: { sources: { select: { sourceRecord: { select: { attributes: true } } } } },
      },
    },
  });
  if (product === null) return null;
  const attributes = (product.importedCandidates[0]?.sources ?? []).flatMap((link) =>
    attributesOf(link.sourceRecord.attributes),
  );
  return {
    rowVersion: product.rowVersion,
    snapshot: {
      nameVi: product.nameVi,
      brand: product.brand?.nameVi ?? null,
      category: product.category?.nameVi ?? null,
      variantLabels: product.variants.flatMap((variant) =>
        variant.labelVi ? [variant.labelVi] : [],
      ),
      supplierText: stripSupplierReviewText(product.descriptionVi ?? '').text,
      attributes,
    },
  };
}

/** The shop's city for local-search wording: the last part of the shop address ("04 Nguyễn Quang Bích, Đà Nẵng" gives "Đà Nẵng"). */
export async function shopCity(database: AiDatabase): Promise<string> {
  const rows = await database.$queryRaw<{ address: string }[]>`
    SELECT address FROM website_shop_info ORDER BY id LIMIT 1`;
  const parts = (rows[0]?.address ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && !/^(vi[eệ]t\s?nam)$/i.test(part));
  return parts.at(-1) ?? 'Việt Nam';
}

/** The worker passes its client (a transaction is opened here); a test may pass a transaction client so everything rolls back. */
function inTransaction<T>(
  database: AiDatabase,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return '$transaction' in database ? database.$transaction(work) : work(database);
}

// ------------------------------------------------------------------------------------------------------------------ item state

/** Why runs were paused (`ai_runs.pause_reason`); the screen shows a plain Vietnamese sentence for each. */
export type PauseReason =
  | 'NO_RATE'
  | 'CAP_MONTH'
  | 'CAP_FEATURE'
  | 'KEY_MISSING'
  | 'AUTH_FAILED'
  | 'LIMIT_REACHED'
  | 'CIRCUIT';

async function pauseActiveRuns(database: AiDatabase, reason: PauseReason): Promise<void> {
  const status = reason === 'CAP_MONTH' || reason === 'CAP_FEATURE' ? 'PAUSED_CAP' : 'PAUSED_ERROR';
  await database.$executeRaw`
    UPDATE ai_runs
       SET status = ${status}, pause_reason = ${reason}, row_version = row_version + 1, updated_at = clock_timestamp()
     WHERE kind = 'PRODUCT_TEXT' AND status IN ('QUEUED', 'RUNNING')`;
}

/** Puts a leased item back in the queue. `give` returns the attempt this lease used (a pause or the kill switch is not the item's fault). */
async function requeue(
  database: AiDatabase,
  id: string,
  options: { until: Date | null; giveAttemptBack: boolean },
): Promise<void> {
  await database.$executeRaw`
    UPDATE ai_items
       SET status = 'QUEUED', locked_until = ${options.until}::timestamptz,
           attempts = GREATEST(attempts - ${options.giveAttemptBack ? 1 : 0}, 0),
           row_version = row_version + 1, updated_at = clock_timestamp()
     WHERE id = ${id}::uuid AND status = 'GENERATING'`;
}

async function failItem(
  database: AiDatabase,
  id: string,
  status: 'FAILED' | 'NEEDS_ATTENTION',
  errorCode: string,
): Promise<void> {
  await database.$executeRaw`
    UPDATE ai_items
       SET status = ${status}, error_code = ${errorCode}, locked_until = NULL, row_version = row_version + 1, updated_at = clock_timestamp()
     WHERE id = ${id}::uuid AND status = 'GENERATING'`;
}

/** A run with nothing queued or generating any more is done (its drafts wait for a person). */
async function closeFinishedRuns(database: AiDatabase, runId: string): Promise<void> {
  await database.$executeRaw`
    UPDATE ai_runs r
       SET status = 'DONE', finished_at = clock_timestamp(), pause_reason = NULL, row_version = row_version + 1, updated_at = clock_timestamp()
     WHERE r.id = ${runId}::uuid AND r.status IN ('QUEUED', 'RUNNING')
       AND NOT EXISTS (SELECT 1 FROM ai_items i WHERE i.run_id = r.id AND i.status IN ('QUEUED', 'GENERATING'))`;
}

// ------------------------------------------------------------------------------------------------------------------ the tick

/** Takes up to `count` queued items (or items whose lease ran out) for this worker; the same item is never given twice. */
export async function leaseRewriteItems(
  database: AiDatabase,
  count: number,
  now: Date,
): Promise<LeasedItem[]> {
  // An item whose lease ran out three times (the process died mid-call) is failed, not retried forever.
  await database.$executeRaw`
    UPDATE ai_items
       SET status = 'FAILED', error_code = 'LEASE_EXPIRED', locked_until = NULL, row_version = row_version + 1, updated_at = clock_timestamp()
     WHERE kind = 'PRODUCT_TEXT' AND status = 'GENERATING' AND locked_until <= ${now}::timestamptz AND attempts >= ${MAX_ATTEMPTS}`;
  const leased = await database.$queryRaw<LeasedItem[]>`
    WITH picked AS (
      SELECT i.id
        FROM ai_items i JOIN ai_runs r ON r.id = i.run_id
       WHERE i.kind = 'PRODUCT_TEXT' AND r.status IN ('QUEUED', 'RUNNING')
         AND ((i.status = 'QUEUED' AND (i.locked_until IS NULL OR i.locked_until <= ${now}::timestamptz))
           OR (i.status = 'GENERATING' AND i.locked_until <= ${now}::timestamptz))
       ORDER BY i.created_at, i.id
       LIMIT ${count}
         FOR UPDATE OF i SKIP LOCKED)
    UPDATE ai_items i
       SET status = 'GENERATING', attempts = i.attempts + 1,
           locked_until = ${now}::timestamptz + make_interval(mins => ${LEASE_MINUTES}),
           row_version = i.row_version + 1, updated_at = clock_timestamp()
      FROM picked, ai_runs r
     WHERE i.id = picked.id AND r.id = i.run_id
 RETURNING i.id, i.run_id, i.target_id, i.attempts, i.base_snapshot, i.instruction, r.model, r.effort`;
  if (leased.length > 0) {
    await database.$executeRaw`
      UPDATE ai_runs
         SET status = 'RUNNING', started_at = coalesce(started_at, clock_timestamp()), row_version = row_version + 1, updated_at = clock_timestamp()
       WHERE status = 'QUEUED' AND id = ANY(${[...new Set(leased.map((item) => item.run_id))]}::uuid[])`;
  }
  return leased;
}

export async function runRewriteTick(
  database: AiDatabase,
  client: ClaudeClient,
  state: RewriteEngineState,
  options: RewriteEngineOptions = {},
): Promise<TickResult> {
  const clock = options.now ?? (() => new Date());
  const settings = await loadAiSettings(database);
  if (!settings.enabled || !settings.rewriteEnabled) return { leased: 0, idle: 'OFF' };
  const items = await leaseRewriteItems(database, settings.concurrency, clock());
  if (items.length === 0) return { leased: 0 };
  const city = await shopCity(database);
  await Promise.all(
    items.map((item) =>
      processItem(database, client, state, item, city, options).catch((error: unknown) => {
        // The lease expires and the item is tried again (or failed after three leases); the caller decides how to log (never the product text).
        options.onError?.(error);
      }),
    ),
  );
  return { leased: items.length };
}

const REPAIR_MAX_TOKENS = 4_000;

/** The input of a rewrite (and of its repair) from the stored snapshot and the current settings. */
export function rewriteInputOf(
  snapshot: ProductSnapshot,
  settings: AiSettings,
  city: string,
  instruction: string | null,
): ProductRewriteInput {
  return {
    nameVi: snapshot.nameVi,
    brand: snapshot.brand,
    category: snapshot.category,
    variantLabels: snapshot.variantLabels,
    supplierText: snapshot.supplierText,
    attributes: snapshot.attributes,
    city,
    authenticityClaimsAllowed: settings.allowAuthenticityClaims,
    instruction,
  };
}

/** What the checks and the free fixes need to know about one product. */
export function fixOptionsOf(
  snapshot: ProductSnapshot,
  settings: AiSettings,
  seen: { titles?: ReadonlySet<string>; descriptions?: ReadonlySet<string> } = {},
): FixOptions {
  return {
    supplierText: snapshot.supplierText,
    attributes: snapshot.attributes,
    brand: snapshot.brand,
    nameVi: snapshot.nameVi,
    authenticityClaimsAllowed: settings.allowAuthenticityClaims,
    bannedPhrases: settings.bannedPhrases,
    ingredientList: sourceIngredients(snapshot.supplierText, snapshot.attributes),
    ...(seen.titles ? { seenTitles: seen.titles } : {}),
    ...(seen.descriptions ? { seenDescriptions: seen.descriptions } : {}),
  };
}

export interface RepairDone {
  draft: ProductRewriteDraft;
  warnings: DraftWarning[];
  targets: RepairTarget[];
  usage: TokenUsage;
  cost: bigint;
  /** The model rewrote at least one field. */
  changed: boolean;
}

/** The most one repair call can cost (what it reserves): used to keep a batch of repairs under a spending limit before any call is made. */
export function repairMaxCost(
  args: Pick<RepairArgs, 'input' | 'draft' | 'targets' | 'model'>,
): bigint {
  const user = buildRepairUserMessage(args.input, args.draft, args.targets);
  const estimatedInput = Math.ceil((PRODUCT_REPAIR_SYSTEM.length + user.length) / 2) + 500;
  return maxCostMicroUsd(args.model, estimatedInput, REPAIR_MAX_TOKENS);
}

export interface RepairArgs {
  item: { id: string; runId: string | null };
  model: AiModel;
  settings: AiSettings;
  input: ProductRewriteInput;
  draft: ProductRewriteDraft;
  targets: readonly RepairTarget[];
  fixOptions: FixOptions;
  now: () => Date;
  timeoutMs: number;
  /** Stores the repaired draft in the same transaction as the ledger row (so money is never spent without a record). */
  persist: (tx: Prisma.TransactionClient, done: RepairDone) => Promise<void>;
}

/**
 * The one targeted repair of a draft (CI-F1): reserve, one call that rewrites only the failing fields, free fixes again on the result,
 * check, then the ledger row (`REPAIRED`, or `REPAIR_FAILED` when nothing usable came back) and `persist` in one transaction. Returns null
 * when nothing was spent: the switches are off, the cap refuses, or the request failed before any token; the caller then keeps the draft as it is.
 */
export async function repairOnce(
  database: AiDatabase,
  client: ClaudeClient,
  args: RepairArgs,
): Promise<RepairDone | null> {
  const settings = await loadAiSettings(database);
  if (!settings.enabled || !settings.rewriteEnabled) return null;
  const user = buildRepairUserMessage(args.input, args.draft, args.targets);
  const reservation = await reserveSpend(database, {
    feature: 'PRODUCT_REWRITE',
    itemId: args.item.id,
    amountMicroUsd: repairMaxCost(args),
    settings,
    now: args.now(),
  });
  if (!reservation.ok) return null;
  let result: GenerateResult;
  try {
    result = await client.generateJson({
      model: args.model,
      effort: 'low',
      system: PRODUCT_REPAIR_SYSTEM,
      user,
      schema: PRODUCT_REPAIR_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: REPAIR_MAX_TOKENS,
      timeoutMs: args.timeoutMs,
      refusalFallback: settings.refusalFallback,
    });
  } catch {
    await releaseReservation(database, reservation.reservationId);
    return null;
  }
  const billedModel = isAiModel(result.modelUsed) ? result.modelUsed : args.model;
  const cost = costMicroUsd(billedModel, result.usage);
  const repaired = result.outcome === 'OK' ? parseRepair(result.json, args.targets) : null;
  let draft = args.draft;
  let changed = false;
  if (repaired !== null && repaired.size > 0) {
    const applied = applyRepair(args.draft, repaired, args.targets);
    // The model's text gets the same free tidying (lengths, markup) and is kept only when it leaves no more problems than before.
    const tidy = fixDraft(applied.draft, args.fixOptions);
    const before = fixDraft(args.draft, args.fixOptions);
    if (tidy.targets.length <= before.targets.length) {
      changed = applied.fixes.length > 0;
      draft = {
        ...tidy.draft,
        autoFixes: [...(args.draft.autoFixes ?? []), ...applied.fixes, ...tidy.fixes],
      };
    }
  }
  const final = fixDraft(draft, args.fixOptions);
  const done: RepairDone = {
    draft:
      final.fixes.length > 0
        ? { ...final.draft, autoFixes: [...(draft.autoFixes ?? []), ...final.fixes] }
        : final.draft,
    warnings: final.warnings,
    targets: final.targets,
    usage: result.usage,
    cost,
    changed,
  };
  await inTransaction(database, async (tx) => {
    await writeLedger(
      tx,
      {
        feature: 'PRODUCT_REWRITE',
        runId: args.item.runId,
        itemId: args.item.id,
        model: result.modelUsed,
        outcome: changed ? 'REPAIRED' : 'REPAIR_FAILED',
        usage: result.usage,
        costMicroUsd: cost,
        requestId: result.requestId,
      },
      reservation.reservationId,
    );
    await args.persist(tx, done);
  });
  return done;
}

async function processItem(
  database: AiDatabase,
  client: ClaudeClient,
  state: RewriteEngineState,
  item: LeasedItem,
  city: string,
  options: RewriteEngineOptions,
): Promise<void> {
  const clock = options.now ?? (() => new Date());
  // The kill switch and the caps are read again for every item: a switch turned off a second ago stops the next call.
  const settings = await loadAiSettings(database);
  if (!settings.enabled || !settings.rewriteEnabled) {
    await requeue(database, item.id, { until: null, giveAttemptBack: true });
    return;
  }
  const snapshot = snapshotOf(item.base_snapshot);
  if (snapshot === null || !isAiModel(item.model) || !isAiEffort(item.effort)) {
    await failItem(database, item.id, 'FAILED', 'BAD_SNAPSHOT');
    await closeFinishedRuns(database, item.run_id);
    return;
  }
  const model: AiModel = item.model;
  const input = rewriteInputOf(snapshot, settings, city, item.instruction);
  const user = buildProductRewriteUserMessage(input);
  // Vietnamese costs about one token per two characters; the estimate is deliberately high so the reservation covers the call.
  const estimatedInput = Math.ceil((PRODUCT_REWRITE_SYSTEM.length + user.length) / 2) + 500;
  const maxTokens = options.maxTokens ?? MAX_OUTPUT_TOKENS;
  const reservation = await reserveSpend(database, {
    feature: 'PRODUCT_REWRITE',
    itemId: item.id,
    amountMicroUsd: maxCostMicroUsd(model, estimatedInput, maxTokens),
    settings,
    now: clock(),
  });
  if (!reservation.ok) {
    await requeue(database, item.id, { until: null, giveAttemptBack: true });
    await pauseActiveRuns(database, reservation.reason);
    return;
  }

  let result: GenerateResult;
  try {
    result = await client.generateJson({
      model,
      effort: item.effort,
      system: PRODUCT_REWRITE_SYSTEM,
      user,
      schema: PRODUCT_REWRITE_SCHEMA as unknown as Record<string, unknown>,
      maxTokens,
      timeoutMs: options.timeoutMs ?? CALL_TIMEOUT_MS,
      refusalFallback: settings.refusalFallback,
    });
  } catch (error) {
    // Nothing was billed (the request failed or never left): release the hold and decide what the item and the runs do.
    await releaseReservation(database, reservation.reservationId);
    const code = error instanceof AiCallError ? error.code : 'ERROR';
    if (error instanceof AiCallError && error.blocksEverything) {
      await requeue(database, item.id, { until: null, giveAttemptBack: true });
      await pauseActiveRuns(
        database,
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
      await closeFinishedRuns(database, item.run_id);
    }
    if (state.consecutiveFailures >= CIRCUIT_LIMIT) {
      state.consecutiveFailures = 0;
      await pauseActiveRuns(database, 'CIRCUIT');
    }
    return;
  }

  state.consecutiveFailures = 0;
  const billedModel = isAiModel(result.modelUsed) ? result.modelUsed : model;
  const cost = costMicroUsd(billedModel, result.usage);
  const draft = result.outcome === 'OK' ? parseProductRewrite(result.json) : null;
  const outcome: 'SUCCEEDED' | 'REFUSED' | 'FAILED' =
    result.outcome === 'REFUSED' ? 'REFUSED' : draft === null ? 'FAILED' : 'SUCCEEDED';

  // CI-F1: the draft is made complete before it is saved. Free code fixes first; what they cannot repair gets one targeted model call.
  let warnings: unknown[] = [];
  let stored = draft;
  let targets: RepairTarget[] = [];
  let fixOptions: FixOptions | null = null;
  if (draft !== null) {
    const seen = await database.$queryRaw<{ title: string | null; description: string | null }[]>`
      SELECT draft ->> 'seoTitleVi' AS title, draft ->> 'seoDescriptionVi' AS description
        FROM ai_items
       WHERE run_id = ${item.run_id}::uuid AND id <> ${item.id}::uuid AND draft IS NOT NULL`;
    fixOptions = fixOptionsOf(snapshot, settings, {
      titles: new Set(seen.flatMap((row) => (row.title ? [row.title] : []))),
      descriptions: new Set(seen.flatMap((row) => (row.description ? [row.description] : []))),
    });
    const fixed = fixDraft(draft, fixOptions);
    stored = fixed.fixes.length > 0 ? { ...fixed.draft, autoFixes: fixed.fixes } : fixed.draft;
    warnings = fixed.warnings;
    targets = fixed.targets;
  }
  // The repair call happens after the first call's ledger row is written; the item stays leased (GENERATING) until it is done.
  const needsRepair = stored !== null && fixOptions !== null && targets.length > 0;

  // A refusal is final (a person decides); an answer that was cut off or not valid JSON is tried once more, then needs a person.
  const retryAnswer = outcome === 'FAILED' && item.attempts < MAX_ATTEMPTS;
  const status =
    draft !== null
      ? needsRepair
        ? 'GENERATING'
        : 'DRAFT_READY'
      : retryAnswer
        ? 'QUEUED'
        : 'NEEDS_ATTENTION';
  const errorCode = draft !== null ? null : outcome === 'REFUSED' ? 'REFUSED' : result.outcome;
  const lockedUntil = retryAnswer
    ? new Date(clock().getTime() + ((options.backoffMs ?? BACKOFF_MS)[0] ?? 30_000))
    : needsRepair
      ? new Date(clock().getTime() + LEASE_MINUTES * 60_000)
      : null;
  await inTransaction(database, async (tx) => {
    await writeLedger(
      tx,
      {
        feature: 'PRODUCT_REWRITE',
        runId: item.run_id,
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
      UPDATE ai_items
         SET status = ${status}, error_code = ${errorCode}, locked_until = ${lockedUntil}::timestamptz,
             draft = coalesce(${stored === null ? null : JSON.stringify(stored)}::jsonb, draft),
             warnings = CASE WHEN ${draft !== null} THEN ${JSON.stringify(warnings)}::jsonb ELSE warnings END,
             input_tokens = input_tokens + ${result.usage.inputTokens},
             cache_read_tokens = cache_read_tokens + ${result.usage.cacheReadTokens},
             cache_write_tokens = cache_write_tokens + ${result.usage.cacheWriteTokens},
             output_tokens = output_tokens + ${result.usage.outputTokens},
             cost_micro_usd = cost_micro_usd + ${cost},
             row_version = row_version + 1, updated_at = clock_timestamp()
       WHERE id = ${item.id}::uuid AND status = 'GENERATING'`;
  });
  if (needsRepair && stored !== null && fixOptions !== null) {
    const done = await repairOnce(database, client, {
      item: { id: item.id, runId: item.run_id },
      model,
      settings,
      input,
      draft: stored,
      targets,
      fixOptions,
      now: clock,
      timeoutMs: options.timeoutMs ?? CALL_TIMEOUT_MS,
      persist: async (tx, repaired) => {
        await tx.$executeRaw`
          UPDATE ai_items
             SET status = 'DRAFT_READY', locked_until = NULL,
                 draft = ${JSON.stringify(repaired.draft)}::jsonb,
                 warnings = ${JSON.stringify(repaired.warnings)}::jsonb,
                 input_tokens = input_tokens + ${repaired.usage.inputTokens},
                 cache_read_tokens = cache_read_tokens + ${repaired.usage.cacheReadTokens},
                 cache_write_tokens = cache_write_tokens + ${repaired.usage.cacheWriteTokens},
                 output_tokens = output_tokens + ${repaired.usage.outputTokens},
                 cost_micro_usd = cost_micro_usd + ${repaired.cost},
                 row_version = row_version + 1, updated_at = clock_timestamp()
           WHERE id = ${item.id}::uuid AND status = 'GENERATING'`;
      },
    }).catch((error: unknown) => {
      options.onError?.(error);
      return null;
    });
    if (done === null) {
      // Nothing was spent (switches off, cap, a failed request): the free-fixed draft is the draft, its notes stay for the Owner to read.
      await database.$executeRaw`
        UPDATE ai_items
           SET status = 'DRAFT_READY', locked_until = NULL, row_version = row_version + 1, updated_at = clock_timestamp()
         WHERE id = ${item.id}::uuid AND status = 'GENERATING'`;
    }
  }
  await closeFinishedRuns(database, item.run_id);
}

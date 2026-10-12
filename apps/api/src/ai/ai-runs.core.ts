import {
  AI_RUN_LIMITS,
  AI_RUN_SCOPES,
  type AiRunBlock,
  type AiRunCommandRequest,
  type AiRunCreateRequest,
  type AiRunItemCounts,
  type AiRunList,
  type AiRunPreview,
  type AiRunRow,
  type AiRunScope,
  type AiRunStatus,
  type AiRunUnlockRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  PRODUCT_REWRITE_PROMPT_VERSION,
  PRODUCT_REWRITE_SYSTEM,
  buildProductSnapshot,
  costMicroUsd,
  isAiEffort,
  isAiModel,
  loadAiSettings,
  microUsdToVnd,
  monthSpend,
  vndToMicroUsd,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { requireUse } from './ai-drafts.core.js';

/**
 * Claude integration Wave A (CI-R3): starting, pausing, resuming and cancelling the runs that write drafts. Starting a run writes the
 * run and its items (each with the product's text as it is now) and an audit event; it makes no call to Anthropic and changes no product.
 * The Owner's rules are enforced here and never only on the screen: the first run is exactly three products, writing more than three at
 * once stays locked until the Owner has judged three drafts and presses "Cho phép chạy tiếp" (`MANAGE_AI_SETTINGS`), only products that
 * are still the supplier's copy and have no open draft are taken, and only one run is open at a time.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A product with less supplier text than this has nothing to rewrite from. */
const MIN_SUPPLIER_CHARS = 20;
/** What a typical draft writes (thinking and the answer), for the estimate; the reservation uses the larger worst case. */
const TYPICAL_OUTPUT_TOKENS = 6_000;
const OPEN = ['QUEUED', 'RUNNING', 'PAUSED_CAP', 'PAUSED_USER', 'PAUSED_ERROR'] as const;

interface Candidate {
  id: string;
  chars: number;
}

/** Products that are still the supplier's copy, have text to rewrite from and no open draft, in the order they were added. */
async function candidates(
  context: AdminContext,
  limit: number,
  ids?: readonly string[],
): Promise<Candidate[]> {
  const rows = await context.tx.$queryRaw<{ id: string; chars: number }[]>`
    SELECT p.id, char_length(btrim(coalesce(p.description_vi, '')))::int AS chars
      FROM products p
     WHERE p.content_origin = 'SUPPLIER_COPY'
       AND char_length(btrim(coalesce(p.description_vi, ''))) >= ${MIN_SUPPLIER_CHARS}
       AND (${ids === undefined}::boolean OR p.id = ANY(${ids ?? []}::uuid[]))
       AND NOT EXISTS (SELECT 1 FROM ai_items i
                        WHERE i.kind = 'PRODUCT_TEXT' AND i.target_id = p.id AND i.status NOT IN ('APPLIED', 'REJECTED'))
     ORDER BY p.created_at, p.id
     LIMIT ${limit}`;
  return rows;
}

async function pendingCount(context: AdminContext): Promise<number> {
  const rows = await context.tx.$queryRaw<{ n: bigint }[]>`
    SELECT count(*) AS n FROM products p
     WHERE p.content_origin = 'SUPPLIER_COPY'
       AND char_length(btrim(coalesce(p.description_vi, ''))) >= ${MIN_SUPPLIER_CHARS}
       AND NOT EXISTS (SELECT 1 FROM ai_items i
                        WHERE i.kind = 'PRODUCT_TEXT' AND i.target_id = p.id AND i.status NOT IN ('APPLIED', 'REJECTED'))`;
  return Number(rows[0]?.n ?? 0n);
}

function scopeOf(value: unknown): AiRunScope {
  if (typeof value !== 'string' || !(AI_RUN_SCOPES as readonly string[]).includes(value)) {
    throw new AuthError('VALIDATION_FAILED', 'scope');
  }
  return value as AiRunScope;
}

function limitOf(value: unknown, fallback: number): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > AI_RUN_LIMITS.runMax
  ) {
    throw new AuthError('VALIDATION_FAILED', 'limit');
  }
  return value;
}

function idsOf(value: unknown): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.length > AI_RUN_LIMITS.selectionMax ||
    value.some((id) => typeof id !== 'string' || !ID.test(id)) ||
    new Set(value as string[]).size !== value.length
  ) {
    throw new AuthError('VALIDATION_FAILED', 'productIds');
  }
  return value as string[];
}

interface Plan {
  scope: AiRunScope;
  picked: Candidate[];
  preview: AiRunPreview;
}

/** What a run would take and whether it may start; the same function backs the preview and the creation, so they cannot disagree. */
async function plan(
  context: AdminContext,
  scope: AiRunScope,
  options: { limit?: unknown; productIds?: unknown },
): Promise<Plan> {
  const { tx } = context;
  const settings = await loadAiSettings(tx);
  const unlocked = settings.runAllUnlockedAt !== null;
  const blocked: AiRunBlock[] = [];
  if (!settings.enabled) blocked.push('OFF');
  else if (!settings.rewriteEnabled) blocked.push('REWRITE_OFF');
  if (settings.vndPerUsd === null) blocked.push('NO_RATE');
  const open = await tx.aiRun.count({ where: { kind: 'PRODUCT_TEXT', status: { in: [...OPEN] } } });
  if (open > 0) blocked.push('RUN_ACTIVE');

  let picked: Candidate[];
  if (scope === 'FIRST_THREE') {
    const earlier = await tx.aiRun.count({
      where: { kind: 'PRODUCT_TEXT', scope: 'FIRST_THREE', status: { not: 'CANCELLED' } },
    });
    if (earlier > 0) blocked.push('FIRST_THREE_DONE');
    picked = await candidates(context, AI_RUN_LIMITS.firstRunSize);
  } else if (scope === 'SELECTION') {
    const ids = idsOf(options.productIds);
    picked = await candidates(context, ids.length, ids);
    // Every named product must be one a run may take (a product that is already rewritten or already queued is refused, not skipped).
    if (picked.length !== ids.length) throw new AuthError('VALIDATION_FAILED', 'productIds');
    if (picked.length > AI_RUN_LIMITS.firstRunSize && !unlocked) blocked.push('LOCKED');
  } else {
    if (!unlocked) blocked.push('LOCKED');
    picked = await candidates(context, limitOf(options.limit, AI_RUN_LIMITS.runMax));
  }
  if (picked.length === 0 && !blocked.includes('FIRST_THREE_DONE'))
    blocked.push('NOTHING_TO_WRITE');

  const model = settings.rewriteModel;
  const effort = settings.rewriteEffort;
  let estimateMicro = 0n;
  if (isAiModel(model)) {
    for (const entry of picked) {
      const input = Math.ceil((PRODUCT_REWRITE_SYSTEM.length + entry.chars + 1_500) / 2);
      estimateMicro += costMicroUsd(model, {
        inputTokens: input,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: TYPICAL_OUTPUT_TOKENS,
      });
    }
  }
  const rate = settings.vndPerUsd;
  let capLeftVnd: string | null = null;
  if (rate !== null) {
    const month = await monthSpend(tx, null);
    const feature = await monthSpend(tx, 'PRODUCT_REWRITE');
    const monthCap = vndToMicroUsd(settings.monthlyCapVnd, rate);
    const featureCapVnd = settings.featureCapsVnd['PRODUCT_REWRITE'];
    const featureCap =
      featureCapVnd === undefined ? monthCap : vndToMicroUsd(BigInt(featureCapVnd), rate);
    const left = [
      monthCap - month.spentMicroUsd - month.reservedMicroUsd,
      featureCap - feature.spentMicroUsd - feature.reservedMicroUsd,
    ].reduce((least, value) => (value < least ? value : least));
    capLeftVnd = String(microUsdToVnd(left < 0n ? 0n : left, rate));
  }
  return {
    scope,
    picked,
    preview: {
      scope,
      count: picked.length,
      pending: await pendingCount(context),
      model,
      effort,
      estimateVnd: rate === null ? null : String(microUsdToVnd(estimateMicro, rate)),
      capLeftVnd,
      blocked,
      unlocked,
    },
  };
}

export async function previewRun(
  context: AdminContext,
  query: { scope?: unknown; limit?: unknown; productIds?: unknown },
): Promise<AiRunPreview> {
  requireUse(context);
  return (await plan(context, scopeOf(query.scope), query)).preview;
}

export async function createRun(
  context: AdminContext,
  request: AiRunCreateRequest,
): Promise<AiRunRow> {
  requireUse(context);
  const { tx } = context;
  // Two people pressing "Chạy" at once must not both start: the check and the insert are one step under this lock.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('lucy-ai-run-create'))`;
  const scope = scopeOf(request.scope);
  const planned = await plan(context, scope, request);
  if (planned.preview.blocked.length > 0) {
    throw new AuthError('CONFLICT', planned.preview.blocked[0]);
  }
  const settings = await loadAiSettings(tx);
  if (!isAiModel(settings.rewriteModel) || !isAiEffort(settings.rewriteEffort)) {
    throw new AuthError('VALIDATION_FAILED', 'rewriteModel');
  }
  const rate = settings.vndPerUsd!;
  const run = await tx.aiRun.create({
    data: {
      kind: 'PRODUCT_TEXT',
      scope,
      model: settings.rewriteModel,
      effort: settings.rewriteEffort,
      promptVersion: PRODUCT_REWRITE_PROMPT_VERSION,
      estimatedCostMicroUsd: vndToMicroUsd(BigInt(planned.preview.estimateVnd ?? '0'), rate),
      startedByUserId: context.actor.userId,
    },
  });
  for (const entry of planned.picked) {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${entry.id}::uuid FOR UPDATE`;
    const built = await buildProductSnapshot(tx, entry.id);
    if (built === null) throw new AuthError('NOT_FOUND');
    await tx.aiItem.create({
      data: {
        runId: run.id,
        kind: 'PRODUCT_TEXT',
        targetType: 'PRODUCT',
        targetId: entry.id,
        baseRowVersion: built.rowVersion,
        baseSnapshot: built.snapshot as unknown as Prisma.InputJsonObject,
      },
    });
  }
  await appendAdminAudit(context, {
    action: 'AI_RUN_CREATED',
    entityType: 'AiRun',
    entityId: run.id,
    after: {
      scope,
      products: planned.picked.length,
      model: run.model,
      effort: run.effort,
      estimateVnd: planned.preview.estimateVnd,
    },
  });
  return (await rowsOf(context, [run.id]))[0]!;
}

// ------------------------------------------------------------------------------------------------------------------ listing

const emptyCounts = (): AiRunItemCounts => ({
  total: 0,
  queued: 0,
  generating: 0,
  draftReady: 0,
  needsAttention: 0,
  failed: 0,
  applied: 0,
  rejected: 0,
  stale: 0,
});

const COUNT_KEY: Record<string, keyof AiRunItemCounts> = {
  QUEUED: 'queued',
  GENERATING: 'generating',
  DRAFT_READY: 'draftReady',
  NEEDS_ATTENTION: 'needsAttention',
  FAILED: 'failed',
  APPLIED: 'applied',
  REJECTED: 'rejected',
  STALE: 'stale',
};

async function rowsOf(context: AdminContext, ids: readonly string[]): Promise<AiRunRow[]> {
  const { tx } = context;
  const runs = await tx.aiRun.findMany({
    where: { id: { in: [...ids] } },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  const groups = await tx.aiItem.groupBy({
    by: ['runId', 'status'],
    where: { runId: { in: [...ids] } },
    _count: { _all: true },
    _sum: { costMicroUsd: true },
  });
  const settings = await tx.aiSettings.findUniqueOrThrow({
    where: { id: 1 },
    select: { vndPerUsd: true },
  });
  const users = await tx.user.findMany({
    where: { id: { in: runs.map((run) => run.startedByUserId) } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((user) => [user.id, user.fullName]));
  return runs.map((run) => {
    const counts = emptyCounts();
    let spent = 0n;
    for (const group of groups.filter((entry) => entry.runId === run.id)) {
      const key = COUNT_KEY[group.status];
      if (key) counts[key] += group._count._all;
      counts.total += group._count._all;
      spent += group._sum.costMicroUsd ?? 0n;
    }
    const rate = settings.vndPerUsd;
    return {
      id: run.id,
      scope: run.scope as AiRunScope,
      status: run.status as AiRunStatus,
      pauseReason: run.pauseReason,
      model: run.model,
      effort: run.effort,
      estimateVnd: rate === null ? null : String(microUsdToVnd(run.estimatedCostMicroUsd, rate)),
      spentVnd: rate === null ? null : String(microUsdToVnd(spent, rate)),
      counts,
      rowVersion: run.rowVersion,
      startedByName: names.get(run.startedByUserId) ?? '',
      createdAt: run.createdAt.toISOString(),
      finishedAt: run.finishedAt?.toISOString() ?? null,
    };
  });
}

export async function listRuns(context: AdminContext): Promise<AiRunList> {
  requireUse(context);
  const { tx } = context;
  const latest = await tx.aiRun.findMany({
    where: { kind: 'PRODUCT_TEXT' },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    take: 10,
    select: { id: true },
  });
  const settings = await tx.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
  const [single, reviewed] = await Promise.all([
    tx.aiItem.count({ where: { kind: 'PRODUCT_TEXT', status: 'APPLIED', appliedVia: 'SINGLE' } }),
    tx.aiItem.count({
      where: {
        kind: 'PRODUCT_TEXT',
        status: { in: ['APPLIED', 'REJECTED'] },
        reviewedAt: { not: null },
      },
    }),
  ]);
  const unlocked = settings.runAllUnlockedAt !== null;
  return {
    runs: await rowsOf(
      context,
      latest.map((run) => run.id),
    ),
    singleApplied: single,
    reviewed,
    unlocked,
    unlockedAt: settings.runAllUnlockedAt?.toISOString() ?? null,
    settingsRowVersion: settings.rowVersion,
    canUnlock:
      !unlocked &&
      reviewed >= AI_RUN_LIMITS.firstRunSize &&
      decide(context.actor.graph, 'MANAGE_AI_SETTINGS', GLOBAL),
  };
}

// ------------------------------------------------------------------------------------------------------------------ commands

export async function commandRun(
  context: AdminContext,
  id: string,
  command: 'pause' | 'resume' | 'cancel',
  request: AiRunCommandRequest,
): Promise<AiRunRow> {
  requireUse(context);
  const { tx } = context;
  if (!ID.test(id)) throw new AuthError('NOT_FOUND');
  if (!Number.isInteger(request.expectedRowVersion) || request.expectedRowVersion < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  await tx.$queryRaw`SELECT id FROM ai_runs WHERE id = ${id}::uuid FOR UPDATE`;
  const run = await tx.aiRun.findUnique({ where: { id } });
  if (run === null || run.kind !== 'PRODUCT_TEXT') throw new AuthError('NOT_FOUND');
  if (run.rowVersion !== request.expectedRowVersion) throw new AuthError('CONFLICT');
  const status = run.status as AiRunStatus;
  let next: AiRunStatus;
  if (command === 'pause') {
    if (status !== 'QUEUED' && status !== 'RUNNING') throw new AuthError('CONFLICT');
    next = 'PAUSED_USER';
  } else if (command === 'resume') {
    if (status !== 'PAUSED_USER' && status !== 'PAUSED_CAP' && status !== 'PAUSED_ERROR') {
      throw new AuthError('CONFLICT');
    }
    next = 'QUEUED';
  } else {
    if (!(OPEN as readonly string[]).includes(status)) throw new AuthError('CONFLICT');
    next = 'CANCELLED';
  }
  await tx.aiRun.update({
    where: { id },
    data: {
      status: next,
      pauseReason: next === 'PAUSED_USER' ? 'USER' : null,
      finishedAt: next === 'CANCELLED' ? context.now : null,
      rowVersion: run.rowVersion + 1,
    },
  });
  let released = 0;
  if (next === 'CANCELLED') {
    // Queued items are history now (so their products are free again); an item the worker is writing right now finishes on its own.
    released = await tx.$executeRaw`
      UPDATE ai_items
         SET status = 'REJECTED', error_code = 'RUN_CANCELLED', locked_until = NULL, row_version = row_version + 1,
             updated_at = clock_timestamp()
       WHERE run_id = ${id}::uuid AND status = 'QUEUED'`;
  }
  await appendAdminAudit(context, {
    action:
      command === 'pause'
        ? 'AI_RUN_PAUSED'
        : command === 'resume'
          ? 'AI_RUN_RESUMED'
          : 'AI_RUN_CANCELLED',
    entityType: 'AiRun',
    entityId: id,
    after: { from: status, to: next, ...(command === 'cancel' ? { releasedItems: released } : {}) },
  });
  return (await rowsOf(context, [id]))[0]!;
}

/**
 * "Cho phép chạy tiếp": the Owner has looked at the first three drafts and allows runs of more than three. Needs three drafts judged
 * (applied or rejected by a person) and `MANAGE_AI_SETTINGS`; it can be pressed once (the settings row records who and when).
 */
export async function unlockRuns(
  context: AdminContext,
  request: AiRunUnlockRequest,
): Promise<AiRunList> {
  if (!decide(context.actor.graph, 'MANAGE_AI_SETTINGS', GLOBAL)) throw new AuthError('FORBIDDEN');
  const { tx } = context;
  if (!Number.isInteger(request.expectedRowVersion) || request.expectedRowVersion < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  await tx.$queryRaw`SELECT id FROM ai_settings WHERE id = 1 FOR UPDATE`;
  const settings = await tx.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
  if (settings.rowVersion !== request.expectedRowVersion) throw new AuthError('CONFLICT');
  if (settings.runAllUnlockedAt !== null) throw new AuthError('CONFLICT');
  const reviewed = await tx.aiItem.count({
    where: {
      kind: 'PRODUCT_TEXT',
      status: { in: ['APPLIED', 'REJECTED'] },
      reviewedAt: { not: null },
    },
  });
  if (reviewed < AI_RUN_LIMITS.firstRunSize) throw new AuthError('VALIDATION_FAILED', 'reviewed');
  await tx.aiSettings.update({
    where: { id: 1 },
    data: {
      runAllUnlockedAt: context.now,
      runAllUnlockedByUserId: context.actor.userId,
      rowVersion: settings.rowVersion + 1,
      updatedByUserId: context.actor.userId,
    },
  });
  await appendAdminAudit(context, {
    action: 'AI_RUNS_UNLOCKED',
    entityType: 'AiSettings',
    entityId: '1',
    after: { reviewedDrafts: reviewed },
  });
  return listRuns(context);
}

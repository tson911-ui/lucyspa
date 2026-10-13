import {
  AI_CAPPED_FEATURES,
  AI_EFFORT_LEVELS,
  AI_KEY_CHECK_STATUSES,
  AI_LIMITS,
  AI_MODEL_IDS,
  type AiCappedFeature,
  type AiEffortLevel,
  type AiKeyCheckRequest,
  type AiKeyCheckStatus,
  type AiModelId,
  type AiSettings,
  type AiSettingsEditRequest,
  type AiSettingsResponse,
  type AiUsageLine,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { microUsdToVnd, monthSpend, readFeatureCaps } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Claude integration Wave A (CI-X1): the AI settings. Authority: `MANAGE_AI_SETTINGS`, GLOBAL (the Owner holds it; nobody else until he
 * grants it). One settings row; a change needs the row version the screen read (a stale one is a conflict); every change is audited with
 * before and after (never a key: the key lives only in the server environment and no contract carries it). The cost card reads the
 * ledger and the open reservations of the shop-time-zone month.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const CAP_PATTERN = /^(0|[1-9][0-9]{0,12})$/;

export function requireSettings(context: AdminContext): void {
  if (!decide(context.actor.graph, 'MANAGE_AI_SETTINGS', GLOBAL)) throw new AuthError('FORBIDDEN');
}

type Row = Prisma.AiSettingsGetPayload<Record<string, never>>;

const capText = (value: bigint | number): string => String(value);

function presentSettings(row: Row): AiSettings {
  const caps = readFeatureCaps(row.featureCapsVnd);
  const featureCapsVnd = Object.fromEntries(
    AI_CAPPED_FEATURES.map((feature) => [feature, capText(caps[feature] ?? 0)]),
  ) as Record<AiCappedFeature, string>;
  return {
    enabled: row.enabled,
    rewriteEnabled: row.rewriteEnabled,
    monthlyCapVnd: capText(row.monthlyCapVnd),
    featureCapsVnd,
    vndPerUsd: row.vndPerUsd,
    rewriteModel: row.rewriteModel as AiModelId,
    rewriteEffort: row.rewriteEffort as AiEffortLevel,
    concurrency: row.concurrency,
    refusalFallback: row.refusalFallback,
    allowAuthenticityClaims: row.allowAuthenticityClaims,
    bannedPhrases: Array.isArray(row.bannedPhrases)
      ? (row.bannedPhrases as unknown[]).filter(
          (entry): entry is string => typeof entry === 'string',
        )
      : [],
    chatEnabled: row.chatEnabled,
    chatDailyCap: row.chatDailyCap,
    seoEnabled: row.seoEnabled,
    seoModel: row.seoModel as AiModelId,
    assistantEnabled: row.assistantEnabled,
    assistantModel: row.assistantModel as AiModelId,
    briefEnabled: row.briefEnabled,
    briefModel: row.briefModel as AiModelId,
    runAllUnlockedAt: row.runAllUnlockedAt === null ? null : row.runAllUnlockedAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

export async function loadSettingsResponse(
  context: AdminContext,
  env: NodeJS.ProcessEnv,
): Promise<AiSettingsResponse> {
  const { tx } = context;
  const row = await tx.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
  const settings = presentSettings(row);
  const rate = row.vndPerUsd;
  const toVnd = (micro: bigint): string | null =>
    rate === null ? null : String(microUsdToVnd(micro, rate));
  const all = await monthSpend(tx, null);
  const byFeature: AiUsageLine[] = [];
  for (const feature of AI_CAPPED_FEATURES) {
    const own = await monthSpend(tx, feature);
    byFeature.push({
      feature,
      spentVnd: toVnd(own.spentMicroUsd),
      capVnd: settings.featureCapsVnd[feature],
    });
  }
  const checkPending =
    row.checkRequestedAt !== null &&
    (row.lastCheckAt === null || row.lastCheckAt < row.checkRequestedAt);
  const status = row.lastCheckStatus;
  return {
    settings,
    key: {
      configured: (env['ANTHROPIC_API_KEY'] ?? '').trim() !== '',
      lastCheckAt: row.lastCheckAt === null ? null : row.lastCheckAt.toISOString(),
      lastCheckStatus:
        status !== null && (AI_KEY_CHECK_STATUSES as readonly string[]).includes(status)
          ? (status as AiKeyCheckStatus)
          : null,
      checkPending,
    },
    integrations: {
      chatWebhookConfigured:
        (env['N8N_CHAT_WEBHOOK_URL'] ?? '').trim() !== '' &&
        (env['CHAT_WEBHOOK_SECRET'] ?? '').trim() !== '',
      botDataConfigured: (env['BOT_DATA_KEY'] ?? '').trim() !== '',
    },
    usage: {
      spentVnd: toVnd(all.spentMicroUsd),
      capVnd: settings.monthlyCapVnd,
      reservedVnd: toVnd(all.reservedMicroUsd),
      spentMicroUsd: String(all.spentMicroUsd),
      byFeature,
    },
  };
}

export async function getSettings(
  context: AdminContext,
  env: NodeJS.ProcessEnv,
): Promise<AiSettingsResponse> {
  requireSettings(context);
  return loadSettingsResponse(context, env);
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

function cap(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !CAP_PATTERN.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  const parsed = BigInt(value);
  if (parsed > BigInt(AI_LIMITS.capVndMax)) throw new AuthError('VALIDATION_FAILED', field);
  return parsed;
}

function phrases(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > AI_LIMITS.bannedPhrasesMax) {
    throw new AuthError('VALIDATION_FAILED', 'bannedPhrases');
  }
  const out: string[] = [];
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string') throw new AuthError('VALIDATION_FAILED', 'bannedPhrases');
    const text = entry.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (text.length < AI_LIMITS.bannedPhraseMin || text.length > AI_LIMITS.bannedPhraseMax) {
      throw new AuthError('VALIDATION_FAILED', 'bannedPhrases');
    }
    if (!out.some((existing) => existing.toLowerCase() === text.toLowerCase())) out.push(text);
  }
  return out;
}

export async function editSettings(
  context: AdminContext,
  request: AiSettingsEditRequest,
  env: NodeJS.ProcessEnv,
): Promise<AiSettingsResponse> {
  requireSettings(context);
  const { tx } = context;
  const expected = request.expectedRowVersion;
  if (!Number.isInteger(expected) || expected < 1)
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  await tx.$queryRaw`SELECT id FROM ai_settings WHERE id = 1 FOR UPDATE`;
  const current = await tx.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');

  const data: Prisma.AiSettingsUpdateInput = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const note = (key: string, previous: unknown, next: unknown) => {
    before[key] = previous;
    after[key] = next;
  };
  if (request.enabled !== undefined) {
    const next = bool(request.enabled, 'enabled');
    if (next !== current.enabled) {
      data.enabled = next;
      note('enabled', current.enabled, next);
    }
  }
  if (request.rewriteEnabled !== undefined) {
    const next = bool(request.rewriteEnabled, 'rewriteEnabled');
    if (next !== current.rewriteEnabled) {
      data.rewriteEnabled = next;
      note('rewriteEnabled', current.rewriteEnabled, next);
    }
  }
  if (request.refusalFallback !== undefined) {
    const next = bool(request.refusalFallback, 'refusalFallback');
    if (next !== current.refusalFallback) {
      data.refusalFallback = next;
      note('refusalFallback', current.refusalFallback, next);
    }
  }
  if (request.allowAuthenticityClaims !== undefined) {
    const next = bool(request.allowAuthenticityClaims, 'allowAuthenticityClaims');
    if (next !== current.allowAuthenticityClaims) {
      data.allowAuthenticityClaims = next;
      note('allowAuthenticityClaims', current.allowAuthenticityClaims, next);
    }
  }
  if (request.monthlyCapVnd !== undefined) {
    const next = cap(request.monthlyCapVnd, 'monthlyCapVnd');
    if (next !== current.monthlyCapVnd) {
      data.monthlyCapVnd = next;
      note('monthlyCapVnd', capText(current.monthlyCapVnd), capText(next));
    }
  }
  if (request.featureCapsVnd !== undefined) {
    if (
      typeof request.featureCapsVnd !== 'object' ||
      request.featureCapsVnd === null ||
      Array.isArray(request.featureCapsVnd)
    ) {
      throw new AuthError('VALIDATION_FAILED', 'featureCapsVnd');
    }
    const caps = readFeatureCaps(current.featureCapsVnd);
    const next: Record<string, number> = { ...caps } as Record<string, number>;
    for (const [feature, value] of Object.entries(request.featureCapsVnd)) {
      if (!(AI_CAPPED_FEATURES as readonly string[]).includes(feature)) {
        throw new AuthError('VALIDATION_FAILED', 'featureCapsVnd');
      }
      const parsed = cap(value, `featureCapsVnd.${feature}`);
      if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
        throw new AuthError('VALIDATION_FAILED', `featureCapsVnd.${feature}`);
      next[feature] = Number(parsed);
    }
    if (JSON.stringify(next) !== JSON.stringify(caps)) {
      data.featureCapsVnd = next;
      note('featureCapsVnd', caps, next);
    }
  }
  if (request.vndPerUsd !== undefined) {
    let next: number | null = null;
    if (request.vndPerUsd !== null) {
      const value = request.vndPerUsd;
      if (
        typeof value !== 'number' ||
        !Number.isInteger(value) ||
        value < AI_LIMITS.vndPerUsdMin ||
        value > AI_LIMITS.vndPerUsdMax
      ) {
        throw new AuthError('VALIDATION_FAILED', 'vndPerUsd');
      }
      next = value;
    }
    if (next !== current.vndPerUsd) {
      data.vndPerUsd = next;
      note('vndPerUsd', current.vndPerUsd, next);
    }
  }
  if (request.rewriteModel !== undefined) {
    if (!(AI_MODEL_IDS as readonly string[]).includes(request.rewriteModel)) {
      throw new AuthError('VALIDATION_FAILED', 'rewriteModel');
    }
    if (request.rewriteModel !== current.rewriteModel) {
      data.rewriteModel = request.rewriteModel;
      note('rewriteModel', current.rewriteModel, request.rewriteModel);
    }
  }
  if (request.rewriteEffort !== undefined) {
    if (!(AI_EFFORT_LEVELS as readonly string[]).includes(request.rewriteEffort)) {
      throw new AuthError('VALIDATION_FAILED', 'rewriteEffort');
    }
    if (request.rewriteEffort !== current.rewriteEffort) {
      data.rewriteEffort = request.rewriteEffort;
      note('rewriteEffort', current.rewriteEffort, request.rewriteEffort);
    }
  }
  if (request.concurrency !== undefined) {
    const value = request.concurrency;
    if (!Number.isInteger(value) || value < 1 || value > AI_LIMITS.concurrencyMax) {
      throw new AuthError('VALIDATION_FAILED', 'concurrency');
    }
    if (value !== current.concurrency) {
      data.concurrency = value;
      note('concurrency', current.concurrency, value);
    }
  }
  // The switches of the later features (Waves B to D): each is its own boolean, off until the Owner turns it on.
  for (const key of ['chatEnabled', 'seoEnabled', 'assistantEnabled', 'briefEnabled'] as const) {
    if (request[key] === undefined) continue;
    const next = bool(request[key], key);
    if (next !== current[key]) {
      data[key] = next;
      note(key, current[key], next);
    }
  }
  // A model per feature, chosen from the same allow-list as the rewrite.
  for (const key of ['seoModel', 'assistantModel', 'briefModel'] as const) {
    const value = request[key];
    if (value === undefined) continue;
    if (!(AI_MODEL_IDS as readonly string[]).includes(value)) {
      throw new AuthError('VALIDATION_FAILED', key);
    }
    if (value !== current[key]) {
      data[key] = value;
      note(key, current[key], value);
    }
  }
  if (request.chatDailyCap !== undefined) {
    const value = request.chatDailyCap;
    if (!Number.isInteger(value) || value < 0 || value > AI_LIMITS.chatDailyCapMax) {
      throw new AuthError('VALIDATION_FAILED', 'chatDailyCap');
    }
    if (value !== current.chatDailyCap) {
      data.chatDailyCap = value;
      note('chatDailyCap', current.chatDailyCap, value);
    }
  }
  if (request.bannedPhrases !== undefined) {
    const next = phrases(request.bannedPhrases);
    const previous = Array.isArray(current.bannedPhrases) ? current.bannedPhrases : [];
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      data.bannedPhrases = next;
      note('bannedPhrases', previous, next);
    }
  }
  if (Object.keys(data).length > 0) {
    await tx.aiSettings.update({
      where: { id: 1 },
      data: { ...data, rowVersion: current.rowVersion + 1, updatedByUserId: context.actor.userId },
    });
    await appendAdminAudit(context, {
      action: 'AI_SETTINGS_CHANGED',
      entityType: 'AiSettings',
      entityId: '1',
      before: before as Prisma.InputJsonObject,
      after: after as Prisma.InputJsonObject,
    });
  }
  return loadSettingsResponse(context, env);
}

/** Asks the worker to test the key (a free call that lists one model). The worker answers by writing `last_check_*`. */
export async function requestKeyCheck(
  context: AdminContext,
  request: AiKeyCheckRequest,
  env: NodeJS.ProcessEnv,
): Promise<AiSettingsResponse> {
  requireSettings(context);
  const { tx } = context;
  if (!Number.isInteger(request.expectedRowVersion) || request.expectedRowVersion < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  await tx.$queryRaw`SELECT id FROM ai_settings WHERE id = 1 FOR UPDATE`;
  const current = await tx.aiSettings.findUniqueOrThrow({ where: { id: 1 } });
  if (current.rowVersion !== request.expectedRowVersion) throw new AuthError('CONFLICT');
  await tx.aiSettings.update({
    where: { id: 1 },
    data: {
      checkRequestedAt: context.now,
      rowVersion: current.rowVersion + 1,
      updatedByUserId: context.actor.userId,
    },
  });
  await appendAdminAudit(context, {
    action: 'AI_KEY_CHECK_REQUESTED',
    entityType: 'AiSettings',
    entityId: '1',
  });
  return loadSettingsResponse(context, env);
}

import {
  AI_SEO_LIMITS,
  AI_SEO_STATUSES,
  type AiSeoApplyRequest,
  type AiSeoApplyResponse,
  type AiSeoBlock,
  type AiSeoContent,
  type AiSeoCreateRequest,
  type AiSeoCreateResponse,
  type AiSeoCurrent,
  type AiSeoDetail,
  type AiSeoEditRequest,
  type AiSeoKind,
  type AiSeoList,
  type AiSeoPreview,
  type AiSeoRegenerateRequest,
  type AiSeoRejectRequest,
  type AiSeoRow,
  type AiSeoStatus,
  type AiSeoWarning,
  type AiSeoVersioned,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import {
  buildSeoSnapshot,
  checkSeoDraft,
  isBlockingSeoWarning,
  loadAiSettings,
  maxCostMicroUsd,
  microUsdToVnd,
  monthSpend,
  seoSeenDescriptions,
  seoSnapshotOf,
  type SeoDraft,
  type SeoDraftWarning,
  type SeoSnapshot,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import { requireUse } from './ai-drafts.core.js';

/**
 * Claude integration Wave B (CI-E1): the review of the drafts of search descriptions and English texts for services and the home page.
 * Authority: `USE_AI_CONTENT` (GLOBAL) for everything; applying a service draft also needs `MANAGE_SERVICES` (GLOBAL) and applying the home
 * page draft `MANAGE_WEBSITE_CONTENT` (GLOBAL). Every command takes the draft's row version and locks the draft; apply also locks the target
 * and refuses a target that changed since the draft was written (the draft becomes STALE, nothing is written). The checks run again on the
 * FINAL text (a reviewer's edit is checked like the model's answer): a blocking note refuses, a soft note needs `acknowledgeWarnings`.
 * Only the search descriptions, and an English text that is still empty, are written; Owner-written text is never replaced. Creating
 * drafts, rejecting, regenerating and retrying never touch a service or the shop profile.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPEN_STATUSES = ['QUEUED', 'GENERATING', 'DRAFT_READY', 'NEEDS_ATTENTION', 'FAILED', 'STALE'];

type Row = Prisma.AiSeoDraftGetPayload<Record<string, never>>;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function requireApply(context: AdminContext, kind: AiSeoKind): void {
  requireUse(context);
  const code = kind === 'SERVICE' ? 'MANAGE_SERVICES' : 'MANAGE_WEBSITE_CONTENT';
  if (!decide(context.actor.graph, code, GLOBAL)) throw new AuthError('FORBIDDEN');
}

// ------------------------------------------------------------------------------------------------------------------ reading

function contentOf(value: unknown): AiSeoContent | null {
  if (!isObject(value)) return null;
  const vi = value['seoDescriptionVi'];
  const en = value['seoDescriptionEn'];
  const text = value['englishText'];
  if (typeof vi !== 'string' || typeof en !== 'string') return null;
  if (text !== null && typeof text !== 'string') return null;
  return { seoDescriptionVi: vi, seoDescriptionEn: en, englishText: text };
}

const present = (warning: SeoDraftWarning): AiSeoWarning => ({
  code: warning.code,
  ...(warning.field ? { field: warning.field } : {}),
  ...(warning.detail ? { detail: warning.detail } : {}),
  blocking: isBlockingSeoWarning(warning.code),
});

function storedWarnings(row: Row): AiSeoWarning[] {
  if (!Array.isArray(row.warnings)) return [];
  return (row.warnings as unknown[]).flatMap((entry) =>
    isObject(entry) && typeof entry['code'] === 'string'
      ? [
          present({
            code: entry['code'] as SeoDraftWarning['code'],
            ...(typeof entry['field'] === 'string' ? { field: entry['field'] } : {}),
            ...(typeof entry['detail'] === 'string' ? { detail: entry['detail'] } : {}),
          }),
        ]
      : [],
  );
}

async function loadRow(context: AdminContext, id: string, lock: boolean): Promise<Row> {
  if (!ID.test(id)) throw new AuthError('NOT_FOUND');
  if (lock)
    await context.tx.$queryRaw`SELECT id FROM ai_seo_drafts WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await context.tx.aiSeoDraft.findUnique({ where: { id } });
  if (row === null) throw new AuthError('NOT_FOUND');
  return row;
}

/** What the target says now (for the side-by-side), and the row version it is at. */
async function currentOf(
  context: AdminContext,
  row: Row,
): Promise<{ current: AiSeoCurrent; rowVersion: number } | null> {
  const { tx } = context;
  if (row.kind === 'SHOP') {
    const shop = await tx.websiteShopInfo.findUnique({
      where: { id: 'shop' },
      select: {
        rowVersion: true,
        taglineVi: true,
        introVi: true,
        introEn: true,
        seoDescriptionVi: true,
        seoDescriptionEn: true,
      },
    });
    if (shop === null) return null;
    return {
      rowVersion: shop.rowVersion,
      current: {
        label: 'Trang chủ',
        seoDescriptionVi: shop.seoDescriptionVi ?? '',
        seoDescriptionEn: shop.seoDescriptionEn ?? '',
        sourceVi: (shop.introVi ?? '').trim() === '' ? shop.taglineVi : (shop.introVi ?? ''),
        englishNow: shop.introEn ?? '',
        englishLabel: 'INTRO',
      },
    };
  }
  if (!ID.test(row.targetId)) return null;
  const service = await tx.service.findUnique({
    where: { id: row.targetId },
    select: {
      rowVersion: true,
      nameVi: true,
      descriptionVi: true,
      descriptionEn: true,
      seoDescriptionVi: true,
      seoDescriptionEn: true,
    },
  });
  if (service === null) return null;
  return {
    rowVersion: service.rowVersion,
    current: {
      label: service.nameVi,
      seoDescriptionVi: service.seoDescriptionVi ?? '',
      seoDescriptionEn: service.seoDescriptionEn ?? '',
      sourceVi: service.descriptionVi ?? '',
      englishNow: service.descriptionEn ?? '',
      englishLabel: 'DESCRIPTION',
    },
  };
}

async function buildDetail(context: AdminContext, row: Row): Promise<AiSeoDetail> {
  const found = await currentOf(context, row);
  const snapshot = seoSnapshotOf(row.baseSnapshot);
  const warnings = storedWarnings(row);
  return {
    id: row.id,
    kind: row.kind as AiSeoKind,
    status: row.status as AiSeoStatus,
    errorCode: row.errorCode,
    rowVersion: row.rowVersion,
    current: found?.current ?? {
      label: snapshot?.label ?? '',
      seoDescriptionVi: '',
      seoDescriptionEn: '',
      sourceVi: snapshot?.sourceVi ?? '',
      englishNow: snapshot?.englishNow ?? '',
      englishLabel: row.kind === 'SHOP' ? 'INTRO' : 'DESCRIPTION',
    },
    stale: found === null || found.rowVersion !== row.baseRowVersion,
    draft: contentOf(row.draft),
    edited: contentOf(row.edited),
    warnings,
    blocking: warnings.some((warning) => warning.blocking),
    instruction: row.instruction,
    regenerations: row.regenerations,
    canRegenerate:
      (row.status === 'DRAFT_READY' || row.status === 'NEEDS_ATTENTION') &&
      row.regenerations < AI_SEO_LIMITS.regenerationsMax,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSeoDrafts(
  context: AdminContext,
  query: { status?: string | undefined; kind?: string | undefined; page?: number | undefined },
): Promise<AiSeoList> {
  requireUse(context);
  const { tx } = context;
  if (
    query.status !== undefined &&
    !(AI_SEO_STATUSES as readonly string[]).includes(query.status)
  ) {
    throw new AuthError('VALIDATION_FAILED', 'status');
  }
  if (query.kind !== undefined && query.kind !== 'SERVICE' && query.kind !== 'SHOP') {
    throw new AuthError('VALIDATION_FAILED', 'kind');
  }
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const where: Prisma.AiSeoDraftWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.kind ? { kind: query.kind } : {}),
  };
  const [total, rows, groups, settings] = await Promise.all([
    tx.aiSeoDraft.count({ where }),
    tx.aiSeoDraft.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * AI_SEO_LIMITS.pageSize,
      take: AI_SEO_LIMITS.pageSize,
    }),
    tx.aiSeoDraft.groupBy({ by: ['status'], _count: { _all: true } }),
    tx.aiSettings.findUniqueOrThrow({ where: { id: 1 }, select: { vndPerUsd: true } }),
  ]);
  const byStatus = Object.fromEntries(AI_SEO_STATUSES.map((entry) => [entry, 0])) as Record<
    AiSeoStatus,
    number
  >;
  for (const group of groups) byStatus[group.status as AiSeoStatus] = group._count._all;
  const items: AiSeoRow[] = rows.map((row) => {
    const snapshot = seoSnapshotOf(row.baseSnapshot);
    const warnings = storedWarnings(row);
    return {
      id: row.id,
      kind: row.kind as AiSeoKind,
      status: row.status as AiSeoStatus,
      errorCode: row.errorCode,
      label: snapshot?.label ?? '',
      warnings: warnings.length,
      blockingWarnings: warnings.filter((warning) => warning.blocking).length,
      edited: row.edited !== null,
      regenerations: row.regenerations,
      updatedAt: row.updatedAt.toISOString(),
      costVnd:
        settings.vndPerUsd === null
          ? null
          : String(microUsdToVnd(row.costMicroUsd, settings.vndPerUsd)),
    };
  });
  return { items, total, page, pageSize: AI_SEO_LIMITS.pageSize, byStatus };
}

export async function getSeoDraft(context: AdminContext, id: string): Promise<AiSeoDetail> {
  requireUse(context);
  return buildDetail(context, await loadRow(context, id, false));
}

// ------------------------------------------------------------------------------------------------------------------ creating

interface Candidate {
  kind: AiSeoKind;
  targetId: string;
}

async function openTargets(context: AdminContext): Promise<Set<string>> {
  const rows = await context.tx.aiSeoDraft.findMany({
    where: { status: { in: OPEN_STATUSES } },
    select: { kind: true, targetId: true },
  });
  return new Set(rows.map((row) => `${row.kind}:${row.targetId}`));
}

function scopeOf(value: unknown): AiSeoCreateRequest['scope'] {
  if (value !== 'MISSING_SERVICES' && value !== 'SERVICES' && value !== 'SHOP') {
    throw new AuthError('VALIDATION_FAILED', 'scope');
  }
  return value;
}

/** The targets a scope names, split into those to draft now and those left out because a draft is already open. */
async function candidates(
  context: AdminContext,
  scope: AiSeoCreateRequest['scope'],
  serviceIds: unknown,
): Promise<{ take: Candidate[]; alreadyOpen: number }> {
  const { tx } = context;
  const open = await openTargets(context);
  let all: Candidate[];
  if (scope === 'SHOP') {
    all = [{ kind: 'SHOP', targetId: 'shop' }];
  } else if (scope === 'SERVICES') {
    if (
      !Array.isArray(serviceIds) ||
      serviceIds.length === 0 ||
      serviceIds.length > AI_SEO_LIMITS.createMax ||
      serviceIds.some((id) => typeof id !== 'string' || !ID.test(id)) ||
      new Set(serviceIds).size !== serviceIds.length
    ) {
      throw new AuthError('VALIDATION_FAILED', 'serviceIds');
    }
    const found = await tx.service.findMany({
      where: { id: { in: serviceIds as string[] }, isActive: true },
      select: { id: true },
    });
    if (found.length !== serviceIds.length) throw new AuthError('VALIDATION_FAILED', 'serviceIds');
    all = (serviceIds as string[]).map((id) => ({ kind: 'SERVICE' as const, targetId: id }));
  } else {
    const missing = await tx.service.findMany({
      where: {
        isActive: true,
        OR: [
          { seoDescriptionVi: null },
          { seoDescriptionVi: '' },
          { seoDescriptionEn: null },
          { seoDescriptionEn: '' },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    all = missing.map((service) => ({ kind: 'SERVICE' as const, targetId: service.id }));
  }
  const take = all.filter((entry) => !open.has(`${entry.kind}:${entry.targetId}`));
  return { take: take.slice(0, AI_SEO_LIMITS.createMax), alreadyOpen: all.length - take.length };
}

export async function previewSeoCreate(
  context: AdminContext,
  query: { scope?: unknown; serviceIds?: unknown },
): Promise<AiSeoPreview> {
  requireUse(context);
  const scope = scopeOf(query.scope);
  const settings = await loadAiSettings(context.tx);
  const { take } = await candidates(context, scope, query.serviceIds);
  const blocked: AiSeoBlock[] = [];
  if (!settings.enabled) blocked.push('OFF');
  if (!settings.seoEnabled) blocked.push('SEO_OFF');
  if (settings.vndPerUsd === null) blocked.push('NO_RATE');
  if (take.length === 0) blocked.push('NOTHING_TO_DRAFT');
  let estimateVnd: string | null = null;
  let capLeftVnd: string | null = null;
  if (settings.vndPerUsd !== null) {
    const perItem = maxCostMicroUsd(
      settings.seoModel as Parameters<typeof maxCostMicroUsd>[0],
      3_000,
      3_000,
    );
    estimateVnd = String(microUsdToVnd(perItem * BigInt(take.length), settings.vndPerUsd));
    const own = await monthSpend(context.tx, 'SEO');
    const featureCap = BigInt(settings.featureCapsVnd['SEO'] ?? 0);
    const spentVnd = BigInt(
      microUsdToVnd(own.spentMicroUsd + own.reservedMicroUsd, settings.vndPerUsd),
    );
    capLeftVnd = String(featureCap > spentVnd ? featureCap - spentVnd : 0n);
  }
  return { scope, count: take.length, model: settings.seoModel, estimateVnd, capLeftVnd, blocked };
}

export async function createSeoDrafts(
  context: AdminContext,
  request: AiSeoCreateRequest,
): Promise<AiSeoCreateResponse> {
  requireUse(context);
  const scope = scopeOf(request.scope);
  const { tx } = context;
  const settings = await loadAiSettings(tx);
  if (!settings.enabled || !settings.seoEnabled || settings.vndPerUsd === null) {
    throw new AuthError('VALIDATION_FAILED', 'seoEnabled');
  }
  const { take, alreadyOpen } = await candidates(context, scope, request.serviceIds);
  if (take.length === 0 && alreadyOpen === 0) throw new AuthError('VALIDATION_FAILED', 'scope');
  let queued = 0;
  for (const target of take) {
    const built = await buildSeoSnapshot(tx, target.kind, target.targetId);
    if (built === null) continue;
    await tx.aiSeoDraft.create({
      data: {
        kind: target.kind,
        targetId: target.targetId,
        baseRowVersion: built.rowVersion,
        baseSnapshot: built.snapshot as unknown as Prisma.InputJsonObject,
        model: settings.seoModel,
        effort: 'medium',
        requestedByUserId: context.actor.userId,
      },
    });
    queued += 1;
  }
  await appendAdminAudit(context, {
    action: 'AI_SEO_DRAFTS_CREATED',
    entityType: 'AiSeoDraft',
    entityId: scope === 'SHOP' ? 'shop' : context.actor.userId,
    after: { scope, queued, alreadyOpen },
  });
  return { queued, alreadyOpen };
}

// ------------------------------------------------------------------------------------------------------------------ commands

function expectVersion(row: Row, request: AiSeoVersioned): void {
  const expected = request.expectedRowVersion;
  if (!Number.isInteger(expected) || expected < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  if (row.rowVersion !== expected) throw new AuthError('CONFLICT');
}

function expectStatus(row: Row, allowed: readonly AiSeoStatus[]): void {
  if (!(allowed as readonly string[]).includes(row.status)) throw new AuthError('CONFLICT');
}

async function touch(
  context: AdminContext,
  row: Row,
  data: Prisma.AiSeoDraftUncheckedUpdateInput,
): Promise<Row> {
  return context.tx.aiSeoDraft.update({
    where: { id: row.id },
    data: { ...data, rowVersion: row.rowVersion + 1 },
  });
}

function text(value: unknown, field: string, max: number, required: boolean): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const cleaned = value.replace(/\r\n?/g, '\n').normalize('NFC').trim();
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(cleaned)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  if (cleaned.length > max || (required && cleaned === '')) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return cleaned;
}

/** The content of an edit request: strings of bounded length with no control characters; empty is allowed (EMPTY_FIELD is a warning). */
function parseEdit(value: unknown, snapshot: SeoSnapshot): AiSeoContent {
  if (!isObject(value)) throw new AuthError('VALIDATION_FAILED', 'content');
  const english = value['englishText'];
  return {
    seoDescriptionVi: text(
      value['seoDescriptionVi'],
      'seoDescriptionVi',
      AI_SEO_LIMITS.descriptionMax,
      false,
    ),
    seoDescriptionEn: text(
      value['seoDescriptionEn'],
      'seoDescriptionEn',
      AI_SEO_LIMITS.descriptionMax,
      false,
    ),
    englishText: snapshot.needsEnglishText
      ? text(english === null ? '' : english, 'englishText', AI_SEO_LIMITS.englishTextMax, false)
      : null,
  };
}

async function recheck(
  context: AdminContext,
  row: Row,
  snapshot: SeoSnapshot,
  content: AiSeoContent,
): Promise<AiSeoWarning[]> {
  const settings = await loadAiSettings(context.tx);
  const draft: SeoDraft = {
    seoDescriptionVi: content.seoDescriptionVi,
    seoDescriptionEn: content.seoDescriptionEn,
    englishText: content.englishText,
  };
  return checkSeoDraft(draft, snapshot, {
    authenticityClaimsAllowed: settings.allowAuthenticityClaims,
    bannedPhrases: settings.bannedPhrases,
    seenDescriptions: await seoSeenDescriptions(context.tx, row.id, row.targetId),
  }).map(present);
}

export async function editSeoDraft(
  context: AdminContext,
  id: string,
  request: AiSeoEditRequest,
): Promise<AiSeoDetail> {
  requireUse(context);
  const row = await loadRow(context, id, true);
  expectVersion(row, request);
  expectStatus(row, ['DRAFT_READY', 'NEEDS_ATTENTION']);
  const snapshot = seoSnapshotOf(row.baseSnapshot);
  if (snapshot === null || contentOf(row.draft) === null) throw new AuthError('CONFLICT');
  const content = parseEdit(request.content, snapshot);
  const warnings = await recheck(context, row, snapshot, content);
  const updated = await touch(context, row, {
    status: 'DRAFT_READY',
    edited: content as unknown as Prisma.InputJsonObject,
    warnings: warnings.map(({ code, field, detail }) => ({
      code,
      ...(field ? { field } : {}),
      ...(detail ? { detail } : {}),
    })) as Prisma.InputJsonArray,
    reviewedAt: context.now,
    reviewedByUserId: context.actor.userId,
  });
  await appendAdminAudit(context, {
    action: 'AI_SEO_DRAFT_EDITED',
    entityType: 'AiSeoDraft',
    entityId: row.id,
    after: { kind: row.kind, warnings: warnings.length },
  });
  return buildDetail(context, updated);
}

export async function applySeoDraft(
  context: AdminContext,
  id: string,
  request: AiSeoApplyRequest,
): Promise<AiSeoApplyResponse> {
  const row = await loadRow(context, id, true);
  requireApply(context, row.kind as AiSeoKind);
  expectVersion(row, request);
  expectStatus(row, ['DRAFT_READY']);
  const snapshot = seoSnapshotOf(row.baseSnapshot);
  const base = contentOf(row.draft);
  if (snapshot === null || base === null) throw new AuthError('CONFLICT');
  const { tx } = context;
  // The target is locked and must be unchanged since the draft was written.
  if (row.kind === 'SHOP') {
    await tx.$queryRaw`SELECT id FROM website_shop_info WHERE id = 'shop' FOR UPDATE`;
  } else {
    await tx.$queryRaw`SELECT id FROM services WHERE id = ${row.targetId}::uuid FOR UPDATE`;
  }
  const found = await currentOf(context, row);
  if (found === null || found.rowVersion !== row.baseRowVersion) {
    const stale = await touch(context, row, { status: 'STALE' });
    await appendAdminAudit(context, {
      action: 'AI_SEO_DRAFT_STALE',
      entityType: 'AiSeoDraft',
      entityId: row.id,
      after: { kind: row.kind, baseRowVersion: row.baseRowVersion },
    });
    return { result: 'STALE', detail: await buildDetail(context, stale) };
  }
  if (
    request.acknowledgeWarnings !== undefined &&
    typeof request.acknowledgeWarnings !== 'boolean'
  ) {
    throw new AuthError('VALIDATION_FAILED', 'acknowledgeWarnings');
  }
  const edited = contentOf(row.edited);
  const content = edited ?? base;
  const warnings = await recheck(context, row, snapshot, content);
  if (warnings.some((warning) => warning.blocking))
    throw new AuthError('VALIDATION_FAILED', 'warnings');
  if (warnings.length > 0 && request.acknowledgeWarnings !== true) {
    throw new AuthError('VALIDATION_FAILED', 'acknowledgeWarnings');
  }
  // An English text is written only into an empty field (re-read now: someone may have written it since).
  const writeEnglish =
    snapshot.needsEnglishText &&
    (content.englishText ?? '').trim() !== '' &&
    found.current.englishNow.trim() === '';
  const before = {
    seoDescriptionVi: found.current.seoDescriptionVi,
    seoDescriptionEn: found.current.seoDescriptionEn,
    english: found.current.englishNow,
  };
  if (row.kind === 'SHOP') {
    await tx.websiteShopInfo.update({
      where: { id: 'shop' },
      data: {
        seoDescriptionVi: content.seoDescriptionVi,
        seoDescriptionEn: content.seoDescriptionEn,
        ...(writeEnglish ? { introEn: content.englishText } : {}),
        rowVersion: found.rowVersion + 1,
        updatedByUserId: context.actor.userId,
      },
    });
  } else {
    await tx.service.update({
      where: { id: row.targetId },
      data: {
        seoDescriptionVi: content.seoDescriptionVi,
        seoDescriptionEn: content.seoDescriptionEn,
        ...(writeEnglish ? { descriptionEn: content.englishText } : {}),
        rowVersion: found.rowVersion + 1,
      },
    });
  }
  const applied = await touch(context, row, {
    status: 'APPLIED',
    appliedAt: context.now,
    appliedByUserId: context.actor.userId,
    reviewedAt: context.now,
    reviewedByUserId: context.actor.userId,
    errorCode: null,
    lockedUntil: null,
  });
  await appendAdminAudit(context, {
    action: 'AI_SEO_DRAFT_APPLIED',
    entityType: row.kind === 'SHOP' ? 'WebsiteShopInfo' : 'Service',
    entityId: row.targetId,
    before: before as unknown as Prisma.InputJsonObject,
    after: {
      seoDescriptionVi: content.seoDescriptionVi,
      seoDescriptionEn: content.seoDescriptionEn,
      english: writeEnglish ? content.englishText : null,
      aiDraftId: row.id,
      edited: edited !== null,
      acknowledgedWarnings: warnings.map((warning) => warning.code),
    } as unknown as Prisma.InputJsonObject,
  });
  return { result: 'APPLIED', detail: await buildDetail(context, applied) };
}

export async function rejectSeoDraft(
  context: AdminContext,
  id: string,
  request: AiSeoRejectRequest,
): Promise<AiSeoDetail> {
  requireUse(context);
  const row = await loadRow(context, id, true);
  expectVersion(row, request);
  expectStatus(row, ['QUEUED', 'DRAFT_READY', 'NEEDS_ATTENTION', 'FAILED', 'STALE']);
  const reason =
    request.reason === undefined ? null : text(request.reason, 'reason', 300, false) || null;
  const updated = await touch(context, row, {
    status: 'REJECTED',
    reviewedAt: context.now,
    reviewedByUserId: context.actor.userId,
    lockedUntil: null,
  });
  await appendAdminAudit(context, {
    action: 'AI_SEO_DRAFT_REJECTED',
    entityType: 'AiSeoDraft',
    entityId: row.id,
    after: { kind: row.kind, reason },
  });
  return buildDetail(context, updated);
}

export async function regenerateSeoDraft(
  context: AdminContext,
  id: string,
  request: AiSeoRegenerateRequest,
): Promise<AiSeoDetail> {
  requireUse(context);
  const row = await loadRow(context, id, true);
  expectVersion(row, request);
  expectStatus(row, ['DRAFT_READY', 'NEEDS_ATTENTION']);
  if (row.regenerations >= AI_SEO_LIMITS.regenerationsMax) throw new AuthError('CONFLICT');
  const instruction =
    request.instruction === undefined
      ? null
      : text(request.instruction, 'instruction', AI_SEO_LIMITS.instructionMax, false) || null;
  const updated = await touch(context, row, {
    status: 'QUEUED',
    instruction,
    regenerations: row.regenerations + 1,
    attempts: 0,
    errorCode: null,
    lockedUntil: null,
    edited: Prisma.DbNull,
  });
  await appendAdminAudit(context, {
    action: 'AI_SEO_DRAFT_REGENERATED',
    entityType: 'AiSeoDraft',
    entityId: row.id,
    after: { kind: row.kind, regenerations: updated.regenerations },
  });
  return buildDetail(context, updated);
}

export async function retrySeoDraft(
  context: AdminContext,
  id: string,
  request: AiSeoVersioned,
): Promise<AiSeoDetail> {
  requireUse(context);
  const row = await loadRow(context, id, true);
  expectVersion(row, request);
  expectStatus(row, ['FAILED', 'NEEDS_ATTENTION', 'STALE']);
  const settings = await loadAiSettings(context.tx);
  if (!settings.enabled || !settings.seoEnabled || settings.vndPerUsd === null) {
    throw new AuthError('VALIDATION_FAILED', 'seoEnabled');
  }
  // A stale draft is about old text: it is written again from the target as it is now.
  const built = await buildSeoSnapshot(context.tx, row.kind as AiSeoKind, row.targetId);
  if (built === null) throw new AuthError('CONFLICT');
  const updated = await touch(context, row, {
    status: 'QUEUED',
    attempts: 0,
    errorCode: null,
    lockedUntil: null,
    baseRowVersion: built.rowVersion,
    baseSnapshot: built.snapshot as unknown as Prisma.InputJsonObject,
    model: settings.seoModel,
  });
  await appendAdminAudit(context, {
    action: 'AI_SEO_DRAFT_RETRIED',
    entityType: 'AiSeoDraft',
    entityId: row.id,
    after: { kind: row.kind },
  });
  return buildDetail(context, updated);
}

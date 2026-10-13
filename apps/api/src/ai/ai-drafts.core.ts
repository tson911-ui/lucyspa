import {
  AI_DRAFT_LIMITS,
  AI_DRAFT_STATUSES,
  AI_RUN_LIMITS,
  type AiDraftApplyRequest,
  type AiDraftApplyResponse,
  type AiDraftContent,
  type AiDraftCounts,
  type AiDraftCurrent,
  type AiDraftDetail,
  type AiDraftEditRequest,
  type AiDraftList,
  type AiDraftRegenerateRequest,
  type AiDraftRejectRequest,
  type AiDraftRetryRequest,
  type AiDraftRow,
  type AiDraftSections,
  type AiDraftStatus,
  type AiDraftWarning,
  type AiPageApproveRequest,
  type AiPageApproveResponse,
  type AiPageItem,
  type AiPageResponse,
  type AiPageViewRequest,
} from '@lucy-spa/contracts';
import { Prisma } from '@lucy-spa/database';
import {
  buildProductSnapshot,
  checkProductRewrite,
  isBlockingWarning,
  loadAiSettings,
  microUsdToVnd,
  parseProductRewrite,
  snapshotOf,
  type DraftWarning,
  type ProductRewriteDraft,
  type WarningCode,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Claude integration Wave A (CI-R2): the review of AI drafts of product text. Authority: `USE_AI_CONTENT`, GLOBAL, for every command;
 * `apply` also needs `MANAGE_PRODUCTS`, GLOBAL (a person who may not edit products cannot change them through a draft either).
 * Every command takes the item row version the screen read (a stale one is a conflict) and locks the item; apply also locks the product
 * and refuses a product that changed since the draft was made (the item becomes `STALE`, nothing is written). Apply recomputes the
 * server checks on the FINAL text (a reviewer's edit is checked like the model's answer): a blocking warning refuses, a quality note
 * needs `acknowledgeWarnings`. Applying writes only the draft's fields, sets `content_origin` (LUCY_AI, or LUCY_MANUAL when edited) and
 * audits the full before and after. Rejecting, regenerating and retrying never touch the catalog.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireUse(context: AdminContext): void {
  if (!decide(context.actor.graph, 'USE_AI_CONTENT', GLOBAL)) throw new AuthError('FORBIDDEN');
}

function requireApply(context: AdminContext): void {
  requireUse(context);
  if (!decide(context.actor.graph, 'MANAGE_PRODUCTS', GLOBAL)) throw new AuthError('FORBIDDEN');
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

type ItemRow = Prisma.AiItemGetPayload<Record<string, never>>;

const emptySections = (): AiDraftSections => ({
  benefits: null,
  ingredients: null,
  usage: null,
  suitableFor: null,
});

/** Sections as stored (`{benefits, ingredients, usage, suitableFor}`); anything else reads as empty. */
function sectionsOf(value: unknown): AiDraftSections {
  const out = emptySections();
  if (!isObject(value)) return out;
  for (const key of ['benefits', 'ingredients', 'usage', 'suitableFor'] as const) {
    const entry = value[key];
    if (typeof entry === 'string' && entry.trim() !== '') out[key] = entry;
  }
  return out;
}

/** The draft the worker stored, as the contract content (and the meta the checks need). */
function storedDraft(item: ItemRow): ProductRewriteDraft | null {
  // The engine stores the parsed draft in camelCase; reuse the parser's checks by mapping back to its snake_case input.
  const value = item.draft;
  if (!isObject(value)) return null;
  const sections = (entry: unknown) => {
    const s = sectionsOf(entry);
    return {
      benefits: s.benefits,
      ingredients: s.ingredients,
      usage: s.usage,
      suitable_for: s.suitableFor,
    };
  };
  return parseProductRewrite({
    description_vi: value['descriptionVi'],
    sections_vi: sections(value['sectionsVi']),
    description_en: value['descriptionEn'],
    sections_en: sections(value['sectionsEn']),
    name_en: value['nameEn'],
    name_vi_suggestion: value['nameViSuggestion'] ?? null,
    seo_title_vi: value['seoTitleVi'],
    seo_title_en: value['seoTitleEn'],
    seo_description_vi: value['seoDescriptionVi'],
    seo_description_en: value['seoDescriptionEn'],
    suitable_for_inferred: value['suitableForInferred'] === true,
    facts_kept: value['factsKept'] ?? [],
    uncertain: value['uncertain'] ?? [],
  });
}

const contentOfDraft = (draft: ProductRewriteDraft): AiDraftContent => ({
  descriptionVi: draft.descriptionVi,
  sectionsVi: { ...draft.sectionsVi },
  descriptionEn: draft.descriptionEn,
  sectionsEn: { ...draft.sectionsEn },
  nameEn: draft.nameEn,
  seoTitleVi: draft.seoTitleVi,
  seoTitleEn: draft.seoTitleEn,
  seoDescriptionVi: draft.seoDescriptionVi,
  seoDescriptionEn: draft.seoDescriptionEn,
});

/** The reviewer's saved edit: `{content, useNameSuggestion}` or null. */
function storedEdit(item: ItemRow): { content: AiDraftContent; useNameSuggestion: boolean } | null {
  const value = item.edited;
  if (!isObject(value) || !isObject(value['content'])) return null;
  const content = parseContent(value['content'], false);
  return content === null
    ? null
    : { content, useNameSuggestion: value['useNameSuggestion'] === true };
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

function sectionsInput(value: unknown, field: string): AiDraftSections {
  if (!isObject(value)) throw new AuthError('VALIDATION_FAILED', field);
  const out = emptySections();
  for (const key of ['benefits', 'ingredients', 'usage', 'suitableFor'] as const) {
    const entry = value[key];
    if (entry === null || entry === undefined) continue;
    const cleaned = text(entry, `${field}.${key}`, AI_DRAFT_LIMITS.section, false);
    out[key] = cleaned === '' ? null : cleaned;
  }
  return out;
}

/**
 * The content of an edit request (strict: right types, lengths and no control characters). `strict` false is for reading what is
 * already stored, which must never throw on the screen: an unreadable stored edit is treated as no edit.
 */
function parseContent(value: unknown, strict: boolean): AiDraftContent | null {
  try {
    if (!isObject(value)) throw new AuthError('VALIDATION_FAILED', 'content');
    // Fields may be empty here (EMPTY_FIELD is a blocking warning shown to the reviewer), only too long or malformed is refused.
    return {
      descriptionVi: text(
        value['descriptionVi'],
        'descriptionVi',
        AI_DRAFT_LIMITS.description,
        false,
      ),
      sectionsVi: sectionsInput(value['sectionsVi'], 'sectionsVi'),
      descriptionEn: text(
        value['descriptionEn'],
        'descriptionEn',
        AI_DRAFT_LIMITS.description,
        false,
      ),
      sectionsEn: sectionsInput(value['sectionsEn'], 'sectionsEn'),
      nameEn: text(value['nameEn'], 'nameEn', AI_DRAFT_LIMITS.name, false),
      seoTitleVi: text(value['seoTitleVi'], 'seoTitleVi', AI_DRAFT_LIMITS.seoTitle, false),
      seoTitleEn: text(value['seoTitleEn'], 'seoTitleEn', AI_DRAFT_LIMITS.seoTitle, false),
      seoDescriptionVi: text(
        value['seoDescriptionVi'],
        'seoDescriptionVi',
        AI_DRAFT_LIMITS.seoDescription,
        false,
      ),
      seoDescriptionEn: text(
        value['seoDescriptionEn'],
        'seoDescriptionEn',
        AI_DRAFT_LIMITS.seoDescription,
        false,
      ),
    };
  } catch (error) {
    if (strict) throw error;
    return null;
  }
}

// ------------------------------------------------------------------------------------------------------------------ checks

const present = (warning: DraftWarning): AiDraftWarning => ({
  code: warning.code,
  ...(warning.field ? { field: warning.field } : {}),
  ...(warning.detail ? { detail: warning.detail } : {}),
  blocking: isBlockingWarning(warning.code),
});

function storedWarnings(item: ItemRow): AiDraftWarning[] {
  if (!Array.isArray(item.warnings)) return [];
  return (item.warnings as unknown[]).flatMap((entry) =>
    isObject(entry) && typeof entry['code'] === 'string'
      ? [
          present({
            code: entry['code'] as WarningCode,
            ...(typeof entry['field'] === 'string' ? { field: entry['field'] } : {}),
            ...(typeof entry['detail'] === 'string' ? { detail: entry['detail'] } : {}),
          }),
        ]
      : [],
  );
}

/** The server checks on `content` (the model's or the reviewer's), against what the draft was written from and the current settings. */
async function checkContent(
  context: AdminContext,
  item: ItemRow,
  content: AiDraftContent,
  base: ProductRewriteDraft,
  useNameSuggestion: boolean,
): Promise<DraftWarning[]> {
  const snapshot = snapshotOf(item.baseSnapshot);
  if (snapshot === null) return [];
  const settings = await loadAiSettings(context.tx);
  return checkProductRewrite(
    // The suggested name is checked only when the reviewer ticked it: otherwise the official name stays and the suggestion is not used.
    { ...base, ...content, nameViSuggestion: useNameSuggestion ? base.nameViSuggestion : null },
    {
      supplierText: snapshot.supplierText,
      attributes: snapshot.attributes,
      brand: snapshot.brand,
      nameVi: snapshot.nameVi,
      authenticityClaimsAllowed: settings.allowAuthenticityClaims,
      bannedPhrases: settings.bannedPhrases,
    },
  );
}

// ------------------------------------------------------------------------------------------------------------------ reading

const PRODUCT_SELECT = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  descriptionVi: true,
  descriptionEn: true,
  seoTitleVi: true,
  seoTitleEn: true,
  seoDescriptionVi: true,
  seoDescriptionEn: true,
  descriptionSectionsVi: true,
  descriptionSectionsEn: true,
  contentOrigin: true,
  rowVersion: true,
} as const;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_SELECT }>;

const currentOf = (product: ProductRow): AiDraftCurrent => ({
  nameVi: product.nameVi,
  nameEn: product.nameEn,
  descriptionVi: product.descriptionVi ?? '',
  descriptionEn: product.descriptionEn ?? '',
  sectionsVi: sectionsOf(product.descriptionSectionsVi),
  sectionsEn: sectionsOf(product.descriptionSectionsEn),
  seoTitleVi: product.seoTitleVi ?? '',
  seoTitleEn: product.seoTitleEn ?? '',
  seoDescriptionVi: product.seoDescriptionVi ?? '',
  seoDescriptionEn: product.seoDescriptionEn ?? '',
});

async function loadItem(context: AdminContext, id: string, lock: boolean): Promise<ItemRow> {
  if (!ID.test(id)) throw new AuthError('NOT_FOUND');
  if (lock) await context.tx.$queryRaw`SELECT id FROM ai_items WHERE id = ${id}::uuid FOR UPDATE`;
  const item = await context.tx.aiItem.findUnique({ where: { id } });
  if (item === null || item.kind !== 'PRODUCT_TEXT') throw new AuthError('NOT_FOUND');
  return item;
}

function expectVersion(item: ItemRow, expected: unknown): void {
  if (!Number.isInteger(expected) || (expected as number) < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  if (item.rowVersion !== expected) throw new AuthError('CONFLICT');
}

function expectStatus(item: ItemRow, allowed: readonly AiDraftStatus[]): void {
  if (!(allowed as readonly string[]).includes(item.status)) throw new AuthError('CONFLICT');
}

async function buildDetail(context: AdminContext, item: ItemRow): Promise<AiDraftDetail> {
  const product = await context.tx.product.findUniqueOrThrow({
    where: { id: item.targetId },
    select: PRODUCT_SELECT,
  });
  const draft = storedDraft(item);
  const edit = storedEdit(item);
  const warnings = storedWarnings(item);
  return {
    id: item.id,
    status: item.status as AiDraftStatus,
    errorCode: item.errorCode,
    rowVersion: item.rowVersion,
    runId: item.runId,
    product: {
      id: product.id,
      code: product.code,
      nameVi: product.nameVi,
      rowVersion: product.rowVersion,
      contentOrigin: product.contentOrigin,
    },
    stale: product.rowVersion !== item.baseRowVersion,
    current: currentOf(product),
    draft: draft === null ? null : contentOfDraft(draft),
    edited: edit?.content ?? null,
    nameViSuggestion: draft?.nameViSuggestion ?? null,
    useNameSuggestion: edit?.useNameSuggestion ?? false,
    suitableForInferred: draft?.suitableForInferred ?? false,
    factsKept: draft?.factsKept ?? [],
    uncertain: draft?.uncertain ?? [],
    warnings,
    blocking: warnings.some((warning) => warning.blocking),
    instruction: item.instruction,
    regenerations: item.regenerations,
    canRegenerate:
      (item.status === 'DRAFT_READY' || item.status === 'NEEDS_ATTENTION') &&
      item.regenerations < AI_DRAFT_LIMITS.regenerationsMax,
    viewedAt: item.viewedAt?.toISOString() ?? null,
    appliedAt: item.appliedAt?.toISOString() ?? null,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export async function listDrafts(
  context: AdminContext,
  query: { status?: string | undefined; page?: number | undefined },
): Promise<AiDraftList> {
  requireUse(context);
  const { tx } = context;
  const status = query.status;
  if (status !== undefined && !(AI_DRAFT_STATUSES as readonly string[]).includes(status)) {
    throw new AuthError('VALIDATION_FAILED', 'status');
  }
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const where: Prisma.AiItemWhereInput = {
    kind: 'PRODUCT_TEXT',
    ...(status ? { status } : {}),
  };
  const [total, rows, groups, applied, settings] = await Promise.all([
    tx.aiItem.count({ where }),
    tx.aiItem.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * AI_DRAFT_LIMITS.pageSize,
      take: AI_DRAFT_LIMITS.pageSize,
    }),
    tx.aiItem.groupBy({ by: ['status'], where: { kind: 'PRODUCT_TEXT' }, _count: { _all: true } }),
    tx.aiItem.count({ where: { kind: 'PRODUCT_TEXT', status: 'APPLIED', appliedVia: 'SINGLE' } }),
    tx.aiSettings.findUniqueOrThrow({ where: { id: 1 }, select: { vndPerUsd: true } }),
  ]);
  const products = await tx.product.findMany({
    where: { id: { in: rows.map((row) => row.targetId) } },
    select: { id: true, code: true, nameVi: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const byStatus = Object.fromEntries(AI_DRAFT_STATUSES.map((entry) => [entry, 0])) as Record<
    AiDraftStatus,
    number
  >;
  for (const group of groups) byStatus[group.status as AiDraftStatus] = group._count._all;
  const counts: AiDraftCounts = {
    all: Object.values(byStatus).reduce((sum, value) => sum + value, 0),
    byStatus,
  };
  const items: AiDraftRow[] = rows.map((row) => {
    const warnings = storedWarnings(row);
    const product = byId.get(row.targetId);
    return {
      id: row.id,
      status: row.status as AiDraftStatus,
      errorCode: row.errorCode,
      productId: row.targetId,
      productCode: product?.code ?? '',
      productName: product?.nameVi ?? '',
      blockingWarnings: warnings.filter((warning) => warning.blocking).length,
      warnings: warnings.length,
      edited: row.edited !== null,
      viewed: row.viewedAt !== null,
      regenerations: row.regenerations,
      runId: row.runId,
      updatedAt: row.updatedAt.toISOString(),
      costVnd:
        settings.vndPerUsd === null
          ? null
          : String(microUsdToVnd(row.costMicroUsd, settings.vndPerUsd)),
    };
  });
  return { items, total, page, pageSize: AI_DRAFT_LIMITS.pageSize, counts, appliedCount: applied };
}

export async function getDraft(context: AdminContext, id: string): Promise<AiDraftDetail> {
  requireUse(context);
  return buildDetail(context, await loadItem(context, id, false));
}

// ------------------------------------------------------------------------------------------------------------------ commands

async function touch(
  context: AdminContext,
  item: ItemRow,
  data: Prisma.AiItemUncheckedUpdateInput,
): Promise<ItemRow> {
  return context.tx.aiItem.update({
    where: { id: item.id },
    data: { ...data, rowVersion: item.rowVersion + 1 },
  });
}

/** Records that this reviewer opened the draft (the first time only); returns the draft with the new row version. */
export async function viewDraft(context: AdminContext, id: string): Promise<AiDraftDetail> {
  requireUse(context);
  const item = await loadItem(context, id, true);
  if (item.viewedAt !== null) return buildDetail(context, item);
  const updated = await touch(context, item, {
    viewedAt: context.now,
    viewedByUserId: context.actor.userId,
  });
  return buildDetail(context, updated);
}

export async function editDraft(
  context: AdminContext,
  id: string,
  request: AiDraftEditRequest,
): Promise<AiDraftDetail> {
  requireUse(context);
  const item = await loadItem(context, id, true);
  expectVersion(item, request.expectedRowVersion);
  expectStatus(item, ['DRAFT_READY']);
  const base = storedDraft(item);
  if (base === null) throw new AuthError('CONFLICT');
  const content = parseContent(request.content, true)!;
  if (request.useNameSuggestion !== undefined && typeof request.useNameSuggestion !== 'boolean') {
    throw new AuthError('VALIDATION_FAILED', 'useNameSuggestion');
  }
  const useNameSuggestion = request.useNameSuggestion === true && base.nameViSuggestion !== null;
  const warnings = (await checkContent(context, item, content, base, useNameSuggestion)).map(
    (warning) => ({
      code: warning.code,
      ...(warning.field ? { field: warning.field } : {}),
      ...(warning.detail ? { detail: warning.detail } : {}),
    }),
  );
  const updated = await touch(context, item, {
    edited: { content, useNameSuggestion } as unknown as Prisma.InputJsonObject,
    warnings: warnings as unknown as Prisma.InputJsonArray,
    reviewedAt: context.now,
    reviewedByUserId: context.actor.userId,
  });
  await appendAdminAudit(context, {
    action: 'AI_DRAFT_EDITED',
    entityType: 'AiItem',
    entityId: item.id,
    after: { productId: item.targetId, warnings: warnings.length },
  });
  return buildDetail(context, updated);
}

/** The text the product will have after apply: the draft with the reviewer's edit over it. */
function finalContent(item: ItemRow, base: ProductRewriteDraft) {
  const edit = storedEdit(item);
  return {
    content: edit?.content ?? contentOfDraft(base),
    edited: edit !== null,
    useNameSuggestion: edit?.useNameSuggestion ?? false,
  };
}

const sectionsJson = (sections: AiDraftSections): Prisma.InputJsonObject => ({ ...sections });
const hasSections = (sections: AiDraftSections): boolean =>
  Object.values(sections).some((entry) => entry !== null);

interface ApplyWrite {
  item: ItemRow;
  product: ProductRow;
  base: ProductRewriteDraft;
  content: AiDraftContent;
  edited: boolean;
  useNameSuggestion: boolean;
  via: 'SINGLE' | 'PAGE';
  acknowledged: string[];
}

/**
 * The one place a draft is written to a product: the draft's fields only, `content_origin` (LUCY_AI, or LUCY_MANUAL when a person edited
 * it), the item as APPLIED with how it was applied, and the audit event with the full before and after. The caller has locked the item and
 * the product and has decided that the draft may be applied.
 */
async function writeApply(context: AdminContext, input: ApplyWrite): Promise<ItemRow> {
  const { tx } = context;
  const { item, product, base, content, edited, useNameSuggestion, via, acknowledged } = input;
  const nameVi =
    useNameSuggestion && base.nameViSuggestion !== null ? base.nameViSuggestion : product.nameVi;
  const origin = edited ? 'LUCY_MANUAL' : 'LUCY_AI';
  const before = {
    ...currentOf(product),
    contentOrigin: product.contentOrigin,
  };
  const data: Prisma.ProductUncheckedUpdateInput = {
    nameVi,
    nameEn: content.nameEn,
    descriptionVi: content.descriptionVi,
    descriptionEn: content.descriptionEn,
    descriptionSectionsVi: hasSections(content.sectionsVi)
      ? sectionsJson(content.sectionsVi)
      : Prisma.DbNull,
    descriptionSectionsEn: hasSections(content.sectionsEn)
      ? sectionsJson(content.sectionsEn)
      : Prisma.DbNull,
    seoTitleVi: content.seoTitleVi,
    seoTitleEn: content.seoTitleEn,
    seoDescriptionVi: content.seoDescriptionVi,
    seoDescriptionEn: content.seoDescriptionEn,
    contentOrigin: origin,
    contentOriginAt: context.now,
    rowVersion: product.rowVersion + 1,
  };
  await tx.product.update({ where: { id: product.id }, data });
  const applied = await touch(context, item, {
    status: 'APPLIED',
    appliedAt: context.now,
    appliedByUserId: context.actor.userId,
    appliedVia: via,
    reviewedAt: context.now,
    reviewedByUserId: context.actor.userId,
    errorCode: null,
    lockedUntil: null,
  });
  await appendAdminAudit(context, {
    action: 'AI_DRAFT_APPLIED',
    entityType: 'Product',
    entityId: product.id,
    before: before as unknown as Prisma.InputJsonObject,
    after: {
      nameVi,
      ...content,
      contentOrigin: origin,
      aiItemId: item.id,
      runId: item.runId,
      appliedVia: via,
      acknowledgedWarnings: acknowledged,
    } as unknown as Prisma.InputJsonObject,
  });
  return applied;
}

export async function applyDraft(
  context: AdminContext,
  id: string,
  request: AiDraftApplyRequest,
): Promise<AiDraftApplyResponse> {
  requireApply(context);
  const { tx } = context;
  const item = await loadItem(context, id, true);
  expectVersion(item, request.expectedRowVersion);
  expectStatus(item, ['DRAFT_READY']);
  const base = storedDraft(item);
  if (base === null) throw new AuthError('CONFLICT');
  await tx.$queryRaw`SELECT id FROM products WHERE id = ${item.targetId}::uuid FOR UPDATE`;
  const product = await tx.product.findUniqueOrThrow({
    where: { id: item.targetId },
    select: PRODUCT_SELECT,
  });
  if (product.rowVersion !== item.baseRowVersion) {
    // The product was changed after the draft was made: the draft is about old text. Nothing is written; the item says why.
    const stale = await touch(context, item, { status: 'STALE' });
    await appendAdminAudit(context, {
      action: 'AI_DRAFT_STALE',
      entityType: 'AiItem',
      entityId: item.id,
      after: { productId: item.targetId, baseRowVersion: item.baseRowVersion },
    });
    return { result: 'STALE', detail: await buildDetail(context, stale) };
  }
  if (
    request.acknowledgeWarnings !== undefined &&
    typeof request.acknowledgeWarnings !== 'boolean'
  ) {
    throw new AuthError('VALIDATION_FAILED', 'acknowledgeWarnings');
  }
  const { content, edited, useNameSuggestion } = finalContent(item, base);
  const warnings = (await checkContent(context, item, content, base, useNameSuggestion)).map(
    present,
  );
  if (warnings.some((warning) => warning.blocking)) {
    throw new AuthError('VALIDATION_FAILED', 'warnings');
  }
  if (warnings.length > 0 && request.acknowledgeWarnings !== true) {
    throw new AuthError('VALIDATION_FAILED', 'acknowledgeWarnings');
  }

  const applied = await writeApply(context, {
    item,
    product,
    base,
    content,
    edited,
    useNameSuggestion,
    via: 'SINGLE',
    acknowledged: warnings.map((warning) => warning.code),
  });
  return { result: 'APPLIED', detail: await buildDetail(context, applied) };
}

export async function rejectDraft(
  context: AdminContext,
  id: string,
  request: AiDraftRejectRequest,
): Promise<AiDraftDetail> {
  requireUse(context);
  const item = await loadItem(context, id, true);
  expectVersion(item, request.expectedRowVersion);
  expectStatus(item, ['QUEUED', 'DRAFT_READY', 'NEEDS_ATTENTION', 'FAILED', 'STALE']);
  const reason =
    request.reason === undefined ? null : text(request.reason, 'reason', 300, false) || null;
  const updated = await touch(context, item, {
    status: 'REJECTED',
    reviewedAt: context.now,
    reviewedByUserId: context.actor.userId,
    lockedUntil: null,
  });
  await appendAdminAudit(context, {
    action: 'AI_DRAFT_REJECTED',
    entityType: 'AiItem',
    entityId: item.id,
    reason,
    after: { productId: item.targetId, fromStatus: item.status },
  });
  return buildDetail(context, updated);
}

/** A finished run whose item is queued again works again; a paused or cancelled run is left as it is. */
async function reopenRun(context: AdminContext, runId: string): Promise<void> {
  await context.tx.$executeRaw`
    UPDATE ai_runs
       SET status = 'RUNNING', finished_at = NULL, row_version = row_version + 1, updated_at = clock_timestamp()
     WHERE id = ${runId}::uuid AND status = 'DONE'`;
}

export async function regenerateDraft(
  context: AdminContext,
  id: string,
  request: AiDraftRegenerateRequest,
): Promise<AiDraftDetail> {
  requireUse(context);
  const item = await loadItem(context, id, true);
  expectVersion(item, request.expectedRowVersion);
  expectStatus(item, ['DRAFT_READY', 'NEEDS_ATTENTION']);
  if (item.regenerations >= AI_DRAFT_LIMITS.regenerationsMax) {
    throw new AuthError('VALIDATION_FAILED', 'regenerations');
  }
  const instruction =
    request.instruction === undefined
      ? null
      : text(request.instruction, 'instruction', AI_DRAFT_LIMITS.instruction, false) || null;
  const updated = await touch(context, item, {
    status: 'QUEUED',
    instruction,
    regenerations: item.regenerations + 1,
    attempts: 0,
    lockedUntil: null,
    errorCode: null,
    // The reviewer's edit was of the old draft; the new one starts clean (the old draft stays until the new one is written).
    edited: Prisma.DbNull,
  });
  await reopenRun(context, item.runId);
  await appendAdminAudit(context, {
    action: 'AI_DRAFT_REGENERATED',
    entityType: 'AiItem',
    entityId: item.id,
    after: {
      productId: item.targetId,
      regenerations: updated.regenerations,
      hasInstruction: instruction !== null,
    },
  });
  return buildDetail(context, updated);
}

export async function retryDraft(
  context: AdminContext,
  id: string,
  request: AiDraftRetryRequest,
): Promise<AiDraftDetail> {
  requireUse(context);
  const item = await loadItem(context, id, true);
  expectVersion(item, request.expectedRowVersion);
  expectStatus(item, ['FAILED', 'NEEDS_ATTENTION', 'STALE']);
  let snapshot: Prisma.AiItemUncheckedUpdateInput = {};
  if (item.status === 'STALE') {
    // A stale draft is about old text: read the product again and start from there.
    const built = await buildProductSnapshot(context.tx, item.targetId);
    if (built === null) throw new AuthError('NOT_FOUND');
    snapshot = {
      baseRowVersion: built.rowVersion,
      baseSnapshot: built.snapshot as unknown as Prisma.InputJsonObject,
      draft: Prisma.DbNull,
      edited: Prisma.DbNull,
      warnings: [],
    };
  }
  const updated = await touch(context, item, {
    ...snapshot,
    status: 'QUEUED',
    attempts: 0,
    lockedUntil: null,
    errorCode: null,
  });
  await reopenRun(context, item.runId);
  await appendAdminAudit(context, {
    action: 'AI_DRAFT_RETRIED',
    entityType: 'AiItem',
    entityId: item.id,
    after: { productId: item.targetId, fromStatus: item.status },
  });
  return buildDetail(context, updated);
}

// ------------------------------------------------------------------------------------------------------------------ page approval

const ITEM_IDS_MAX = AI_RUN_LIMITS.pageApprovalMax;

function itemIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > ITEM_IDS_MAX) {
    throw new AuthError('VALIDATION_FAILED', 'itemIds');
  }
  const ids = [...new Set(value as unknown[])];
  if (ids.length !== value.length || ids.some((id) => typeof id !== 'string' || !ID.test(id))) {
    throw new AuthError('VALIDATION_FAILED', 'itemIds');
  }
  return (ids as string[]).sort();
}

const singleApplied = (context: AdminContext): Promise<number> =>
  context.tx.aiItem.count({
    where: { kind: 'PRODUCT_TEXT', status: 'APPLIED', appliedVia: 'SINGLE' },
  });

/** One page (20) of drafts that are ready, as the text that would go on the page, for reading before the one confirm. */
export async function pageOfDrafts(
  context: AdminContext,
  query: { page?: number | undefined },
): Promise<AiPageResponse> {
  requireUse(context);
  const { tx } = context;
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const where = { kind: 'PRODUCT_TEXT', status: 'DRAFT_READY' } as const;
  const [total, rows, applied] = await Promise.all([
    tx.aiItem.count({ where }),
    tx.aiItem.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * ITEM_IDS_MAX,
      take: ITEM_IDS_MAX,
    }),
    singleApplied(context),
  ]);
  const products = await tx.product.findMany({
    where: { id: { in: rows.map((row) => row.targetId) } },
    select: { id: true, code: true, nameVi: true, rowVersion: true },
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  const items: AiPageItem[] = rows.flatMap((row) => {
    const base = storedDraft(row);
    const product = byId.get(row.targetId);
    if (base === null || !product) return [];
    const { content } = finalContent(row, base);
    const warnings = storedWarnings(row).length;
    return [
      {
        id: row.id,
        rowVersion: row.rowVersion,
        productName: product.nameVi,
        productCode: product.code,
        descriptionVi: content.descriptionVi,
        seoTitleVi: content.seoTitleVi,
        warnings,
        eligible: warnings === 0 && product.rowVersion === row.baseRowVersion,
      },
    ];
  });
  return {
    items,
    page,
    total,
    singleApplied: applied,
    canApprove:
      applied >= AI_RUN_LIMITS.singleApprovalsNeeded &&
      decide(context.actor.graph, 'MANAGE_PRODUCTS', GLOBAL),
  };
}

/** Records that this reviewer has been shown these drafts (the page approval counts only drafts this person has seen). */
export async function viewPage(context: AdminContext, request: AiPageViewRequest): Promise<number> {
  requireUse(context);
  const ids = itemIds(request.itemIds);
  let marked = 0;
  for (const id of ids) {
    await context.tx.$queryRaw`SELECT id FROM ai_items WHERE id = ${id}::uuid FOR UPDATE`;
    const item = await context.tx.aiItem.findUnique({ where: { id } });
    if (item === null || item.kind !== 'PRODUCT_TEXT' || item.status !== 'DRAFT_READY') continue;
    if (item.viewedByUserId === context.actor.userId && item.viewedAt !== null) continue;
    await touch(context, item, { viewedAt: context.now, viewedByUserId: context.actor.userId });
    marked += 1;
  }
  return marked;
}

/**
 * One confirm for a page of up to 20 drafts (Owner answer to OQ-CI-3). Allowed only after three drafts were applied one by one. Each
 * draft must be ready, free of any warning, fresh (its product unchanged) and seen by this reviewer; a draft that is not is skipped with
 * its reason, never applied. Every applied product gets its own audit event (applied via PAGE) and one summary event covers the page.
 */
export async function approvePage(
  context: AdminContext,
  request: AiPageApproveRequest,
): Promise<AiPageApproveResponse> {
  requireApply(context);
  const ids = itemIds(request.itemIds);
  if ((await singleApplied(context)) < AI_RUN_LIMITS.singleApprovalsNeeded) {
    throw new AuthError('VALIDATION_FAILED', 'singleApprovals');
  }
  const { tx } = context;
  const skipped: AiPageApproveResponse['skipped'] = [];
  const done: string[] = [];
  for (const id of ids) {
    await tx.$queryRaw`SELECT id FROM ai_items WHERE id = ${id}::uuid FOR UPDATE`;
    const item = await tx.aiItem.findUnique({ where: { id } });
    if (item === null || item.kind !== 'PRODUCT_TEXT') throw new AuthError('NOT_FOUND');
    const base = item.status === 'DRAFT_READY' ? storedDraft(item) : null;
    if (base === null) {
      skipped.push({ id, reason: 'NOT_READY' });
      continue;
    }
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${item.targetId}::uuid FOR UPDATE`;
    const product = await tx.product.findUniqueOrThrow({
      where: { id: item.targetId },
      select: PRODUCT_SELECT,
    });
    if (product.rowVersion !== item.baseRowVersion) {
      await touch(context, item, { status: 'STALE' });
      skipped.push({ id, reason: 'STALE' });
      continue;
    }
    if (item.viewedByUserId !== context.actor.userId || item.viewedAt === null) {
      skipped.push({ id, reason: 'NOT_VIEWED' });
      continue;
    }
    const { content, edited, useNameSuggestion } = finalContent(item, base);
    // The notes the draft already carries count (some, like a title shared with another product, only exist at write time), and the
    // checks run again on the text that would be applied (the settings may have changed since).
    if (
      storedWarnings(item).length > 0 ||
      (await checkContent(context, item, content, base, useNameSuggestion)).length > 0
    ) {
      skipped.push({ id, reason: 'WARNINGS' });
      continue;
    }
    await writeApply(context, {
      item,
      product,
      base,
      content,
      edited,
      useNameSuggestion,
      via: 'PAGE',
      acknowledged: [],
    });
    done.push(id);
  }
  if (done.length > 0) {
    await appendAdminAudit(context, {
      action: 'AI_PAGE_APPROVED',
      entityType: 'AiItem',
      entityId: done[0]!,
      after: { applied: done.length, skipped: skipped.length, itemIds: done },
    });
  }
  return { applied: done.length, skipped };
}

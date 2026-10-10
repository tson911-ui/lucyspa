import {
  CANDIDATE_BLOCKERS,
  CANDIDATE_BULK_MAX,
  CANDIDATE_DESCRIPTION_MAX,
  CANDIDATE_NAME_MAX,
  CANDIDATE_NOTE_MAX,
  CANDIDATE_PAGE_SIZE,
  CANDIDATE_STATES,
  OPEN_CANDIDATE_STATES,
  type CandidateBlocker,
  type CandidateState,
  type CandidateWarningItem,
  type SupplierApproveReadyRequest,
  type SupplierApproveReadyResponse,
  type SupplierCandidateApproveRequest,
  type SupplierCandidateApproveResponse,
  type SupplierCandidateDecideRequest,
  type SupplierCandidateDecideResponse,
  type SupplierCandidateDetail,
  type SupplierCandidateDetailResponse,
  type SupplierCandidateEditRequest,
  type SupplierCandidateImage,
  type SupplierCandidateImageDecisionRequest,
  type SupplierCandidateKeepSeparateRequest,
  type SupplierCandidateListResponse,
  type SupplierCandidateRow,
  type SupplierMappingRequest,
  type SupplierMappingResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  evaluateCandidates,
  hammingDistance,
  LUCY_SKU,
  NEAR_DUPLICATE_DISTANCE,
  reduceDecisions,
  saveMapping,
} from '@lucy-spa/server';
import { randomUUID } from 'node:crypto';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import * as input from '../inventory/inventory.input.js';
import * as productInput from '../products/product-catalog.input.js';

/**
 * Phase 9 P9-6: the review of supplier candidates (REVIEW_SUPPLIER_IMPORTS, GLOBAL, decided inside every command). A reviewer edits
 * the Lucy-owned fields, maps a brand or category once, decides about flagged pictures and look-alike products, and approves: the
 * approval creates ONE DRAFT product with ONE variant carrying the SKU exactly as reviewed, copies the kept pictures in order, and
 * records where it came from, all in one transaction. A supplier price is never copied anywhere; a selling price is created only when
 * the caller also holds MANAGE_PRODUCT_PRICES and types it. No code path here writes a cost.
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;
const MAX_CODE_PRODUCT = 96;
const MAX_PRICE = 100_000_000_000n;
const DECIDED = ['APPROVED', 'REJECTED', 'IGNORED', 'IMPORTED'] as const;
const isDecided = (state: string) => (DECIDED as readonly string[]).includes(state);

function requireReview(context: AdminContext): void {
  if (!decide(context.actor.graph, 'REVIEW_SUPPLIER_IMPORTS', GLOBAL)) {
    throw new AuthError('FORBIDDEN');
  }
}

const canSeePrices = (context: AdminContext): boolean =>
  decide(context.actor.graph, 'MANAGE_PRODUCT_PRICES', GLOBAL);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const warningsOf = (value: unknown): CandidateWarningItem[] =>
  (Array.isArray(value) ? (value as unknown[]) : []).filter(isRecord) as CandidateWarningItem[];

// ------------------------------------------------------------------------------------------------------------------ list

const ROW_SELECT = {
  id: true,
  state: true,
  rowVersion: true,
  nameVi: true,
  proposedSku: true,
  warnings: true,
  needsTranslation: true,
  updatedAt: true,
  supplier: { select: { id: true, name: true } },
  brand: { select: { id: true, nameVi: true } },
  category: { select: { id: true, nameVi: true } },
  images: {
    where: { retiredAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true, flag: true },
  },
  decisions: {
    where: { imageId: { not: null } },
    orderBy: { seq: 'asc' },
    select: { kind: true, imageId: true, ref: true },
  },
  sources: {
    take: 1,
    select: {
      sourceRecord: {
        select: {
          priceObservations: {
            orderBy: { observedAt: 'desc' },
            take: 1,
            select: { priceVnd: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ImportCandidateSelect;

type RowData = Prisma.ImportCandidateGetPayload<{ select: typeof ROW_SELECT }>;

function presentRow(row: RowData, prices: boolean): SupplierCandidateRow {
  const decided = reduceDecisions(row.decisions).images;
  const shown = row.images.filter((image) => decided.get(image.id) !== 'DROP');
  return {
    id: row.id,
    state: row.state,
    rowVersion: row.rowVersion,
    nameVi: row.nameVi,
    sku: row.proposedSku,
    brand: row.brand ? { id: row.brand.id, name: row.brand.nameVi } : null,
    category: row.category ? { id: row.category.id, name: row.category.nameVi } : null,
    supplier: row.supplier,
    warnings: [...new Set(warningsOf(row.warnings).map((warning) => warning.code))],
    needsTranslation: row.needsTranslation,
    imageCount: shown.length,
    flaggedImageCount: shown.filter((image) => image.flag !== null && !decided.has(image.id))
      .length,
    thumbImageId: shown[0]?.id ?? null,
    ...(prices
      ? {
          sourcePriceVnd:
            row.sources[0]?.sourceRecord.priceObservations[0]?.priceVnd === null ||
            row.sources[0]?.sourceRecord.priceObservations[0] === undefined
              ? null
              : Number(row.sources[0]?.sourceRecord.priceObservations[0]?.priceVnd),
        }
      : {}),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listCandidates(
  context: AdminContext,
  query: { state?: string | undefined; warning?: string | undefined; page?: number | undefined },
): Promise<SupplierCandidateListResponse> {
  requireReview(context);
  const state = query.state ?? 'OPEN';
  if (state !== 'OPEN' && !(CANDIDATE_STATES as readonly string[]).includes(state)) {
    throw new AuthError('VALIDATION_FAILED', 'state');
  }
  if (query.warning !== undefined && !/^[A-Z_]{3,40}$/.test(query.warning)) {
    throw new AuthError('VALIDATION_FAILED', 'warning');
  }
  const page = query.page ?? 1;
  if (!Number.isSafeInteger(page) || page < 1 || page > 100_000) {
    throw new AuthError('VALIDATION_FAILED', 'page');
  }
  const { tx } = context;
  const where: Prisma.ImportCandidateWhereInput = {
    state: state === 'OPEN' ? { in: [...OPEN_CANDIDATE_STATES] } : (state as CandidateState),
    ...(query.warning ? { warnings: { array_contains: [{ code: query.warning }] } } : {}),
  };
  const [total, rows, counts] = await Promise.all([
    tx.importCandidate.count({ where }),
    tx.importCandidate.findMany({
      where,
      select: ROW_SELECT,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * CANDIDATE_PAGE_SIZE,
      take: CANDIDATE_PAGE_SIZE,
    }),
    tx.importCandidate.groupBy({ by: ['state'], _count: { _all: true } }),
  ]);
  const stateCounts: SupplierCandidateListResponse['stateCounts'] = {};
  for (const entry of counts) stateCounts[entry.state] = entry._count._all;
  const prices = canSeePrices(context);
  return {
    items: rows.map((row) => presentRow(row, prices)),
    total,
    page,
    pageSize: CANDIDATE_PAGE_SIZE,
    readyCount: stateCounts.READY_FOR_REVIEW ?? 0,
    stateCounts,
    canSeePrices: prices,
  };
}

// ----------------------------------------------------------------------------------------------------------------- detail

const DETAIL_SELECT = {
  id: true,
  state: true,
  rowVersion: true,
  supplier: { select: { id: true, name: true } },
  nameVi: true,
  nameEn: true,
  needsTranslation: true,
  descriptionVi: true,
  descriptionEn: true,
  brandId: true,
  categoryId: true,
  proposedSku: true,
  warnings: true,
  decidedAt: true,
  decisionNote: true,
  importedProductId: true,
  decidedBy: { select: { fullName: true } },
  sources: {
    take: 1,
    select: {
      sourceRecord: {
        select: {
          id: true,
          sourceKey: true,
          url: true,
          name: true,
          sku: true,
          categoryPath: true,
          brandText: true,
          source: { select: { id: true, name: true } },
          priceObservations: {
            orderBy: { observedAt: 'desc' },
            take: 1,
            select: { priceVnd: true, promoPriceVnd: true, currency: true, observedAt: true },
          },
        },
      },
    },
  },
  images: {
    where: { retiredAt: null },
    orderBy: { sortOrder: 'asc' },
    select: {
      id: true,
      sourceUrl: true,
      sourceProductKey: true,
      variantKey: true,
      flag: true,
      sortOrder: true,
      mediaAssetId: true,
      phash: true,
      mediaAsset: { select: { width: true, height: true } },
    },
  },
  decisions: { orderBy: { seq: 'asc' }, select: { kind: true, imageId: true, ref: true } },
} satisfies Prisma.ImportCandidateSelect;

type DetailRow = Prisma.ImportCandidateGetPayload<{ select: typeof DETAIL_SELECT }>;

/** The other products that have the same picture file or a near-identical one (shown, never assigned). */
async function sharedWith(
  tx: Tx,
  candidateId: string,
  supplierId: string,
  images: DetailRow['images'],
): Promise<Map<string, SupplierCandidateImage['sharedWith']>> {
  const out = new Map<string, SupplierCandidateImage['sharedWith']>();
  const flagged = images.filter((image) => image.flag !== null);
  if (flagged.length === 0) return out;
  const assetIds = flagged.map((image) => image.mediaAssetId);
  const [sameAsset, catalog, neighbours] = await Promise.all([
    tx.candidateImage.findMany({
      where: { mediaAssetId: { in: assetIds }, candidateId: { not: candidateId } },
      select: {
        mediaAssetId: true,
        candidate: { select: { id: true, nameVi: true, proposedSku: true } },
      },
    }),
    tx.productImage.findMany({
      where: { mediaAssetId: { in: assetIds } },
      select: {
        mediaAssetId: true,
        product: {
          select: { id: true, nameVi: true, variants: { take: 1, select: { sku: true } } },
        },
      },
    }),
    tx.candidateImage.findMany({
      where: {
        retiredAt: null,
        phash: { not: null },
        candidateId: { not: candidateId },
        candidate: { supplierId },
      },
      select: { phash: true, candidate: { select: { id: true, nameVi: true, proposedSku: true } } },
    }),
  ]);
  for (const image of flagged) {
    const list: SupplierCandidateImage['sharedWith'] = [];
    const seen = new Set<string>();
    const add = (entry: SupplierCandidateImage['sharedWith'][number]) => {
      const key = `${entry.kind}:${entry.id}`;
      if (!seen.has(key) && list.length < 5) {
        seen.add(key);
        list.push(entry);
      }
    };
    for (const row of sameAsset.filter((r) => r.mediaAssetId === image.mediaAssetId)) {
      add({
        kind: 'CANDIDATE',
        id: row.candidate.id,
        name: row.candidate.nameVi,
        sku: row.candidate.proposedSku,
      });
    }
    for (const row of catalog.filter((r) => r.mediaAssetId === image.mediaAssetId)) {
      add({
        kind: 'PRODUCT',
        id: row.product.id,
        name: row.product.nameVi,
        sku: row.product.variants[0]?.sku ?? null,
      });
    }
    if (image.phash !== null) {
      for (const row of neighbours) {
        if (
          row.phash !== null &&
          hammingDistance(row.phash, image.phash) <= NEAR_DUPLICATE_DISTANCE
        ) {
          add({
            kind: 'CANDIDATE',
            id: row.candidate.id,
            name: row.candidate.nameVi,
            sku: row.candidate.proposedSku,
          });
        }
      }
    }
    out.set(image.id, list);
  }
  return out;
}

/** Why a candidate cannot be approved now (empty when it can). The approval repeats the check against the database. */
export function approvalBlockers(facts: {
  nameVi: string;
  sku: string | null;
  skuTaken: boolean;
  warnings: readonly CandidateWarningItem[];
}): CandidateBlocker[] {
  const codes = new Set(facts.warnings.map((warning) => warning.code));
  const out: CandidateBlocker[] = [];
  if (facts.nameVi.trim() === '') out.push('NAME_MISSING');
  if (facts.sku === null || !LUCY_SKU.test(facts.sku)) out.push('SKU_INVALID');
  if (facts.skuTaken || codes.has('SKU_COLLISION')) out.push('SKU_TAKEN');
  if (codes.has('SKU_DUPLICATE_CANDIDATE')) out.push('SKU_DUPLICATE_CANDIDATE');
  if (codes.has('IMAGE_SHARED')) out.push('IMAGE_DECISION_REQUIRED');
  if (codes.has('POSSIBLE_DUPLICATE')) out.push('DUPLICATE_UNRESOLVED');
  return CANDIDATE_BLOCKERS.filter((blocker) => out.includes(blocker));
}

async function presentDetail(
  context: AdminContext,
  row: DetailRow,
): Promise<SupplierCandidateDetail> {
  const { tx } = context;
  const link = row.sources[0]?.sourceRecord;
  if (!link) throw new AuthError('NOT_FOUND');
  const decisions = reduceDecisions(row.decisions);
  const shared = await sharedWith(tx, row.id, row.supplier.id, row.images);
  const [brands, categories, taken] = await Promise.all([
    tx.brand.findMany({
      where: { isActive: true },
      orderBy: { nameVi: 'asc' },
      select: { id: true, nameVi: true },
    }),
    tx.productCategory.findMany({
      where: { isActive: true },
      orderBy: { nameVi: 'asc' },
      select: { id: true, nameVi: true },
    }),
    row.proposedSku === null
      ? Promise.resolve(null)
      : tx.productVariant.findUnique({ where: { sku: row.proposedSku }, select: { id: true } }),
  ]);
  const warnings = warningsOf(row.warnings);
  const blockers = approvalBlockers({
    nameVi: row.nameVi,
    sku: row.proposedSku,
    skuTaken: taken !== null,
    warnings,
  });
  const price = link.priceObservations[0];
  const categoryPath = Array.isArray(link.categoryPath) ? (link.categoryPath as unknown[]) : [];
  const prices = canSeePrices(context);
  return {
    id: row.id,
    state: row.state,
    rowVersion: row.rowVersion,
    supplier: row.supplier,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    needsTranslation: row.needsTranslation,
    descriptionVi: row.descriptionVi,
    descriptionEn: row.descriptionEn,
    brandId: row.brandId,
    categoryId: row.categoryId,
    proposedSku: row.proposedSku,
    warnings,
    source: {
      sourceId: link.source.id,
      sourceName: link.source.name,
      sourceKey: link.sourceKey,
      url: link.url,
      name: link.name,
      sku: link.sku,
      categoryNames: categoryPath.filter((entry): entry is string => typeof entry === 'string'),
      brandText: link.brandText,
    },
    images: row.images.map((image) => ({
      id: image.id,
      sourceUrl: image.sourceUrl,
      sourceProductKey: image.sourceProductKey,
      variantKey: image.variantKey,
      flag: image.flag as SupplierCandidateImage['flag'],
      sortOrder: image.sortOrder,
      width: image.mediaAsset.width,
      height: image.mediaAsset.height,
      decision: decisions.images.get(image.id) ?? null,
      sharedWith: shared.get(image.id) ?? [],
    })),
    ...(prices && price
      ? {
          sourcePrice: {
            priceVnd: price.priceVnd === null ? null : Number(price.priceVnd),
            promoPriceVnd: price.promoPriceVnd === null ? null : Number(price.promoPriceVnd),
            currency: price.currency,
            observedAt: price.observedAt.toISOString(),
          },
        }
      : {}),
    brands: brands.map((entry) => ({ id: entry.id, name: entry.nameVi })),
    categories: categories.map((entry) => ({ id: entry.id, name: entry.nameVi })),
    approval: { canApprove: !isDecided(row.state) && blockers.length === 0, blockers },
    decided: isDecided(row.state)
      ? {
          by: row.decidedBy?.fullName ?? null,
          at: row.decidedAt?.toISOString() ?? null,
          note: row.decisionNote,
          productId: row.importedProductId,
        }
      : null,
    canSeePrices: prices,
  };
}

async function loadDetail(
  context: AdminContext,
  id: string,
): Promise<SupplierCandidateDetailResponse> {
  const row = await context.tx.importCandidate.findUnique({ where: { id }, select: DETAIL_SELECT });
  if (!row) throw new AuthError('NOT_FOUND');
  return { item: await presentDetail(context, row) };
}

export async function getCandidate(
  context: AdminContext,
  id: string,
): Promise<SupplierCandidateDetailResponse> {
  requireReview(context);
  return loadDetail(context, input.uuid(id, 'id'));
}

// -------------------------------------------------------------------------------------------------------------- commands

async function lockCandidate(tx: Tx, id: string, expected: number) {
  const rows = await tx.$queryRaw<{ row_version: number; state: string }[]>`
    SELECT row_version, state::text AS state FROM import_candidates WHERE id = ${id}::uuid FOR UPDATE`;
  const row = rows[0];
  if (!row) throw new AuthError('NOT_FOUND');
  if (row.row_version !== expected) throw new AuthError('CONFLICT');
  if (isDecided(row.state)) throw new AuthError('CANDIDATE_DECIDED');
  return row;
}

/** A control character other than a line break or a tab (text a reviewer types must be plain). */
function hasControl(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) as number;
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f)
      return true;
  }
  return false;
}

function text(value: unknown, field: string, max: number, required: boolean): string | null {
  if (value === null && !required) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const clean = value.normalize('NFC').trim();
  if (clean === '' && required) throw new AuthError('VALIDATION_FAILED', field);
  if ([...clean].length > max || hasControl(clean)) throw new AuthError('VALIDATION_FAILED', field);
  return clean === '' ? null : clean;
}

const EDIT_KEYS = [
  'expectedVersion',
  'nameVi',
  'nameEn',
  'needsTranslation',
  'descriptionVi',
  'descriptionEn',
  'brandId',
  'categoryId',
  'proposedSku',
] as const;

export async function editCandidate(
  context: AdminContext,
  id: string,
  request: SupplierCandidateEditRequest,
): Promise<SupplierCandidateDetailResponse> {
  requireReview(context);
  const body = input.record(request, 'body', EDIT_KEYS);
  const expected = input.rowVersion(body['expectedVersion']);
  const candidateId = input.uuid(id, 'id');
  const { tx } = context;
  await lockCandidate(tx, candidateId, expected);
  const current = await tx.importCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    select: {
      nameVi: true,
      nameEn: true,
      needsTranslation: true,
      descriptionVi: true,
      descriptionEn: true,
      brandId: true,
      categoryId: true,
      proposedSku: true,
    },
  });
  const data: Prisma.ImportCandidateUncheckedUpdateInput = {};
  const before: Record<string, string | boolean | null> = {};
  const after: Record<string, string | boolean | null> = {};
  const set = <K extends keyof typeof current>(key: K, value: (typeof current)[K]) => {
    if (value === current[key]) return;
    (data as Record<string, unknown>)[key] = value;
    before[key] = current[key];
    after[key] = value;
  };
  if (body['nameVi'] !== undefined)
    set('nameVi', text(body['nameVi'], 'nameVi', CANDIDATE_NAME_MAX, true) as string);
  if (body['nameEn'] !== undefined)
    set('nameEn', text(body['nameEn'], 'nameEn', CANDIDATE_NAME_MAX, true) as string);
  if (body['needsTranslation'] !== undefined) {
    set('needsTranslation', input.boolean(body['needsTranslation'], 'needsTranslation'));
  }
  if (body['descriptionVi'] !== undefined) {
    set(
      'descriptionVi',
      text(body['descriptionVi'], 'descriptionVi', CANDIDATE_DESCRIPTION_MAX, false),
    );
  }
  if (body['descriptionEn'] !== undefined) {
    set(
      'descriptionEn',
      text(body['descriptionEn'], 'descriptionEn', CANDIDATE_DESCRIPTION_MAX, false),
    );
  }
  if (body['brandId'] !== undefined) {
    const brandId = input.optionalUuid(body['brandId'], 'brandId');
    if (brandId !== null) {
      const brand = await tx.brand.findUnique({
        where: { id: brandId },
        select: { isActive: true },
      });
      if (!brand?.isActive) throw new AuthError('VALIDATION_FAILED', 'brandId');
    }
    set('brandId', brandId);
  }
  if (body['categoryId'] !== undefined) {
    const categoryId = input.optionalUuid(body['categoryId'], 'categoryId');
    if (categoryId !== null) {
      const category = await tx.productCategory.findUnique({
        where: { id: categoryId },
        select: { isActive: true },
      });
      if (!category?.isActive) throw new AuthError('VALIDATION_FAILED', 'categoryId');
    }
    set('categoryId', categoryId);
  }
  if (body['proposedSku'] !== undefined) {
    const raw = body['proposedSku'];
    // Exactly Lucy's shape or nothing: no upper-casing, no repair. A person types the SKU they mean.
    if (raw !== null && (typeof raw !== 'string' || !LUCY_SKU.test(raw))) {
      throw new AuthError('VALIDATION_FAILED', 'proposedSku');
    }
    set('proposedSku', raw as string | null);
  }
  if (Object.keys(after).length === 0) return loadDetail(context, candidateId);
  await tx.importCandidate.update({
    where: { id: candidateId },
    data: { ...data, rowVersion: expected + 1 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CANDIDATE_EDITED',
    entityType: 'ImportCandidate',
    entityId: candidateId,
    before,
    after,
  });
  await evaluateCandidates(tx, { candidateIds: [candidateId] });
  return loadDetail(context, candidateId);
}

export async function decideImage(
  context: AdminContext,
  id: string,
  request: SupplierCandidateImageDecisionRequest,
): Promise<SupplierCandidateDetailResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['expectedVersion', 'imageId', 'decision']);
  const expected = input.rowVersion(body['expectedVersion']);
  const candidateId = input.uuid(id, 'id');
  const imageId = input.uuid(body['imageId'], 'imageId');
  const decision = body['decision'];
  if (decision !== 'KEEP' && decision !== 'DROP')
    throw new AuthError('VALIDATION_FAILED', 'decision');
  const { tx } = context;
  await lockCandidate(tx, candidateId, expected);
  const image = await tx.candidateImage.findFirst({
    where: { id: imageId, candidateId, retiredAt: null },
    select: { id: true },
  });
  if (!image) throw new AuthError('NOT_FOUND');
  await tx.candidateReviewDecision.create({
    data: {
      candidateId,
      kind: decision === 'KEEP' ? 'IMAGE_KEEP' : 'IMAGE_DROP',
      imageId,
      decidedByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await tx.importCandidate.update({
    where: { id: candidateId },
    data: { rowVersion: expected + 1 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CANDIDATE_IMAGE_DECIDED',
    entityType: 'ImportCandidate',
    entityId: candidateId,
    after: { imageId, decision },
  });
  await evaluateCandidates(tx, { candidateIds: [candidateId] });
  return loadDetail(context, candidateId);
}

export async function keepSeparate(
  context: AdminContext,
  id: string,
  request: SupplierCandidateKeepSeparateRequest,
): Promise<SupplierCandidateDetailResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['expectedVersion', 'ref']);
  const expected = input.rowVersion(body['expectedVersion']);
  const candidateId = input.uuid(id, 'id');
  const ref = body['ref'];
  if (typeof ref !== 'string' || !/^(PRODUCT|CANDIDATE):[0-9a-f-]{36}$/.test(ref)) {
    throw new AuthError('VALIDATION_FAILED', 'ref');
  }
  const { tx } = context;
  await lockCandidate(tx, candidateId, expected);
  // Only a look-alike the candidate is actually suspected of being can be kept separate.
  const row = await tx.importCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    select: { warnings: true },
  });
  const matches = warningsOf(row.warnings)
    .filter((warning) => warning.code === 'POSSIBLE_DUPLICATE')
    .flatMap((warning) =>
      Array.isArray(warning['matches']) ? (warning['matches'] as unknown[]) : [],
    )
    .filter(isRecord)
    .map((match) =>
      match['kind'] === 'PRODUCT'
        ? `PRODUCT:${String(match['productId'])}`
        : `CANDIDATE:${String(match['candidateId'])}`,
    );
  if (!matches.includes(ref)) throw new AuthError('VALIDATION_FAILED', 'ref');
  await tx.candidateReviewDecision.create({
    data: {
      candidateId,
      kind: 'DUPLICATE_KEEP_SEPARATE',
      ref,
      decidedByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await tx.importCandidate.update({
    where: { id: candidateId },
    data: { rowVersion: expected + 1 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CANDIDATE_KEPT_SEPARATE',
    entityType: 'ImportCandidate',
    entityId: candidateId,
    after: { ref },
  });
  await evaluateCandidates(tx, { candidateIds: [candidateId] });
  return loadDetail(context, candidateId);
}

export async function saveSourceMapping(
  context: AdminContext,
  request: SupplierMappingRequest,
): Promise<SupplierMappingResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['candidateId', 'kind', 'sourceText', 'targetId']);
  const candidateId = input.uuid(body['candidateId'], 'candidateId');
  const kind = body['kind'];
  if (kind !== 'BRAND' && kind !== 'CATEGORY') throw new AuthError('VALIDATION_FAILED', 'kind');
  const sourceText = text(body['sourceText'], 'sourceText', 300, true) as string;
  const targetId = input.uuid(body['targetId'], 'targetId');
  const { tx } = context;
  const candidate = await tx.importCandidate.findUnique({
    where: { id: candidateId },
    select: { supplierId: true },
  });
  if (!candidate) throw new AuthError('NOT_FOUND');
  let saved: { id: string; changed: boolean };
  try {
    saved = await saveMapping(tx, {
      supplierId: candidate.supplierId,
      kind,
      sourceText,
      targetId,
      userId: context.actor.userId,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'MAPPING_TARGET_INVALID') throw new AuthError('VALIDATION_FAILED', 'targetId');
    if (message === 'MAPPING_TEXT_INVALID') throw new AuthError('VALIDATION_FAILED', 'sourceText');
    throw error;
  }
  let evaluated = 0;
  let updated = 0;
  if (saved.changed) {
    await appendAdminAudit(context, {
      action: 'SUPPLIER_MAPPING_SAVED',
      entityType: 'SourceValueMapping',
      entityId: saved.id,
      after: { supplierId: candidate.supplierId, kind, sourceText, targetId },
    });
    const summary = await evaluateCandidates(tx, { supplierId: candidate.supplierId });
    evaluated = summary.evaluated;
    updated = summary.changed;
  }
  return { changed: saved.changed, evaluated, updated };
}

async function decideCandidate(
  context: AdminContext,
  id: string,
  request: SupplierCandidateDecideRequest,
  state: 'REJECTED' | 'IGNORED',
): Promise<SupplierCandidateDecideResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['expectedVersion', 'note']);
  const expected = input.rowVersion(body['expectedVersion']);
  const candidateId = input.uuid(id, 'id');
  const note =
    body['note'] === undefined ? null : text(body['note'], 'note', CANDIDATE_NOTE_MAX, false);
  const { tx } = context;
  await lockCandidate(tx, candidateId, expected);
  await tx.importCandidate.update({
    where: { id: candidateId },
    data: {
      state,
      decidedByUserId: context.actor.userId,
      decidedAt: context.now,
      decisionNote: note,
      rowVersion: expected + 1,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: state === 'REJECTED' ? 'SUPPLIER_CANDIDATE_REJECTED' : 'SUPPLIER_CANDIDATE_IGNORED',
    entityType: 'ImportCandidate',
    entityId: candidateId,
    before: { state: 'OPEN' },
    after: { state, note },
  });
  return { id: candidateId, state };
}

export const rejectCandidate = (
  context: AdminContext,
  id: string,
  request: SupplierCandidateDecideRequest,
) => decideCandidate(context, id, request, 'REJECTED');
export const ignoreCandidate = (
  context: AdminContext,
  id: string,
  request: SupplierCandidateDecideRequest,
) => decideCandidate(context, id, request, 'IGNORED');

// -------------------------------------------------------------------------------------------------------------- approval

/**
 * The approval, in the caller's transaction: refreshes the candidate's warnings, refuses while a blocker stands, creates the DRAFT
 * product with its one variant (SKU exactly as reviewed), the optional selling price, the kept pictures in order and the provenance,
 * and closes the candidate as IMPORTED. The supplier's price and any cost are never written.
 */
async function approveInTransaction(
  context: AdminContext,
  candidateId: string,
  expected: number,
  price: bigint | null,
): Promise<SupplierCandidateApproveResponse> {
  const { tx } = context;
  await lockCandidate(tx, candidateId, expected);
  // The warnings are refreshed first: a mapping or a decision made a moment ago must count (this may move the row version).
  await evaluateCandidates(tx, { candidateIds: [candidateId] });
  const row = await tx.importCandidate.findUniqueOrThrow({
    where: { id: candidateId },
    select: DETAIL_SELECT,
  });
  const link = row.sources[0]?.sourceRecord;
  if (!link) throw new AuthError('NOT_FOUND');
  const taken =
    row.proposedSku === null
      ? null
      : await tx.productVariant.findUnique({
          where: { sku: row.proposedSku },
          select: { id: true },
        });
  const blockers = approvalBlockers({
    nameVi: row.nameVi,
    sku: row.proposedSku,
    skuTaken: taken !== null,
    warnings: warningsOf(row.warnings),
  });
  if (blockers.length > 0) throw new AuthError('CANDIDATE_BLOCKED', blockers[0]);
  const sku = row.proposedSku as string;
  const decisions = reduceDecisions(row.decisions);
  const kept = row.images.filter((image) => decisions.images.get(image.id) !== 'DROP');
  const code = await productInput.uniqueCode(
    productInput.slug(row.nameEn, MAX_CODE_PRODUCT),
    MAX_CODE_PRODUCT,
    async (candidate) =>
      Boolean(await tx.product.findUnique({ where: { code: candidate }, select: { id: true } })),
  );
  const provenance = {
    supplierId: row.supplier.id,
    sourceId: link.source.id,
    sourceKey: link.sourceKey,
    url: link.url,
    candidateId,
    importedAt: context.now.toISOString(),
  };
  const product = await tx.product.create({
    data: {
      code,
      nameVi: row.nameVi,
      nameEn: row.nameEn,
      descriptionVi: row.descriptionVi,
      descriptionEn: row.descriptionEn,
      brandId: row.brandId,
      categoryId: row.categoryId,
      source: provenance as unknown as Prisma.InputJsonValue,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  const variant = await tx.productVariant.create({
    data: { productId: product.id, sku, sortOrder: 0 },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CREATED',
    entityType: 'Product',
    entityId: product.id,
    after: {
      code,
      nameVi: row.nameVi,
      nameEn: row.nameEn,
      status: 'DRAFT',
      via: 'SUPPLIER_IMPORT',
    },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_VARIANT_CREATED',
    entityType: 'ProductVariant',
    entityId: variant.id,
    after: { productId: product.id, sku, via: 'SUPPLIER_IMPORT' },
  });
  if (price !== null) {
    await tx.productPriceVersion.create({
      data: {
        variantId: variant.id,
        versionNo: 1,
        listPriceVnd: price,
        createdByUserId: context.actor.userId,
      },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_PRICE_CHANGED',
      entityType: 'ProductVariant',
      entityId: variant.id,
      classification: 'FINANCIAL',
      before: { listPriceVnd: null, versionNo: 0 },
      after: { listPriceVnd: price.toString(), versionNo: 1, via: 'SUPPLIER_IMPORT' },
    });
  }
  let position = 0;
  const usedAssets = new Set<string>();
  for (const image of kept) {
    if (usedAssets.has(image.mediaAssetId)) continue;
    usedAssets.add(image.mediaAssetId);
    await tx.productImage.create({
      data: {
        productId: product.id,
        mediaAssetId: image.mediaAssetId,
        sortOrder: position,
        createdByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    position += 1;
  }
  await tx.importCandidate.update({
    where: { id: candidateId },
    data: {
      state: 'IMPORTED',
      importedProductId: product.id,
      decidedByUserId: context.actor.userId,
      decidedAt: context.now,
      rowVersion: { increment: 1 },
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CANDIDATE_APPROVED',
    entityType: 'ImportCandidate',
    entityId: candidateId,
    after: {
      productId: product.id,
      sku,
      images: position,
      droppedImages: row.images.length - kept.length,
      sellingPriceSet: price !== null,
    },
  });
  return { productId: product.id, sku, images: position };
}

function priceOf(value: unknown): bigint {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,15}$/.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'listPriceVnd');
  }
  const amount = BigInt(value);
  if (amount > MAX_PRICE) throw new AuthError('VALIDATION_FAILED', 'listPriceVnd');
  return amount;
}

export async function approveCandidate(
  context: AdminContext,
  id: string,
  request: SupplierCandidateApproveRequest,
): Promise<SupplierCandidateApproveResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['expectedVersion', 'listPriceVnd']);
  const expected = input.rowVersion(body['expectedVersion']);
  // A selling price is the Owner's (or a person granted the price permission): the authority comes first and a refusal writes nothing.
  let price: bigint | null = null;
  if (body['listPriceVnd'] !== undefined && body['listPriceVnd'] !== null) {
    if (!canSeePrices(context)) throw new AuthError('FORBIDDEN');
    price = priceOf(body['listPriceVnd']);
  }
  return approveInTransaction(context, input.uuid(id, 'id'), expected, price);
}

/** Approves the listed candidates that are still ready (no warning at all), one by one, without a price. The others are reported. */
export async function approveReady(
  context: AdminContext,
  request: SupplierApproveReadyRequest,
): Promise<SupplierApproveReadyResponse> {
  requireReview(context);
  const body = input.record(request, 'body', ['candidates']);
  const list = input.list(body['candidates'], 'candidates', CANDIDATE_BULK_MAX);
  if (list.length === 0) throw new AuthError('VALIDATION_FAILED', 'candidates');
  const { tx } = context;
  const result: SupplierApproveReadyResponse = { approved: 0, skipped: [] };
  const seen = new Set<string>();
  for (const entry of list) {
    const item = input.record(entry, 'candidates', ['id', 'expectedVersion']);
    const id = input.uuid(item['id'], 'candidates');
    const expected = input.rowVersion(item['expectedVersion']);
    if (seen.has(id)) throw new AuthError('VALIDATION_FAILED', 'candidates');
    seen.add(id);
    const point = `ready_${randomUUID().replaceAll('-', '')}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${point}`);
    try {
      const current = await tx.importCandidate.findUnique({
        where: { id },
        select: { state: true, rowVersion: true },
      });
      if (!current) throw new AuthError('NOT_FOUND');
      if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
      if (current.state !== 'READY_FOR_REVIEW') throw new AuthError('CANDIDATE_NOT_READY');
      // The refresh inside the approval can find a new warning: then it is not ready any more and nothing is created.
      await evaluateCandidates(tx, { candidateIds: [id] });
      const fresh = await tx.importCandidate.findUniqueOrThrow({
        where: { id },
        select: { state: true, rowVersion: true },
      });
      if (fresh.state !== 'READY_FOR_REVIEW') throw new AuthError('CANDIDATE_NOT_READY');
      await approveInTransaction(context, id, fresh.rowVersion, null);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${point}`);
      result.approved += 1;
    } catch (error) {
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${point}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${point}`);
      result.skipped.push({
        id,
        reason: error instanceof AuthError ? error.code : 'FAILED',
      });
    }
  }
  return result;
}

// ------------------------------------------------------------------------------------------------------------- pictures

/** The stored object of one candidate picture (the caller has already been authorized): its asset id must belong to that candidate. */
export async function candidateImageAsset(
  tx: Tx,
  candidateId: string,
  imageId: string,
): Promise<string> {
  const image = await tx.candidateImage.findFirst({
    where: { id: imageId, candidateId },
    select: { mediaAssetId: true },
  });
  if (!image) throw new AuthError('NOT_FOUND');
  return image.mediaAssetId;
}

export { requireReview as requireCandidateReview };

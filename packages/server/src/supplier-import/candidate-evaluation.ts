import type { Prisma } from '@lucy-spa/database';
import {
  DECIDED_STATES,
  evaluateCandidate,
  foldText,
  hostOf,
  type CandidateWarning,
  type EvaluationContext,
  type NamedTarget,
  type VariantOwner,
} from './candidate-rules.js';
import { canonicalJson } from './text.js';

/**
 * Phase 9 P9-5: applies the candidate rules to the database (no network, so the worker after a scan and the API after a mapping change
 * can both call it inside a transaction). A candidate is written only when something changed, and then its row version moves by one.
 * A person's decided candidate (approved, rejected, ignored, imported) is never touched.
 */
type Tx = Prisma.TransactionClient;

const json = (value: unknown) => value as Prisma.InputJsonValue;
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export interface MappingInput {
  supplierId: string;
  kind: 'BRAND' | 'CATEGORY';
  /** The text exactly as the source shows it (a category name, a brand name). */
  sourceText: string;
  targetId: string;
  userId: string;
}

/** Remembers "this source text means this brand or category" (one answer per text, found case and diacritics insensitively). */
export async function saveMapping(
  tx: Tx,
  input: MappingInput,
): Promise<{ id: string; changed: boolean }> {
  const text = input.sourceText.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (text === '' || [...text].length > 300) throw new Error('MAPPING_TEXT_INVALID');
  const key = foldText(text);
  if (key === '') throw new Error('MAPPING_TEXT_INVALID');
  if (input.kind === 'BRAND') {
    const brand = await tx.brand.findUnique({
      where: { id: input.targetId },
      select: { isActive: true },
    });
    if (!brand?.isActive) throw new Error('MAPPING_TARGET_INVALID');
  } else {
    const category = await tx.productCategory.findUnique({
      where: { id: input.targetId },
      select: { isActive: true },
    });
    if (!category?.isActive) throw new Error('MAPPING_TARGET_INVALID');
  }
  const existing = (
    await tx.sourceValueMapping.findMany({
      where: { supplierId: input.supplierId, kind: input.kind },
      select: { id: true, sourceText: true, brandId: true, categoryId: true },
    })
  ).find((row) => foldText(row.sourceText) === key);
  const data =
    input.kind === 'BRAND'
      ? { brandId: input.targetId, categoryId: null }
      : { brandId: null, categoryId: input.targetId };
  if (existing) {
    const same = (existing.brandId ?? existing.categoryId) === input.targetId;
    if (same) return { id: existing.id, changed: false };
    await tx.sourceValueMapping.update({ where: { id: existing.id }, data, select: { id: true } });
    return { id: existing.id, changed: true };
  }
  const created = await tx.sourceValueMapping.create({
    data: {
      supplierId: input.supplierId,
      kind: input.kind,
      sourceText: text,
      createdByUserId: input.userId,
      ...data,
    },
    select: { id: true },
  });
  return { id: created.id, changed: true };
}

const CANDIDATE_SELECT = {
  id: true,
  supplierId: true,
  state: true,
  nameVi: true,
  nameEn: true,
  descriptionVi: true,
  descriptionEn: true,
  brandId: true,
  brandText: true,
  categoryId: true,
  proposedSku: true,
  warnings: true,
  sources: {
    select: {
      sourceRecord: {
        select: {
          id: true,
          sourceKey: true,
          sku: true,
          brandText: true,
          categoryPath: true,
          descriptionText: true,
          attributes: true,
          imageUrls: true,
          source: { select: { baseUrl: true } },
          priceObservations: {
            orderBy: { observedAt: 'desc' },
            take: 1,
            select: { priceVnd: true },
          },
        },
      },
    },
    take: 1,
  },
  images: {
    where: { retiredAt: null },
    select: { id: true, sourceUrl: true, flag: true },
  },
  decisions: {
    orderBy: { seq: 'asc' },
    select: { kind: true, imageId: true, ref: true },
  },
} satisfies Prisma.ImportCandidateSelect;

/** The latest decision of each picture and every look-alike kept separate (a later decision replaces an earlier one). */
export function reduceDecisions(
  rows: readonly { kind: string; imageId: string | null; ref: string | null }[],
): { images: Map<string, 'KEEP' | 'DROP'>; keptSeparate: Set<string> } {
  const images = new Map<string, 'KEEP' | 'DROP'>();
  const keptSeparate = new Set<string>();
  for (const row of rows) {
    if (row.imageId !== null && (row.kind === 'IMAGE_KEEP' || row.kind === 'IMAGE_DROP')) {
      images.set(row.imageId, row.kind === 'IMAGE_KEEP' ? 'KEEP' : 'DROP');
    } else if (row.ref !== null && row.kind === 'DUPLICATE_KEEP_SEPARATE') {
      keptSeparate.add(row.ref);
    }
  }
  return { images, keptSeparate };
}

async function loadContext(
  tx: Tx,
  supplierIds: readonly string[],
  skuPrefixes?: Readonly<Record<string, string>>,
): Promise<{
  context: EvaluationContext;
  mappingsBySupplier: Map<string, { brand: Map<string, string>; category: Map<string, string> }>;
}> {
  const [brands, categories, variants, products, others, mappings] = await Promise.all([
    tx.brand.findMany({
      where: { isActive: true },
      select: { id: true, nameVi: true, nameEn: true },
    }),
    tx.productCategory.findMany({
      where: { isActive: true },
      select: { id: true, nameVi: true, nameEn: true },
    }),
    tx.productVariant.findMany({
      select: { id: true, sku: true, product: { select: { id: true, nameVi: true } } },
    }),
    tx.product.findMany({ select: { id: true, nameVi: true, nameEn: true, brandId: true } }),
    tx.importCandidate.findMany({
      select: { id: true, nameVi: true, proposedSku: true, brandId: true, state: true },
    }),
    tx.sourceValueMapping.findMany({
      where: { supplierId: { in: [...supplierIds] } },
      select: { supplierId: true, kind: true, sourceText: true, brandId: true, categoryId: true },
    }),
  ]);
  const named = (rows: { id: string; nameVi: string; nameEn: string }[]): NamedTarget[] =>
    rows.map((row) => ({ id: row.id, names: [row.nameVi, row.nameEn] }));
  const variantMap = new Map<string, VariantOwner>(
    variants.map((variant) => [
      variant.sku,
      { variantId: variant.id, productId: variant.product.id, productName: variant.product.nameVi },
    ]),
  );
  const mappingsBySupplier = new Map<
    string,
    { brand: Map<string, string>; category: Map<string, string> }
  >();
  for (const row of mappings) {
    const entry = mappingsBySupplier.get(row.supplierId) ?? {
      brand: new Map(),
      category: new Map(),
    };
    const target = row.kind === 'BRAND' ? row.brandId : row.categoryId;
    if (target)
      (row.kind === 'BRAND' ? entry.brand : entry.category).set(foldText(row.sourceText), target);
    mappingsBySupplier.set(row.supplierId, entry);
  }
  return {
    context: {
      ...(skuPrefixes ? { skuPrefixes } : {}),
      brandMappings: new Map(),
      categoryMappings: new Map(),
      brands: named(brands),
      categories: named(categories),
      variants: variantMap,
      products,
      otherCandidates: others,
    },
    mappingsBySupplier,
  };
}

export interface EvaluationSummary {
  evaluated: number;
  changed: number;
  states: Record<string, number>;
}

/**
 * Evaluates the given candidates (or, with `supplierId`, every candidate of that supplier a person has not decided yet). Candidates
 * are locked one at a time; a decided candidate is skipped.
 */
export async function evaluateCandidates(
  tx: Tx,
  scope: { candidateIds: readonly string[] } | { supplierId: string },
  options: { skuPrefixes?: Readonly<Record<string, string>> } = {},
): Promise<EvaluationSummary> {
  const ids =
    'candidateIds' in scope
      ? [...scope.candidateIds]
      : (
          await tx.importCandidate.findMany({
            where: { supplierId: scope.supplierId, state: { notIn: [...DECIDED_STATES] } },
            select: { id: true },
          })
        ).map((row) => row.id);
  const summary: EvaluationSummary = { evaluated: 0, changed: 0, states: {} };
  if (ids.length === 0) return summary;
  const suppliers = [
    ...new Set(
      (
        await tx.importCandidate.findMany({
          where: { id: { in: ids } },
          select: { supplierId: true },
        })
      ).map((row) => row.supplierId),
    ),
  ];
  const { context: base, mappingsBySupplier } = await loadContext(
    tx,
    suppliers,
    options.skuPrefixes,
  );
  // Two passes: the first only teaches the context every candidate of this run (its SKU, brand and state), the second writes. That way
  // two candidates with the same SKU warn each other whichever is evaluated first.
  for (const write of [false, true]) {
    for (const id of ids) {
      await tx.$queryRaw`SELECT id FROM import_candidates WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.importCandidate.findUnique({ where: { id }, select: CANDIDATE_SELECT });
      if (!row || (DECIDED_STATES as readonly string[]).includes(row.state)) continue;
      const link = row.sources[0]?.sourceRecord;
      if (!link) continue;
      const maps = mappingsBySupplier.get(row.supplierId);
      const categoryPath = Array.isArray(link.categoryPath) ? (link.categoryPath as unknown[]) : [];
      const attributes = isRecord(link.attributes) ? link.attributes : {};
      const result = evaluateCandidate(
        {
          candidate: {
            id: row.id,
            state: row.state,
            nameVi: row.nameVi,
            nameEn: row.nameEn,
            descriptionVi: row.descriptionVi,
            descriptionEn: row.descriptionEn,
            brandId: row.brandId,
            brandText: row.brandText,
            categoryId: row.categoryId,
            proposedSku: row.proposedSku,
            warnings: (Array.isArray(row.warnings) ? row.warnings : []).filter(
              isRecord,
            ) as CandidateWarning[],
          },
          record: {
            sourceKey: link.sourceKey,
            sku: link.sku,
            brandText: link.brandText,
            categoryNames: categoryPath.filter(
              (entry): entry is string => typeof entry === 'string',
            ),
            descriptionText: link.descriptionText,
            attributeTexts: Object.values(attributes).flatMap((value) =>
              Array.isArray(value)
                ? value.filter((entry): entry is string => typeof entry === 'string')
                : [],
            ),
            priceVnd:
              link.priceObservations[0]?.priceVnd === null ||
              link.priceObservations[0] === undefined
                ? null
                : Number(link.priceObservations[0].priceVnd),
            imageUrls: Array.isArray(link.imageUrls)
              ? (link.imageUrls as unknown[]).filter(
                  (entry): entry is string => typeof entry === 'string',
                )
              : [],
          },
          host: hostOf(link.source.baseUrl),
          images: row.images,
          decisions: reduceDecisions(row.decisions),
        },
        {
          ...base,
          brandMappings: maps?.brand ?? new Map(),
          categoryMappings: maps?.category ?? new Map(),
        },
      );
      if (!write) {
        const index = base.otherCandidates.findIndex((other) => other.id === id);
        const planned = {
          id,
          nameVi: row.nameVi,
          proposedSku: result.proposedSku,
          brandId: result.brandId,
          state: result.state,
        };
        if (index >= 0) base.otherCandidates[index] = planned;
        continue;
      }
      summary.evaluated += 1;
      summary.states[result.state] = (summary.states[result.state] ?? 0) + 1;
      const before = canonicalJson({
        brandId: row.brandId,
        brandText: row.brandText,
        categoryId: row.categoryId,
        proposedSku: row.proposedSku,
        warnings: row.warnings,
        state: row.state,
      });
      const after = canonicalJson({
        brandId: result.brandId,
        brandText: result.brandText,
        categoryId: result.categoryId,
        proposedSku: result.proposedSku,
        warnings: result.warnings,
        state: result.state,
      });
      if (before === after) continue;
      await tx.importCandidate.update({
        where: { id },
        data: {
          brandId: result.brandId,
          brandText: result.brandText,
          categoryId: result.categoryId,
          proposedSku: result.proposedSku,
          warnings: json(result.warnings),
          state: result.state as never,
          rowVersion: { increment: 1 },
        },
        select: { id: true },
      });
      summary.changed += 1;
      // Later candidates of this run see this one's new SKU and state.
      const known = base.otherCandidates.findIndex((other) => other.id === id);
      const updated = {
        id,
        nameVi: row.nameVi,
        proposedSku: result.proposedSku,
        brandId: result.brandId,
        state: result.state,
      };
      if (known >= 0) base.otherCandidates[known] = updated;
    }
  }
  return summary;
}

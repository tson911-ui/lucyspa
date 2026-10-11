import { randomUUID } from 'node:crypto';
import {
  IMPORT_ALL_IGNORE_MAX,
  IMPORT_ALL_IMPORT_MAX,
  OPEN_CANDIDATE_STATES,
  type CandidateWarningItem,
  type ImportAllBlocker,
  type SupplierImportAllPreview,
  type SupplierImportAllRequest,
  type SupplierImportAllResponse,
  type SupplierImportAllRow,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import {
  classifyProduct,
  deriveBrands,
  hostOf,
  proposeSku,
  evaluateCandidates,
  foldText,
  LUCY_CATEGORIES,
  reduceDecisions,
  saveMapping,
  supplierPromoPrice,
  supplierSellingPrice,
  type LucyCategoryKey,
} from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';
import * as input from '../inventory/inventory.input.js';
import * as productInput from '../products/product-catalog.input.js';
import { approvalBlockers, approveInTransaction, lockCandidate } from './supplier-import.core.js';

/**
 * Phase 9 P9-9b (Owner, docs/PHASE9_PRODUCT_IMPORT.md section 17): "Nhập và đăng tất cả". The preview lists every open candidate with the
 * brand, category and selling price the system chose; the import step creates the product (DRAFT first, through the same approval as
 * a single product), records the price as a normal numbered price version and publishes it, for the products the person ticked. Under
 * the clicks nothing is relaxed:
 * - Authority: REVIEW_SUPPLIER_IMPORTS, MANAGE_PRODUCTS (brands, categories, publishing) and MANAGE_PRODUCT_PRICES (the price), all GLOBAL,
 *   decided inside the transaction. Without all three nothing is shown and nothing is written.
 * - A real blocker (no name, no or malformed SKU, SKU collision, a flagged picture without a decision, an unresolved look-alike, or no
 *   price at the source) skips that product and lists it; nothing is forced. Every skipped product is changed in no way.
 * - Brands and categories are created only from the supplier's own text and the Owner's fixed list; every creation, mapping, product,
 *   price version and publication writes the audit log. The supplier price is never written to a cost.
 * - Each product is its own savepoint: one failure never undoes the others. The screen sends the ticked products in calls of 20.
 */
type Tx = Prisma.TransactionClient;
const GLOBAL = { kind: 'GLOBAL' } as const;
const MAX_CODE = 64;
const IGNORE_NOTE = 'Bỏ chọn khi nhập hàng loạt';
/** A sale the source gives no end date for runs ten years (no end in practice); a person ends it by hand when the source's sale ends. */
const OPEN_ENDED_PROMOTION_MS = 10 * 365 * 24 * 60 * 60 * 1000;

function requireImportAll(context: AdminContext): void {
  const graph = context.actor.graph;
  for (const permission of [
    'REVIEW_SUPPLIER_IMPORTS',
    'MANAGE_PRODUCTS',
    'MANAGE_PRODUCT_PRICES',
  ]) {
    if (!decide(graph, permission, GLOBAL)) throw new AuthError('FORBIDDEN');
  }
}

const CANDIDATE = {
  id: true,
  state: true,
  rowVersion: true,
  nameVi: true,
  proposedSku: true,
  warnings: true,
  brandId: true,
  categoryId: true,
  brandText: true,
  categoryPath: true,
  supplierId: true,
  images: {
    where: { retiredAt: null },
    orderBy: { sortOrder: 'asc' },
    select: { id: true },
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
          categoryPath: true,
          sku: true,
          sourceKey: true,
          source: { select: { baseUrl: true } },
          priceObservations: {
            orderBy: { observedAt: 'desc' },
            take: 1,
            select: { priceVnd: true, promoPriceVnd: true },
          },
        },
      },
    },
  },
} satisfies Prisma.ImportCandidateSelect;

type CandidateRow = Prisma.ImportCandidateGetPayload<{ select: typeof CANDIDATE }>;

const warningsOf = (value: unknown): CandidateWarningItem[] =>
  (Array.isArray(value) ? (value as unknown[]) : []).filter(
    (entry): entry is CandidateWarningItem =>
      typeof entry === 'object' && entry !== null && !Array.isArray(entry),
  );
const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

interface BrandRow {
  id: string;
  nameVi: string;
  nameEn: string;
}

/** An active Lucy brand whose name is the text (accents and case ignored). */
function findBrand(brands: readonly BrandRow[], text: string): BrandRow | undefined {
  const key = foldText(text);
  return key === ''
    ? undefined
    : brands.find((brand) => foldText(brand.nameVi) === key || foldText(brand.nameEn) === key);
}

interface CategoryIndex {
  /** The fixed list's key to the category id (null when Lucy Spa does not have it yet). */
  ids: Map<LucyCategoryKey, string | null>;
}

async function loadCategories(tx: Tx): Promise<CategoryIndex> {
  const rows = await tx.productCategory.findMany({
    where: { isActive: true },
    select: { id: true, nameVi: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });
  const ids = new Map<LucyCategoryKey, string | null>();
  for (const category of LUCY_CATEGORIES) {
    const key = foldText(category.nameVi);
    ids.set(category.key, rows.find((row) => foldText(row.nameVi) === key)?.id ?? null);
  }
  return { ids };
}

/** Creates the categories of the fixed list that are missing (idempotent). Returns how many were created. */
async function ensureCategories(context: AdminContext, index: CategoryIndex): Promise<number> {
  const { tx } = context;
  let created = 0;
  let order =
    (await tx.productCategory.aggregate({ _max: { sortOrder: true } }))._max.sortOrder ?? 0;
  for (const category of LUCY_CATEGORIES) {
    if (index.ids.get(category.key) !== null && index.ids.get(category.key) !== undefined) continue;
    order += 10;
    const code = await productInput.uniqueCode(
      productInput.slug(category.nameEn, MAX_CODE),
      MAX_CODE,
      async (candidate) =>
        Boolean(
          await tx.productCategory.findUnique({ where: { code: candidate }, select: { id: true } }),
        ),
    );
    const row = await tx.productCategory.create({
      data: { code, nameVi: category.nameVi, nameEn: category.nameEn, sortOrder: order },
      select: { id: true },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_CATEGORY_CREATED',
      entityType: 'ProductCategory',
      entityId: row.id,
      after: { code, nameVi: category.nameVi, nameEn: category.nameEn, via: 'SUPPLIER_IMPORT_ALL' },
    });
    index.ids.set(category.key, row.id);
    created += 1;
  }
  return created;
}

const categoryName = (key: LucyCategoryKey) =>
  LUCY_CATEGORIES.find((category) => category.key === key)!.nameVi;

interface Plan {
  row: CandidateRow;
  brand: { text: string; existing: BrandRow | undefined } | null;
  brandTerm: { text: string; by: string } | null;
  category: { key: LucyCategoryKey; term: string | null; by: string };
  price: bigint | null;
  /** The supplier's sale, mirrored as a promotion (null when the product is not on sale). */
  promo: bigint | null;
  sku: string | null;
}

/** The supplier's category names of a candidate (its own, else those of its source record). */
function categoryNamesOf(row: CandidateRow): string[] {
  const own = stringsOf(row.categoryPath);
  return own.length > 0 ? own : stringsOf(row.sources[0]?.sourceRecord.categoryPath);
}

/** The brands the whole batch of open candidates teaches (a product that lists only a product line still finds its brand). */
function dictionaryOf(rows: readonly CandidateRow[], brands: readonly BrandRow[]): string[] {
  return deriveBrands(
    rows.map((row) => ({ name: row.nameVi, categoryNames: categoryNamesOf(row) })),
    brands.map((brand) => brand.nameVi),
  );
}

async function loadDictionary(tx: Tx, brands: readonly BrandRow[]): Promise<string[]> {
  const rows = await tx.importCandidate.findMany({
    where: { state: { in: [...OPEN_CANDIDATE_STATES] } },
    select: CANDIDATE,
  });
  return dictionaryOf(rows, brands);
}

/**
 * The SKU the product will have (Owner, 2026-10-11): a candidate scanned before the HARU-<id> rule still holds the supplier's unusable
 * text (a URL slug). It is shown, checked and imported with HARU-<WooCommerce id> now; the import re-evaluates the candidate and stores
 * it. A SKU a person typed is never replaced.
 */
function skuOf(row: CandidateRow): string | null {
  const record = row.sources[0]?.sourceRecord;
  if (!record) return row.proposedSku;
  const proposed = proposeSku(
    { sku: record.sku, sourceKey: record.sourceKey },
    hostOf(record.source.baseUrl),
  );
  // No SKU stored (an over-long supplier slug is stored as none), or the unedited unusable supplier text: the proposal.
  const stale =
    row.proposedSku === null ||
    (proposed.replacedSourceSku !== undefined && row.proposedSku === proposed.replacedSourceSku);
  return stale ? (proposed.sku ?? row.proposedSku) : row.proposedSku;
}

function planOf(
  row: CandidateRow,
  brands: readonly BrandRow[],
  dictionary: readonly string[],
): Plan {
  const record = row.sources[0]?.sourceRecord;
  const classified = classifyProduct(
    { name: row.nameVi, categoryNames: categoryNamesOf(row), brandText: row.brandText },
    brands.map((brand) => brand.nameVi),
    dictionary,
  );
  const brand =
    classified.brand === null
      ? null
      : { text: classified.brand.text, existing: findBrand(brands, classified.brand.text) };
  const observation = record?.priceObservations[0];
  return {
    row,
    brand,
    brandTerm:
      classified.brand === null ? null : { text: classified.brand.text, by: classified.brand.by },
    category: {
      key: classified.category.key,
      term: classified.category.term,
      by: classified.category.by,
    },
    // The REGULAR price only (Owner, 2026-10-11): the sale price stays a reference observation on the source record.
    price: supplierSellingPrice(observation?.priceVnd ?? null),
    promo: supplierPromoPrice(observation?.priceVnd ?? null, observation?.promoPriceVnd ?? null),
    sku: skuOf(row),
  };
}

function blockersOf(plan: Plan, skuTaken: boolean): ImportAllBlocker[] {
  const out: ImportAllBlocker[] = [
    ...approvalBlockers({
      nameVi: plan.row.nameVi,
      sku: plan.sku,
      skuTaken,
      warnings: warningsOf(plan.row.warnings),
    }),
  ];
  if (plan.price === null) out.push('PRICE_MISSING');
  return out;
}

/** Everything the screen needs to show one list and decide: all open candidates, what the system chose, and why some cannot go. */
export async function previewImportAll(context: AdminContext): Promise<SupplierImportAllPreview> {
  requireImportAll(context);
  const { tx } = context;
  const [rows, brands, categories] = await Promise.all([
    tx.importCandidate.findMany({
      where: { state: { in: [...OPEN_CANDIDATE_STATES] } },
      select: CANDIDATE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    tx.brand.findMany({
      where: { isActive: true },
      select: { id: true, nameVi: true, nameEn: true },
    }),
    loadCategories(tx),
  ]);
  const dictionary = dictionaryOf(rows, brands);
  const skus = [...new Set(rows.flatMap((row) => skuOf(row) ?? []))];
  const taken = new Set(
    (await tx.productVariant.findMany({ where: { sku: { in: skus } }, select: { sku: true } })).map(
      (variant) => variant.sku,
    ),
  );
  const result: SupplierImportAllRow[] = [];
  const newBrands = new Map<string, { name: string; count: number }>();
  const perCategory = new Map<LucyCategoryKey, number>();
  let importable = 0;
  for (const row of rows) {
    const plan = planOf(row, brands, dictionary);
    const blockers = blockersOf(plan, plan.sku !== null && taken.has(plan.sku));
    const decisions = reduceDecisions(row.decisions).images;
    const shown = row.images.filter((image) => decisions.get(image.id) !== 'DROP');
    // The brand already on the candidate (a person chose it) wins over the one the system would pick.
    const brandName =
      row.brandId === null
        ? plan.brand
          ? {
              name: plan.brand.existing?.nameVi ?? plan.brand.text,
              isNew: plan.brand.existing === undefined,
            }
          : null
        : { name: brands.find((brand) => brand.id === row.brandId)?.nameVi ?? '', isNew: false };
    const key =
      row.categoryId === null
        ? plan.category.key
        : (categoryKeyOf(categories, row.categoryId) ?? plan.category.key);
    result.push({
      id: row.id,
      rowVersion: row.rowVersion,
      nameVi: row.nameVi,
      sku: plan.sku,
      thumbImageId: shown[0]?.id ?? null,
      brand: brandName,
      category: { key, name: categoryName(key) },
      priceVnd: plan.price === null ? null : plan.price.toString(),
      promoPriceVnd: plan.promo === null ? null : plan.promo.toString(),
      blockers,
    });
    if (blockers.length === 0) {
      importable += 1;
      perCategory.set(key, (perCategory.get(key) ?? 0) + 1);
      if (brandName?.isNew) {
        const entry = newBrands.get(foldText(brandName.name)) ?? { name: brandName.name, count: 0 };
        entry.count += 1;
        newBrands.set(foldText(brandName.name), entry);
      }
    }
  }
  return {
    rows: result,
    total: rows.length,
    importable,
    blocked: rows.length - importable,
    newBrands: [...newBrands.values()].sort(
      (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi'),
    ),
    categories: LUCY_CATEGORIES.map((category) => ({
      key: category.key,
      name: category.nameVi,
      count: perCategory.get(category.key) ?? 0,
    })),
    categoriesToCreate: LUCY_CATEGORIES.filter(
      (category) => categories.ids.get(category.key) === null,
    ).map((category) => category.nameVi),
  };
}

function categoryKeyOf(index: CategoryIndex, id: string): LucyCategoryKey | null {
  for (const [key, value] of index.ids) if (value === id) return key;
  return null;
}

class Skip extends Error {
  constructor(readonly reasons: string[]) {
    super('skipped');
  }
}

const reasonsOf = (error: unknown): string[] =>
  error instanceof Skip ? error.reasons : error instanceof AuthError ? [error.code] : ['FAILED'];

/** Runs `work` in its own savepoint; a failure rolls back only this unit and is reported. */
async function savepoint<T>(tx: Tx, work: () => Promise<T>): Promise<T> {
  const name = `all_${randomUUID().replaceAll('-', '')}`;
  await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
  try {
    const value = await work();
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`);
    throw error;
  }
}

async function importOne(
  context: AdminContext,
  id: string,
  expected: number,
  brands: BrandRow[],
  categories: CategoryIndex,
  dictionary: readonly string[],
): Promise<{ newBrand: BrandRow | null }> {
  const { tx } = context;
  await lockCandidate(tx, id, expected);
  const row = await tx.importCandidate.findUniqueOrThrow({ where: { id }, select: CANDIDATE });
  const plan = planOf(row, brands, dictionary);

  // 1. The brand: the one a person already chose, else the supplier's own text, matched to a Lucy brand or created.
  let brandId = row.brandId;
  let newBrand: BrandRow | null = null;
  if (brandId === null && plan.brand !== null) {
    const existing = plan.brand.existing;
    if (existing) brandId = existing.id;
    else {
      const nameVi = plan.brand.text.normalize('NFC').trim().slice(0, 200);
      const code = await productInput.uniqueCode(
        productInput.slug(nameVi, MAX_CODE),
        MAX_CODE,
        async (candidate) =>
          Boolean(await tx.brand.findUnique({ where: { code: candidate }, select: { id: true } })),
      );
      const created = await tx.brand.create({
        data: { code, nameVi, nameEn: nameVi },
        select: { id: true },
      });
      await appendAdminAudit(context, {
        action: 'PRODUCT_BRAND_CREATED',
        entityType: 'Brand',
        entityId: created.id,
        after: { code, nameVi, nameEn: nameVi, via: 'SUPPLIER_IMPORT_ALL' },
      });
      brandId = created.id;
      newBrand = { id: created.id, nameVi, nameEn: nameVi };
    }
    // Remembered for the next scan: this supplier text always means this brand.
    if (plan.brandTerm !== null) {
      await saveMapping(tx, {
        supplierId: row.supplierId,
        kind: 'BRAND',
        sourceText: plan.brandTerm.text,
        targetId: brandId,
        userId: context.actor.userId,
      });
    }
  }

  // 2. The category: the one already on the candidate, else the one the rules chose from the fixed list.
  let categoryId = row.categoryId;
  if (categoryId === null) {
    categoryId = categories.ids.get(plan.category.key) ?? null;
    if (categoryId !== null && plan.category.term !== null) {
      await saveMapping(tx, {
        supplierId: row.supplierId,
        kind: 'CATEGORY',
        sourceText: plan.category.term,
        targetId: categoryId,
        userId: context.actor.userId,
      });
    }
  }
  if (brandId !== row.brandId || categoryId !== row.categoryId) {
    await tx.importCandidate.update({
      where: { id },
      data: { brandId, categoryId, rowVersion: { increment: 1 } },
      select: { id: true },
    });
    await appendAdminAudit(context, {
      action: 'SUPPLIER_CANDIDATE_EDITED',
      entityType: 'ImportCandidate',
      entityId: id,
      before: { brandId: row.brandId, categoryId: row.categoryId },
      after: { brandId, categoryId, via: 'SUPPLIER_IMPORT_ALL' },
    });
  }

  // 3. The warnings are refreshed with the brand and category now in place; a real blocker skips the product and says why.
  await evaluateCandidates(tx, { candidateIds: [id] });
  const fresh = await tx.importCandidate.findUniqueOrThrow({ where: { id }, select: CANDIDATE });
  const freshPlan = planOf(fresh, brands, dictionary);
  const taken =
    fresh.proposedSku === null
      ? null
      : await tx.productVariant.findUnique({
          where: { sku: fresh.proposedSku },
          select: { id: true },
        });
  const blockers = blockersOf(freshPlan, taken !== null);
  if (blockers.length > 0) throw new Skip(blockers);
  if (freshPlan.price === null) throw new Skip(['PRICE_MISSING']);

  // 4. The same approval as a single product (DRAFT, the numbered price version, the kept pictures, the provenance), then publish.
  const approved = await approveInTransaction(context, id, fresh.rowVersion, freshPlan.price);
  // The supplier's sale, as the shop's own promotion (price below the list price, from now). The Store API gives no sale dates, so it
  // runs open-ended: a later change at the source is a review item (the change notes) and a person ends it by hand.
  if (freshPlan.promo !== null) {
    const variant = await tx.productVariant.findFirstOrThrow({
      where: { productId: approved.productId },
      orderBy: { sortOrder: 'asc' },
      select: { id: true },
    });
    const startsAt = context.now;
    const endsAt = new Date(startsAt.getTime() + OPEN_ENDED_PROMOTION_MS);
    const promotion = await tx.productPromotion.create({
      data: {
        variantId: variant.id,
        promoPriceVnd: freshPlan.promo,
        startsAt,
        endsAt,
        createdByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_PROMOTION_CREATED',
      entityType: 'ProductPromotion',
      entityId: promotion.id,
      classification: 'FINANCIAL',
      after: {
        variantId: variant.id,
        promoPriceVnd: freshPlan.promo.toString(),
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        via: 'SUPPLIER_IMPORT_ALL',
      },
    });
  }
  const published = await tx.product.update({
    where: { id: approved.productId },
    data: { status: 'PUBLISHED', rowVersion: { increment: 1 } },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_STATUS_CHANGED',
    entityType: 'Product',
    entityId: published.id,
    before: { status: 'DRAFT' },
    after: { status: 'PUBLISHED', via: 'SUPPLIER_IMPORT_ALL' },
  });
  return { newBrand };
}

async function ignoreOne(context: AdminContext, id: string, expected: number): Promise<void> {
  const { tx } = context;
  await lockCandidate(tx, id, expected);
  await tx.importCandidate.update({
    where: { id },
    data: {
      state: 'IGNORED',
      decidedByUserId: context.actor.userId,
      decidedAt: context.now,
      decisionNote: IGNORE_NOTE,
      rowVersion: expected + 1,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'SUPPLIER_CANDIDATE_IGNORED',
    entityType: 'ImportCandidate',
    entityId: id,
    before: { state: 'OPEN' },
    after: { state: 'IGNORED', note: IGNORE_NOTE, via: 'SUPPLIER_IMPORT_ALL' },
  });
}

/** Imports and publishes the ticked products and ignores the unticked ones (one call: at most 20 and 100). */
export async function importAll(
  context: AdminContext,
  request: SupplierImportAllRequest,
): Promise<SupplierImportAllResponse> {
  requireImportAll(context);
  const body = input.record(request, 'body', ['import', 'ignore']);
  const parse = (value: unknown, field: string, max: number) => {
    const list = input.list(value, field, max);
    const seen = new Set<string>();
    return list.map((entry) => {
      const item = input.record(entry, field, ['id', 'expectedVersion']);
      const id = input.uuid(item['id'], field);
      if (seen.has(id)) throw new AuthError('VALIDATION_FAILED', field);
      seen.add(id);
      return { id, expected: input.rowVersion(item['expectedVersion']) };
    });
  };
  const toImport = parse(body['import'], 'import', IMPORT_ALL_IMPORT_MAX);
  const toIgnore = parse(body['ignore'], 'ignore', IMPORT_ALL_IGNORE_MAX);
  if (toImport.length + toIgnore.length === 0) throw new AuthError('VALIDATION_FAILED', 'import');
  const overlap = new Set(toImport.map((item) => item.id));
  if (toIgnore.some((item) => overlap.has(item.id)))
    throw new AuthError('VALIDATION_FAILED', 'ignore');

  const { tx } = context;
  const result: SupplierImportAllResponse = {
    imported: 0,
    ignored: 0,
    newBrands: 0,
    createdCategories: 0,
    skipped: [],
  };
  const categories = await loadCategories(tx);
  const brands = await tx.brand.findMany({
    where: { isActive: true },
    select: { id: true, nameVi: true, nameEn: true },
  });
  if (toImport.length > 0) result.createdCategories = await ensureCategories(context, categories);
  const dictionary = toImport.length > 0 ? await loadDictionary(tx, brands) : [];
  for (const item of toImport) {
    try {
      const done = await savepoint(tx, () =>
        importOne(context, item.id, item.expected, brands, categories, dictionary),
      );
      result.imported += 1;
      if (done.newBrand) {
        // Only after the unit succeeded: a rolled-back brand must not stay in the cache.
        brands.push(done.newBrand);
        result.newBrands += 1;
      }
    } catch (error) {
      result.skipped.push({ id: item.id, reasons: reasonsOf(error) });
    }
  }
  for (const item of toIgnore) {
    try {
      await savepoint(tx, () => ignoreOne(context, item.id, item.expected));
      result.ignored += 1;
    } catch (error) {
      result.skipped.push({ id: item.id, reasons: reasonsOf(error) });
    }
  }
  return result;
}

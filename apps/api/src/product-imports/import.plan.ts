import type {
  ProductImportActionName,
  ProductImportIssue,
  ProductImportRowResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { normalizeHeader } from '@lucy-spa/server';
import { branchToday } from '../inventory/inventory.view.js';
import { parseCatalogRow, parseOpeningRow, type Access, type Issues } from './import.parse.js';

type Tx = Prisma.TransactionClient;

/**
 * Phase 6 P6-5: what a file would do, row by row. ONE planner serves the preview (at upload) and the apply (which plans again,
 * under locks and with the applier's own authority, and refuses when the result differs from what the person confirmed).
 * It only reads: nothing here writes. Cells are plain text as read from the file; every problem is a language-neutral code.
 */

export interface SourceRow {
  rowNo: number;
  cells: Record<string, string>;
}

export interface PlannedRow {
  rowNo: number;
  sku: string;
  title: string | null;
  status: 'VALID' | 'INVALID';
  action: ProductImportActionName;
  errors: Issues;
  warnings: Issues;
  changes: string[];
  cells: Record<string, string>;
}

/** What is stored in `product_import_rows.raw`: everything of the row except the errors (their own column). */
export interface StoredRaw {
  sku: string;
  title: string | null;
  cells: Record<string, string>;
  warnings: Issues;
  changes: string[];
}

export const toStored = (row: PlannedRow): StoredRaw => ({
  sku: row.sku,
  title: row.title,
  cells: row.cells,
  warnings: row.warnings,
  changes: row.changes,
});

/** The row as the screens read it. The money columns exist only for a viewer who may see them. */
export function toResponse(
  row: {
    rowNo: number;
    raw: StoredRaw;
    status: 'VALID' | 'INVALID';
    action: ProductImportActionName;
    errors: Issues;
  },
  access: Access,
): ProductImportRowResponse {
  const cells = { ...row.raw.cells };
  if (!access.prices) delete cells['price'];
  if (!access.cost) delete cells['cost'];
  return {
    rowNo: row.rowNo,
    status: row.status,
    action: row.action,
    sku: row.raw.sku,
    title: row.raw.title,
    errors: row.errors,
    warnings: row.raw.warnings,
    changes: row.raw.changes.filter(
      (key) => (key !== 'price' || access.prices) && (key !== 'cost' || access.cost),
    ),
    cells,
  };
}

// ------------------------------------------------------------------------------------------------------ catalog

const PRODUCT_FIELDS = [
  'name_vi',
  'name_en',
  'description_vi',
  'description_en',
  'brand',
  'category',
  'featured',
] as const;
type ProductField = (typeof PRODUCT_FIELDS)[number];
const PRODUCT_FIELD_SET = new Set<string>(PRODUCT_FIELDS);

export interface ProductValues {
  nameVi?: string;
  nameEn?: string;
  descriptionVi?: string;
  descriptionEn?: string;
  brandId?: string;
  categoryId?: string;
  featured?: boolean;
}

export interface EntityPlan {
  key: string;
  /** The product this entity is, or `null` for a product the file creates. */
  existingId: string | null;
  values: ProductValues;
  /** The first valid row of the entity: it carries the product's create or update. */
  carrierRowNo: number | null;
  /** Product columns that change (an existing product) with the stored values they replace. */
  changes: ProductField[];
}

export interface VariantPlan {
  rowNo: number;
  entity: string;
  variantId: string | null;
  sku: string;
  create: boolean;
  set: {
    labelVi?: string;
    labelEn?: string;
    barcode?: string;
    lowStockThreshold?: number;
    sellOnOrder?: boolean;
    leadTimeDaysMin?: number;
    leadTimeDaysMax?: number;
  };
  price: bigint | null;
  cost: bigint | null;
  /** What the stored cost was (for the audit), when the cost changes. */
  previousCost: bigint | null;
  previousPrice: bigint | null;
}

export interface CatalogPlan {
  rows: PlannedRow[];
  entities: Map<string, EntityPlan>;
  /** Only for the valid rows that change something, in file order. */
  variants: VariantPlan[];
}

const issue = (
  code: ProductImportIssue['code'],
  field?: string,
  params?: ProductImportIssue['params'],
): ProductImportIssue => ({
  code,
  ...(field !== undefined ? { field } : {}),
  ...(params !== undefined ? { params } : {}),
});

/** Brands and categories are matched by code or by either name, ignoring case and accents. */
function lookup<
  T extends { id: string; code: string; nameVi: string; nameEn: string; isActive: boolean },
>(items: readonly T[]) {
  const index = new Map<string, T[]>();
  for (const item of items) {
    for (const name of new Set([item.code, item.nameVi, item.nameEn].map(normalizeHeader))) {
      if (name === '') continue;
      index.set(name, [...(index.get(name) ?? []), item]);
    }
  }
  return (text: string) => index.get(normalizeHeader(text)) ?? [];
}

export async function planCatalog(
  context: { tx: Tx; now: Date },
  sources: readonly SourceRow[],
  access: Access,
): Promise<CatalogPlan> {
  const { tx, now } = context;
  const parsed = sources.map((source) => ({
    source,
    ...parseCatalogRow(source.cells, access),
    warnings: [] as Issues,
    changes: [] as string[],
    title: null as string | null,
  }));
  const rowOf = new Map(parsed.map((row) => [row.source.rowNo, row]));

  // Duplicates inside the file: the first row keeps the SKU or barcode, the later ones are refused.
  const firstBySku = new Map<string, number>();
  const firstByBarcode = new Map<string, number>();
  for (const row of parsed) {
    const sku = row.values.sku;
    if (sku !== null) {
      const first = firstBySku.get(sku);
      if (first === undefined) firstBySku.set(sku, row.source.rowNo);
      else row.issues.push(issue('SKU_DUPLICATE_IN_FILE', 'sku', { row: first }));
    }
    const barcode = row.values.barcode;
    if (barcode !== undefined) {
      const first = firstByBarcode.get(barcode);
      if (first === undefined) firstByBarcode.set(barcode, row.source.rowNo);
      else if (sku === null || firstBySku.get(sku) !== first) {
        row.issues.push(issue('BARCODE_DUPLICATE_IN_FILE', 'barcode', { row: first }));
      }
    }
  }

  const skus = [...firstBySku.keys()];
  const variants = await tx.productVariant.findMany({
    where: { sku: { in: skus } },
    select: {
      id: true,
      sku: true,
      productId: true,
      labelVi: true,
      labelEn: true,
      barcode: true,
      lowStockThreshold: true,
      sellOnOrder: true,
      leadTimeDaysMin: true,
      leadTimeDaysMax: true,
      costPriceVnd: true,
      product: {
        select: {
          nameVi: true,
          nameEn: true,
          descriptionVi: true,
          descriptionEn: true,
          brandId: true,
          categoryId: true,
          featured: true,
        },
      },
      priceVersions: { orderBy: { versionNo: 'desc' }, take: 1, select: { listPriceVnd: true } },
      promotions: {
        where: { endedEarlyAt: null, endsAt: { gt: now } },
        select: { promoPriceVnd: true },
      },
    },
  });
  const stored = new Map(variants.map((variant) => [variant.sku, variant]));

  const barcodes = [...firstByBarcode.keys()];
  const barcodeOwners = new Map(
    (barcodes.length === 0
      ? []
      : await tx.productVariant.findMany({
          where: { barcode: { in: barcodes } },
          select: { barcode: true, sku: true },
        })
    ).map((owner) => [owner.barcode, owner.sku]),
  );

  const brands = lookup(
    await tx.brand.findMany({
      select: { id: true, code: true, nameVi: true, nameEn: true, isActive: true },
    }),
  );
  const categories = lookup(
    await tx.productCategory.findMany({
      select: { id: true, code: true, nameVi: true, nameEn: true, isActive: true },
    }),
  );

  // Which product each row belongs to. A matched SKU belongs to its stored product; a group joins the product of its matched SKUs.
  const groupOwner = new Map<string, string>();
  for (const row of parsed) {
    const match = row.values.sku === null ? undefined : stored.get(row.values.sku);
    const group = row.values.productKey;
    if (!match || group === null) continue;
    const entity = `p:${match.productId}`;
    const owner = groupOwner.get(group);
    if (owner === undefined) groupOwner.set(group, entity);
    else if (owner !== entity) row.issues.push(issue('GROUP_MISMATCH', 'product_key', { group }));
  }
  const entityKeyOf = (row: (typeof parsed)[number]): string => {
    const match = row.values.sku === null ? undefined : stored.get(row.values.sku);
    if (match) return `p:${match.productId}`;
    const group = row.values.productKey;
    if (group !== null) return groupOwner.get(group) ?? `n:${group}`;
    return `n:#${row.source.rowNo}`;
  };

  // The product-level columns of every row of an entity are merged: the first value given wins, a different one is refused.
  const merged = new Map<
    string,
    Partial<Record<ProductField, { value: string | boolean; rowNo: number }>>
  >();
  const byEntity = new Map<string, typeof parsed>();
  for (const row of parsed) {
    const key = entityKeyOf(row);
    byEntity.set(key, [...(byEntity.get(key) ?? []), row]);
    const slot = merged.get(key) ?? {};
    merged.set(key, slot);
    const given: [ProductField, string | boolean | undefined][] = [
      ['name_vi', row.values.nameVi],
      ['name_en', row.values.nameEn],
      ['description_vi', row.values.descriptionVi],
      ['description_en', row.values.descriptionEn],
      ['brand', row.values.brand],
      ['category', row.values.category],
      ['featured', row.values.featured],
    ];
    for (const [field, value] of given) {
      if (value === undefined) continue;
      const seen = slot[field];
      const same =
        seen !== undefined &&
        (typeof value === 'string' && typeof seen.value === 'string'
          ? normalizeHeader(value) === normalizeHeader(seen.value) &&
            value.trim() === seen.value.trim()
          : value === seen.value);
      if (seen === undefined) slot[field] = { value, rowNo: row.source.rowNo };
      else if (!same) row.issues.push(issue('GROUP_CONFLICT', field, { row: seen.rowNo }));
    }
  }

  // Resolve each entity's values; a problem belongs to the row that gave the value.
  const entities = new Map<string, EntityPlan>();
  const entityProblem = new Set<string>();
  for (const [key, slot] of merged) {
    const storedProduct = key.startsWith('p:')
      ? [...stored.values()].find((variant) => `p:${variant.productId}` === key)?.product
      : undefined;
    const existingId = key.startsWith('p:') ? key.slice(2) : null;
    const values: ProductValues = {};
    const link = (field: 'brand' | 'category') => {
      const given = slot[field];
      if (given === undefined) return;
      const row = rowOf.get(given.rowNo)!;
      const found = (field === 'brand' ? brands : categories)(String(given.value));
      const upper = field.toUpperCase() as 'BRAND' | 'CATEGORY';
      if (found.length === 0) {
        row.issues.push(
          issue(`${upper}_NOT_FOUND` as const, field, { text: String(given.value).slice(0, 80) }),
        );
      } else if (found.length > 1) {
        row.issues.push(
          issue(`${upper}_AMBIGUOUS` as const, field, { text: String(given.value).slice(0, 80) }),
        );
      } else {
        const only = found[0]!;
        const current = field === 'brand' ? storedProduct?.brandId : storedProduct?.categoryId;
        if (!only.isActive && only.id !== current) {
          row.issues.push(
            issue(`${upper}_INACTIVE` as const, field, { text: String(given.value).slice(0, 80) }),
          );
        } else if (field === 'brand') values.brandId = only.id;
        else values.categoryId = only.id;
      }
    };
    link('brand');
    link('category');
    const text = (field: ProductField) => {
      const given = slot[field];
      return given === undefined ? undefined : String(given.value);
    };
    const pick = <K extends keyof ProductValues>(name: K, value: ProductValues[K]) => {
      if (value !== undefined) values[name] = value;
    };
    pick('nameVi', text('name_vi'));
    pick('nameEn', text('name_en'));
    pick('descriptionVi', text('description_vi'));
    pick('descriptionEn', text('description_en'));
    if (slot.featured !== undefined) values.featured = slot.featured.value === true;

    const changes: ProductField[] = [];
    if (storedProduct) {
      const compare: [ProductField, unknown, unknown][] = [
        ['name_vi', values.nameVi, storedProduct.nameVi],
        ['name_en', values.nameEn, storedProduct.nameEn],
        ['description_vi', values.descriptionVi, storedProduct.descriptionVi],
        ['description_en', values.descriptionEn, storedProduct.descriptionEn],
        ['brand', values.brandId, storedProduct.brandId],
        ['category', values.categoryId, storedProduct.categoryId],
        ['featured', values.featured, storedProduct.featured],
      ];
      for (const [field, next, current] of compare) {
        if (next !== undefined && next !== current) changes.push(field);
      }
    } else {
      const rows = byEntity.get(key) ?? [];
      const first = rows[0]!;
      if (values.nameVi === undefined) first.issues.push(issue('NAME_REQUIRED', 'name_vi'));
      if (values.nameEn === undefined) first.issues.push(issue('NAME_REQUIRED', 'name_en'));
    }
    entities.set(key, { key, existingId, values, carrierRowNo: null, changes });
  }
  // A new product with a problem in any of its product columns is not created from the other rows of its group.
  for (const [key, rows] of byEntity) {
    if (key.startsWith('p:')) continue;
    if (
      rows.some((row) =>
        row.issues.some((entry) => entry.field !== undefined && PRODUCT_FIELD_SET.has(entry.field)),
      )
    ) {
      entityProblem.add(key);
    }
  }
  for (const key of entityProblem) {
    for (const row of byEntity.get(key) ?? []) {
      if (
        !row.issues.some((entry) => entry.field !== undefined && PRODUCT_FIELD_SET.has(entry.field))
      ) {
        row.issues.push(issue('PRODUCT_HAS_ERRORS', 'product_key'));
      }
    }
  }

  // Names already in the catalog are a warning, not a block.
  const newNames = [
    ...new Set(
      [...entities.values()]
        .filter((entity) => entity.existingId === null && entity.values.nameVi !== undefined)
        .map((entity) => entity.values.nameVi!.toLowerCase()),
    ),
  ];
  const taken = new Set(
    newNames.length === 0
      ? []
      : (
          await tx.$queryRaw<{ name: string }[]>`
            SELECT lower(name_vi) AS name FROM products WHERE lower(name_vi) = ANY(${newNames}::text[])`
        ).map((row) => row.name),
  );

  // Variant level, row by row.
  const plans: VariantPlan[] = [];
  const planned: PlannedRow[] = [];
  for (const row of parsed) {
    const { values, issues } = row;
    const match = values.sku === null ? undefined : stored.get(values.sku);
    const entityKey = entityKeyOf(row);
    const entity = entities.get(entityKey)!;
    row.title = entity.values.nameVi ?? match?.product.nameVi ?? null;

    if (
      values.barcode !== undefined &&
      !issues.some((entry) => entry.code === 'BARCODE_DUPLICATE_IN_FILE')
    ) {
      const owner = barcodeOwners.get(values.barcode);
      if (owner !== undefined && owner !== values.sku)
        issues.push(issue('BARCODE_IN_USE', 'barcode'));
    }
    const set: VariantPlan['set'] = {};
    const changes = row.changes;
    const maybe = <K extends keyof VariantPlan['set']>(
      key: K,
      column: string,
      next: VariantPlan['set'][K] | undefined,
      current: unknown,
    ) => {
      if (next === undefined) return;
      if (!match || next !== current) {
        set[key] = next;
        if (match) changes.push(column);
      }
    };
    maybe('labelVi', 'label_vi', values.labelVi, match?.labelVi);
    maybe('labelEn', 'label_en', values.labelEn, match?.labelEn);
    maybe('barcode', 'barcode', values.barcode, match?.barcode);
    maybe(
      'lowStockThreshold',
      'low_stock_threshold',
      values.lowStockThreshold,
      match?.lowStockThreshold,
    );
    maybe('sellOnOrder', 'sell_on_order', values.sellOnOrder, match?.sellOnOrder);
    if (values.leadTimeDaysMin !== undefined && values.leadTimeDaysMax !== undefined) {
      if (
        !match ||
        values.leadTimeDaysMin !== match.leadTimeDaysMin ||
        values.leadTimeDaysMax !== match.leadTimeDaysMax
      ) {
        set.leadTimeDaysMin = values.leadTimeDaysMin;
        set.leadTimeDaysMax = values.leadTimeDaysMax;
        if (match) changes.push('lead_time_min', 'lead_time_max');
      }
    }
    let price: bigint | null = null;
    const latest = match?.priceVersions[0]?.listPriceVnd ?? null;
    if (values.price !== undefined && values.price !== latest) {
      price = values.price;
      if (match) changes.push('price');
      // Owner rule 1 (2026-10-07): a price cannot go to or below a promotion that has not ended.
      if (match?.promotions.some((promotion) => promotion.promoPriceVnd >= values.price!)) {
        issues.push(issue('PRICE_BELOW_PROMOTION', 'price'));
      }
    }
    let cost: bigint | null = null;
    const storedCost = match?.costPriceVnd ?? null;
    if (values.cost !== undefined && values.cost !== storedCost) {
      cost = values.cost;
      if (match) changes.push('cost');
    }

    const invalid = issues.length > 0;
    const create = values.sku !== null && !match;
    row.warnings = [];
    planned.push({
      rowNo: row.source.rowNo,
      sku: values.sku ?? row.source.cells['sku'] ?? '',
      title: row.title,
      status: invalid ? 'INVALID' : 'VALID',
      action: 'NONE',
      errors: issues,
      warnings: row.warnings,
      changes,
      cells: row.source.cells,
    });
    if (!invalid) {
      if (entity.carrierRowNo === null) entity.carrierRowNo = row.source.rowNo;
      plans.push({
        rowNo: row.source.rowNo,
        entity: entityKey,
        variantId: match?.id ?? null,
        sku: values.sku!,
        create,
        set,
        price,
        cost,
        previousCost: storedCost,
        previousPrice: latest,
      });
    }
  }

  // The carrier row of an entity carries the product's create or update.
  const result: VariantPlan[] = [];
  for (const [index, row] of planned.entries()) {
    if (row.status === 'INVALID') continue;
    const plan = plans.find((candidate) => candidate.rowNo === row.rowNo)!;
    const entity = entities.get(plan.entity)!;
    const carrier = entity.carrierRowNo === row.rowNo;
    if (
      carrier &&
      entity.existingId === null &&
      taken.has((entity.values.nameVi ?? '').toLowerCase())
    ) {
      row.warnings.push(issue('PRODUCT_NAME_EXISTS', 'name_vi'));
    }
    if (carrier && entity.existingId !== null) row.changes.unshift(...entity.changes);
    const changesSomething =
      plan.create ||
      Object.keys(plan.set).length > 0 ||
      plan.price !== null ||
      plan.cost !== null ||
      (carrier && entity.changes.length > 0);
    row.action = plan.create ? 'CREATE' : changesSomething ? 'UPDATE' : 'NONE';
    if (changesSomething) result.push(plan);
    planned[index] = row;
  }
  return { rows: planned, entities, variants: result };
}

// ---------------------------------------------------------------------------------------------------- opening stock

export interface OpeningLotPlan {
  rowNo: number;
  variantId: string;
  sku: string;
  quantity: number;
  lotCode: string;
  expiryDate: string | null;
  cost: bigint | null;
}

export interface OpeningPlan {
  rows: PlannedRow[];
  lots: OpeningLotPlan[];
}

export async function planOpeningStock(
  context: { tx: Tx },
  branch: { id: string; timezone: string },
  sources: readonly SourceRow[],
  access: Access,
): Promise<OpeningPlan> {
  const { tx } = context;
  const today = await branchToday(tx, branch.timezone);
  const parsed = sources.map((source) => ({ source, ...parseOpeningRow(source.cells, access) }));

  const skus = new Set<string>();
  const lotsInFile = new Map<string, number>();
  for (const row of parsed) {
    const sku = row.values.sku;
    if (sku === null) continue;
    skus.add(sku);
    // The same variant may come in several lots; the same lot code twice for one variant is a mistake.
    const lot = `${sku}\u0000${normalizeHeader(row.values.lotCode ?? `#${row.source.rowNo}`)}`;
    const first = lotsInFile.get(lot);
    if (first === undefined) lotsInFile.set(lot, row.source.rowNo);
    else row.issues.push(issue('LOT_DUPLICATE_IN_FILE', 'lot_code', { row: first }));
  }
  const variants = await tx.productVariant.findMany({
    where: { sku: { in: [...skus] } },
    select: {
      id: true,
      sku: true,
      isActive: true,
      product: { select: { nameVi: true, status: true } },
    },
  });
  const bySku = new Map(variants.map((variant) => [variant.sku, variant]));
  const stocked = new Set(
    (
      await tx.stockMovement.findMany({
        where: { branchId: branch.id, variantId: { in: variants.map((variant) => variant.id) } },
        distinct: ['variantId'],
        select: { variantId: true },
      })
    ).map((movement) => movement.variantId),
  );

  const rows: PlannedRow[] = [];
  const lots: OpeningLotPlan[] = [];
  for (const row of parsed) {
    const { values, issues } = row;
    const variant = values.sku === null ? undefined : bySku.get(values.sku);
    if (values.sku !== null && !variant) issues.push(issue('VARIANT_NOT_FOUND', 'sku'));
    else if (variant && (!variant.isActive || variant.product.status === 'INACTIVE')) {
      issues.push(issue('VARIANT_INACTIVE', 'sku'));
    } else if (variant && stocked.has(variant.id)) issues.push(issue('ALREADY_STOCKED', 'sku'));
    if (values.expiryDate !== undefined && values.expiryDate < today) {
      issues.push(issue('EXPIRY_PAST', 'expiry_date'));
    }
    const invalid = issues.length > 0;
    rows.push({
      rowNo: row.source.rowNo,
      sku: values.sku ?? row.source.cells['sku'] ?? '',
      title: variant?.product.nameVi ?? null,
      status: invalid ? 'INVALID' : 'VALID',
      action: invalid ? 'NONE' : 'CREATE',
      errors: issues,
      warnings: [],
      changes: [],
      cells: row.source.cells,
    });
    if (!invalid && variant) {
      lots.push({
        rowNo: row.source.rowNo,
        variantId: variant.id,
        sku: variant.sku,
        quantity: values.quantity!,
        lotCode: values.lotCode ?? `DAUKY-${row.source.rowNo}`,
        expiryDate: values.expiryDate ?? null,
        cost: values.cost ?? null,
      });
    }
  }
  return { rows, lots };
}

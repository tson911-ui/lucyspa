import type { ProductImportIssue } from '@lucy-spa/contracts';
import { IMPORT_LIMITS } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from '../products/product-catalog.input.js';
import { parseMoney, type Access, type Issues } from './import.parse.js';
import type { PlannedRow, SourceRow } from './import.plan.js';

/**
 * Phase 9 P9-8 (PRD 31.4): the bulk price update. The Owner (or a person with the price permission) exports the price list, edits the
 * price column, imports the file again, reads the differences and confirms. A price changes ONLY through this path after a preview
 * and an explicit confirmation by a person holding MANAGE_PRODUCT_PRICES (checked here from the actor's own authority, inside the
 * transaction, for the preview and again for the apply). Each change is a new, numbered, append-only price version; the apply plans
 * AGAIN under locks and refuses (writing nothing) when any row differs from the preview, the current price included, so a price
 * someone else changed in between is never overwritten by a stale file. No cost is read or written.
 */
type Tx = AdminContext['tx'];

export interface PricePlan {
  rows: PlannedRow[];
  /** Only for the valid rows that change a price, in file order. */
  changes: {
    rowNo: number;
    variantId: string;
    sku: string;
    previousVersionNo: number;
    previousPrice: bigint | null;
    price: bigint;
  }[];
}

const issue = (code: ProductImportIssue['code'], field?: string): ProductImportIssue => ({
  code,
  ...(field !== undefined ? { field } : {}),
});

export async function planPriceUpdate(
  context: AdminContext,
  sources: readonly SourceRow[],
  access: Access,
): Promise<PricePlan> {
  const { tx, now } = context;
  const parsed = sources.map((source) => {
    const issues: Issues = [];
    const cell = (key: string) => (source.cells[key] ?? '').trim();
    let sku: string | null = null;
    if (cell('sku') === '') issues.push(issue('SKU_REQUIRED', 'sku'));
    else {
      try {
        sku = input.sku(cell('sku'));
      } catch {
        issues.push(issue('SKU_INVALID', 'sku'));
      }
    }
    let price: bigint | null = null;
    if (!access.prices) issues.push(issue('PRICE_NOT_ALLOWED', 'price'));
    else if (cell('price') === '') issues.push(issue('PRICE_INVALID', 'price'));
    else {
      const value = parseMoney(cell('price'));
      if (value === null || value < 1n) issues.push(issue('PRICE_INVALID', 'price'));
      else price = value;
    }
    return { source, sku, price, issues };
  });
  const seen = new Map<string, number>();
  for (const row of parsed) {
    if (row.sku === null) continue;
    const first = seen.get(row.sku);
    if (first === undefined) seen.set(row.sku, row.source.rowNo);
    else row.issues.push({ ...issue('SKU_DUPLICATE_IN_FILE', 'sku'), params: { row: first } });
  }
  const variants = await tx.productVariant.findMany({
    where: { sku: { in: [...seen.keys()] } },
    select: {
      id: true,
      sku: true,
      isActive: true,
      product: { select: { nameVi: true } },
      priceVersions: {
        orderBy: { versionNo: 'desc' },
        take: 1,
        select: { versionNo: true, listPriceVnd: true },
      },
      promotions: {
        where: { endedEarlyAt: null, endsAt: { gt: now } },
        select: { promoPriceVnd: true },
      },
    },
  });
  const bySku = new Map(variants.map((variant) => [variant.sku, variant]));

  const rows: PlannedRow[] = [];
  const changes: PricePlan['changes'] = [];
  for (const row of parsed) {
    const variant = row.sku === null ? undefined : bySku.get(row.sku);
    if (row.sku !== null && !variant) row.issues.push(issue('VARIANT_NOT_FOUND', 'sku'));
    else if (variant && !variant.isActive) row.issues.push(issue('VARIANT_INACTIVE', 'sku'));
    const latest = variant?.priceVersions[0] ?? null;
    const changed =
      variant !== undefined && row.price !== null && row.price !== latest?.listPriceVnd;
    // Owner rule 1 (2026-10-07): a price cannot go to or below a promotion that has not ended.
    if (changed && variant.promotions.some((promotion) => promotion.promoPriceVnd >= row.price!)) {
      row.issues.push(issue('PRICE_BELOW_PROMOTION', 'price'));
    }
    const invalid = row.issues.length > 0;
    rows.push({
      rowNo: row.source.rowNo,
      sku: row.sku ?? row.source.cells['sku'] ?? '',
      title: variant?.product.nameVi ?? null,
      status: invalid ? 'INVALID' : 'VALID',
      action: !invalid && changed ? 'UPDATE' : 'NONE',
      errors: row.issues,
      warnings: [],
      changes: !invalid && changed ? ['price'] : [],
      // The current price is stored with the preview so the apply notices a price someone changed in between.
      cells: {
        ...row.source.cells,
        current_price: latest === null ? '' : latest.listPriceVnd.toString(),
      },
    });
    if (!invalid && changed && variant && row.price !== null) {
      changes.push({
        rowNo: row.source.rowNo,
        variantId: variant.id,
        sku: variant.sku,
        previousVersionNo: latest?.versionNo ?? 0,
        previousPrice: latest?.listPriceVnd ?? null,
        price: row.price,
      });
    }
  }
  return { rows, changes };
}

/** Locks the variants the file names (sorted, the order every catalog command uses), then plans under those locks. */
export async function lockAndPlanPrices(
  context: AdminContext,
  sources: readonly SourceRow[],
  access: Access,
): Promise<PricePlan> {
  const { tx } = context;
  const skus = [
    ...new Set(sources.map((row) => (row.cells['sku'] ?? '').trim().toUpperCase())),
  ].filter((sku) => sku !== '');
  const found = await tx.productVariant.findMany({
    where: { sku: { in: skus } },
    select: { id: true },
  });
  for (const id of found.map((variant) => variant.id).sort()) {
    await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${id}::uuid FOR UPDATE`;
  }
  return planPriceUpdate(context, sources, access);
}

/** The writes: one new numbered price version per changed row, with the financial audit entry. */
export async function applyPriceUpdate(
  context: AdminContext,
  jobId: string,
  plan: PricePlan,
): Promise<{ applied: number }> {
  const { tx } = context;
  let applied = 0;
  for (const change of plan.changes) {
    const versionNo = change.previousVersionNo + 1;
    await tx.productPriceVersion.create({
      data: {
        variantId: change.variantId,
        versionNo,
        listPriceVnd: change.price,
        reason: 'Cập nhật giá hàng loạt từ tệp',
        createdByUserId: context.actor.userId,
      },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_PRICE_CHANGED',
      entityType: 'ProductVariant',
      entityId: change.variantId,
      classification: 'FINANCIAL',
      before: { listPriceVnd: change.previousPrice?.toString() ?? null, versionNo: versionNo - 1 },
      after: { listPriceVnd: change.price.toString(), versionNo, importJobId: jobId },
    });
    applied += 1;
  }
  return { applied };
}

/**
 * The price list as rows of the PRICE_UPDATE template: SKU, product name (variant label when there is one), current selling price.
 * Only active variants; a product with no price yet has an empty price cell. Needs MANAGE_PRODUCT_PRICES (the caller checks).
 */
export async function priceExportRows(tx: Tx): Promise<string[][]> {
  const variants = await tx.productVariant.findMany({
    where: { isActive: true },
    orderBy: [{ sku: 'asc' }],
    take: IMPORT_LIMITS.maxRows + 1,
    select: {
      sku: true,
      labelVi: true,
      product: { select: { nameVi: true } },
      priceVersions: { orderBy: { versionNo: 'desc' }, take: 1, select: { listPriceVnd: true } },
    },
  });
  if (variants.length > IMPORT_LIMITS.maxRows)
    throw new AuthError('IMPORT_FILE_INVALID', 'tooManyRows');
  return variants.map((variant) => [
    variant.sku,
    variant.labelVi && variant.labelVi.trim() !== ''
      ? `${variant.product.nameVi} (${variant.labelVi})`
      : variant.product.nameVi,
    variant.priceVersions[0]?.listPriceVnd.toString() ?? '',
  ]);
}

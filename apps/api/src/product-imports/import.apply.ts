import { type AdminContext, appendAdminAudit } from '../authorization/admin-command.js';
import * as input from '../products/product-catalog.input.js';
import type { Access } from './import.parse.js';
import {
  planCatalog,
  planOpeningStock,
  type CatalogPlan,
  type OpeningPlan,
  type SourceRow,
} from './import.plan.js';

/**
 * Phase 6 P6-5: the writes of an applied import. The catalog goes through the same tables, rules and audit events as the admin
 * screens (product, variant, numbered price version, cost); opening stock becomes `OPENING` movements into new lots. Everything
 * runs inside the apply transaction: one failure rolls the whole file back.
 *
 * Locks come before the second planning, so the plan the writes follow is the plan of the data they will find:
 * catalog = the products, then the variants the file names (the order the catalog screens use); stock = one advisory lock per
 * (branch, variant), sorted, because a variant that was never stocked has no stock row to lock.
 */

export async function lockAndPlanCatalog(
  context: AdminContext,
  sources: readonly SourceRow[],
  access: Access,
): Promise<CatalogPlan> {
  const { tx } = context;
  const skus = [
    ...new Set(sources.map((row) => (row.cells['sku'] ?? '').trim().toUpperCase())),
  ].filter((sku) => sku !== '');
  const found = await tx.productVariant.findMany({
    where: { sku: { in: skus } },
    select: { id: true, productId: true },
  });
  const products = [...new Set(found.map((variant) => variant.productId))].sort();
  for (const id of products) {
    await tx.$queryRaw`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
  }
  for (const id of found.map((variant) => variant.id).sort()) {
    await tx.$queryRaw`SELECT id FROM product_variants WHERE id = ${id}::uuid FOR UPDATE`;
  }
  return planCatalog(context, sources, access);
}

export async function lockAndPlanOpening(
  context: AdminContext,
  branch: { id: string; timezone: string },
  sources: readonly SourceRow[],
  access: Access,
): Promise<OpeningPlan> {
  const { tx } = context;
  const skus = [
    ...new Set(sources.map((row) => (row.cells['sku'] ?? '').trim().toUpperCase())),
  ].filter((sku) => sku !== '');
  const found = await tx.productVariant.findMany({
    where: { sku: { in: skus } },
    select: { id: true },
  });
  for (const id of found.map((variant) => variant.id).sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`opening-stock:${branch.id}:${id}`}, 0))`;
  }
  return planOpeningStock(context, branch, sources, access);
}

const MAX_CODE_PRODUCT = 96;

export async function applyCatalog(
  context: AdminContext,
  jobId: string,
  plan: CatalogPlan,
): Promise<{ applied: number }> {
  const { tx } = context;
  const productIds = new Map<string, string>();
  const nextOrder = new Map<string, number>();
  let applied = 0;

  const existing = [...plan.entities.values()].filter((entity) => entity.existingId !== null);
  const currentProducts = new Map(
    (
      await tx.product.findMany({
        where: { id: { in: existing.map((entity) => entity.existingId!) } },
        select: {
          id: true,
          nameVi: true,
          nameEn: true,
          descriptionVi: true,
          descriptionEn: true,
          brandId: true,
          categoryId: true,
          featured: true,
          rowVersion: true,
        },
      })
    ).map((product) => [product.id, product]),
  );
  const variantIds = plan.variants.flatMap((variant) =>
    variant.variantId ? [variant.variantId] : [],
  );
  const currentVariants = new Map(
    (
      await tx.productVariant.findMany({
        where: { id: { in: variantIds } },
        select: {
          id: true,
          productId: true,
          labelVi: true,
          labelEn: true,
          barcode: true,
          lowStockThreshold: true,
          sellOnOrder: true,
          leadTimeDaysMin: true,
          leadTimeDaysMax: true,
          rowVersion: true,
          priceVersions: { orderBy: { versionNo: 'desc' }, take: 1, select: { versionNo: true } },
        },
      })
    ).map((variant) => [variant.id, variant]),
  );

  for (const row of plan.variants) {
    const entity = plan.entities.get(row.entity)!;
    const carrier = entity.carrierRowNo === row.rowNo;

    // The product: created by the first valid row of a new entity, updated by the first valid row of an existing one.
    if (entity.existingId === null && !productIds.has(entity.key)) {
      const values = entity.values;
      const code = await input.uniqueCode(
        input.slug(values.nameEn!, MAX_CODE_PRODUCT),
        MAX_CODE_PRODUCT,
        async (candidate) =>
          Boolean(
            await tx.product.findUnique({ where: { code: candidate }, select: { id: true } }),
          ),
      );
      const data = {
        code,
        nameVi: values.nameVi!,
        nameEn: values.nameEn!,
        descriptionVi: values.descriptionVi ?? null,
        descriptionEn: values.descriptionEn ?? null,
        brandId: values.brandId ?? null,
        categoryId: values.categoryId ?? null,
        featured: values.featured ?? false,
      };
      const created = await tx.product.create({
        data: { ...data, createdByUserId: context.actor.userId },
        select: { id: true },
      });
      productIds.set(entity.key, created.id);
      await appendAdminAudit(context, {
        action: 'PRODUCT_CREATED',
        entityType: 'Product',
        entityId: created.id,
        after: { ...data, status: 'DRAFT', importJobId: jobId },
      });
    } else if (entity.existingId !== null && carrier && entity.changes.length > 0) {
      const current = currentProducts.get(entity.existingId)!;
      const values = entity.values;
      const next = {
        ...(values.nameVi !== undefined ? { nameVi: values.nameVi } : {}),
        ...(values.nameEn !== undefined ? { nameEn: values.nameEn } : {}),
        ...(values.descriptionVi !== undefined ? { descriptionVi: values.descriptionVi } : {}),
        ...(values.descriptionEn !== undefined ? { descriptionEn: values.descriptionEn } : {}),
        ...(values.brandId !== undefined ? { brandId: values.brandId } : {}),
        ...(values.categoryId !== undefined ? { categoryId: values.categoryId } : {}),
        ...(values.featured !== undefined ? { featured: values.featured } : {}),
      };
      const before = Object.fromEntries(
        Object.keys(next).map((key) => [key, Reflect.get(current, key) as string | boolean | null]),
      );
      await tx.product.update({
        where: { id: entity.existingId },
        data: { ...next, rowVersion: current.rowVersion + 1 },
      });
      await appendAdminAudit(context, {
        action: 'PRODUCT_UPDATED',
        entityType: 'Product',
        entityId: entity.existingId,
        before,
        after: { ...next, importJobId: jobId },
      });
    }
    const productId = entity.existingId ?? productIds.get(entity.key)!;

    if (row.create) {
      if (!nextOrder.has(productId)) {
        const max = await tx.productVariant.aggregate({
          where: { productId },
          _max: { sortOrder: true },
        });
        nextOrder.set(productId, (max._max.sortOrder ?? -1) + 1);
      }
      const order = nextOrder.get(productId)!;
      nextOrder.set(productId, order + 1);
      const data = {
        productId,
        sku: row.sku,
        labelVi: row.set.labelVi ?? null,
        labelEn: row.set.labelEn ?? null,
        barcode: row.set.barcode ?? null,
        lowStockThreshold: row.set.lowStockThreshold ?? null,
        // On by default (Owner, OQ-P6-30); an absent waiting time means the settings default applies.
        sellOnOrder: row.set.sellOnOrder ?? true,
        leadTimeDaysMin: row.set.leadTimeDaysMin ?? null,
        leadTimeDaysMax: row.set.leadTimeDaysMax ?? null,
        sortOrder: Math.min(order, 100_000),
        ...(row.cost !== null ? { costPriceVnd: row.cost } : {}),
      };
      const created = await tx.productVariant.create({ data, select: { id: true } });
      await appendAdminAudit(context, {
        action: 'PRODUCT_VARIANT_CREATED',
        entityType: 'ProductVariant',
        entityId: created.id,
        after: {
          productId,
          sku: data.sku,
          labelVi: data.labelVi,
          labelEn: data.labelEn,
          barcode: data.barcode,
          lowStockThreshold: data.lowStockThreshold,
          sellOnOrder: data.sellOnOrder,
          leadTimeDaysMin: data.leadTimeDaysMin,
          leadTimeDaysMax: data.leadTimeDaysMax,
          importJobId: jobId,
        },
      });
      if (row.price !== null) {
        await tx.productPriceVersion.create({
          data: {
            variantId: created.id,
            versionNo: 1,
            listPriceVnd: row.price,
            createdByUserId: context.actor.userId,
          },
        });
        await appendAdminAudit(context, {
          action: 'PRODUCT_PRICE_CHANGED',
          entityType: 'ProductVariant',
          entityId: created.id,
          classification: 'FINANCIAL',
          before: { listPriceVnd: null, versionNo: 0 },
          after: { listPriceVnd: row.price.toString(), versionNo: 1, importJobId: jobId },
        });
      }
      if (row.cost !== null) {
        await appendAdminAudit(context, {
          action: 'PRODUCT_COST_CHANGED',
          entityType: 'ProductVariant',
          entityId: created.id,
          classification: 'FINANCIAL',
          before: { costPriceVnd: null },
          after: { costPriceVnd: row.cost.toString(), importJobId: jobId },
        });
      }
      applied += 1;
      continue;
    }

    const current = currentVariants.get(row.variantId!)!;
    const variantSet = Object.keys(row.set).length > 0;
    if (variantSet || row.cost !== null) {
      const before = Object.fromEntries(
        Object.keys(row.set).map((key) => [
          key,
          Reflect.get(current, key) as string | number | boolean | null,
        ]),
      );
      await tx.productVariant.update({
        where: { id: current.id },
        data: {
          ...row.set,
          ...(row.cost !== null ? { costPriceVnd: row.cost } : {}),
          rowVersion: current.rowVersion + 1,
        },
      });
      if (variantSet) {
        await appendAdminAudit(context, {
          action: 'PRODUCT_VARIANT_UPDATED',
          entityType: 'ProductVariant',
          entityId: current.id,
          before,
          after: { ...row.set, importJobId: jobId },
        });
      }
      if (row.cost !== null) {
        await appendAdminAudit(context, {
          action: 'PRODUCT_COST_CHANGED',
          entityType: 'ProductVariant',
          entityId: current.id,
          classification: 'FINANCIAL',
          before: { costPriceVnd: row.previousCost?.toString() ?? null },
          after: { costPriceVnd: row.cost.toString(), importJobId: jobId },
        });
      }
    }
    if (row.price !== null) {
      const versionNo = (current.priceVersions[0]?.versionNo ?? 0) + 1;
      await tx.productPriceVersion.create({
        data: {
          variantId: current.id,
          versionNo,
          listPriceVnd: row.price,
          reason: null,
          createdByUserId: context.actor.userId,
        },
      });
      await appendAdminAudit(context, {
        action: 'PRODUCT_PRICE_CHANGED',
        entityType: 'ProductVariant',
        entityId: current.id,
        classification: 'FINANCIAL',
        before: { listPriceVnd: row.previousPrice?.toString() ?? null, versionNo: versionNo - 1 },
        after: { listPriceVnd: row.price.toString(), versionNo, importJobId: jobId },
      });
    }
    applied += 1;
  }
  return { applied };
}

export async function applyOpeningStock(
  context: AdminContext,
  jobId: string,
  branchId: string,
  plan: OpeningPlan,
): Promise<{ applied: number }> {
  const { tx } = context;
  // Sorted by variant so two jobs applied together take their rows in the same order.
  const lots = [...plan.lots].sort(
    (a, b) => a.variantId.localeCompare(b.variantId) || a.rowNo - b.rowNo,
  );
  for (const row of lots) {
    const lot = await tx.inventoryLot.create({
      data: {
        branchId,
        variantId: row.variantId,
        lotCode: row.lotCode,
        expiryDate: row.expiryDate === null ? null : new Date(`${row.expiryDate}T00:00:00.000Z`),
        unitCostVnd: row.cost,
        createdByUserId: context.actor.userId,
      },
      select: { id: true },
    });
    await tx.stockMovement.create({
      data: {
        branchId,
        variantId: row.variantId,
        lotId: lot.id,
        kind: 'OPENING',
        quantityDelta: row.quantity,
        importJobId: jobId,
        idempotencyKey: `OPENING:${jobId}:${row.rowNo}`,
        actorUserId: context.actor.userId,
      },
      select: { id: true },
    });
  }
  return { applied: lots.length };
}

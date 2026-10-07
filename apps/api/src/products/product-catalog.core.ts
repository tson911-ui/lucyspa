import type {
  ProductBrandCreateRequest,
  ProductBrandEditRequest,
  ProductBrandListResponse,
  ProductBrandResponse,
  ProductCategoryCreateRequest,
  ProductCategoryEditRequest,
  ProductCategoryListResponse,
  ProductCategoryResponse,
  ProductCreateRequest,
  ProductDetailResponse,
  ProductEditRequest,
  ProductImageAddRequest,
  ProductImageOrderRequest,
  ProductListResponse,
  ProductPriceChangeRequest,
  ProductPromotionCreateRequest,
  ProductStatusRequest,
  ProductVariantCreateRequest,
  ProductVariantEditRequest,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { appendAdminAudit, type AdminContext } from '../authorization/admin-command.js';
import * as input from './product-catalog.input.js';
import {
  brandSelect,
  categorySelect,
  listProducts,
  loadDetail,
  presentBrand,
  presentCategory,
  promotionEnd,
  requireCost,
  requireManage,
  requirePrices,
  requireRead,
} from './product-catalog.present.js';

/**
 * Phase 6 P6-3: product catalog administration (design 3; P6-T9..T12; the Owner's request of 2026-10-07).
 *
 * - Authority is decided inside each command, GLOBAL only: `MANAGE_PRODUCTS` (brands, categories, products, variants, images,
 *   status), `MANAGE_PRODUCT_PRICES` (list price, promotions), `VIEW_PRODUCT_COST` (cost and margin). A write that carries a
 *   price needs the price permission and a write that carries a cost needs the cost permission BEFORE anything is written.
 * - Every database guard of migration 20261106000002 is pre-checked here under a row lock, so the person gets a precise message
 *   and not a generic failure; the database stays the final authority.
 * - Lock order: product row, then its variant row. Every update advances `rowVersion` by one (the generic row guard requires it).
 * - Prices and promotions are audited FINANCIAL; a cost change is audited FINANCIAL too. Cost never appears in the ordinary audit.
 */

type Tx = Prisma.TransactionClient;

const MAX_CODE_PRODUCT = 96;
const MAX_CODE_OTHER = 64;

/** Locks one catalog row for the rest of the transaction (404 when it does not exist). */
async function lockRow(
  tx: Tx,
  table: 'brands' | 'product_categories' | 'products' | 'product_variants',
  id: string,
): Promise<void> {
  let rows: { id: string }[];
  if (table === 'brands') {
    rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM brands WHERE id = ${id}::uuid FOR UPDATE`;
  } else if (table === 'product_categories') {
    rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM product_categories WHERE id = ${id}::uuid FOR UPDATE`;
  } else if (table === 'products') {
    rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM products WHERE id = ${id}::uuid FOR UPDATE`;
  } else {
    rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM product_variants WHERE id = ${id}::uuid FOR UPDATE`;
  }
  if (rows.length === 0) throw new AuthError('NOT_FOUND');
}

/** The values `current` holds for the keys of `next`: the "before" side of an audit event. */
function pickOf(
  current: object,
  next: Record<string, unknown>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.keys(next).map((key) => [
      key,
      Reflect.get(current, key) as string | number | boolean | null,
    ]),
  );
}

/** True when every key of `next` holds the same value in `current` (field order never matters). */
function sameValues(current: object, next: Record<string, unknown>): boolean {
  return Object.entries(next).every(([key, value]) => Reflect.get(current, key) === value);
}

// ------------------------------------------------------------------------------------------------------ brands

export async function listBrands(context: AdminContext): Promise<ProductBrandListResponse> {
  const access = requireRead(context);
  const rows = await context.tx.brand.findMany({
    orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
    select: brandSelect,
  });
  return { brands: rows.map(presentBrand), access };
}

export async function createBrand(
  context: AdminContext,
  request: ProductBrandCreateRequest,
): Promise<ProductBrandResponse> {
  requireManage(context);
  const nameVi = input.name(request.nameVi, 'nameVi');
  const nameEn = input.name(request.nameEn, 'nameEn');
  const { tx } = context;
  const code = await input.uniqueCode(
    input.slug(nameEn, MAX_CODE_OTHER),
    MAX_CODE_OTHER,
    async (candidate) =>
      Boolean(await tx.brand.findUnique({ where: { code: candidate }, select: { id: true } })),
  );
  const created = await tx.brand.create({ data: { code, nameVi, nameEn }, select: brandSelect });
  await appendAdminAudit(context, {
    action: 'PRODUCT_BRAND_CREATED',
    entityType: 'Brand',
    entityId: created.id,
    after: { code, nameVi, nameEn },
  });
  return presentBrand(created);
}

export async function editBrand(
  context: AdminContext,
  id: string,
  request: ProductBrandEditRequest,
): Promise<ProductBrandResponse> {
  requireManage(context);
  const values = {
    nameVi: input.name(request.nameVi, 'nameVi'),
    nameEn: input.name(request.nameEn, 'nameEn'),
    isActive: input.boolean(request.isActive, 'isActive'),
  };
  const expected = input.rowVersion(request.expectedRowVersion);
  const { tx } = context;
  await lockRow(tx, 'brands', id);
  const current = await tx.brand.findUniqueOrThrow({ where: { id }, select: brandSelect });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (
    current.nameVi === values.nameVi &&
    current.nameEn === values.nameEn &&
    current.isActive === values.isActive
  ) {
    return presentBrand(current);
  }
  const saved = await tx.brand.update({
    where: { id },
    data: { ...values, rowVersion: current.rowVersion + 1 },
    select: brandSelect,
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_BRAND_UPDATED',
    entityType: 'Brand',
    entityId: id,
    before: { nameVi: current.nameVi, nameEn: current.nameEn, isActive: current.isActive },
    after: values,
  });
  return presentBrand(saved);
}

// ------------------------------------------------------------------------------------------------------ categories

export async function listCategories(context: AdminContext): Promise<ProductCategoryListResponse> {
  const access = requireRead(context);
  const rows = await context.tx.productCategory.findMany({
    orderBy: [{ sortOrder: 'asc' }, { nameVi: 'asc' }, { id: 'asc' }],
    select: categorySelect,
  });
  return { categories: rows.map(presentCategory), access };
}

/** Two levels at most: a parent must exist and be a top-level category itself. */
async function checkParent(tx: Tx, parentId: string | null, self: string | null): Promise<void> {
  if (parentId === null) return;
  if (parentId === self) throw new AuthError('VALIDATION_FAILED', 'parentId');
  const parent = await tx.productCategory.findUnique({
    where: { id: parentId },
    select: { parentId: true, isActive: true },
  });
  if (!parent) throw new AuthError('VALIDATION_FAILED', 'parentId');
  if (parent.parentId !== null) throw new AuthError('PRODUCT_CATEGORY_DEPTH', 'parentId');
  if (self !== null && (await tx.productCategory.count({ where: { parentId: self } })) > 0) {
    throw new AuthError('PRODUCT_CATEGORY_DEPTH', 'parentId');
  }
}

export async function createCategory(
  context: AdminContext,
  request: ProductCategoryCreateRequest,
): Promise<ProductCategoryResponse> {
  requireManage(context);
  const nameVi = input.name(request.nameVi, 'nameVi');
  const nameEn = input.name(request.nameEn, 'nameEn');
  const parentId = input.optionalUuid(request.parentId, 'parentId');
  const order = request.sortOrder === undefined ? 0 : input.sortOrder(request.sortOrder);
  const { tx } = context;
  if (parentId !== null)
    await lockRow(tx, 'product_categories', parentId).catch(() => {
      throw new AuthError('VALIDATION_FAILED', 'parentId');
    });
  await checkParent(tx, parentId, null);
  const code = await input.uniqueCode(
    input.slug(nameEn, MAX_CODE_OTHER),
    MAX_CODE_OTHER,
    async (candidate) =>
      Boolean(
        await tx.productCategory.findUnique({ where: { code: candidate }, select: { id: true } }),
      ),
  );
  const created = await tx.productCategory.create({
    data: { parentId, code, nameVi, nameEn, sortOrder: order },
    select: categorySelect,
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CATEGORY_CREATED',
    entityType: 'ProductCategory',
    entityId: created.id,
    after: { code, parentId, nameVi, nameEn, sortOrder: order },
  });
  return presentCategory(created);
}

export async function editCategory(
  context: AdminContext,
  id: string,
  request: ProductCategoryEditRequest,
): Promise<ProductCategoryResponse> {
  requireManage(context);
  const values = {
    parentId: input.optionalUuid(request.parentId, 'parentId'),
    nameVi: input.name(request.nameVi, 'nameVi'),
    nameEn: input.name(request.nameEn, 'nameEn'),
    sortOrder: input.sortOrder(request.sortOrder),
    isActive: input.boolean(request.isActive, 'isActive'),
  };
  const expected = input.rowVersion(request.expectedRowVersion);
  const { tx } = context;
  await lockRow(tx, 'product_categories', id);
  const current = await tx.productCategory.findUniqueOrThrow({
    where: { id },
    select: categorySelect,
  });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (
    current.parentId === values.parentId &&
    current.nameVi === values.nameVi &&
    current.nameEn === values.nameEn &&
    current.sortOrder === values.sortOrder &&
    current.isActive === values.isActive
  ) {
    return presentCategory(current);
  }
  if (values.parentId !== current.parentId) {
    if (values.parentId !== null) {
      await lockRow(tx, 'product_categories', values.parentId).catch(() => {
        throw new AuthError('VALIDATION_FAILED', 'parentId');
      });
    }
    await checkParent(tx, values.parentId, id);
  }
  const saved = await tx.productCategory.update({
    where: { id },
    data: { ...values, rowVersion: current.rowVersion + 1 },
    select: categorySelect,
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CATEGORY_UPDATED',
    entityType: 'ProductCategory',
    entityId: id,
    before: {
      parentId: current.parentId,
      nameVi: current.nameVi,
      nameEn: current.nameEn,
      sortOrder: current.sortOrder,
      isActive: current.isActive,
    },
    after: values,
  });
  return presentCategory(saved);
}

// ------------------------------------------------------------------------------------------------------ products

export async function listAllProducts(context: AdminContext): Promise<ProductListResponse> {
  const access = requireRead(context);
  return listProducts(context, access);
}

export async function getProduct(
  context: AdminContext,
  id: string,
): Promise<ProductDetailResponse> {
  const access = requireRead(context);
  return loadDetail(context, id, access);
}

/** A brand or category a product points at must exist and be active (a product that already uses an inactive one keeps it). */
async function checkLinks(
  tx: Tx,
  brandId: string | null,
  categoryId: string | null,
  keep: { brandId: string | null; categoryId: string | null },
): Promise<void> {
  if (brandId !== null && brandId !== keep.brandId) {
    const brand = await tx.brand.findUnique({ where: { id: brandId }, select: { isActive: true } });
    if (!brand?.isActive) throw new AuthError('VALIDATION_FAILED', 'brandId');
  }
  if (categoryId !== null && categoryId !== keep.categoryId) {
    const category = await tx.productCategory.findUnique({
      where: { id: categoryId },
      select: { isActive: true },
    });
    if (!category?.isActive) throw new AuthError('VALIDATION_FAILED', 'categoryId');
  }
}

function productValues(request: ProductCreateRequest) {
  return {
    nameVi: input.name(request.nameVi, 'nameVi'),
    nameEn: input.name(request.nameEn, 'nameEn'),
    descriptionVi: input.description(request.descriptionVi, 'descriptionVi'),
    descriptionEn: input.description(request.descriptionEn, 'descriptionEn'),
    brandId: input.optionalUuid(request.brandId, 'brandId'),
    categoryId: input.optionalUuid(request.categoryId, 'categoryId'),
    featured: input.boolean(request.featured, 'featured'),
  };
}

export async function createProduct(
  context: AdminContext,
  request: ProductCreateRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  const values = productValues(request);
  const { tx } = context;
  await checkLinks(tx, values.brandId, values.categoryId, { brandId: null, categoryId: null });
  const code = await input.uniqueCode(
    input.slug(values.nameEn, MAX_CODE_PRODUCT),
    MAX_CODE_PRODUCT,
    async (candidate) =>
      Boolean(await tx.product.findUnique({ where: { code: candidate }, select: { id: true } })),
  );
  const created = await tx.product.create({
    data: { code, ...values, createdByUserId: context.actor.userId },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_CREATED',
    entityType: 'Product',
    entityId: created.id,
    after: { code, ...values, status: 'DRAFT' },
  });
  return loadDetail(context, created.id, access);
}

export async function editProduct(
  context: AdminContext,
  id: string,
  request: ProductEditRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  const values = productValues(request);
  const expected = input.rowVersion(request.expectedRowVersion);
  const { tx } = context;
  await lockRow(tx, 'products', id);
  const current = await tx.product.findUniqueOrThrow({
    where: { id },
    select: {
      nameVi: true,
      nameEn: true,
      descriptionVi: true,
      descriptionEn: true,
      brandId: true,
      categoryId: true,
      featured: true,
      rowVersion: true,
    },
  });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  const before = pickOf(current, values);
  if (sameValues(before, values)) return loadDetail(context, id, access);
  await checkLinks(tx, values.brandId, values.categoryId, current);
  await tx.product.update({
    where: { id },
    data: { ...values, rowVersion: current.rowVersion + 1 },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_UPDATED',
    entityType: 'Product',
    entityId: id,
    before,
    after: values,
  });
  return loadDetail(context, id, access);
}

/** Allowed moves only: DRAFT to PUBLISHED, PUBLISHED to INACTIVE, INACTIVE to PUBLISHED (the database refuses a return to draft). */
export async function changeStatus(
  context: AdminContext,
  id: string,
  request: ProductStatusRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  const target = request.status;
  if (target !== 'PUBLISHED' && target !== 'INACTIVE')
    throw new AuthError('VALIDATION_FAILED', 'status');
  const expected = input.rowVersion(request.expectedRowVersion);
  const { tx } = context;
  await lockRow(tx, 'products', id);
  const current = await tx.product.findUniqueOrThrow({
    where: { id },
    select: { status: true, rowVersion: true },
  });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  if (current.status === target) return loadDetail(context, id, access);
  if (current.status === 'DRAFT' && target !== 'PUBLISHED')
    throw new AuthError('PRODUCT_STATUS_INVALID');
  if (target === 'PUBLISHED') {
    const priced = await tx.productVariant.count({
      where: { productId: id, isActive: true, priceVersions: { some: {} } },
    });
    if (priced === 0) throw new AuthError('PRODUCT_PUBLISH_INCOMPLETE');
  }
  await tx.product.update({
    where: { id },
    data: { status: target, rowVersion: current.rowVersion + 1 },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_STATUS_CHANGED',
    entityType: 'Product',
    entityId: id,
    before: { status: current.status },
    after: { status: target },
  });
  return loadDetail(context, id, access);
}

// ------------------------------------------------------------------------------------------------------ variants

async function ownVariant(tx: Tx, productId: string, variantId: string) {
  const variant = await tx.productVariant.findFirst({
    where: { id: variantId, productId },
    select: { id: true },
  });
  if (!variant) throw new AuthError('NOT_FOUND');
}

/** SKU and barcode are unique across the catalog: a clash names the field. */
async function checkIdentifiers(
  tx: Tx,
  sku: string | null,
  barcode: string | null,
  self: string | null,
) {
  if (sku !== null) {
    const clash = await tx.productVariant.findUnique({ where: { sku }, select: { id: true } });
    if (clash && clash.id !== self) throw new AuthError('CONFLICT', 'sku');
  }
  if (barcode !== null) {
    const clash = await tx.productVariant.findFirst({ where: { barcode }, select: { id: true } });
    if (clash && clash.id !== self) throw new AuthError('CONFLICT', 'barcode');
  }
}

export async function createVariant(
  context: AdminContext,
  productId: string,
  request: ProductVariantCreateRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  // Authority for the money fields comes first: a refused request writes nothing.
  const wantsPrice = request.listPriceVnd !== undefined;
  const wantsCost = request.costPriceVnd !== undefined;
  if (wantsPrice) requirePrices(context);
  if (wantsCost) requireCost(context);
  const values = {
    sku: input.sku(request.sku),
    labelVi: input.label(request.labelVi, 'labelVi'),
    labelEn: input.label(request.labelEn, 'labelEn'),
    barcode: input.barcode(request.barcode),
    lowStockThreshold: input.threshold(request.lowStockThreshold),
  };
  const order = request.sortOrder === undefined ? null : input.sortOrder(request.sortOrder);
  const price = wantsPrice ? input.positiveMoney(request.listPriceVnd, 'listPriceVnd') : null;
  const costValue = wantsCost ? input.cost(request.costPriceVnd) : undefined;
  const { tx } = context;
  await lockRow(tx, 'products', productId);
  await checkIdentifiers(tx, values.sku, values.barcode, null);
  const next =
    order ??
    ((await tx.productVariant.aggregate({ where: { productId }, _max: { sortOrder: true } }))._max
      .sortOrder ?? -1) + 1;
  const created = await tx.productVariant.create({
    data: {
      productId,
      ...values,
      sortOrder: Math.min(next, 100_000),
      ...(costValue !== undefined ? { costPriceVnd: costValue } : {}),
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_VARIANT_CREATED',
    entityType: 'ProductVariant',
    entityId: created.id,
    after: { productId, ...values },
  });
  if (price !== null) {
    await tx.productPriceVersion.create({
      data: {
        variantId: created.id,
        versionNo: 1,
        listPriceVnd: price,
        createdByUserId: context.actor.userId,
      },
    });
    await appendAdminAudit(context, {
      action: 'PRODUCT_PRICE_CHANGED',
      entityType: 'ProductVariant',
      entityId: created.id,
      classification: 'FINANCIAL',
      before: { listPriceVnd: null, versionNo: 0 },
      after: { listPriceVnd: price.toString(), versionNo: 1 },
    });
  }
  if (costValue !== undefined && costValue !== null) {
    await appendAdminAudit(context, {
      action: 'PRODUCT_COST_CHANGED',
      entityType: 'ProductVariant',
      entityId: created.id,
      classification: 'FINANCIAL',
      before: { costPriceVnd: null },
      after: { costPriceVnd: costValue.toString() },
    });
  }
  return loadDetail(context, productId, access);
}

export async function editVariant(
  context: AdminContext,
  productId: string,
  variantId: string,
  request: ProductVariantEditRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  const wantsCost = request.costPriceVnd !== undefined;
  if (wantsCost) requireCost(context);
  const values = {
    labelVi: input.label(request.labelVi, 'labelVi'),
    labelEn: input.label(request.labelEn, 'labelEn'),
    barcode: input.barcode(request.barcode),
    lowStockThreshold: input.threshold(request.lowStockThreshold),
    sortOrder: input.sortOrder(request.sortOrder),
    isActive: input.boolean(request.isActive, 'isActive'),
  };
  const expected = input.rowVersion(request.expectedRowVersion);
  const costValue = wantsCost ? input.cost(request.costPriceVnd) : undefined;
  const { tx } = context;
  await lockRow(tx, 'products', productId);
  await ownVariant(tx, productId, variantId);
  await lockRow(tx, 'product_variants', variantId);
  const current = await tx.productVariant.findUniqueOrThrow({
    where: { id: variantId },
    select: {
      labelVi: true,
      labelEn: true,
      barcode: true,
      lowStockThreshold: true,
      sortOrder: true,
      isActive: true,
      rowVersion: true,
      costPriceVnd: true,
    },
  });
  if (current.rowVersion !== expected) throw new AuthError('CONFLICT');
  const before = pickOf(current, values);
  const storedCost = current.costPriceVnd;
  const costChanged = costValue !== undefined && costValue !== storedCost;
  if (sameValues(before, values) && !costChanged) {
    return loadDetail(context, productId, access);
  }
  await checkIdentifiers(tx, null, values.barcode, variantId);
  if (current.isActive && !values.isActive) {
    const product = await tx.product.findUniqueOrThrow({
      where: { id: productId },
      select: { status: true },
    });
    if (product.status === 'PUBLISHED') {
      const others = await tx.productVariant.count({
        where: { productId, id: { not: variantId }, isActive: true, priceVersions: { some: {} } },
      });
      if (others === 0) throw new AuthError('PRODUCT_LAST_PRICED_VARIANT');
    }
  }
  await tx.productVariant.update({
    where: { id: variantId },
    data: {
      ...values,
      ...(costChanged ? { costPriceVnd: costValue } : {}),
      rowVersion: current.rowVersion + 1,
    },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_VARIANT_UPDATED',
    entityType: 'ProductVariant',
    entityId: variantId,
    before,
    after: values,
  });
  if (costChanged) {
    await appendAdminAudit(context, {
      action: 'PRODUCT_COST_CHANGED',
      entityType: 'ProductVariant',
      entityId: variantId,
      classification: 'FINANCIAL',
      before: { costPriceVnd: storedCost?.toString() ?? null },
      after: { costPriceVnd: costValue?.toString() ?? null },
    });
  }
  return loadDetail(context, productId, access);
}

// ------------------------------------------------------------------------------------------------------ prices

/** The list price of a variant is a new, numbered, append-only version; the old ones stay as the history. */
export async function changePrice(
  context: AdminContext,
  productId: string,
  variantId: string,
  request: ProductPriceChangeRequest,
): Promise<ProductDetailResponse> {
  const access = requirePrices(context);
  const price = input.positiveMoney(request.listPriceVnd, 'listPriceVnd');
  const why = input.reason(request.reason);
  const expectedNo = request.expectedVersionNo;
  if (typeof expectedNo !== 'number' || !Number.isSafeInteger(expectedNo) || expectedNo < 0) {
    throw new AuthError('VALIDATION_FAILED', 'expectedVersionNo');
  }
  const { tx, now } = context;
  await lockRow(tx, 'products', productId);
  await ownVariant(tx, productId, variantId);
  await lockRow(tx, 'product_variants', variantId);
  const latest = await tx.productPriceVersion.findFirst({
    where: { variantId },
    orderBy: { versionNo: 'desc' },
    select: { versionNo: true, listPriceVnd: true },
  });
  if ((latest?.versionNo ?? 0) !== expectedNo) throw new AuthError('CONFLICT');
  if (latest && latest.listPriceVnd === price) return loadDetail(context, productId, access);
  // Rule 1 (Owner-approved 2026-10-07): while a promotion that has not ended is at or above the new price, the price cannot change.
  const blocking = await tx.productPromotion.findMany({
    where: { variantId },
    select: { promoPriceVnd: true, endsAt: true, endedEarlyAt: true },
  });
  if (blocking.some((row) => promotionEnd(row) > now && row.promoPriceVnd >= price)) {
    throw new AuthError('PRODUCT_PRICE_BELOW_PROMOTION', 'listPriceVnd');
  }
  const versionNo = (latest?.versionNo ?? 0) + 1;
  await tx.productPriceVersion.create({
    data: {
      variantId,
      versionNo,
      listPriceVnd: price,
      reason: why,
      createdByUserId: context.actor.userId,
    },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_PRICE_CHANGED',
    entityType: 'ProductVariant',
    entityId: variantId,
    classification: 'FINANCIAL',
    reason: why,
    before: {
      listPriceVnd: latest?.listPriceVnd.toString() ?? null,
      versionNo: latest?.versionNo ?? 0,
    },
    after: { listPriceVnd: price.toString(), versionNo },
  });
  return loadDetail(context, productId, access);
}

export async function createPromotion(
  context: AdminContext,
  productId: string,
  variantId: string,
  request: ProductPromotionCreateRequest,
): Promise<ProductDetailResponse> {
  const access = requirePrices(context);
  const promo = input.positiveMoney(request.promoPriceVnd, 'promoPriceVnd');
  const startsAt = input.instant(request.startsAt, 'startsAt');
  const endsAt = input.instant(request.endsAt, 'endsAt');
  if (endsAt <= startsAt) throw new AuthError('VALIDATION_FAILED', 'endsAt');
  const { tx, now } = context;
  await lockRow(tx, 'products', productId);
  await ownVariant(tx, productId, variantId);
  await lockRow(tx, 'product_variants', variantId);
  const latest = await tx.productPriceVersion.findFirst({
    where: { variantId },
    orderBy: { versionNo: 'desc' },
    select: { listPriceVnd: true },
  });
  // Rule 2 (Owner-approved 2026-10-07): below the current list price, and not already over.
  if (!latest || promo >= latest.listPriceVnd) {
    throw new AuthError('PRODUCT_PROMOTION_PRICE_INVALID', 'promoPriceVnd');
  }
  if (endsAt <= now) throw new AuthError('PRODUCT_PROMOTION_EXPIRED', 'endsAt');
  const others = await tx.productPromotion.findMany({
    where: { variantId },
    select: { startsAt: true, endsAt: true, endedEarlyAt: true },
  });
  if (others.some((row) => row.startsAt < endsAt && startsAt < promotionEnd(row))) {
    throw new AuthError('PRODUCT_PROMOTION_OVERLAP', 'startsAt');
  }
  const created = await tx.productPromotion.create({
    data: {
      variantId,
      promoPriceVnd: promo,
      startsAt,
      endsAt,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_PROMOTION_CREATED',
    entityType: 'ProductPromotion',
    entityId: created.id,
    classification: 'FINANCIAL',
    after: {
      variantId,
      promoPriceVnd: promo.toString(),
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
    },
  });
  return loadDetail(context, productId, access);
}

/** The one change a promotion allows: ending it by hand, once. The price returns to the list price by itself. */
export async function endPromotion(
  context: AdminContext,
  productId: string,
  promotionId: string,
): Promise<ProductDetailResponse> {
  const access = requirePrices(context);
  const { tx, now } = context;
  await lockRow(tx, 'products', productId);
  const promotion = await tx.productPromotion.findFirst({
    where: { id: promotionId, variant: { productId } },
    select: { id: true, variantId: true },
  });
  if (!promotion) throw new AuthError('NOT_FOUND');
  await lockRow(tx, 'product_variants', promotion.variantId);
  const current = await tx.productPromotion.findUniqueOrThrow({
    where: { id: promotionId },
    select: { promoPriceVnd: true, startsAt: true, endsAt: true, endedEarlyAt: true },
  });
  if (promotionEnd(current) <= now) throw new AuthError('PRODUCT_PROMOTION_EXPIRED');
  await tx.productPromotion.update({
    where: { id: promotionId },
    data: { endedEarlyAt: now, endedEarlyByUserId: context.actor.userId },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_PROMOTION_ENDED',
    entityType: 'ProductPromotion',
    entityId: promotionId,
    classification: 'FINANCIAL',
    before: { endsAt: current.endsAt.toISOString(), endedEarlyAt: null },
    after: { endedEarlyAt: now.toISOString() },
  });
  return loadDetail(context, productId, access);
}

// ------------------------------------------------------------------------------------------------------ images

export async function addImage(
  context: AdminContext,
  productId: string,
  request: ProductImageAddRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  const mediaAssetId = input.uuid(request.mediaAssetId, 'mediaAssetId');
  const { tx } = context;
  await lockRow(tx, 'products', productId);
  const asset = await tx.mediaAsset.findUnique({
    where: { id: mediaAssetId },
    select: { altVi: true },
  });
  if (!asset) throw new AuthError('VALIDATION_FAILED', 'mediaAssetId');
  // Vietnamese alt text is required before a picture is used (media rules).
  if (asset.altVi === null) throw new AuthError('MEDIA_ALT_REQUIRED', 'altVi');
  if (
    await tx.productImage.findUnique({
      where: { productId_mediaAssetId: { productId, mediaAssetId } },
      select: { id: true },
    })
  ) {
    throw new AuthError('CONFLICT', 'mediaAssetId');
  }
  const last = await tx.productImage.aggregate({ where: { productId }, _max: { sortOrder: true } });
  const created = await tx.productImage.create({
    data: {
      productId,
      mediaAssetId,
      sortOrder: (last._max.sortOrder ?? -1) + 1,
      createdByUserId: context.actor.userId,
    },
    select: { id: true },
  });
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMAGE_ADDED',
    entityType: 'Product',
    entityId: productId,
    after: { imageId: created.id, mediaAssetId },
  });
  return loadDetail(context, productId, access);
}

export async function orderImages(
  context: AdminContext,
  productId: string,
  request: ProductImageOrderRequest,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  if (!Array.isArray(request.imageIds)) throw new AuthError('VALIDATION_FAILED', 'imageIds');
  const ids = request.imageIds.map((value) => input.uuid(value, 'imageIds'));
  const { tx } = context;
  await lockRow(tx, 'products', productId);
  const current = await tx.productImage.findMany({
    where: { productId },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  const known = new Set(current.map((row) => row.id));
  if (
    ids.length !== known.size ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !known.has(id))
  ) {
    throw new AuthError('VALIDATION_FAILED', 'imageIds');
  }
  if (ids.every((id, index) => current[index]?.id === id))
    return loadDetail(context, productId, access);
  for (const [index, id] of ids.entries()) {
    await tx.productImage.update({ where: { id }, data: { sortOrder: index } });
  }
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMAGES_REORDERED',
    entityType: 'Product',
    entityId: productId,
    before: { imageIds: current.map((row) => row.id) },
    after: { imageIds: ids },
  });
  return loadDetail(context, productId, access);
}

/** Removes the link between the product and the picture; the picture itself stays in the media library. */
export async function removeImage(
  context: AdminContext,
  productId: string,
  imageId: string,
): Promise<ProductDetailResponse> {
  const access = requireManage(context);
  const { tx } = context;
  await lockRow(tx, 'products', productId);
  const image = await tx.productImage.findFirst({
    where: { id: imageId, productId },
    select: { id: true, mediaAssetId: true },
  });
  if (!image) throw new AuthError('NOT_FOUND');
  await tx.productImage.delete({ where: { id: imageId } });
  await appendAdminAudit(context, {
    action: 'PRODUCT_IMAGE_REMOVED',
    entityType: 'Product',
    entityId: productId,
    before: { imageId, mediaAssetId: image.mediaAssetId },
  });
  return loadDetail(context, productId, access);
}

import type {
  ProductAccess,
  ProductBrandResponse,
  ProductCategoryResponse,
  ProductDetailResponse,
  ProductListItem,
  ProductPromotionResponse,
  ProductPromotionState,
  ProductVariantResponse,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import type { AdminContext } from '../authorization/admin-command.js';
import { decide } from '../authorization/authorization.js';

/**
 * Phase 6 P6-3: what the catalog administration answers with. ONE presenter builds every product response (list, detail and the
 * result of every command), and it decides the cost visibility once, from the caller's authority inside the transaction:
 * a caller without `VIEW_PRODUCT_COST` gets responses in which `costPriceVnd` and `marginVnd` do not exist, and the cost column is not
 * even read from the database for them.
 */

const GLOBAL = { kind: 'GLOBAL' } as const;

export function accessOf(context: AdminContext): ProductAccess {
  const graph = context.actor.graph;
  return {
    manage: decide(graph, 'MANAGE_PRODUCTS', GLOBAL),
    prices: decide(graph, 'MANAGE_PRODUCT_PRICES', GLOBAL),
    cost: decide(graph, 'VIEW_PRODUCT_COST', GLOBAL),
  };
}

/** Reading the catalog needs `MANAGE_PRODUCTS` or `MANAGE_PRODUCT_PRICES` (my reading of design 3.2; `VIEW_PRODUCT_COST` alone opens nothing). */
export function requireRead(context: AdminContext): ProductAccess {
  const access = accessOf(context);
  if (!access.manage && !access.prices) throw new AuthError('FORBIDDEN');
  return access;
}

export function requireManage(context: AdminContext): ProductAccess {
  const access = accessOf(context);
  if (!access.manage) throw new AuthError('FORBIDDEN');
  return access;
}

export function requirePrices(context: AdminContext): ProductAccess {
  const access = accessOf(context);
  if (!access.prices) throw new AuthError('FORBIDDEN');
  return access;
}

export function requireCost(context: AdminContext): void {
  if (!accessOf(context).cost) throw new AuthError('FORBIDDEN');
}

/** The database clock right now: later than every write this command made, so a just-ended promotion is already over. */
async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now;
  if (!(now instanceof Date)) throw new Error('Database clock unavailable.');
  return now;
}

const nameRef = { select: { id: true, nameVi: true, nameEn: true } } as const;

const brandSelect = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  isActive: true,
  rowVersion: true,
  _count: { select: { products: true } },
} satisfies Prisma.BrandSelect;

export function presentBrand(
  row: Prisma.BrandGetPayload<{ select: typeof brandSelect }>,
): ProductBrandResponse {
  return {
    id: row.id,
    code: row.code,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    isActive: row.isActive,
    rowVersion: row.rowVersion,
    productCount: row._count.products,
  };
}
export { brandSelect };

const categorySelect = {
  id: true,
  parentId: true,
  code: true,
  nameVi: true,
  nameEn: true,
  sortOrder: true,
  isActive: true,
  rowVersion: true,
  _count: { select: { products: true } },
} satisfies Prisma.ProductCategorySelect;

export function presentCategory(
  row: Prisma.ProductCategoryGetPayload<{ select: typeof categorySelect }>,
): ProductCategoryResponse {
  return {
    id: row.id,
    parentId: row.parentId,
    code: row.code,
    nameVi: row.nameVi,
    nameEn: row.nameEn,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    rowVersion: row.rowVersion,
    productCount: row._count.products,
  };
}
export { categorySelect };

// ------------------------------------------------------------------------------------------------------ prices

interface PromotionWindow {
  promoPriceVnd: bigint;
  startsAt: Date;
  endsAt: Date;
  endedEarlyAt: Date | null;
}

interface PromotionRow {
  id: string;
  promoPriceVnd: bigint;
  startsAt: Date;
  endsAt: Date;
  endedEarlyAt: Date | null;
  createdBy: { fullName: string };
}

/** The instant a promotion stops applying: the manual early end when there is one, else the planned end. */
export const promotionEnd = (row: { endsAt: Date; endedEarlyAt: Date | null }): Date =>
  row.endedEarlyAt ?? row.endsAt;

/** The same window the database function `lucy_variant_price_at` uses: `[starts_at, ended_early_at or ends_at)`. */
export function promotionState(
  row: { startsAt: Date; endsAt: Date; endedEarlyAt: Date | null },
  now: Date,
): ProductPromotionState {
  // Ended by hand before it started: it never applies, so it is over (the database keeps its end at the planned start).
  if (row.endedEarlyAt !== null || now >= promotionEnd(row)) return 'ENDED';
  return row.startsAt <= now ? 'ACTIVE' : 'SCHEDULED';
}

function presentPromotion(row: PromotionRow, now: Date): ProductPromotionResponse {
  return {
    id: row.id,
    promoPriceVnd: row.promoPriceVnd.toString(),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    endedEarlyAt: row.endedEarlyAt?.toISOString() ?? null,
    state: promotionState(row, now),
    createdByName: row.createdBy.fullName,
  };
}

/** The price a customer pays at `now`: the promotion running now (never above the list price), else the list price. */
export function effectivePrice<T extends PromotionWindow>(
  list: bigint | null,
  promotions: readonly T[],
  now: Date,
): { effective: bigint | null; active: T | null } {
  if (list === null) return { effective: null, active: null };
  const active =
    [...promotions]
      .filter((row) => promotionState(row, now) === 'ACTIVE')
      .sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime())[0] ?? null;
  const promo = active?.promoPriceVnd ?? list;
  return { effective: promo < list ? promo : list, active };
}

// ------------------------------------------------------------------------------------------------------ list

/** Every product with a price range. A list row never carries a cost, whoever asks. */
export async function listProducts(context: AdminContext, access: ProductAccess) {
  const { tx } = context;
  const now = await databaseNow(tx);
  const rows = await tx.product.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    select: {
      id: true,
      code: true,
      nameVi: true,
      nameEn: true,
      status: true,
      featured: true,
      rowVersion: true,
      updatedAt: true,
      brand: nameRef,
      category: nameRef,
      images: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 1,
        select: { mediaAssetId: true },
      },
      variants: {
        where: { isActive: true },
        select: {
          priceVersions: {
            orderBy: { versionNo: 'desc' },
            take: 1,
            select: { listPriceVnd: true },
          },
          promotions: {
            where: { endsAt: { gt: now } },
            select: { promoPriceVnd: true, startsAt: true, endsAt: true, endedEarlyAt: true },
          },
        },
      },
    },
  });
  const products: ProductListItem[] = rows.map((row) => {
    const prices = row.variants.flatMap((variant) => {
      const list = variant.priceVersions[0]?.listPriceVnd ?? null;
      const { effective } = effectivePrice(list, variant.promotions, now);
      return effective === null ? [] : [effective];
    });
    const sorted = [...prices].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return {
      id: row.id,
      code: row.code,
      nameVi: row.nameVi,
      nameEn: row.nameEn,
      status: row.status,
      featured: row.featured,
      brand: row.brand,
      category: row.category,
      activeVariantCount: row.variants.length,
      priceFromVnd: sorted[0]?.toString() ?? null,
      priceToVnd: sorted.at(-1)?.toString() ?? null,
      coverMediaId: row.images[0]?.mediaAssetId ?? null,
      rowVersion: row.rowVersion,
      updatedAt: row.updatedAt.toISOString(),
    };
  });
  return { products, access };
}

// ------------------------------------------------------------------------------------------------------ detail

/** The one place a product response is built, for the list-less views: the full product, its variants, prices and images. */
export async function loadDetail(
  context: AdminContext,
  productId: string,
  access: ProductAccess,
): Promise<ProductDetailResponse> {
  const { tx } = context;
  const now = await databaseNow(tx);
  const product = await tx.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      code: true,
      nameVi: true,
      nameEn: true,
      descriptionVi: true,
      descriptionEn: true,
      status: true,
      featured: true,
      publishedAt: true,
      rowVersion: true,
      createdAt: true,
      updatedAt: true,
      brand: nameRef,
      category: nameRef,
      variants: {
        orderBy: [{ sortOrder: 'asc' }, { sku: 'asc' }],
        select: {
          id: true,
          sku: true,
          labelVi: true,
          labelEn: true,
          barcode: true,
          lowStockThreshold: true,
          sellOnOrder: true,
          leadTimeDaysMin: true,
          leadTimeDaysMax: true,
          sortOrder: true,
          isActive: true,
          rowVersion: true,
          priceVersions: {
            orderBy: { versionNo: 'desc' },
            select: {
              versionNo: true,
              listPriceVnd: true,
              reason: true,
              createdAt: true,
              createdBy: { select: { fullName: true } },
            },
          },
          promotions: {
            orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
            select: {
              id: true,
              promoPriceVnd: true,
              startsAt: true,
              endsAt: true,
              endedEarlyAt: true,
              createdBy: { select: { fullName: true } },
            },
          },
        },
      },
      images: {
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        select: {
          id: true,
          mediaAssetId: true,
          sortOrder: true,
          mediaAsset: { select: { altVi: true } },
        },
      },
    },
  });
  if (!product) throw new AuthError('NOT_FOUND');
  // The cost column is read only for a caller who may see it: for everyone else it never leaves the database.
  const costs = new Map<string, bigint | null>();
  if (access.cost) {
    const rows = await tx.productVariant.findMany({
      where: { productId },
      select: { id: true, costPriceVnd: true },
    });
    for (const row of rows) costs.set(row.id, row.costPriceVnd);
  }
  const variants: ProductVariantResponse[] = product.variants.map((variant) => {
    const list = variant.priceVersions[0]?.listPriceVnd ?? null;
    const { effective, active } = effectivePrice(list, variant.promotions, now);
    const base: ProductVariantResponse = {
      id: variant.id,
      sku: variant.sku,
      labelVi: variant.labelVi,
      labelEn: variant.labelEn,
      barcode: variant.barcode,
      lowStockThreshold: variant.lowStockThreshold,
      sellOnOrder: variant.sellOnOrder,
      leadTimeDaysMin: variant.leadTimeDaysMin,
      leadTimeDaysMax: variant.leadTimeDaysMax,
      sortOrder: variant.sortOrder,
      isActive: variant.isActive,
      rowVersion: variant.rowVersion,
      listPriceVnd: list?.toString() ?? null,
      priceVersionNo: variant.priceVersions[0]?.versionNo ?? 0,
      effectivePriceVnd: effective?.toString() ?? null,
      activePromotion: active ? presentPromotion(active, now) : null,
      promotions: variant.promotions.map((row) => presentPromotion(row, now)),
      priceHistory: variant.priceVersions.map((row) => ({
        versionNo: row.versionNo,
        listPriceVnd: row.listPriceVnd.toString(),
        reason: row.reason,
        createdAt: row.createdAt.toISOString(),
        createdByName: row.createdBy.fullName,
      })),
    };
    if (!access.cost) return base;
    const stored = costs.get(variant.id) ?? null;
    return {
      ...base,
      costPriceVnd: stored?.toString() ?? null,
      marginVnd: stored !== null && effective !== null ? (effective - stored).toString() : null,
    };
  });
  const [brandOptions, categoryOptions] = await Promise.all([
    tx.brand.findMany({
      where: { OR: [{ isActive: true }, ...(product.brand ? [{ id: product.brand.id }] : [])] },
      orderBy: [{ nameVi: 'asc' }, { id: 'asc' }],
      select: nameRef.select,
    }),
    tx.productCategory.findMany({
      where: {
        OR: [{ isActive: true }, ...(product.category ? [{ id: product.category.id }] : [])],
      },
      orderBy: [{ sortOrder: 'asc' }, { nameVi: 'asc' }, { id: 'asc' }],
      select: nameRef.select,
    }),
  ]);
  return {
    id: product.id,
    code: product.code,
    nameVi: product.nameVi,
    nameEn: product.nameEn,
    descriptionVi: product.descriptionVi,
    descriptionEn: product.descriptionEn,
    status: product.status,
    featured: product.featured,
    publishedAt: product.publishedAt?.toISOString() ?? null,
    brand: product.brand,
    category: product.category,
    rowVersion: product.rowVersion,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
    variants,
    images: product.images.map((image) => ({
      id: image.id,
      mediaAssetId: image.mediaAssetId,
      altVi: image.mediaAsset.altVi,
      sortOrder: image.sortOrder,
    })),
    brandOptions,
    categoryOptions,
    access,
  };
}

import {
  PUBLIC_PRODUCTS_PAGE_SIZE,
  type PublicCampaignRef,
  type PublicProductCard,
  type PublicProductCategory,
  type PublicProductCategoryRef,
  type PublicProductCodesResponse,
  type PublicProductDetailResponse,
  type PublicProductPrice,
  type PublicProductsCommitment,
  type PublicProductsHero,
  type PublicProductsResponse,
  type PublicProductStock,
  type PublicProductVariant,
  type PublicSlideImage,
} from '@lucy-spa/contracts';
import type { Prisma } from '@lucy-spa/database';
import { AuthError } from '../auth/auth.error.js';
import { campaignRefs, runningCampaignId } from '../campaigns/campaign.public.js';
import { TO_FOLDED, FROM_FOLDED } from '../employees/employee-search.js';
import { pick, publicImageSources, type PublicLocale } from '../website/popup.core.js';
import { readCommitmentItems } from './product-settings.core.js';
import {
  isNewProduct,
  isProductCode,
  pageOffset,
  priceBlock,
  productStock,
  searchPatterns,
  variantStock,
  type PublicProductsQuery,
} from './public-products.logic.js';

/**
 * Phase 6 P6-6: the cosmetics catalog a visitor reads without signing in (design 11.1, 16). A product is visible only while it is
 * PUBLISHED and has at least one active variant with a list price; prices come from the database's `lucy_variant_price_at` and
 * availability from `lucy_available_stock` summed over the active branches, so the public page and the counter can never disagree.
 * Nothing here reads a cost, a lot, a reservation or a user, and nothing returns a quantity, a branch, a SKU or an internal id.
 */

type Tx = Prisma.TransactionClient;

const RELATED_COUNT = 4;
const SITEMAP_LIMIT = 5_000;

async function databaseNow(tx: Tx): Promise<Date> {
  const rows = await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`;
  const now = rows[0]?.now;
  if (!now) throw new AuthError('SERVICE_UNAVAILABLE');
  return now;
}

const settingsSelect = {
  leadTimeDaysMin: true,
  leadTimeDaysMax: true,
  newBadgeDays: true,
  heroTitleVi: true,
  heroTitleEn: true,
  heroTextVi: true,
  heroTextEn: true,
  commitmentTitleVi: true,
  commitmentTitleEn: true,
  commitmentItems: true,
  heroMedia: { select: mediaSelect() },
} satisfies Prisma.ProductSettingsSelect;

function mediaSelect() {
  return {
    id: true,
    altVi: true,
    altEn: true,
    width: true,
    height: true,
    variants: { where: { kind: { in: ['MD', 'LG'] } }, select: { kind: true, width: true } },
  } satisfies Prisma.MediaAssetSelect;
}

type Settings = Prisma.ProductSettingsGetPayload<{ select: typeof settingsSelect }>;
type Media = Prisma.MediaAssetGetPayload<{ select: ReturnType<typeof mediaSelect> }>;

const readSettings = (tx: Tx): Promise<Settings> =>
  tx.productSettings.findUniqueOrThrow({ where: { id: 1 }, select: settingsSelect });

function publicImage(media: Media, locale: PublicLocale, fallbackAlt: string): PublicSlideImage {
  return {
    alt: pick(media.altVi, media.altEn, locale) ?? fallbackAlt,
    width: media.width,
    height: media.height,
    sources: publicImageSources(media.id, media.variants),
  };
}

function presentHero(settings: Settings, locale: PublicLocale): PublicProductsHero | null {
  const title = pick(settings.heroTitleVi, settings.heroTitleEn, locale);
  const text = pick(settings.heroTextVi, settings.heroTextEn, locale);
  const image = settings.heroMedia ? publicImage(settings.heroMedia, locale, title ?? '') : null;
  return title === null && text === null && image === null ? null : { title, text, image };
}

function presentCommitment(
  settings: Settings,
  locale: PublicLocale,
): PublicProductsCommitment | null {
  const items = readCommitmentItems(settings.commitmentItems).map((line) =>
    locale === 'vi' ? line.textVi : line.textEn,
  );
  if (items.length === 0) return null;
  return { title: pick(settings.commitmentTitleVi, settings.commitmentTitleEn, locale), items };
}

// ------------------------------------------------------------------------------------------------ variants

interface VariantRow {
  variantId: string;
  productId: string;
  labelVi: string | null;
  labelEn: string | null;
  sellOnOrder: boolean;
  sellOnline: boolean;
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
  listPriceVnd: bigint;
  effectivePriceVnd: bigint;
  available: number;
  /** The running campaign that gives the price (Wave 4, P6-23), when one does. */
  campaignId: string | null;
}

/** The priced, active variants of the products, in the shop's own order, with price and availability decided by the database. */
async function variantRows(
  tx: Tx,
  productIds: readonly string[],
  now: Date,
): Promise<VariantRow[]> {
  if (productIds.length === 0) return [];
  return tx.$queryRaw<VariantRow[]>`
    SELECT v.id AS "variantId", v.product_id AS "productId",
           v.label_vi AS "labelVi", v.label_en AS "labelEn", v.sell_on_order AS "sellOnOrder", v.sell_online AS "sellOnline",
           v.lead_time_days_min::int AS "leadTimeDaysMin", v.lead_time_days_max::int AS "leadTimeDaysMax",
           pr.list_price_vnd AS "listPriceVnd", pr.effective_price_vnd AS "effectivePriceVnd",
           COALESCE((SELECT sum(lucy_available_stock(b.id, v.id)) FROM branches b WHERE b.is_active), 0)::int AS "available",
           cm.campaign_id AS "campaignId"
    FROM product_variants v
    CROSS JOIN LATERAL lucy_variant_price_at(v.id, ${now}::timestamptz) pr
    LEFT JOIN LATERAL (
      SELECT m.campaign_id FROM lucy_variant_campaign_at(v.id, ${now}::timestamptz) m
      WHERE pr.promotion_id IS NULL AND m.price_vnd = pr.effective_price_vnd
    ) cm ON true
    WHERE v.product_id = ANY(${productIds as string[]}::uuid[]) AND v.is_active
    ORDER BY v.product_id, v.sort_order, v.id`;
}

const cheapestFirst = (a: VariantRow, b: VariantRow): number =>
  a.effectivePriceVnd < b.effectivePriceVnd
    ? -1
    : a.effectivePriceVnd > b.effectivePriceVnd
      ? 1
      : 0;

// ------------------------------------------------------------------------------------------------ cards

const productSelect = {
  id: true,
  code: true,
  nameVi: true,
  nameEn: true,
  descriptionVi: true,
  descriptionEn: true,
  featured: true,
  publishedAt: true,
  category: { select: { id: true, code: true, nameVi: true, nameEn: true, isActive: true } },
  brand: { select: { nameVi: true, nameEn: true, isActive: true } },
  images: {
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    select: { mediaAsset: { select: mediaSelect() } },
  },
} satisfies Prisma.ProductSelect;

type ProductRow = Prisma.ProductGetPayload<{ select: typeof productSelect }>;

function categoryRef(row: ProductRow, locale: PublicLocale): PublicProductCategoryRef | null {
  const category = row.category;
  if (!category || !category.isActive) return null;
  return {
    code: category.code,
    name: pick(category.nameVi, category.nameEn, locale) ?? category.code,
  };
}

const brandName = (row: ProductRow, locale: PublicLocale): string | null =>
  row.brand && row.brand.isActive ? pick(row.brand.nameVi, row.brand.nameEn, locale) : null;

interface Context {
  locale: PublicLocale;
  now: Date;
  settings: Settings;
  /** The badge data of the campaigns that gave the prices of this page (Wave 4, P6-23). */
  campaigns?: Map<string, PublicCampaignRef>;
}

/** The price of a variant, with the running campaign that gives it. */
function priced(variant: VariantRow, context: Context): PublicProductPrice {
  const block = priceBlock(variant.listPriceVnd, variant.effectivePriceVnd);
  const campaign = variant.campaignId ? context.campaigns?.get(variant.campaignId) : undefined;
  return campaign ? { ...block, campaign } : block;
}

function stockOf(rows: readonly VariantRow[], settings: Settings): PublicProductStock[] {
  const fallback = { min: settings.leadTimeDaysMin, max: settings.leadTimeDaysMax };
  return rows.map((row) => variantStock(row, fallback));
}

function presentCard(
  row: ProductRow,
  variants: readonly VariantRow[],
  context: Context,
): PublicProductCard {
  const { locale, now, settings } = context;
  const cheapest = [...variants].sort(cheapestFirst)[0];
  if (!cheapest) throw new AuthError('SERVICE_UNAVAILABLE');
  const dearest = [...variants].sort((a, b) => cheapestFirst(b, a))[0] ?? cheapest;
  const name = pick(row.nameVi, row.nameEn, locale) ?? row.code;
  const first = row.images[0]?.mediaAsset;
  return {
    code: row.code,
    name,
    category: categoryRef(row, locale),
    brand: brandName(row, locale),
    image: first ? publicImage(first, locale, name) : null,
    price: priced(cheapest, context),
    priceMaxVnd: dearest.effectivePriceVnd.toString(),
    isNew: isNewProduct(row.publishedAt, now, settings.newBadgeDays),
    featured: row.featured,
    stock: productStock(stockOf(variants, settings)),
  };
}

/** The cards of these products, in the order of `ids`; a product that lost its last priced variant meanwhile is dropped. */
async function cardsOf(
  tx: Tx,
  ids: readonly string[],
  context: Context,
): Promise<PublicProductCard[]> {
  if (ids.length === 0) return [];
  const [rows, variants] = await Promise.all([
    tx.product.findMany({
      where: { id: { in: [...ids] }, status: 'PUBLISHED' },
      select: productSelect,
    }),
    variantRows(tx, ids, context.now),
  ]);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const withCampaigns: Context = {
    ...context,
    campaigns: await campaignRefs(
      tx,
      [...new Set(variants.flatMap((variant) => (variant.campaignId ? [variant.campaignId] : [])))],
      context.locale,
    ),
  };
  const cards: PublicProductCard[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    const own = variants.filter((variant) => variant.productId === id);
    if (row && own.length > 0) cards.push(presentCard(row, own, withCampaigns));
  }
  return cards;
}

// ------------------------------------------------------------------------------------------------ the list

interface Filters {
  categoryIds: string[] | null;
  brandId: string | null;
  excludeId: string | null;
  /** Only products with a variant in this running campaign (Wave 4, P6-23). */
  campaignId?: string | null;
  patterns: string[];
  sort: PublicProductsQuery['sort'];
  limit: number;
  offset: number;
}

/** Ids of one page of visible products (ranked by the database) and how many match in all. */
async function pageOfIds(
  tx: Tx,
  now: Date,
  filters: Filters,
): Promise<{ ids: string[]; total: number }> {
  const rows = await tx.$queryRaw<{ id: string; total: number }[]>`
    WITH visible AS (
      SELECT p.id, p.featured, p.published_at, min(pr.effective_price_vnd) AS min_price
      FROM products p
      JOIN product_variants v ON v.product_id = p.id AND v.is_active
      CROSS JOIN LATERAL lucy_variant_price_at(v.id, ${now}::timestamptz) pr
      LEFT JOIN brands b ON b.id = p.brand_id
      WHERE p.status = 'PUBLISHED'
        AND (${filters.categoryIds}::uuid[] IS NULL OR p.category_id = ANY(${filters.categoryIds}::uuid[]))
        AND (${filters.brandId}::uuid IS NULL OR p.brand_id = ${filters.brandId}::uuid)
        AND (${filters.excludeId}::uuid IS NULL OR p.id <> ${filters.excludeId}::uuid)
        AND (${filters.campaignId ?? null}::uuid IS NULL OR EXISTS (
          SELECT 1 FROM product_campaign_items ci WHERE ci.variant_id = v.id AND ci.campaign_id = ${filters.campaignId ?? null}::uuid))
        AND (cardinality(${filters.patterns}::text[]) = 0 OR NOT EXISTS (
          SELECT 1 FROM unnest(${filters.patterns}::text[]) AS t(pat)
          WHERE translate(lower(normalize(
                  p.name_vi || ' ' || p.name_en || ' ' || COALESCE(b.name_vi, '') || ' ' || COALESCE(b.name_en, ''), NFC)),
                ${FROM_FOLDED}, ${TO_FOLDED}) NOT LIKE t.pat))
      GROUP BY p.id
    )
    SELECT id, (count(*) OVER ())::int AS total
    FROM visible
    ORDER BY
      CASE WHEN ${filters.sort} = 'price_asc' THEN min_price END ASC,
      CASE WHEN ${filters.sort} = 'price_desc' THEN min_price END DESC,
      CASE WHEN ${filters.sort} = 'featured' THEN featured END DESC,
      published_at DESC, id
    LIMIT ${filters.limit} OFFSET ${filters.offset}`;
  return { ids: rows.map((row) => row.id), total: rows[0]?.total ?? 0 };
}

interface Taxonomy {
  categories: (PublicProductCategory & { id: string })[];
  brands: { id: string; code: string; name: string }[];
}

/** The categories and brands that hold at least one visible product (a parent holds its children's products too). */
async function taxonomy(tx: Tx, now: Date, locale: PublicLocale): Promise<Taxonomy> {
  const [combos, categories, brands] = await Promise.all([
    tx.$queryRaw<{ categoryId: string | null; brandId: string | null }[]>`
      SELECT DISTINCT p.category_id AS "categoryId", p.brand_id AS "brandId"
      FROM products p
      WHERE p.status = 'PUBLISHED' AND EXISTS (
        SELECT 1 FROM product_variants v
        CROSS JOIN LATERAL lucy_variant_price_at(v.id, ${now}::timestamptz) pr
        WHERE v.product_id = p.id AND v.is_active)`,
    tx.productCategory.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, parentId: true, code: true, nameVi: true, nameEn: true },
    }),
    tx.brand.findMany({
      where: { isActive: true },
      orderBy: [{ nameVi: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, nameVi: true, nameEn: true },
    }),
  ]);
  const held = new Set<string>();
  const parentOf = new Map(categories.map((category) => [category.id, category.parentId]));
  for (const { categoryId } of combos) {
    // Walk up through active categories only; a loop in the data (it cannot happen) ends at the guard.
    let cursor = categoryId;
    for (let depth = 0; cursor && parentOf.has(cursor) && depth < 8; depth += 1) {
      held.add(cursor);
      cursor = parentOf.get(cursor) ?? null;
    }
  }
  const usedBrands = new Set(combos.map((combo) => combo.brandId));
  return {
    categories: categories
      .filter((category) => held.has(category.id))
      .map((category) => ({
        id: category.id,
        code: category.code,
        name: pick(category.nameVi, category.nameEn, locale) ?? category.code,
        parentCode:
          categories.find(
            (candidate) => candidate.id === category.parentId && held.has(candidate.id),
          )?.code ?? null,
      })),
    brands: brands
      .filter((brand) => usedBrands.has(brand.id))
      .map((brand) => ({
        id: brand.id,
        code: brand.code,
        name: pick(brand.nameVi, brand.nameEn, locale) ?? brand.code,
      })),
  };
}

/** The category and every category below it (a filter on a parent includes its sub-categories). */
function withDescendants(
  categories: readonly { id: string; code: string; parentCode: string | null }[],
  code: string,
): string[] | null {
  const root = categories.find((category) => category.code === code);
  if (!root) return null;
  const ids = [root.id];
  const codes = new Set([root.code]);
  for (let changed = true; changed;) {
    changed = false;
    for (const category of categories) {
      if (
        category.parentCode !== null &&
        codes.has(category.parentCode) &&
        !codes.has(category.code)
      ) {
        codes.add(category.code);
        ids.push(category.id);
        changed = true;
      }
    }
  }
  return ids;
}

export async function publicProducts(
  tx: Tx,
  locale: PublicLocale,
  query: PublicProductsQuery,
): Promise<PublicProductsResponse> {
  const now = await databaseNow(tx);
  const [settings, tax] = await Promise.all([readSettings(tx), taxonomy(tx, now, locale)]);
  const publicTaxonomy = {
    categories: tax.categories.map(({ code, name, parentCode }) => ({ code, name, parentCode })),
    brands: tax.brands.map(({ code, name }) => ({ code, name })),
  };
  const head = {
    hero: presentHero(settings, locale),
    commitment: presentCommitment(settings, locale),
    ...publicTaxonomy,
    pageSize: PUBLIC_PRODUCTS_PAGE_SIZE,
  };
  // An unknown (or empty) category or brand matches nothing: the page says so instead of listing everything.
  const categoryIds =
    query.category === null ? null : withDescendants(tax.categories, query.category);
  const brand =
    query.brand === null ? null : (tax.brands.find((entry) => entry.code === query.brand) ?? null);
  if (
    (query.category !== null && categoryIds === null) ||
    (query.brand !== null && brand === null)
  ) {
    return { ...head, items: [], page: query.page, total: 0 };
  }
  // An unknown or not running campaign matches nothing: the page says so instead of listing everything.
  const campaignId =
    query.campaign === undefined ? null : await runningCampaignId(tx, query.campaign, now);
  if (query.campaign !== undefined && campaignId === null) {
    return { ...head, items: [], page: query.page, total: 0 };
  }
  const filters: Filters = {
    categoryIds,
    brandId: brand?.id ?? null,
    excludeId: null,
    campaignId,
    patterns: searchPatterns(query.q),
    sort: query.sort,
    limit: PUBLIC_PRODUCTS_PAGE_SIZE,
    offset: pageOffset(query.page),
  };
  let found = await pageOfIds(tx, now, filters);
  if (found.ids.length === 0 && filters.offset > 0) {
    // A page past the end: still tell the caller how many products there are, so it can send the visitor to the last page.
    found = {
      ids: [],
      total: (await pageOfIds(tx, now, { ...filters, limit: 1, offset: 0 })).total,
    };
  }
  const items = await cardsOf(tx, found.ids, { locale, now, settings });
  return { ...head, items, page: query.page, total: found.total };
}

// ------------------------------------------------------------------------------------------------ detail

export async function publicProductDetail(
  tx: Tx,
  locale: PublicLocale,
  code: string,
): Promise<PublicProductDetailResponse> {
  if (!isProductCode(code)) throw new AuthError('NOT_FOUND');
  const now = await databaseNow(tx);
  const settings = await readSettings(tx);
  const row = await tx.product.findFirst({
    where: { code, status: 'PUBLISHED' },
    select: productSelect,
  });
  if (!row) throw new AuthError('NOT_FOUND');
  const variants = await variantRows(tx, [row.id], now);
  if (variants.length === 0) throw new AuthError('NOT_FOUND');
  const context: Context = {
    locale,
    now,
    settings,
    campaigns: await campaignRefs(
      tx,
      [...new Set(variants.flatMap((variant) => (variant.campaignId ? [variant.campaignId] : [])))],
      locale,
    ),
  };
  const card = presentCard(row, variants, context);
  const name = card.name;
  const stocks = stockOf(variants, settings);
  const presented: PublicProductVariant[] = variants.map((variant, index) => ({
    id: variant.variantId,
    sellOnline: variant.sellOnline,
    label: pick(variant.labelVi, variant.labelEn, locale),
    price: priced(variant, context),
    stock: stocks[index] ?? card.stock,
  }));
  const relatedIds =
    row.category && row.category.isActive
      ? (
          await pageOfIds(tx, now, {
            categoryIds: [row.category.id],
            brandId: null,
            excludeId: row.id,
            patterns: [],
            sort: 'featured',
            limit: RELATED_COUNT,
            offset: 0,
          })
        ).ids
      : [];
  return {
    product: {
      code: row.code,
      name,
      description: pick(row.descriptionVi, row.descriptionEn, locale),
      category: card.category,
      brand: card.brand,
      images: row.images.map((image) => publicImage(image.mediaAsset, locale, name)),
      variants: presented,
      priceMaxVnd: card.priceMaxVnd,
      isNew: card.isNew,
      featured: card.featured,
      stock: card.stock,
    },
    commitment: presentCommitment(settings, locale),
    related: await cardsOf(tx, relatedIds, context),
  };
}

/** The codes of every visible product, for the sitemap. */
export async function publicProductCodes(tx: Tx): Promise<PublicProductCodesResponse> {
  const now = await databaseNow(tx);
  const rows = await tx.$queryRaw<{ code: string }[]>`
    SELECT p.code
    FROM products p
    WHERE p.status = 'PUBLISHED' AND EXISTS (
      SELECT 1 FROM product_variants v
      CROSS JOIN LATERAL lucy_variant_price_at(v.id, ${now}::timestamptz) pr
      WHERE v.product_id = p.id AND v.is_active)
    ORDER BY p.code
    LIMIT ${SITEMAP_LIMIT}`;
  return { codes: rows.map((row) => row.code) };
}

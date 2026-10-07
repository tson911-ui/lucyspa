import {
  PUBLIC_PRODUCT_SORTS,
  PUBLIC_PRODUCTS_PAGE_SIZE,
  type PublicProductPrice,
  type PublicProductSort,
  type PublicProductStock,
} from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { foldSearch, likeLiteral, searchTokens } from '../employees/employee-search.js';

/**
 * Phase 6 P6-6: the rules of the public cosmetics catalog that need no database (design 11.1, 16): what stock reads as, the
 * price block, the "Mới" badge, the search terms and the bounds of the query. Pure, so every rule is unit-tested.
 */

export const PUBLIC_MAX_PAGE = 500;
export const PUBLIC_MAX_QUERY_LENGTH = 80;
export const PUBLIC_MAX_SEARCH_TERMS = 6;
const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export const isProductCode = (value: string): boolean => CODE.test(value);

export interface PublicProductsQuery {
  q: string;
  category: string | null;
  brand: string | null;
  sort: PublicProductSort;
  page: number;
}

/** What the controller got from the URL, bounded: nothing here can make a query expensive or an unbounded cache key. */
export function parsePublicProductsQuery(raw: {
  q?: unknown;
  category?: unknown;
  brand?: unknown;
  sort?: unknown;
  page?: unknown;
}): PublicProductsQuery {
  const one = (value: unknown): string | null =>
    typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  const q = (one(raw.q) ?? '').normalize('NFC').replace(/\p{Cc}/gu, ' ');
  if ([...q].length > PUBLIC_MAX_QUERY_LENGTH) throw new AuthError('VALIDATION_FAILED', 'q');
  const code = (value: unknown, field: string): string | null => {
    const text = one(value);
    if (text === null) return null;
    if (!CODE.test(text)) throw new AuthError('VALIDATION_FAILED', field);
    return text;
  };
  const sortText = one(raw.sort) ?? 'featured';
  const sort = (PUBLIC_PRODUCT_SORTS as readonly string[]).includes(sortText)
    ? (sortText as PublicProductSort)
    : null;
  if (sort === null) throw new AuthError('VALIDATION_FAILED', 'sort');
  const pageText = one(raw.page) ?? '1';
  const page = /^[0-9]{1,4}$/.test(pageText) ? Number(pageText) : 0;
  if (page < 1 || page > PUBLIC_MAX_PAGE) throw new AuthError('VALIDATION_FAILED', 'page');
  return {
    q,
    category: code(raw.category, 'category'),
    brand: code(raw.brand, 'brand'),
    sort,
    page,
  };
}

export const pageOffset = (page: number): number => (page - 1) * PUBLIC_PRODUCTS_PAGE_SIZE;

/**
 * LIKE patterns of a search, one per term (at most six): every term must be contained in the folded name or brand, so
 * "kem duong" finds "Kem dưỡng ẩm" and a `%` or `_` typed by the visitor is a letter, not a wildcard.
 */
export function searchPatterns(query: string): string[] {
  return searchTokens(query)
    .slice(0, PUBLIC_MAX_SEARCH_TERMS)
    .map((term) => `%${likeLiteral(term)}%`);
}

export { foldSearch };

// ------------------------------------------------------------------------------------------------------ price

const ONE_HUNDRED = 100n;

/**
 * The price block of one variant: what is paid, and while a promotion makes it lower the struck list price and the percent
 * (round half up of (list - price) / list, kept between 1 and 99; null when it would round to nothing).
 */
export function priceBlock(list: bigint, effective: bigint): PublicProductPrice {
  if (effective >= list)
    return { priceVnd: list.toString(), listPriceVnd: null, discountPercent: null };
  const half = (list - effective) * ONE_HUNDRED * 2n + list;
  const percent = Number(half / (list * 2n));
  return {
    priceVnd: effective.toString(),
    listPriceVnd: list.toString(),
    discountPercent: percent < 1 ? null : Math.min(percent, 99),
  };
}

// ------------------------------------------------------------------------------------------------------ stock

export interface VariantStockInput {
  /** The sum of `lucy_available_stock` over the active branches. */
  available: number;
  sellOnOrder: boolean;
  /** The variant's own waiting time, or null for the settings default. */
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
}

export interface LeadTimeDefault {
  min: number;
  max: number;
}

/**
 * One variant (design 18.2, P6-Q15): stock above zero shows nothing; none and "sell on order" is a pre-order with its waiting time
 * (the variant's own or the shop default); none otherwise is "Hết hàng". The quantity never leaves this function.
 */
export function variantStock(
  variant: VariantStockInput,
  fallback: LeadTimeDefault,
): PublicProductStock {
  if (variant.available > 0) {
    return { state: 'IN_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null };
  }
  if (!variant.sellOnOrder) {
    return { state: 'OUT_OF_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null };
  }
  const own = variant.leadTimeDaysMin !== null && variant.leadTimeDaysMax !== null;
  return {
    state: 'PRE_ORDER',
    leadTimeDaysMin: own ? variant.leadTimeDaysMin : fallback.min,
    leadTimeDaysMax: own ? variant.leadTimeDaysMax : fallback.max,
  };
}

/**
 * A product with several variants: any variant in stock means no label; else any pre-order variant means a pre-order whose
 * waiting time spans the shortest to the longest of them; else "Hết hàng".
 */
export function productStock(stocks: readonly PublicProductStock[]): PublicProductStock {
  if (stocks.length === 0 || stocks.some((stock) => stock.state === 'IN_STOCK')) {
    return { state: 'IN_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null };
  }
  const waiting = stocks.filter((stock) => stock.state === 'PRE_ORDER');
  if (waiting.length === 0)
    return { state: 'OUT_OF_STOCK', leadTimeDaysMin: null, leadTimeDaysMax: null };
  return {
    state: 'PRE_ORDER',
    leadTimeDaysMin: Math.min(...waiting.map((stock) => stock.leadTimeDaysMin ?? 0)),
    leadTimeDaysMax: Math.max(...waiting.map((stock) => stock.leadTimeDaysMax ?? 0)),
  };
}

// ------------------------------------------------------------------------------------------------------ "new"

const DAY_MS = 86_400_000;

/** "Mới" (OQ-P6-28): within `days` days of the first publication; 0 days turns the badge off. */
export function isNewProduct(publishedAt: Date | null, now: Date, days: number): boolean {
  if (publishedAt === null || days <= 0) return false;
  return now.getTime() - publishedAt.getTime() < days * DAY_MS && now >= publishedAt;
}

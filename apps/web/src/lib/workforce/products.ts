import type {
  ProductAccess,
  ProductBrandCreateRequest,
  ProductBrandEditRequest,
  ProductBrandResponse,
  ProductCategoryCreateRequest,
  ProductCategoryEditRequest,
  ProductCategoryResponse,
  ProductCreateRequest,
  ProductDetailResponse,
  ProductListItem,
  ProductPriceChangeRequest,
  ProductPromotionCreateRequest,
  ProductPromotionResponse,
  ProductSettingsEditRequest,
  ProductSettingsResponse,
  ProductStatusName,
  ProductVariantCreateRequest,
  ProductVariantEditRequest,
  ProductVariantResponse,
} from '@lucy-spa/contracts';
import { DEFAULT_PAGE_SIZE, normalizeSearch, type SortValue } from '@lucy-spa/ui';
import type { Locale } from '../../i18n/locales';
import { productDictionary } from '../../i18n/products';
import { ApiError } from './api';
import { vnLocalToIso } from './discounts';
import { formatVnd, isVndInput } from './format';
import { normalizePage, normalizePageSize } from './list-view';

/**
 * Phase 6 P6-3: the product catalog screens' pure logic (list state, drafts, requests, display rules). Nothing here decides
 * authority: `ProductAccess` comes from the API and only decides what the screens offer; the API authorizes every request again.
 * Money is an integer VND string, never a float.
 */

export type Issue = 'required' | 'invalid';

export const localizedName = (entry: { nameVi: string; nameEn: string }, locale: Locale): string =>
  locale === 'vi' ? entry.nameVi : entry.nameEn;

/** The current crumb of a breadcrumb is one short line: a long name is cut (the full name stays in the page title). */
export function crumbLabel(name: string, max = 32): string {
  const chars = [...name.trim()];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max).join('').trimEnd()}…`;
}

// ---------------------------------------------------------------------------------------------------------- access

/** The product screens are readable with the catalog or the price permission (the API's rule). */
export const canOpenCatalog = (access: ProductAccess): boolean => access.manage || access.prices;

/** The variant table's column keys for this caller: the cost and margin columns exist only with the cost permission. */
export function variantColumnKeys(access: ProductAccess): string[] {
  return [
    'sku',
    'label',
    'listPrice',
    'currentPrice',
    'threshold',
    ...(access.cost ? ['cost', 'margin'] : []),
    'status',
    'actions',
  ];
}

// --------------------------------------------------------------------------------------------------------- status

export const PRODUCT_STATUSES: readonly ProductStatusName[] = ['DRAFT', 'PUBLISHED', 'INACTIVE'];

export const statusTone = (status: ProductStatusName): 'success' | 'neutral' | 'warning' =>
  status === 'PUBLISHED' ? 'success' : status === 'DRAFT' ? 'warning' : 'neutral';

/** Moves the database allows: Nháp to Đang bán, Đang bán to Ngừng bán, Ngừng bán to Đang bán. Never back to Nháp. */
export function allowedStatusMoves(status: ProductStatusName): Array<'PUBLISHED' | 'INACTIVE'> {
  return status === 'PUBLISHED' ? ['INACTIVE'] : ['PUBLISHED'];
}

export type StatusMoveKind = 'publish' | 'stop' | 'resume';

export function statusMoveKind(
  from: ProductStatusName,
  to: 'PUBLISHED' | 'INACTIVE',
): StatusMoveKind {
  return to === 'INACTIVE' ? 'stop' : from === 'DRAFT' ? 'publish' : 'resume';
}

// -------------------------------------------------------------------------------------------------------- money

/** A whole VND amount from what was typed: digits only and at least `min` (the API's own format). */
export function vndAmount(text: string, min: 0 | 1 = 1): string | null {
  const value = text.trim();
  if (!isVndInput(value)) return null;
  return BigInt(value) >= BigInt(min) ? value : null;
}

/** "120.000 ₫", or "120.000 ₫ – 250.000 ₫" for a range, or the "no price yet" text. */
export function priceRangeText(
  from: string | null,
  to: string | null,
  locale: Locale,
  none: string,
): string {
  if (from === null || to === null) return none;
  return from === to
    ? formatVnd(from, locale)
    : `${formatVnd(from, locale)} – ${formatVnd(to, locale)}`;
}

/** The margin shown for a variant: only present when the API sent it (the cost permission). */
export const marginText = (variant: ProductVariantResponse, locale: Locale): string =>
  variant.marginVnd === undefined || variant.marginVnd === null
    ? '—'
    : variant.marginVnd.startsWith('-')
      ? `-${formatVnd(variant.marginVnd.slice(1), locale)}`
      : formatVnd(variant.marginVnd, locale);

export const costText = (variant: ProductVariantResponse, locale: Locale): string =>
  variant.costPriceVnd === undefined || variant.costPriceVnd === null
    ? '—'
    : formatVnd(variant.costPriceVnd, locale);

// ------------------------------------------------------------------------------------------------- list state

export const PRODUCT_TABS = ['products', 'brands', 'categories'] as const;
export const PRODUCT_SORT_KEYS = ['name', 'brand', 'category', 'price', 'status'] as const;

export const PRODUCT_LIST_DEFAULTS = {
  tab: 'products',
  q: '',
  brand: '',
  category: '',
  status: '',
  sort: 'name',
  dir: 'asc',
  page: 1,
  pageSize: DEFAULT_PAGE_SIZE,
  /** Page and page size of the brands tab and the categories tab. */
  bpage: 1,
  bpageSize: DEFAULT_PAGE_SIZE,
  cpage: 1,
  cpageSize: DEFAULT_PAGE_SIZE,
};
export type ProductListState = typeof PRODUCT_LIST_DEFAULTS;

export const PRODUCT_PAGE_KEYS: readonly string[] = ['page', 'bpage', 'cpage'];

export function normalizeProductList(state: ProductListState): ProductListState {
  return {
    tab: (PRODUCT_TABS as readonly string[]).includes(state.tab) ? state.tab : 'products',
    q: state.q.slice(0, 100),
    brand: state.brand.slice(0, 64),
    category: state.category.slice(0, 64),
    status: (PRODUCT_STATUSES as readonly string[]).includes(state.status) ? state.status : '',
    sort: (PRODUCT_SORT_KEYS as readonly string[]).includes(state.sort) ? state.sort : 'name',
    dir: state.dir === 'desc' ? 'desc' : 'asc',
    page: normalizePage(state.page),
    pageSize: normalizePageSize(state.pageSize),
    bpage: normalizePage(state.bpage),
    bpageSize: normalizePageSize(state.bpageSize),
    cpage: normalizePage(state.cpage),
    cpageSize: normalizePageSize(state.cpageSize),
  };
}

/** Products matching the search (either name, ignoring case and accents) and the three filters. */
export function filterProducts(
  products: readonly ProductListItem[],
  state: Pick<ProductListState, 'q' | 'brand' | 'category' | 'status'>,
): ProductListItem[] {
  const query = normalizeSearch(state.q);
  return products.filter((product) => {
    if (state.status !== '' && product.status !== state.status) return false;
    if (state.brand !== '' && product.brand?.id !== state.brand) return false;
    if (state.category !== '' && product.category?.id !== state.category) return false;
    if (query === '') return true;
    return [product.nameVi, product.nameEn].some((field) => normalizeSearch(field).includes(query));
  });
}

/** What a product column sorts by. Price sorts by its lowest price (whole VND); no price sorts first. */
export function productSortValue(product: ProductListItem, key: string, locale: Locale): SortValue {
  if (key === 'brand') return product.brand ? localizedName(product.brand, locale) : '';
  if (key === 'category') return product.category ? localizedName(product.category, locale) : '';
  if (key === 'price') return product.priceFromVnd === null ? -1 : Number(product.priceFromVnd);
  if (key === 'status') return PRODUCT_STATUSES.indexOf(product.status);
  return localizedName(product, locale);
}

// ---------------------------------------------------------------------------------------------------- product form

export interface ProductDraft {
  nameVi: string;
  nameEn: string;
  descriptionVi: string;
  descriptionEn: string;
  brandId: string;
  categoryId: string;
  featured: boolean;
}

export const NAME_MAX = 200;
export const DESCRIPTION_MAX = 2000;

export const emptyProductDraft = (): ProductDraft => ({
  nameVi: '',
  nameEn: '',
  descriptionVi: '',
  descriptionEn: '',
  brandId: '',
  categoryId: '',
  featured: false,
});

export const draftFromProduct = (product: ProductDetailResponse): ProductDraft => ({
  nameVi: product.nameVi,
  nameEn: product.nameEn,
  descriptionVi: product.descriptionVi ?? '',
  descriptionEn: product.descriptionEn ?? '',
  brandId: product.brand?.id ?? '',
  categoryId: product.category?.id ?? '',
  featured: product.featured,
});

const clean = (text: string): string => text.normalize('NFC').trim();
const length = (text: string): number => [...text].length;

function nameIssue(text: string): Issue | undefined {
  const value = clean(text);
  if (value === '') return 'required';
  return length(value) > NAME_MAX ? 'invalid' : undefined;
}

function descriptionIssue(text: string): Issue | undefined {
  return length(clean(text)) > DESCRIPTION_MAX ? 'invalid' : undefined;
}

export type ProductDraftErrors = Partial<
  Record<'nameVi' | 'nameEn' | 'descriptionVi' | 'descriptionEn', Issue>
>;

/** Both names are required (the English one is never copied from the Vietnamese one). */
export function validateProductDraft(draft: ProductDraft): ProductDraftErrors {
  const errors: ProductDraftErrors = {};
  const nameVi = nameIssue(draft.nameVi);
  const nameEn = nameIssue(draft.nameEn);
  const descriptionVi = descriptionIssue(draft.descriptionVi);
  const descriptionEn = descriptionIssue(draft.descriptionEn);
  if (nameVi) errors.nameVi = nameVi;
  if (nameEn) errors.nameEn = nameEn;
  if (descriptionVi) errors.descriptionVi = descriptionVi;
  if (descriptionEn) errors.descriptionEn = descriptionEn;
  return errors;
}

export function productRequest(draft: ProductDraft): ProductCreateRequest | null {
  if (Object.keys(validateProductDraft(draft)).length > 0) return null;
  const optional = (text: string) => (clean(text) === '' ? null : clean(text));
  return {
    nameVi: clean(draft.nameVi),
    nameEn: clean(draft.nameEn),
    descriptionVi: optional(draft.descriptionVi),
    descriptionEn: optional(draft.descriptionEn),
    brandId: draft.brandId === '' ? null : draft.brandId,
    categoryId: draft.categoryId === '' ? null : draft.categoryId,
    featured: draft.featured,
  };
}

export function productEditRequest(
  draft: ProductDraft,
  expectedRowVersion: number,
): (ProductCreateRequest & { expectedRowVersion: number }) | null {
  const body = productRequest(draft);
  return body ? { expectedRowVersion, ...body } : null;
}

// ----------------------------------------------------------------------------------- brands and categories forms

export interface BrandDraft {
  nameVi: string;
  nameEn: string;
  isActive: boolean;
}

export const draftFromBrand = (brand: ProductBrandResponse | null): BrandDraft => ({
  nameVi: brand?.nameVi ?? '',
  nameEn: brand?.nameEn ?? '',
  isActive: brand?.isActive ?? true,
});

export function validateNames(draft: { nameVi: string; nameEn: string }) {
  const errors: Partial<Record<'nameVi' | 'nameEn', Issue>> = {};
  const nameVi = nameIssue(draft.nameVi);
  const nameEn = nameIssue(draft.nameEn);
  if (nameVi) errors.nameVi = nameVi;
  if (nameEn) errors.nameEn = nameEn;
  return errors;
}

export function brandCreateRequest(draft: BrandDraft): ProductBrandCreateRequest | null {
  if (Object.keys(validateNames(draft)).length > 0) return null;
  return { nameVi: clean(draft.nameVi), nameEn: clean(draft.nameEn) };
}

export function brandEditRequest(
  draft: BrandDraft,
  expectedRowVersion: number,
): ProductBrandEditRequest | null {
  if (Object.keys(validateNames(draft)).length > 0) return null;
  return {
    expectedRowVersion,
    nameVi: clean(draft.nameVi),
    nameEn: clean(draft.nameEn),
    isActive: draft.isActive,
  };
}

export interface CategoryDraft extends BrandDraft {
  parentId: string;
  sortOrder: string;
}

export const draftFromCategory = (category: ProductCategoryResponse | null): CategoryDraft => ({
  ...draftFromBrand(category),
  parentId: category?.parentId ?? '',
  sortOrder: String(category?.sortOrder ?? 0),
});

const wholeNumber = (text: string, max: number): number | null => {
  const value = text.trim();
  if (!/^[0-9]{1,9}$/.test(value)) return null;
  const number = Number(value);
  return number <= max ? number : null;
};

export function validateCategoryDraft(draft: CategoryDraft) {
  const errors: Partial<Record<'nameVi' | 'nameEn' | 'sortOrder', Issue>> = validateNames(draft);
  if (wholeNumber(draft.sortOrder, 100_000) === null) errors.sortOrder = 'invalid';
  return errors;
}

export function categoryCreateRequest(draft: CategoryDraft): ProductCategoryCreateRequest | null {
  if (Object.keys(validateCategoryDraft(draft)).length > 0) return null;
  return {
    parentId: draft.parentId === '' ? null : draft.parentId,
    nameVi: clean(draft.nameVi),
    nameEn: clean(draft.nameEn),
    sortOrder: wholeNumber(draft.sortOrder, 100_000)!,
  };
}

export function categoryEditRequest(
  draft: CategoryDraft,
  expectedRowVersion: number,
): ProductCategoryEditRequest | null {
  if (Object.keys(validateCategoryDraft(draft)).length > 0) return null;
  return {
    expectedRowVersion,
    parentId: draft.parentId === '' ? null : draft.parentId,
    nameVi: clean(draft.nameVi),
    nameEn: clean(draft.nameEn),
    sortOrder: wholeNumber(draft.sortOrder, 100_000)!,
    isActive: draft.isActive,
  };
}

/** Tree order for the categories table: each root by its sort order and code, then its children the same way. */
export function orderCategoryTree(
  categories: readonly ProductCategoryResponse[],
): ProductCategoryResponse[] {
  const byOrder = (left: ProductCategoryResponse, right: ProductCategoryResponse) =>
    left.sortOrder - right.sortOrder || left.code.localeCompare(right.code);
  const roots = categories.filter((entry) => entry.parentId === null).sort(byOrder);
  const known = new Set(roots.map((root) => root.id));
  const result = roots.flatMap((root) => [
    root,
    ...categories.filter((entry) => entry.parentId === root.id).sort(byOrder),
  ]);
  // A child whose parent is not in the list (should not happen) is still shown.
  return [
    ...result,
    ...categories
      .filter((entry) => entry.parentId !== null && !known.has(entry.parentId))
      .sort(byOrder),
  ];
}

/** Parents offered by the category form: top-level categories only (two levels), never the category itself. */
export function parentOptions(
  categories: readonly ProductCategoryResponse[],
  editing: ProductCategoryResponse | null,
): ProductCategoryResponse[] {
  const hasChildren = editing ? categories.some((entry) => entry.parentId === editing.id) : false;
  // A category that has children stays a root: it can have no parent at all.
  if (hasChildren) return [];
  return categories.filter(
    (entry) =>
      entry.parentId === null &&
      entry.id !== editing?.id &&
      (entry.isActive || entry.id === editing?.parentId),
  );
}

// ---------------------------------------------------------------------------------------------------- variants

export interface VariantDraft {
  sku: string;
  labelVi: string;
  labelEn: string;
  barcode: string;
  threshold: string;
  /** Sold on order (on for a new variant, Owner OQ-P6-30). */
  sellOnOrder: boolean;
  /** The variant's own waiting time in days; both empty means the settings default. */
  leadMin: string;
  leadMax: string;
  /** The supplier this variant is usually ordered from (OQ-87); empty means none. */
  usualSupplierId: string;
  sortOrder: string;
  listPrice: string;
  cost: string;
  isActive: boolean;
}

export const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;

export const emptyVariantDraft = (): VariantDraft => ({
  sku: '',
  labelVi: '',
  labelEn: '',
  barcode: '',
  threshold: '',
  sellOnOrder: true,
  leadMin: '',
  leadMax: '',
  usualSupplierId: '',
  sortOrder: '0',
  listPrice: '',
  cost: '',
  isActive: true,
});

export const draftFromVariant = (variant: ProductVariantResponse): VariantDraft => ({
  sku: variant.sku,
  labelVi: variant.labelVi ?? '',
  labelEn: variant.labelEn ?? '',
  barcode: variant.barcode ?? '',
  threshold: variant.lowStockThreshold === null ? '' : String(variant.lowStockThreshold),
  sellOnOrder: variant.sellOnOrder,
  leadMin: variant.leadTimeDaysMin === null ? '' : String(variant.leadTimeDaysMin),
  leadMax: variant.leadTimeDaysMax === null ? '' : String(variant.leadTimeDaysMax),
  usualSupplierId: variant.usualSupplier?.id ?? '',
  sortOrder: String(variant.sortOrder),
  listPrice: '',
  cost: variant.costPriceVnd ?? '',
  isActive: variant.isActive,
});

export type VariantField =
  | 'sku'
  | 'labelVi'
  | 'labelEn'
  | 'barcode'
  | 'threshold'
  | 'leadTime'
  | 'sortOrder'
  | 'listPrice'
  | 'cost';

export const LEAD_DAYS_MAX = 90;

/**
 * A waiting time of whole days: both boxes empty (the settings default) or both filled with 1 to 90 and from <= to. Returns
 * "empty" for no own time, null when invalid, otherwise the pair.
 */
export function parseLeadTime(
  min: string,
  max: string,
): 'empty' | { min: number; max: number } | null {
  if (min.trim() === '' && max.trim() === '') return 'empty';
  const low = wholeNumber(min, LEAD_DAYS_MAX);
  const high = wholeNumber(max, LEAD_DAYS_MAX);
  if (low === null || high === null || low < 1 || high < 1 || low > high) return null;
  return { min: low, max: high };
}

export function validateVariantDraft(
  draft: VariantDraft,
  mode: { creating: boolean; prices: boolean; cost: boolean },
): Partial<Record<VariantField, Issue>> {
  const errors: Partial<Record<VariantField, Issue>> = {};
  if (mode.creating) {
    const sku = draft.sku.trim().toUpperCase();
    if (sku === '') errors.sku = 'required';
    else if (!SKU_PATTERN.test(sku)) errors.sku = 'invalid';
  }
  if (length(clean(draft.labelVi)) > NAME_MAX) errors.labelVi = 'invalid';
  if (length(clean(draft.labelEn)) > NAME_MAX) errors.labelEn = 'invalid';
  if (length(clean(draft.barcode)) > 64) errors.barcode = 'invalid';
  if (draft.threshold.trim() !== '' && wholeNumber(draft.threshold, 2_147_483_647) === null) {
    errors.threshold = 'invalid';
  }
  if (draft.sellOnOrder && parseLeadTime(draft.leadMin, draft.leadMax) === null) {
    errors.leadTime = 'invalid';
  }
  if (wholeNumber(draft.sortOrder, 100_000) === null) errors.sortOrder = 'invalid';
  if (
    mode.creating &&
    mode.prices &&
    draft.listPrice.trim() !== '' &&
    vndAmount(draft.listPrice) === null
  ) {
    errors.listPrice = 'invalid';
  }
  if (mode.cost && draft.cost.trim() !== '' && vndAmount(draft.cost, 0) === null) {
    errors.cost = 'invalid';
  }
  return errors;
}

const optionalText = (text: string): string | null => (clean(text) === '' ? null : clean(text));
const optionalNumber = (text: string): number | null =>
  text.trim() === '' ? null : wholeNumber(text, 2_147_483_647);

/** The waiting-time keys of a request: the pair, or both null to fall back to the settings default. */
function leadTimeKeys(draft: VariantDraft): {
  leadTimeDaysMin: number | null;
  leadTimeDaysMax: number | null;
} {
  // A variant that is not sold on order has no waiting time of its own.
  const lead = draft.sellOnOrder ? parseLeadTime(draft.leadMin, draft.leadMax) : 'empty';
  return lead && lead !== 'empty'
    ? { leadTimeDaysMin: lead.min, leadTimeDaysMax: lead.max }
    : { leadTimeDaysMin: null, leadTimeDaysMax: null };
}

/**
 * A new variant. The list price is sent only to a caller who may price, the cost only to one who may see cost: the API refuses
 * either key from anybody else (403), so the screen never includes them.
 */
export function variantCreateRequest(
  draft: VariantDraft,
  access: ProductAccess,
): ProductVariantCreateRequest | null {
  if (Object.keys(validateVariantDraft(draft, { creating: true, ...access })).length > 0)
    return null;
  const price = access.prices ? vndAmount(draft.listPrice) : null;
  return {
    sku: draft.sku.trim().toUpperCase(),
    labelVi: optionalText(draft.labelVi),
    labelEn: optionalText(draft.labelEn),
    barcode: optionalText(draft.barcode),
    lowStockThreshold: optionalNumber(draft.threshold),
    sellOnOrder: draft.sellOnOrder,
    ...leadTimeKeys(draft),
    ...(draft.usualSupplierId !== '' ? { usualSupplierId: draft.usualSupplierId } : {}),
    sortOrder: wholeNumber(draft.sortOrder, 100_000)!,
    ...(price ? { listPriceVnd: price } : {}),
    ...(access.cost && draft.cost.trim() !== '' ? { costPriceVnd: vndAmount(draft.cost, 0)! } : {}),
  };
}

/**
 * Edits a variant. An unchanged or inaccessible cost is left out of the request (an absent key keeps the stored cost); a cost the
 * caller emptied is sent as null.
 */
export function variantEditRequest(
  draft: VariantDraft,
  variant: ProductVariantResponse,
  access: ProductAccess,
): ProductVariantEditRequest | null {
  if (
    Object.keys(validateVariantDraft(draft, { creating: false, ...access, prices: false })).length >
    0
  ) {
    return null;
  }
  const costChanged = access.cost && clean(draft.cost) !== (variant.costPriceVnd ?? '');
  return {
    expectedRowVersion: variant.rowVersion,
    labelVi: optionalText(draft.labelVi),
    labelEn: optionalText(draft.labelEn),
    barcode: optionalText(draft.barcode),
    lowStockThreshold: optionalNumber(draft.threshold),
    sellOnOrder: draft.sellOnOrder,
    ...leadTimeKeys(draft),
    // Sent only when it changed (an absent key keeps the stored supplier; null clears it).
    ...(draft.usualSupplierId !== (variant.usualSupplier?.id ?? '')
      ? { usualSupplierId: draft.usualSupplierId === '' ? null : draft.usualSupplierId }
      : {}),
    sortOrder: wholeNumber(draft.sortOrder, 100_000)!,
    isActive: draft.isActive,
    ...(costChanged
      ? { costPriceVnd: draft.cost.trim() === '' ? null : vndAmount(draft.cost, 0)! }
      : {}),
  };
}

/** The request that switches a variant on or off and changes nothing else (the cost key is never sent). */
export function variantActiveRequest(
  variant: ProductVariantResponse,
  isActive: boolean,
): ProductVariantEditRequest {
  return {
    expectedRowVersion: variant.rowVersion,
    labelVi: variant.labelVi,
    labelEn: variant.labelEn,
    barcode: variant.barcode,
    lowStockThreshold: variant.lowStockThreshold,
    sortOrder: variant.sortOrder,
    isActive,
  };
}

export const variantName = (variant: ProductVariantResponse, locale: Locale): string => {
  const label =
    locale === 'vi' ? (variant.labelVi ?? variant.labelEn) : (variant.labelEn ?? variant.labelVi);
  return label ? `${variant.sku} · ${label}` : variant.sku;
};

// ---------------------------------------------------------------------------------------------------- price change

export interface PriceDraft {
  price: string;
  reason: string;
}

export function priceIssue(
  draft: PriceDraft,
  variant: ProductVariantResponse,
): Issue | 'same' | undefined {
  const amount = vndAmount(draft.price);
  if (draft.price.trim() === '') return 'required';
  if (amount === null) return 'invalid';
  return amount === variant.listPriceVnd ? 'same' : undefined;
}

export function priceRequest(
  draft: PriceDraft,
  variant: ProductVariantResponse,
): ProductPriceChangeRequest | null {
  if (priceIssue(draft, variant) !== undefined || length(clean(draft.reason)) > 500) return null;
  return {
    expectedVersionNo: variant.priceVersionNo,
    listPriceVnd: vndAmount(draft.price)!,
    reason: optionalText(draft.reason),
  };
}

// ---------------------------------------------------------------------------------------------------- promotion

export interface PromotionDraft {
  price: string;
  startsAt: string;
  endsAt: string;
}

export type PromotionField = 'price' | 'startsAt' | 'endsAt';
export type PromotionIssue = Issue | 'tooHigh' | 'window' | 'noListPrice';

export function validatePromotionDraft(
  draft: PromotionDraft,
  variant: ProductVariantResponse,
  now: Date = new Date(),
): Partial<Record<PromotionField, PromotionIssue>> {
  const errors: Partial<Record<PromotionField, PromotionIssue>> = {};
  const amount = vndAmount(draft.price);
  if (variant.listPriceVnd === null) errors.price = 'noListPrice';
  else if (draft.price.trim() === '') errors.price = 'required';
  else if (amount === null) errors.price = 'invalid';
  else if (BigInt(amount) >= BigInt(variant.listPriceVnd)) errors.price = 'tooHigh';
  const starts = vnLocalToIso(draft.startsAt);
  const ends = vnLocalToIso(draft.endsAt);
  if (!starts) errors.startsAt = draft.startsAt === '' ? 'required' : 'invalid';
  if (!ends) errors.endsAt = draft.endsAt === '' ? 'required' : 'invalid';
  if (starts && ends && (ends <= starts || new Date(ends).getTime() <= now.getTime())) {
    errors.endsAt = 'window';
  }
  return errors;
}

export function promotionRequest(
  draft: PromotionDraft,
  variant: ProductVariantResponse,
  now: Date = new Date(),
): ProductPromotionCreateRequest | null {
  if (Object.keys(validatePromotionDraft(draft, variant, now)).length > 0) return null;
  return {
    promoPriceVnd: vndAmount(draft.price)!,
    startsAt: vnLocalToIso(draft.startsAt)!,
    endsAt: vnLocalToIso(draft.endsAt)!,
  };
}

/** Only a promotion that has not ended can be ended by hand. */
export const canEndPromotion = (promotion: ProductPromotionResponse): boolean =>
  promotion.state !== 'ENDED';

export const promotionTone = (
  state: ProductPromotionResponse['state'],
): 'success' | 'info' | 'neutral' =>
  state === 'ACTIVE' ? 'success' : state === 'SCHEDULED' ? 'info' : 'neutral';

// ------------------------------------------------------------------------------------------------------ images

/** The image ids after moving the image at `index` one place earlier (-1) or later (+1); null when it cannot move. */
export function movedImageIds(
  ids: readonly string[],
  index: number,
  step: -1 | 1,
): string[] | null {
  const target = index + step;
  if (index < 0 || index >= ids.length || target < 0 || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

// ---------------------------------------------------------------------------------------------------- settings

export interface SettingsDraft {
  leadMin: string;
  leadMax: string;
  expiry: string;
  /** The days the "Mới" badge shows after the first publication. */
  badge: string;
}

export type SettingsField = 'lead' | 'expiry' | 'badge';

export const draftFromSettings = (settings: ProductSettingsResponse): SettingsDraft => ({
  leadMin: String(settings.leadTimeDaysMin),
  leadMax: String(settings.leadTimeDaysMax),
  expiry: String(settings.expiryWarningDays),
  badge: String(settings.newBadgeDays),
});

/** Which parts of the settings dialog the caller sees: the waiting time and the "Mới" days (products), the expiry warning (inventory). */
export function validateSettingsDraft(
  draft: SettingsDraft,
  fields: readonly SettingsField[],
): Partial<Record<SettingsField, Issue>> {
  const errors: Partial<Record<SettingsField, Issue>> = {};
  if (fields.includes('lead')) {
    const lead = parseLeadTime(draft.leadMin, draft.leadMax);
    if (lead === null || lead === 'empty') errors.lead = 'invalid';
  }
  if (fields.includes('expiry')) {
    const days = wholeNumber(draft.expiry, EXPIRY_DAYS_MAX);
    if (days === null || days < 1) errors.expiry = 'invalid';
  }
  if (fields.includes('badge')) {
    const days = wholeNumber(draft.badge, NEW_BADGE_DAYS_MAX);
    if (days === null || days < 1) errors.badge = 'invalid';
  }
  return errors;
}

export const EXPIRY_DAYS_MAX = 730;
export const NEW_BADGE_DAYS_MAX = 365;

/** Only the keys that changed (the API changes only the keys present); null when nothing changed or the draft is invalid. */
export function settingsRequest(
  draft: SettingsDraft,
  settings: ProductSettingsResponse,
  fields: readonly SettingsField[],
): ProductSettingsEditRequest | null {
  if (Object.keys(validateSettingsDraft(draft, fields)).length > 0) return null;
  const request: ProductSettingsEditRequest = { expectedRowVersion: settings.rowVersion };
  if (fields.includes('lead')) {
    const lead = parseLeadTime(draft.leadMin, draft.leadMax);
    if (
      lead &&
      lead !== 'empty' &&
      (lead.min !== settings.leadTimeDaysMin || lead.max !== settings.leadTimeDaysMax)
    ) {
      request.leadTimeDaysMin = lead.min;
      request.leadTimeDaysMax = lead.max;
    }
  }
  if (fields.includes('expiry')) {
    const days = wholeNumber(draft.expiry, EXPIRY_DAYS_MAX);
    if (days !== null && days !== settings.expiryWarningDays) request.expiryWarningDays = days;
  }
  if (fields.includes('badge')) {
    const days = wholeNumber(draft.badge, NEW_BADGE_DAYS_MAX);
    if (days !== null && days !== settings.newBadgeDays) request.newBadgeDays = days;
  }
  return Object.keys(request).length > 1 ? request : null;
}

/** The waiting time a variant shows: its own range, else the settings default, always as "from-to days" (a single day when equal). */
export function leadTimeRange(
  variant: Pick<ProductVariantResponse, 'leadTimeDaysMin' | 'leadTimeDaysMax'>,
  settings: Pick<ProductSettingsResponse, 'leadTimeDaysMin' | 'leadTimeDaysMax'> | null,
): { min: number; max: number } | null {
  if (variant.leadTimeDaysMin !== null && variant.leadTimeDaysMax !== null) {
    return { min: variant.leadTimeDaysMin, max: variant.leadTimeDaysMax };
  }
  return settings ? { min: settings.leadTimeDaysMin, max: settings.leadTimeDaysMax } : null;
}

// ------------------------------------------------------------------------------------------------------ errors

/** The field a failed request names ("sku", "barcode"...), or null. */
export const failedField = (error: unknown): string | null =>
  error instanceof ApiError ? error.field : null;

/** The text of a failed catalog command: its own texts first (a taken SKU or barcode, the P6-3 codes), then the shared ones. */
export function productErrorText(
  error: unknown,
  locale: Locale,
  fallback: (error: unknown) => string,
): string {
  if (error instanceof ApiError) {
    const texts = productDictionary(locale).errors as Record<string, string>;
    if (error.code === 'CONFLICT') {
      if (error.field === 'sku' || error.field === 'barcode') return texts[error.field] as string;
      return texts['conflict'] as string;
    }
    if (error.code in texts) return texts[error.code] as string;
  }
  return fallback(error);
}

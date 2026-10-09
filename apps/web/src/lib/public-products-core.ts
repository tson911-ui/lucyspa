import {
  PUBLIC_PRODUCT_SORTS,
  PUBLIC_PRODUCTS_PAGE_SIZE,
  type PublicCampaign,
  type PublicCampaignsResponse,
  type PublicProductCard,
  type PublicProductCodesResponse,
  type PublicProductDetail,
  type PublicProductDetailResponse,
  type PublicProductPrice,
  type PublicProductsCommitment,
  type PublicProductsHero,
  type PublicProductsResponse,
  type PublicProductSort,
  type PublicProductStock,
  type PublicProductVariant,
  type PublicSlideImage,
} from '@lucy-spa/contracts';
import type { Locale } from '../i18n/locales';
import { fill } from './fill';

// The cosmetics catalog as the public site reads it (Phase 6 P6-6, design 11.1 and 16): the address bar's state, the checks of
// what the API answered (a malformed answer is "could not be read", never a broken page), and the wording of prices and stock.
// Pure, so every rule is unit-tested.

export { PUBLIC_PRODUCTS_PAGE_SIZE };

/** The id of the list's heading: where the pager brings the visitor back to. */
export const PRODUCTS_LIST_ID = 'products-list';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isString = (value: unknown): value is string => typeof value === 'string';
const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';
const isBool = (value: unknown): value is boolean => typeof value === 'boolean';
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isMoney = (value: unknown): value is string => isString(value) && /^\d{1,15}$/.test(value);

// ------------------------------------------------------------------------------------------------ address bar

export interface ProductsState {
  q: string;
  category: string;
  brand: string;
  sort: PublicProductSort;
  page: number;
  /** The address name of a campaign (Wave 4 / P6-23): only that campaign's products. Left out of the state when there is none. */
  campaign?: string;
}

export const EMPTY_PRODUCTS_STATE: ProductsState = {
  q: '',
  category: '',
  brand: '',
  sort: 'featured',
  page: 1,
};

type SearchParams = Record<string, string | string[] | undefined>;

const CODE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
/** The address name of a campaign: lower case words joined by hyphens (3 to 60 characters, as the admin enforces). */
const CAMPAIGN_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_QUERY = 80;
const MAX_PAGE = 500;

const first = (value: string | string[] | undefined): string =>
  (Array.isArray(value) ? value[0] : value) ?? '';

/** The state the address bar says, leniently: anything unknown falls back to its default, so a bad link still shows a page. */
export function productsStateOf(params: SearchParams): ProductsState {
  const q = first(params['q'])
    .replace(/\p{Cc}/gu, ' ')
    .trim();
  const category = first(params['category']);
  const brand = first(params['brand']);
  const sort = first(params['sort']);
  const page = Number(first(params['page']));
  const campaign = first(params['campaign']);
  return {
    ...(CAMPAIGN_SLUG.test(campaign) ? { campaign } : {}),
    q: [...q].length > MAX_QUERY ? [...q].slice(0, MAX_QUERY).join('').trim() : q,
    category: CODE.test(category) ? category : '',
    brand: CODE.test(brand) ? brand : '',
    sort: (PUBLIC_PRODUCT_SORTS as readonly string[]).includes(sort)
      ? (sort as PublicProductSort)
      : 'featured',
    page: Number.isInteger(page) && page >= 1 && page <= MAX_PAGE ? page : 1,
  };
}

/** The query string of a state, defaults left out (so the plain list has a plain address). */
export function productsQuery(state: ProductsState): string {
  const query = new URLSearchParams();
  if (state.campaign) query.set('campaign', state.campaign);
  if (state.q !== '') query.set('q', state.q);
  if (state.category !== '') query.set('category', state.category);
  if (state.brand !== '') query.set('brand', state.brand);
  if (state.sort !== 'featured') query.set('sort', state.sort);
  if (state.page > 1) query.set('page', String(state.page));
  const text = query.toString();
  return text === '' ? '' : `?${text}`;
}

export const productsHref = (locale: Locale, state: ProductsState = EMPTY_PRODUCTS_STATE): string =>
  `/${locale}/products${productsQuery(state)}`;

/** A change of filter or search starts again at the first page. */
export const withFilter = (
  state: ProductsState,
  patch: Partial<Omit<ProductsState, 'page'>>,
): ProductsState => ({ ...state, ...patch, page: 1 });

export const productHref = (locale: Locale, code: string): string =>
  `/${locale}/products/${encodeURIComponent(code)}`;

export const isProductCode = (value: string): boolean => CODE.test(value);

/** Filters (not the sort) that narrow the list: drives the "Lọc" count and the reset. */
export const activeFilterCount = (state: ProductsState): number =>
  (state.category !== '' ? 1 : 0) + (state.brand !== '' ? 1 : 0);

export const isPlainList = (state: ProductsState): boolean =>
  state.q === '' &&
  state.category === '' &&
  state.brand === '' &&
  state.page === 1 &&
  !state.campaign;

export function lastPage(total: number): number {
  return Math.max(1, Math.ceil(total / PUBLIC_PRODUCTS_PAGE_SIZE));
}

// ------------------------------------------------------------------------------------------------ parsing

function parseImage(value: unknown): PublicSlideImage | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value['alt']) || !isCount(value['width'])) return undefined;
  if (!isCount(value['height']) || !Array.isArray(value['sources'])) return undefined;
  const sources: { url: string; width: number }[] = [];
  for (const source of value['sources']) {
    // Only same-origin image paths of the public media route are ever drawn.
    if (
      !isRecord(source) ||
      !isString(source['url']) ||
      !/^\/api\/v1\/public\/media\/[0-9a-f-]{36}\/(md|lg)$/i.test(source['url']) ||
      !isCount(source['width'])
    ) {
      return undefined;
    }
    sources.push({ url: source['url'], width: source['width'] });
  }
  return { alt: value['alt'], width: value['width'], height: value['height'], sources };
}

function parseStock(value: unknown): PublicProductStock | null {
  if (!isRecord(value)) return null;
  const { state, leadTimeDaysMin: min, leadTimeDaysMax: max } = value;
  if (state === 'IN_STOCK' || state === 'OUT_OF_STOCK') {
    return { state, leadTimeDaysMin: null, leadTimeDaysMax: null };
  }
  if (state === 'PRE_ORDER' && isCount(min) && isCount(max) && min >= 1 && max >= min) {
    return { state, leadTimeDaysMin: min, leadTimeDaysMax: max };
  }
  return null;
}

function parsePrice(value: unknown): PublicProductPrice | null {
  if (!isRecord(value) || !isMoney(value['priceVnd'])) return null;
  const list = value['listPriceVnd'];
  const percent = value['discountPercent'];
  if (list !== null && !isMoney(list)) return null;
  if (percent !== null && (!isCount(percent) || percent < 1 || percent > 99)) return null;
  const campaign = parseCampaignRef(value['campaign']);
  if (campaign === undefined) return null;
  return {
    priceVnd: value['priceVnd'],
    listPriceVnd: list,
    discountPercent: percent,
    ...(campaign ? { campaign } : {}),
  };
}

/** The campaign that gives a price: absent (null here) for a plain or promotion price, undefined when malformed. */
function parseCampaignRef(value: unknown): PublicProductPrice['campaign'] | null | undefined {
  if (value === undefined || value === null) return null;
  if (!isRecord(value) || !isString(value['slug']) || !isString(value['name'])) return undefined;
  if (!isNullableString(value['badge'])) return undefined;
  return { slug: value['slug'], name: value['name'], badge: value['badge'] };
}

function parseCategoryRef(value: unknown): { code: string; name: string } | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isString(value['code']) || !isString(value['name'])) return undefined;
  return { code: value['code'], name: value['name'] };
}

function parseCard(value: unknown): PublicProductCard | null {
  if (!isRecord(value) || !isString(value['code']) || !isString(value['name'])) return null;
  const category = parseCategoryRef(value['category']);
  const image = parseImage(value['image']);
  const price = parsePrice(value['price']);
  const stock = parseStock(value['stock']);
  if (category === undefined || image === undefined || !price || !stock) return null;
  if (!isNullableString(value['brand']) || !isMoney(value['priceMaxVnd'])) return null;
  if (!isBool(value['isNew']) || !isBool(value['featured'])) return null;
  return {
    code: value['code'],
    name: value['name'],
    category,
    brand: value['brand'],
    image,
    price,
    priceMaxVnd: value['priceMaxVnd'],
    isNew: value['isNew'],
    featured: value['featured'],
    stock,
  };
}

function parseCards(value: unknown): PublicProductCard[] | null {
  if (!Array.isArray(value)) return null;
  const cards: PublicProductCard[] = [];
  for (const item of value) {
    const card = parseCard(item);
    if (!card) return null;
    cards.push(card);
  }
  return cards;
}

function parseHero(value: unknown): PublicProductsHero | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isNullableString(value['title']) || !isNullableString(value['text'])) {
    return undefined;
  }
  const image = parseImage(value['image']);
  return image === undefined ? undefined : { title: value['title'], text: value['text'], image };
}

function parseCommitment(value: unknown): PublicProductsCommitment | null | undefined {
  if (value === null) return null;
  if (!isRecord(value) || !isNullableString(value['title']) || !Array.isArray(value['items'])) {
    return undefined;
  }
  if (!value['items'].every(isString)) return undefined;
  return { title: value['title'], items: value['items'] };
}

export function parsePublicProducts(value: unknown): PublicProductsResponse | null {
  if (!isRecord(value)) return null;
  const hero = parseHero(value['hero']);
  const commitment = parseCommitment(value['commitment']);
  const items = parseCards(value['items']);
  if (hero === undefined || commitment === undefined || !items) return null;
  if (!Array.isArray(value['categories']) || !Array.isArray(value['brands'])) return null;
  if (!isCount(value['page']) || !isCount(value['pageSize']) || !isCount(value['total']))
    return null;
  const categories: PublicProductsResponse['categories'] = [];
  for (const item of value['categories']) {
    if (
      !isRecord(item) ||
      !isString(item['code']) ||
      !isString(item['name']) ||
      !isNullableString(item['parentCode'])
    ) {
      return null;
    }
    categories.push({ code: item['code'], name: item['name'], parentCode: item['parentCode'] });
  }
  const brands: PublicProductsResponse['brands'] = [];
  for (const item of value['brands']) {
    if (!isRecord(item) || !isString(item['code']) || !isString(item['name'])) return null;
    brands.push({ code: item['code'], name: item['name'] });
  }
  return {
    hero,
    commitment,
    categories,
    brands,
    items,
    page: value['page'],
    pageSize: value['pageSize'],
    total: value['total'],
  };
}

function parseVariant(value: unknown): PublicProductVariant | null {
  if (!isRecord(value) || !isNullableString(value['label'])) return null;
  if (!isString(value['id']) || typeof value['sellOnline'] !== 'boolean') return null;
  const price = parsePrice(value['price']);
  const stock = parseStock(value['stock']);
  return price && stock
    ? { id: value['id'], sellOnline: value['sellOnline'], label: value['label'], price, stock }
    : null;
}

function parseDetail(value: unknown): PublicProductDetail | null {
  if (!isRecord(value) || !isString(value['code']) || !isString(value['name'])) return null;
  const category = parseCategoryRef(value['category']);
  const stock = parseStock(value['stock']);
  if (category === undefined || !stock || !Array.isArray(value['images'])) return null;
  if (!Array.isArray(value['variants']) || value['variants'].length === 0) return null;
  if (!isNullableString(value['description']) || !isNullableString(value['brand'])) return null;
  if (!isMoney(value['priceMaxVnd']) || !isBool(value['isNew']) || !isBool(value['featured'])) {
    return null;
  }
  const images: PublicSlideImage[] = [];
  for (const item of value['images']) {
    const image = parseImage(item);
    if (!image) return null;
    images.push(image);
  }
  const variants: PublicProductVariant[] = [];
  for (const item of value['variants']) {
    const variant = parseVariant(item);
    if (!variant) return null;
    variants.push(variant);
  }
  return {
    code: value['code'],
    name: value['name'],
    description: value['description'],
    category,
    brand: value['brand'],
    images,
    variants,
    priceMaxVnd: value['priceMaxVnd'],
    isNew: value['isNew'],
    featured: value['featured'],
    stock,
  };
}

/** The banner of a campaign as a picture the catalog can draw (same-origin public media only); its shape is cropped by the CSS. */
function bannerImage(url: unknown, name: string): PublicSlideImage | null {
  if (!isString(url) || !/^\/api\/v1\/public\/media\/[0-9a-f-]{36}\/(md|lg)$/i.test(url)) {
    return null;
  }
  return { alt: name, width: 1600, height: 1000, sources: [{ url, width: 1600 }] };
}

/** The campaigns running now (GET public/campaigns); a malformed entry is left out, a malformed answer is null. */
export function parsePublicCampaigns(value: unknown): PublicCampaignsResponse | null {
  if (!isRecord(value) || !Array.isArray(value['campaigns'])) return null;
  const campaigns: PublicCampaign[] = [];
  for (const item of value['campaigns']) {
    if (
      !isRecord(item) ||
      !isString(item['slug']) ||
      !CAMPAIGN_SLUG.test(item['slug']) ||
      !isString(item['name']) ||
      !isNullableString(item['badge']) ||
      !isNullableString(item['headline']) ||
      !isNullableString(item['message']) ||
      !isNullableString(item['ctaLabel']) ||
      !isString(item['endsAt']) ||
      Number.isNaN(Date.parse(item['endsAt']))
    ) {
      continue;
    }
    campaigns.push({
      slug: item['slug'],
      name: item['name'],
      badge: item['badge'],
      headline: item['headline'],
      message: item['message'],
      ctaLabel: item['ctaLabel'],
      bannerUrl: bannerImage(item['bannerUrl'], item['name'])
        ? (item['bannerUrl'] as string)
        : null,
      endsAt: item['endsAt'],
    });
  }
  return { campaigns };
}

/** The campaign's banner as a catalog picture, or null when it has none. */
export const campaignBanner = (campaign: Pick<PublicCampaign, 'bannerUrl' | 'name'>) =>
  bannerImage(campaign.bannerUrl, campaign.name);

/** The address of a campaign's sale view (the catalog filtered by it). */
export const campaignHref = (locale: Locale, slug: string): string =>
  productsHref(locale, { ...EMPTY_PRODUCTS_STATE, campaign: slug });

/** The one badge a price shows: the campaign's own words when it has some, else the percent ("-15%"), else nothing. */
export const priceBadgeText = (price: PublicProductPrice): string | null =>
  price.campaign?.badge?.trim() || discountText(price);

/** Running campaigns for the strips of the plain list: at most two, most recent first (the API's order). */
export const stripCampaigns = (campaigns: readonly PublicCampaign[] | null | undefined) =>
  (campaigns ?? []).slice(0, 2);

/** The running campaign a state asks for, or null (no campaign asked, unknown or ended: the list then shows its normal words). */
export const activeCampaign = (
  campaigns: readonly PublicCampaign[] | null | undefined,
  state: Pick<ProductsState, 'campaign'>,
): PublicCampaign | null =>
  state.campaign
    ? ((campaigns ?? []).find((entry) => entry.slug === state.campaign) ?? null)
    : null;

/** "31/10/2026" in the shop's time zone (the visitor reads the day the sale ends there). */
export function campaignEndText(endsAt: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'Asia/Ho_Chi_Minh',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(endsAt));
}

export function parseProductDetail(value: unknown): PublicProductDetailResponse | null {
  if (!isRecord(value)) return null;
  const product = parseDetail(value['product']);
  const commitment = parseCommitment(value['commitment']);
  const related = parseCards(value['related']);
  if (!product || commitment === undefined || !related) return null;
  return { product, commitment, related };
}

export function parseProductCodes(value: unknown): PublicProductCodesResponse | null {
  if (!isRecord(value) || !Array.isArray(value['codes'])) return null;
  const codes = value['codes'].filter((code): code is string => isString(code) && CODE.test(code));
  return { codes };
}

// ------------------------------------------------------------------------------------------------ wording

const format = (value: string, locale: Locale): string =>
  `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(BigInt(value))} ₫`;

export const moneyText = format;

/** "329.000 ₫", or "từ 329.000 ₫" when the product's variants differ in price. */
export function cardPriceText(
  card: Pick<PublicProductCard, 'price' | 'priceMaxVnd'>,
  locale: Locale,
): string {
  const price = format(card.price.priceVnd, locale);
  if (card.priceMaxVnd === card.price.priceVnd) return price;
  return locale === 'vi' ? `từ ${price}` : `from ${price}`;
}

/** "-15%" (the percent is display only; the struck list price is the fact). */
export const discountText = (price: PublicProductPrice): string | null =>
  price.discountPercent === null ? null : `-${price.discountPercent}%`;

export interface StockTexts {
  outOfStock: string;
  /** With {days}: "Đặt trước, dự kiến {days} ngày". */
  preOrder: string;
}

/** The days of a pre-order, "3–5" or a single "3". */
export const leadDays = (
  stock: Pick<PublicProductStock, 'leadTimeDaysMin' | 'leadTimeDaysMax'>,
): string =>
  stock.leadTimeDaysMin === stock.leadTimeDaysMax
    ? String(stock.leadTimeDaysMin)
    : `${stock.leadTimeDaysMin}–${stock.leadTimeDaysMax}`;

/** The one line a visitor reads about availability, or null when the product is in stock (nothing is said). Never a number of items. */
export function stockLabel(stock: PublicProductStock, texts: StockTexts): string | null {
  if (stock.state === 'IN_STOCK') return null;
  if (stock.state === 'OUT_OF_STOCK') return texts.outOfStock;
  return fill(texts.preOrder, { days: leadDays(stock) });
}

// ------------------------------------------------------------------------------------------------ data for search engines

const AVAILABILITY = {
  IN_STOCK: 'https://schema.org/InStock',
  PRE_ORDER: 'https://schema.org/PreOrder',
  OUT_OF_STOCK: 'https://schema.org/OutOfStock',
} as const;

/** schema.org `Product` with one `Offer` per variant: price in VND and availability (never a quantity). */
export function productJsonLd(
  product: PublicProductDetail,
  options: { url: string; images: readonly string[] },
) {
  const offers = product.variants.map((variant) => ({
    '@type': 'Offer',
    priceCurrency: 'VND',
    price: variant.price.priceVnd,
    availability: AVAILABILITY[variant.stock.state],
    url: options.url,
    ...(variant.label ? { name: variant.label } : {}),
  }));
  return {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: product.name,
    url: options.url,
    ...(product.description ? { description: product.description } : {}),
    ...(product.brand ? { brand: { '@type': 'Brand', name: product.brand } } : {}),
    ...(product.category ? { category: product.category.name } : {}),
    ...(options.images.length > 0 ? { image: [...options.images] } : {}),
    offers: offers.length === 1 ? offers[0] : offers,
  };
}

import { HttpFetchError, type HttpClient } from './http-client.js';
import { hashOf, htmlToPlainText, plainLine } from './text.js';

/**
 * Phase 9 P9-3: the `woocommerce-store-api` adapter (design section 16). It reads the public WooCommerce Store API
 * (`/wp-json/wc/store/v1/products`) of one source and turns each product into a normalized, plain-text `SourceProductRecord`.
 *
 * Everything the site sends is untrusted: the shape is checked field by field, text is reduced to plain text, a link or an image
 * outside the source's own host is dropped with a problem, and one broken product never breaks the page. A product is identified by
 * its WooCommerce id (`sourceKey`), never by name or SKU, and its images come only from its own record (`images[]`). Stock
 * (`is_in_stock`, quantities) is deliberately not read: stock enters Lucy only through receipts.
 */

export const STORE_API_ADAPTER_KEY = 'woocommerce-store-api';
export const MAX_IMAGES_KEPT = 20;

export type SourceFailureCode =
  | 'AUTHENTICATION_REQUIRED'
  | 'CHALLENGE_PAGE'
  | 'API_NOT_FOUND'
  | 'NOT_JSON'
  | 'UNEXPECTED_SHAPE'
  | 'UNEXPECTED_STATUS'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'ROBOTS_DISALLOWED'
  | 'ROBOTS_UNAVAILABLE'
  | 'CONNECTION';

/** The source status a failure leads to (design 3: ADAPTER_REQUIRED / AUTHENTICATION_REQUIRED / SOURCE_ERROR). */
export type FailureStatus = 'ADAPTER_REQUIRED' | 'AUTHENTICATION_REQUIRED' | 'SOURCE_ERROR';

export class SourceReadError extends Error {
  constructor(
    readonly code: SourceFailureCode,
    readonly status: FailureStatus,
    readonly detail?: string,
  ) {
    super(code);
    this.name = 'SourceReadError';
  }
}

export interface RecordProblem {
  code:
    | 'INVALID_PRODUCT'
    | 'NAME_MISSING'
    | 'URL_MISSING'
    | 'URL_OFF_HOST'
    | 'PRICE_MISSING'
    | 'PRICE_INVALID'
    | 'CURRENCY_NOT_VND'
    | 'PRICE_NOT_WHOLE_VND'
    | 'IMAGE_MISSING'
    | 'IMAGE_OFF_HOST'
    | 'SKU_MISSING'
    | 'SKU_TOO_LONG'
    | 'CATEGORY_MISSING'
    | 'DESCRIPTION_EMPTY'
    | 'DUPLICATE_KEY';
  /** Fatal problems make the record unusable; the others are warnings for the review. */
  fatal: boolean;
  detail?: string;
}

export interface SourceImage {
  url: string;
  alt: string | null;
}

export interface SourceAttribute {
  name: string;
  values: string[];
}

export interface SourceVariationRef {
  /** WooCommerce id of the variation (its own record carries its own images). */
  key: string;
  attributes: { name: string; value: string }[];
}

/** One supplier product, normalized. Prices are reference data only (never the selling price, never the cost). */
export interface SourceProductRecord {
  /** The WooCommerce product id as text. */
  sourceKey: string;
  type: string;
  /** The parent product id for a variation record. */
  parentKey: string | null;
  name: string;
  slug: string | null;
  url: string;
  sku: string | null;
  brandText: string | null;
  /** Category names as the site lists them (a flat list: the Store API gives no parent links). */
  categoryNames: string[];
  descriptionText: string | null;
  shortDescriptionText: string | null;
  attributes: SourceAttribute[];
  /** Whole VND, or null when the site gave no usable VND price. */
  priceVnd: number | null;
  /** The sale price when it is lower than the regular price. */
  promoPriceVnd: number | null;
  currency: string;
  /** The amounts exactly as the site sent them (minor units), kept when the price is not plain VND. */
  originalPrice: { regular: string | null; sale: string | null; minorUnit: number | null } | null;
  /** In the site's order; only this product's own `images[]`. */
  images: SourceImage[];
  variations: SourceVariationRef[];
  contentHash: string;
  priceHash: string;
  imagesHash: string;
}

export interface NormalizedProduct {
  /** The id the site gave, when there was one (also for a record that is unusable). */
  key: string | null;
  record: SourceProductRecord | null;
  problems: RecordProblem[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === 'string' ? value : null);

function onHost(raw: string, host: string): URL | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' &&
      url.username === '' &&
      url.password === '' &&
      url.port === '' &&
      url.hostname.toLowerCase() === host
      ? url
      : null;
  } catch {
    return null;
  }
}

/** Minor units to whole amount. Returns null when the text is not a plain non-negative integer. */
function minorToAmount(
  value: unknown,
  minorUnit: number,
): { whole: number | null; valid: boolean } {
  if (value === '' || value === null || value === undefined) return { whole: null, valid: true };
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) return { whole: null, valid: false };
  const minor = Number(value);
  const divisor = 10 ** minorUnit;
  const whole = minor / divisor;
  return Number.isSafeInteger(whole) && minor % divisor === 0
    ? { whole, valid: true }
    : { whole: null, valid: false };
}

export function normalizeStoreProduct(raw: unknown, sourceHost: string): NormalizedProduct {
  const host = sourceHost.toLowerCase();
  const problems: RecordProblem[] = [];
  if (!isObject(raw) || !Number.isSafeInteger(raw['id']) || (raw['id'] as number) <= 0) {
    problems.push({ code: 'INVALID_PRODUCT', fatal: true });
    return { key: null, record: null, problems };
  }
  const key = String(raw['id']);
  const name = plainLine(text(raw['name']) ?? '');
  if (name === '') problems.push({ code: 'NAME_MISSING', fatal: true });

  const permalink = text(raw['permalink']);
  const link = permalink === null ? null : onHost(permalink, host);
  if (permalink === null || permalink === '') problems.push({ code: 'URL_MISSING', fatal: true });
  else if (link === null) problems.push({ code: 'URL_OFF_HOST', fatal: true });

  let sku = (text(raw['sku']) ?? '').normalize('NFC').trim();
  if (sku.length > 100) {
    problems.push({ code: 'SKU_TOO_LONG', fatal: false });
    sku = '';
  }
  if (sku === '') problems.push({ code: 'SKU_MISSING', fatal: false });

  // Prices: the Store API sends strings in minor units with the currency's minor unit (VND: 0).
  const prices = isObject(raw['prices']) ? raw['prices'] : null;
  const currency = (text(prices?.['currency_code']) ?? 'VND').toUpperCase().slice(0, 3);
  const minorUnit =
    typeof prices?.['currency_minor_unit'] === 'number' &&
    Number.isInteger(prices['currency_minor_unit']) &&
    prices['currency_minor_unit'] >= 0 &&
    prices['currency_minor_unit'] <= 4
      ? prices['currency_minor_unit']
      : null;
  let priceVnd: number | null = null;
  let promoPriceVnd: number | null = null;
  let originalPrice: SourceProductRecord['originalPrice'] = null;
  if (prices === null) {
    problems.push({ code: 'PRICE_MISSING', fatal: false });
  } else {
    const regularText = text(prices['regular_price']) ?? text(prices['price']);
    const saleText = text(prices['sale_price']);
    if (currency !== 'VND' || minorUnit === null) {
      problems.push({
        code: currency === 'VND' ? 'PRICE_INVALID' : 'CURRENCY_NOT_VND',
        fatal: false,
      });
      originalPrice = { regular: regularText, sale: saleText, minorUnit };
    } else {
      const regular = minorToAmount(regularText, minorUnit);
      const sale = minorToAmount(saleText, minorUnit);
      if (!regular.valid || !sale.valid) {
        problems.push({
          code: minorUnit > 0 ? 'PRICE_NOT_WHOLE_VND' : 'PRICE_INVALID',
          fatal: false,
        });
        originalPrice = { regular: regularText, sale: saleText, minorUnit };
      } else if (regular.whole === null || regular.whole <= 0) {
        problems.push({ code: 'PRICE_MISSING', fatal: false });
      } else {
        priceVnd = regular.whole;
        if (sale.whole !== null && sale.whole > 0 && sale.whole < regular.whole) {
          promoPriceVnd = sale.whole;
        }
      }
    }
  }

  const images: SourceImage[] = [];
  const rawImages = Array.isArray(raw['images']) ? raw['images'] : [];
  let offHost = 0;
  for (const entry of rawImages.slice(0, MAX_IMAGES_KEPT)) {
    const src = isObject(entry) ? text(entry['src']) : null;
    const url = src === null ? null : onHost(src, host);
    if (url === null) {
      offHost += 1;
      continue;
    }
    if (images.some((image) => image.url === url.toString())) continue;
    const alt = isObject(entry) ? plainLine(text(entry['alt']) ?? '', 200) : '';
    images.push({ url: url.toString(), alt: alt === '' ? null : alt });
  }
  if (offHost > 0) problems.push({ code: 'IMAGE_OFF_HOST', fatal: false, detail: String(offHost) });
  if (images.length === 0) problems.push({ code: 'IMAGE_MISSING', fatal: false });

  const categoryNames = (Array.isArray(raw['categories']) ? raw['categories'] : [])
    .map((entry) => (isObject(entry) ? plainLine(text(entry['name']) ?? '', 200) : ''))
    .filter((entry) => entry !== '')
    .slice(0, 20);
  if (categoryNames.length === 0) problems.push({ code: 'CATEGORY_MISSING', fatal: false });

  const brandNames = (Array.isArray(raw['brands']) ? raw['brands'] : [])
    .map((entry) => (isObject(entry) ? plainLine(text(entry['name']) ?? '', 200) : ''))
    .filter((entry) => entry !== '');
  const brandText = brandNames[0] ?? null;

  const description = htmlToPlainText(text(raw['description']) ?? '');
  const shortDescription = htmlToPlainText(text(raw['short_description']) ?? '', 2000);
  if (description === '' && shortDescription === '') {
    problems.push({ code: 'DESCRIPTION_EMPTY', fatal: false });
  }

  const attributes: SourceAttribute[] = (Array.isArray(raw['attributes']) ? raw['attributes'] : [])
    .filter(isObject)
    .map((entry) => ({
      name: plainLine(text(entry['name']) ?? '', 100),
      values: (Array.isArray(entry['terms']) ? entry['terms'] : [])
        .map((term) => (isObject(term) ? plainLine(text(term['name']) ?? '', 100) : ''))
        .filter((value) => value !== '')
        .slice(0, 50),
    }))
    .filter((entry) => entry.name !== '')
    .slice(0, 30);

  const variations: SourceVariationRef[] = [];
  for (const entry of Array.isArray(raw['variations']) ? raw['variations'] : []) {
    if (!isObject(entry) || !Number.isSafeInteger(entry['id']) || (entry['id'] as number) <= 0)
      continue;
    variations.push({
      key: String(entry['id']),
      attributes: (Array.isArray(entry['attributes']) ? entry['attributes'] : [])
        .filter(isObject)
        .map((attribute) => ({
          name: plainLine(text(attribute['name']) ?? '', 100),
          value: plainLine(text(attribute['value']) ?? '', 100),
        }))
        .slice(0, 10),
    });
    if (variations.length >= 100) break;
  }

  const type = (text(raw['type']) ?? 'simple').toLowerCase().slice(0, 30);
  const parent =
    Number.isSafeInteger(raw['parent']) && (raw['parent'] as number) > 0
      ? String(raw['parent'])
      : null;

  if (problems.some((problem) => problem.fatal)) return { key, record: null, problems };

  const slug = (text(raw['slug']) ?? '').trim().slice(0, 200);
  const record: SourceProductRecord = {
    sourceKey: key,
    type,
    parentKey: type === 'variation' ? parent : null,
    name: name.slice(0, 300),
    slug: slug === '' ? null : slug,
    url: (link as URL).toString(),
    sku: sku === '' ? null : sku,
    brandText,
    categoryNames,
    descriptionText: description === '' ? null : description,
    shortDescriptionText: shortDescription === '' ? null : shortDescription,
    attributes,
    priceVnd,
    promoPriceVnd,
    currency,
    originalPrice,
    images,
    variations,
    contentHash: '',
    priceHash: '',
    imagesHash: '',
  };
  record.contentHash = hashOf({
    type: record.type,
    name: record.name,
    sku: record.sku,
    brandText: record.brandText,
    categoryNames: record.categoryNames,
    descriptionText: record.descriptionText,
    shortDescriptionText: record.shortDescriptionText,
    attributes: record.attributes,
    variations: record.variations,
  });
  record.priceHash = hashOf({
    priceVnd: record.priceVnd,
    promoPriceVnd: record.promoPriceVnd,
    currency: record.currency,
    originalPrice: record.originalPrice,
  });
  record.imagesHash = hashOf(record.images.map((image) => image.url));
  return { key, record, problems };
}

// ------------------------------------------------------------------------------------------------------- reading the API

const CHALLENGE =
  /(just a moment|cf-challenge|captcha|attention required|access denied|ddos protection)/i;

function parseJson(
  status: number,
  headers: Record<string, string>,
  body: Buffer,
): { json: unknown } {
  if (status === 401 || status === 403 || status === 407) {
    throw new SourceReadError('AUTHENTICATION_REQUIRED', 'AUTHENTICATION_REQUIRED', String(status));
  }
  if (status === 404 || status === 410) {
    throw new SourceReadError('API_NOT_FOUND', 'ADAPTER_REQUIRED', String(status));
  }
  if (status === 429) throw new SourceReadError('RATE_LIMITED', 'SOURCE_ERROR', '429');
  if (status >= 500) throw new SourceReadError('SERVER_ERROR', 'SOURCE_ERROR', String(status));
  if (status < 200 || status >= 300) {
    throw new SourceReadError('UNEXPECTED_STATUS', 'ADAPTER_REQUIRED', String(status));
  }
  const raw = body.toString('utf8');
  try {
    return { json: JSON.parse(raw) as unknown };
  } catch {
    const type = headers['content-type'] ?? '';
    if (CHALLENGE.test(raw.slice(0, 4000))) {
      throw new SourceReadError('CHALLENGE_PAGE', 'AUTHENTICATION_REQUIRED', type.slice(0, 80));
    }
    throw new SourceReadError('NOT_JSON', 'ADAPTER_REQUIRED', type.slice(0, 80));
  }
}

/** Turns a transport failure into the typed error the screens and the status mapping understand. */
export function asSourceError(error: unknown): SourceReadError {
  if (error instanceof SourceReadError) return error;
  if (error instanceof HttpFetchError) {
    return new SourceReadError('CONNECTION', 'SOURCE_ERROR', error.code);
  }
  return new SourceReadError('CONNECTION', 'SOURCE_ERROR', 'UNKNOWN');
}

export interface ProductPage {
  records: SourceProductRecord[];
  /** Problems per product id (also for products that could not be used), in page order. */
  problems: { key: string | null; problems: RecordProblem[] }[];
  /** `X-WP-Total`: how many products the site says it has. */
  total: number | null;
  totalPages: number | null;
  /** Ids in the order the site returned them (usable or not). */
  keys: (string | null)[];
}

function toCount(value: string | undefined): number | null {
  if (value === undefined || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}

export function createStoreApiAdapter(client: HttpClient, baseUrl: string) {
  const base = new URL(baseUrl);
  const host = base.hostname.toLowerCase();
  const root = new URL(
    'wp-json/wc/store/v1/',
    base.href.endsWith('/') ? base.href : `${base.href}/`,
  );

  async function getJson(path: string, query: Record<string, string>) {
    const url = new URL(path, root);
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    let response;
    try {
      response = await client.get(url.toString(), { accept: 'application/json' });
    } catch (error) {
      throw asSourceError(error);
    }
    const { json } = parseJson(response.status, response.headers, response.body);
    return { json, headers: response.headers };
  }

  function page(json: unknown, headers: Record<string, string>): ProductPage {
    if (!Array.isArray(json)) throw new SourceReadError('UNEXPECTED_SHAPE', 'ADAPTER_REQUIRED');
    const records: SourceProductRecord[] = [];
    const problems: ProductPage['problems'] = [];
    const keys: (string | null)[] = [];
    const seen = new Set<string>();
    for (const item of json) {
      const normalized = normalizeStoreProduct(item, host);
      keys.push(normalized.key);
      if (normalized.key !== null && seen.has(normalized.key)) {
        problems.push({
          key: normalized.key,
          problems: [{ code: 'DUPLICATE_KEY', fatal: true }],
        });
        continue;
      }
      if (normalized.key !== null) seen.add(normalized.key);
      problems.push({ key: normalized.key, problems: normalized.problems });
      if (normalized.record) records.push(normalized.record);
    }
    return {
      records,
      problems,
      total: toCount(headers['x-wp-total']),
      totalPages: toCount(headers['x-wp-totalpages']),
      keys,
    };
  }

  return {
    /** One page of the product list, in id order (stable between scans). */
    async listPage(pageNumber: number, perPage: number): Promise<ProductPage> {
      const { json, headers } = await getJson('products', {
        page: String(pageNumber),
        per_page: String(perPage),
        orderby: 'id',
        order: 'asc',
      });
      return page(json, headers);
    },

    /**
     * Re-reads specific products by id (`include`). Used to check, at download time, that an image still belongs to the product
     * that listed it. A product the site no longer returns is simply absent from `records`; an id that comes back but was not
     * asked for is ignored (never trusted).
     */
    async fetchProducts(keys: readonly string[]): Promise<ProductPage> {
      const wanted = new Set(keys);
      const { json, headers } = await getJson('products', {
        include: keys.join(','),
        per_page: String(Math.min(100, Math.max(1, keys.length))),
        orderby: 'id',
        order: 'asc',
      });
      const result = page(json, headers);
      return {
        ...result,
        records: result.records.filter((record) => wanted.has(record.sourceKey)),
      };
    },

    /** One product or variation by its own id. The answer must carry that same id, otherwise it is an error. */
    async fetchProduct(key: string): Promise<SourceProductRecord | null> {
      const { json } = await getJson(`products/${encodeURIComponent(key)}`, {});
      if (!isObject(json) || String(json['id']) !== key) {
        throw new SourceReadError('UNEXPECTED_SHAPE', 'ADAPTER_REQUIRED');
      }
      return normalizeStoreProduct(json, host).record;
    },
  };
}

export type StoreApiAdapter = ReturnType<typeof createStoreApiAdapter>;

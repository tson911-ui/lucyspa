import type { ProductImportIssue } from '@lucy-spa/contracts';
import { normalizeHeader } from '@lucy-spa/server';
import { AuthError } from '../auth/auth.error.js';
import * as input from '../products/product-catalog.input.js';

/**
 * Phase 6 P6-5: the cells of one import row read into typed values, with the problems as language-neutral codes. Pure: no database.
 * The rules are the ones the catalog and the inventory already enforce (the same parsers), so an imported value can never be one a
 * person could not type in the admin screens.
 */

export type Issues = ProductImportIssue[];

const flagYes = new Set(['co', 'yes', 'y', 'true', '1', 'x', 'dung']);
const flagNo = new Set(['khong', 'no', 'n', 'false', '0', 'sai']);

/** `undefined`: the cell is blank. `null`: it says something that is neither yes nor no. */
export function parseFlag(text: string): boolean | null | undefined {
  if (text === '') return undefined;
  const word = normalizeHeader(text);
  if (flagYes.has(word)) return true;
  if (flagNo.has(word)) return false;
  return null;
}

/** Whole VND: "150000", "150.000", "150,000 ₫", "150000.0". Never a fraction. `null` when it is not an amount. */
export function parseMoney(text: string): bigint | null {
  const bare = text.replace(/\s+/g, '').replace(/(?:₫|đ|vnd|vnđ)$/i, '');
  if (/^\d{1,18}$/.test(bare)) return BigInt(bare);
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(bare) && bare.length <= 24)
    return BigInt(bare.replace(/[.,]/g, ''));
  if (/^\d{1,18}\.0+$/.test(bare)) return BigInt(bare.split('.')[0]!);
  return null;
}

/** A whole number from 0 up to 7 digits (the cell as Excel or a person writes it). `null` when it is not one. */
export function parseCount(text: string): number | null {
  const bare = text.replace(/\s+/g, '');
  if (/^\d{1,7}$/.test(bare)) return Number(bare);
  if (/^\d{1,7}\.0+$/.test(bare)) return Number(bare.split('.')[0]);
  return null;
}

/** `YYYY-MM-DD`, `D/M/YYYY` or `D-M-YYYY` as an ISO date; `null` when it is not a real calendar day. */
export function parseDay(text: string): string | null {
  let year: number;
  let month: number;
  let day: number;
  let found = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (found) {
    [year, month, day] = [Number(found[1]), Number(found[2]), Number(found[3])] as [
      number,
      number,
      number,
    ];
  } else {
    found = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!found) return null;
    [day, month, year] = [Number(found[1]), Number(found[2]), Number(found[3])] as [
      number,
      number,
      number,
    ];
  }
  const moment = new Date(Date.UTC(year, month - 1, day));
  if (
    moment.getUTCFullYear() !== year ||
    moment.getUTCMonth() !== month - 1 ||
    moment.getUTCDate() !== day ||
    year < 1900 ||
    year > 2200
  ) {
    return null;
  }
  return moment.toISOString().slice(0, 10);
}

/** Runs one of the catalog's own parsers; a refusal becomes the row's issue and the value stays undefined. */
function attempt<T>(
  issues: Issues,
  code: ProductImportIssue['code'],
  field: string,
  work: () => T,
): T | undefined {
  try {
    return work();
  } catch (error) {
    if (error instanceof AuthError) {
      issues.push({ code, field });
      return undefined;
    }
    throw error;
  }
}

export interface CatalogRowValues {
  sku: string | null;
  productKey: string | null;
  nameVi?: string;
  nameEn?: string;
  descriptionVi?: string;
  descriptionEn?: string;
  /** The text of the brand and category cells, resolved against the catalog by the planner. */
  brand?: string;
  category?: string;
  featured?: boolean;
  labelVi?: string;
  labelEn?: string;
  barcode?: string;
  lowStockThreshold?: number;
  sellOnOrder?: boolean;
  leadTimeDaysMin?: number;
  leadTimeDaysMax?: number;
  price?: bigint;
  cost?: bigint;
}

export interface Access {
  prices: boolean;
  cost: boolean;
}

/** Every column is optional except the SKU. A blank cell is "not given": never an error and never a deletion. */
export function parseCatalogRow(
  cells: Record<string, string>,
  access: Access,
): { values: CatalogRowValues; issues: Issues } {
  const issues: Issues = [];
  const cell = (key: string) => (cells[key] ?? '').trim();
  const values: CatalogRowValues = { sku: null, productKey: null };

  if (cell('sku') === '') issues.push({ code: 'SKU_REQUIRED', field: 'sku' });
  else {
    values.sku = attempt(issues, 'SKU_INVALID', 'sku', () => input.sku(cell('sku'))) ?? null;
  }
  const group = cell('product_key');
  if (group !== '') {
    if (group.length > 64) issues.push({ code: 'TEXT_INVALID', field: 'product_key' });
    else values.productKey = group.normalize('NFC').toUpperCase();
  }

  const text = (
    key: string,
    code: ProductImportIssue['code'],
    parse: (value: string) => unknown,
  ): string | undefined => {
    if (cell(key) === '') return undefined;
    const done = attempt(issues, code, key, () => parse(cell(key)));
    return done === undefined ? undefined : (done as string);
  };
  const nameVi = text('name_vi', 'NAME_INVALID', (v) => input.name(v, 'name_vi'));
  const nameEn = text('name_en', 'NAME_INVALID', (v) => input.name(v, 'name_en'));
  const descriptionVi = text('description_vi', 'TEXT_INVALID', (v) =>
    input.description(v, 'description_vi'),
  );
  const descriptionEn = text('description_en', 'TEXT_INVALID', (v) =>
    input.description(v, 'description_en'),
  );
  const labelVi = text('label_vi', 'TEXT_INVALID', (v) => input.label(v, 'label_vi'));
  const labelEn = text('label_en', 'TEXT_INVALID', (v) => input.label(v, 'label_en'));
  const barcode = text('barcode', 'BARCODE_INVALID', (v) => input.barcode(v));
  if (nameVi !== undefined) values.nameVi = nameVi;
  if (nameEn !== undefined) values.nameEn = nameEn;
  if (descriptionVi !== undefined) values.descriptionVi = descriptionVi;
  if (descriptionEn !== undefined) values.descriptionEn = descriptionEn;
  if (labelVi !== undefined) values.labelVi = labelVi;
  if (labelEn !== undefined) values.labelEn = labelEn;
  if (barcode !== undefined) values.barcode = barcode;
  if (cell('brand') !== '') values.brand = cell('brand');
  if (cell('category') !== '') values.category = cell('category');

  const featured = parseFlag(cell('featured'));
  if (featured === null) issues.push({ code: 'FEATURED_INVALID', field: 'featured' });
  else if (featured !== undefined) values.featured = featured;

  if (cell('low_stock_threshold') !== '') {
    const count = parseCount(cell('low_stock_threshold'));
    if (count === null || count > input.PRODUCT_LIMITS.maxThreshold) {
      issues.push({ code: 'THRESHOLD_INVALID', field: 'low_stock_threshold' });
    } else values.lowStockThreshold = count;
  }

  const onOrder = parseFlag(cell('sell_on_order'));
  if (onOrder === null) issues.push({ code: 'SELL_ON_ORDER_INVALID', field: 'sell_on_order' });
  else if (onOrder !== undefined) values.sellOnOrder = onOrder;

  const min = cell('lead_time_min');
  const max = cell('lead_time_max');
  if (min !== '' || max !== '') {
    const low = min === '' ? null : parseCount(min);
    const high = max === '' ? null : parseCount(max);
    if (min === '' || max === '') {
      issues.push({
        code: 'LEAD_TIME_INVALID',
        field: min === '' ? 'lead_time_min' : 'lead_time_max',
      });
    } else if (low === null || low < 1 || low > 90) {
      issues.push({ code: 'LEAD_TIME_INVALID', field: 'lead_time_min' });
    } else if (high === null || high < 1 || high > 90 || high < low) {
      issues.push({ code: 'LEAD_TIME_INVALID', field: 'lead_time_max' });
    } else {
      values.leadTimeDaysMin = low;
      values.leadTimeDaysMax = high;
    }
  }

  if (cell('price') !== '') {
    if (!access.prices) issues.push({ code: 'PRICE_NOT_ALLOWED', field: 'price' });
    else {
      const price = parseMoney(cell('price'));
      if (price === null || price < 1n) issues.push({ code: 'PRICE_INVALID', field: 'price' });
      else values.price = price;
    }
  }
  if (cell('cost') !== '') {
    if (!access.cost) issues.push({ code: 'COST_NOT_ALLOWED', field: 'cost' });
    else {
      const cost = parseMoney(cell('cost'));
      if (cost === null) issues.push({ code: 'COST_INVALID', field: 'cost' });
      else values.cost = cost;
    }
  }
  return { values, issues };
}

export interface OpeningRowValues {
  sku: string | null;
  quantity?: number;
  lotCode?: string;
  expiryDate?: string;
  cost?: bigint;
}

export const OPENING_MAX_QUANTITY = 1_000_000;
const LOT_CODE = /^[^\p{Cc}]{1,64}$/u;

export function parseOpeningRow(
  cells: Record<string, string>,
  access: Access,
): { values: OpeningRowValues; issues: Issues } {
  const issues: Issues = [];
  const cell = (key: string) => (cells[key] ?? '').trim();
  const values: OpeningRowValues = { sku: null };
  if (cell('sku') === '') issues.push({ code: 'SKU_REQUIRED', field: 'sku' });
  else values.sku = attempt(issues, 'SKU_INVALID', 'sku', () => input.sku(cell('sku'))) ?? null;

  if (cell('quantity') === '') issues.push({ code: 'QUANTITY_REQUIRED', field: 'quantity' });
  else {
    const count = parseCount(cell('quantity'));
    if (count === null || count < 1 || count > OPENING_MAX_QUANTITY) {
      issues.push({ code: 'QUANTITY_INVALID', field: 'quantity' });
    } else values.quantity = count;
  }
  if (cell('lot_code') !== '') {
    if (!LOT_CODE.test(cell('lot_code')))
      issues.push({ code: 'LOT_CODE_INVALID', field: 'lot_code' });
    else values.lotCode = cell('lot_code').normalize('NFC');
  }
  if (cell('expiry_date') !== '') {
    const day = parseDay(cell('expiry_date'));
    if (day === null) issues.push({ code: 'EXPIRY_INVALID', field: 'expiry_date' });
    else values.expiryDate = day;
  }
  if (cell('cost') !== '') {
    if (!access.cost) issues.push({ code: 'COST_NOT_ALLOWED', field: 'cost' });
    else {
      const cost = parseMoney(cell('cost'));
      if (cost === null) issues.push({ code: 'COST_INVALID', field: 'cost' });
      else values.cost = cost;
    }
  }
  return { values, issues };
}

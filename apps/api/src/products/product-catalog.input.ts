import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';
import { catalogName } from '../catalog/catalog.input.js';

/**
 * Phase 6 P6-3: parsing and normalizing the product catalog's input (design 3). Every parser throws
 * `VALIDATION_FAILED` with a safe field name; nothing here touches the database.
 */

export const PRODUCT_LIMITS = Object.freeze({
  nameMaxCodePoints: 200,
  descriptionMaxCodePoints: 2_000,
  reasonMaxCodePoints: 500,
  maxThreshold: 1_000_000,
  maxSortOrder: 100_000,
  barcodeMax: 64,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SKU = /^[A-Z0-9][A-Z0-9._-]{0,63}$/;
const MONEY_POSITIVE = /^[1-9][0-9]{0,17}$/;
const MONEY = /^(?:0|[1-9][0-9]{0,17})$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : uuid(value, field);
}

export function name(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  return catalogName(value, field);
}

/** `null` clears an optional text; blank text is refused. */
export function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  return text(value, field, max);
}

export function description(value: unknown, field: string): string | null {
  return optionalText(value, field, PRODUCT_LIMITS.descriptionMaxCodePoints);
}

/** The label of a variant (size or volume): optional, plain text. */
export function label(value: unknown, field: string): string | null {
  return optionalText(value, field, PRODUCT_LIMITS.nameMaxCodePoints);
}

export function reason(value: unknown): string | null {
  return optionalText(value, 'reason', PRODUCT_LIMITS.reasonMaxCodePoints);
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

export function rowVersion(value: unknown, field = 'expectedRowVersion'): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

export function sortOrder(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > PRODUCT_LIMITS.maxSortOrder
  ) {
    throw new AuthError('VALIDATION_FAILED', 'sortOrder');
  }
  return value;
}

export function threshold(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > PRODUCT_LIMITS.maxThreshold
  ) {
    throw new AuthError('VALIDATION_FAILED', 'lowStockThreshold');
  }
  return value;
}

/** The SKU is the stable business identifier (PRD 31.4): trimmed and upper-cased, no spaces. */
export function sku(value: unknown): string {
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'sku');
  const normalized = value.normalize('NFC').trim().toUpperCase();
  if (!SKU.test(normalized)) throw new AuthError('VALIDATION_FAILED', 'sku');
  return normalized;
}

export function barcode(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', 'barcode');
  const normalized = value.normalize('NFC').trim();
  if (normalized === '') return null;
  if (normalized.length > PRODUCT_LIMITS.barcodeMax || /[\p{Cc}\s]/u.test(normalized)) {
    throw new AuthError('VALIDATION_FAILED', 'barcode');
  }
  return normalized;
}

/** A price that must be above zero (a list price, a promotional price), integer VND carried as a string. */
export function positiveMoney(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !MONEY_POSITIVE.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return BigInt(value);
}

/** A cost: zero or more; `null` clears it. */
export function cost(value: unknown): bigint | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !MONEY.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'costPriceVnd');
  }
  return BigInt(value);
}

export function instant(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !INSTANT.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AuthError('VALIDATION_FAILED', field);
  return date;
}

/**
 * A stable identifier from a name: lower case, no accents (the Vietnamese `đ` has no decomposition, so it is mapped by hand),
 * words joined by single hyphens. It always matches the database CHECK `^[a-z0-9]+(-[a-z0-9]+)*$`.
 */
export function slug(value: string, maxLength: number): string {
  const base = value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return base === '' ? 'item' : base;
}

/** `base`, then `base-2`, `base-3`, …: the first one `taken` does not know. */
export async function uniqueCode(
  base: string,
  maxLength: number,
  taken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 1; attempt <= 200; attempt += 1) {
    const suffix = attempt === 1 ? '' : `-${attempt}`;
    const code = `${base.slice(0, maxLength - suffix.length).replace(/-+$/g, '')}${suffix}`;
    if (!(await taken(code))) return code;
  }
  throw new AuthError('SERVICE_UNAVAILABLE');
}

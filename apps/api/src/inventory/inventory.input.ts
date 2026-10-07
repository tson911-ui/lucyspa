import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 6 P6-4: parsing and normalizing the inventory input. Every parser throws `VALIDATION_FAILED` with a safe field name and
 * touches nothing else. The decorators of the controller only keep the wrong types out; these are the exact rules.
 */

export const INVENTORY_LIMITS = Object.freeze({
  maxLines: 500,
  maxQuantity: 1_000_000,
  noteMax: 500,
  nameMax: 200,
  textMax: 500,
  lotCodeMax: 64,
  phoneMax: 40,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONEY = /^(?:0|[1-9][0-9]{0,17})$/;
// No control characters (tabs, line breaks) in a single-line text.
const CONTROL = /[\p{Cc}]/u;

export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return value.toLowerCase();
}

export function optionalUuid(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : uuid(value, field);
}

/** A calendar date `YYYY-MM-DD` that exists, between 2000 and 2100. */
export function date(value: unknown, field: string): string {
  const match = typeof value === 'string' ? DATE.exec(value) : null;
  if (!match) throw new AuthError('VALIDATION_FAILED', field);
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2000 ||
    year > 2100 ||
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value as string;
}

export function optionalDate(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : date(value, field);
}

/** A whole number of units, 1 to a million. */
export function quantity(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > INVENTORY_LIMITS.maxQuantity
  ) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

/** A counted quantity: zero or more. */
export function counted(value: unknown, field: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < 0 ||
    value > INVENTORY_LIMITS.maxQuantity
  ) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

/** A single-line text: trimmed, `null` for absent or blank, refused when too long or holding control characters. */
export function optionalLine(value: unknown, field: string, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text === '') return null;
  if ([...text].length > max || CONTROL.test(text)) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

/** A required single-line text. */
export function line(value: unknown, field: string, max: number): string {
  const text = optionalLine(value, field, max);
  if (text === null) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

/** A free note: trimmed, line breaks allowed, `null` when blank. */
export function optionalNote(value: unknown, field: string, max = INVENTORY_LIMITS.noteMax) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text === '') return null;
  // A control character other than a line break or a tab is refused.
  if ([...text].length > max || /[^\P{Cc}\n\r\t]/u.test(text)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return text;
}

export function email(value: unknown, field: string): string | null {
  const text = optionalLine(value, field, 254);
  if (text === null) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

export function boolean(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

export function rowVersion(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new AuthError('VALIDATION_FAILED', 'expectedRowVersion');
  }
  return value;
}

/** A unit cost in whole dong carried as a string; `null` clears it. */
export function unitCost(value: unknown): bigint | null {
  if (value === null) return null;
  if (typeof value !== 'string' || !MONEY.test(value)) {
    throw new AuthError('VALIDATION_FAILED', 'unitCostVnd');
  }
  return BigInt(value);
}

/** An object with only the listed keys (a stray key is refused), as a record. */
export function record(
  value: unknown,
  field: string,
  allowed: readonly string[],
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const entries = value as Record<string, unknown>;
  for (const key of Object.keys(entries)) {
    if (!allowed.includes(key)) throw new AuthError('VALIDATION_FAILED', field);
  }
  return entries;
}

export function list(value: unknown, field: string, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

export const ADJUSTMENT_REASONS = ['INTERNAL_USE', 'TESTER', 'DAMAGED', 'EXPIRED', 'LOSS'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export function adjustmentReason(value: unknown): AdjustmentReason {
  if (typeof value !== 'string' || !(ADJUSTMENT_REASONS as readonly string[]).includes(value)) {
    throw new AuthError('VALIDATION_FAILED', 'reason');
  }
  return value as AdjustmentReason;
}

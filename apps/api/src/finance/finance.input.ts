import { CASH_AMOUNT_MAX_VND } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 7: strict input parsing for the money commands. VND is an integer carried as a decimal string; nothing else is accepted
 * (no sign, no separators, no leading zeros, no fraction), so a typo can never become a different number.
 */
const MONEY = /^(0|[1-9][0-9]{0,15})$/;

export function money(value: unknown, field: string, options: { positive?: boolean } = {}): bigint {
  if (typeof value !== 'string' || !MONEY.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  const amount = BigInt(value);
  if (amount > BigInt(CASH_AMOUNT_MAX_VND) || (options.positive === true && amount === 0n)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return amount;
}

export function reason(value: unknown, field: string, max: number, required = true): string | null {
  if (value === null || value === undefined) {
    if (required) throw new AuthError('VALIDATION_FAILED', field);
    return null;
  }
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.trim();
  if (text.length === 0) {
    if (required) throw new AuthError('VALIDATION_FAILED', field);
    return null;
  }
  if (text.length > max) throw new AuthError('VALIDATION_FAILED', field);
  return text;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new AuthError('VALIDATION_FAILED', field);
  return value.toLowerCase();
}

/** Exactly the object keys named (a request with another key is refused, like the global pipe does for DTOs). */
export function exactKeys(
  value: unknown,
  keys: readonly string[],
  field: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!keys.includes(key)) throw new AuthError('VALIDATION_FAILED', `${field}.${key}`);
  }
  return record;
}

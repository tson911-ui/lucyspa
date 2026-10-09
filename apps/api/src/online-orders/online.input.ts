import type { OnlineAddressInput } from '@lucy-spa/contracts';
import { provinceByCode } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';
import { IdentityValidationError, normalizePhone } from '../auth/identity.js';
import { sqlStateOf } from '../booking/customer-command.js';
import * as input from '../inventory/inventory.input.js';

/**
 * Phase 6 Wave 4 (P6-19): parsing of everything a customer or the settings screen sends for online sales. Every parser throws
 * `VALIDATION_FAILED` with a safe field name and touches nothing else; the decorators of the controller only keep the wrong types out.
 */
export const ONLINE_LIMITS = Object.freeze({
  nameMax: 120,
  wardMax: 120,
  streetMax: 200,
  policyMax: 6000,
  moneyMax: 100_000_000n,
  /** Wave 4 (P6-22; pending Owner review): the most successful online requests one member makes in a minute (an honest page makes about 20). */
  memberRequestsPerMinute: 120,
});

/**
 * A database guard, a lock timeout, a deadlock, a serialization failure or a unique/foreign key violation raised under a command is a
 * CONFLICT the person can retry after reloading, never a 500 (the guards are the last line; the application checks come first).
 */
export async function conflictOnDatabaseGuard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    const meta = Reflect.get(Object(error), 'meta');
    const state = sqlStateOf(error) ?? (meta ? Reflect.get(Object(meta), 'code') : undefined);
    if (
      ['55P03', '40P01', '40001', '23505', '23P01', '23514', '23503'].includes(state ?? '') ||
      ['P2002', 'P2034', 'P2003'].includes(Reflect.get(Object(error), 'code'))
    ) {
      throw new AuthError('CONFLICT');
    }
    throw error;
  }
}

// A control character other than a line break or a tab is refused.
const CONTROL = /[^\P{Cc}\n\r\t]/u;
const MONEY = /^(?:0|[1-9][0-9]{0,11})$/;

export interface ParsedAddress {
  recipientName: string;
  recipientPhone: string;
  provinceCode: string;
  provinceName: string;
  ward: string;
  street: string;
}

/** The five fields of OQ-93. The phone is stored in the canonical +84 form; the province must be one of the 34 units. */
export function parseAddress(value: OnlineAddressInput, field = 'address'): ParsedAddress {
  const raw = input.record(value, field, [
    'recipientName',
    'recipientPhone',
    'provinceCode',
    'ward',
    'street',
  ]);
  const recipientName = input.line(
    raw['recipientName'],
    `${field}.recipientName`,
    ONLINE_LIMITS.nameMax,
  );
  const phoneText = input.line(raw['recipientPhone'], `${field}.recipientPhone`, 40);
  let recipientPhone: string;
  try {
    recipientPhone = normalizePhone(phoneText).phoneCanonical;
  } catch (error) {
    if (error instanceof IdentityValidationError) {
      throw new AuthError('VALIDATION_FAILED', `${field}.recipientPhone`);
    }
    throw error;
  }
  const code = input.line(raw['provinceCode'], `${field}.provinceCode`, 40);
  const province = provinceByCode(code);
  if (!province) throw new AuthError('VALIDATION_FAILED', `${field}.provinceCode`);
  return {
    recipientName: recipientName.replace(/\s+/g, ' '),
    recipientPhone,
    provinceCode: province.code,
    provinceName: province.nameVi,
    ward: input.line(raw['ward'], `${field}.ward`, ONLINE_LIMITS.wardMax).replace(/\s+/g, ' '),
    street: input
      .line(raw['street'], `${field}.street`, ONLINE_LIMITS.streetMax)
      .replace(/\s+/g, ' '),
  };
}

/** Whole dong as a string, 0 up to a hundred million. */
export function money(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !MONEY.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  const amount = BigInt(value);
  if (amount > ONLINE_LIMITS.moneyMax) throw new AuthError('VALIDATION_FAILED', field);
  return amount;
}

export function smallInt(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

/** A policy text: line breaks allowed, blank means "use the default draft" (null). */
export function policyText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new AuthError('VALIDATION_FAILED', field);
  const text = value.normalize('NFC').trim();
  if (text === '') return null;
  if ([...text].length > ONLINE_LIMITS.policyMax || CONTROL.test(text)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return text;
}

import { AuthError } from '../auth/auth.error.js';
import { text } from '../auth/registration.js';

export const CATALOG_LIMITS = Object.freeze({
  nameMaxCodePoints: 200,
  descriptionMaxCodePoints: 2_000,
  reasonMaxCodePoints: 500,
  maxSortOrder: 100_000,
  maxDurationMinutes: 1_440,
});

/** Catalog codes are stable identifiers: trimmed, uppercased, `[A-Z][A-Z0-9_]*` (SQL too). */
export function normalizeCatalogCode(value: string): string {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)) throw new AuthError('VALIDATION_FAILED', 'code');
  return code;
}

export function catalogName(value: string, field: string): string {
  return text(value, field, CATALOG_LIMITS.nameMaxCodePoints);
}

/** `null` clears an optional description; blank text is rejected (SQL too). */
export function catalogDescription(value: string | null, field: string): string | null {
  return value === null ? null : text(value, field, CATALOG_LIMITS.descriptionMaxCodePoints);
}

export function optionalReason(value: string | undefined): string | null {
  return value === undefined ? null : text(value, 'reason', CATALOG_LIMITS.reasonMaxCodePoints);
}

export function requiredReason(value: string): string {
  return text(value, 'reason', CATALOG_LIMITS.reasonMaxCodePoints);
}

export function sortOrder(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > CATALOG_LIMITS.maxSortOrder) {
    throw new AuthError('VALIDATION_FAILED', 'sortOrder');
  }
  return value;
}

/** One concrete internal duration; offerings of different lengths are separate services. */
export function durationMinutes(value: number): number {
  if (!Number.isInteger(value) || value < 1 || value > CATALOG_LIMITS.maxDurationMinutes) {
    throw new AuthError('VALIDATION_FAILED', 'durationMinutes');
  }
  return value;
}

/** One bound of the customer-facing estimated duration (whole minutes, 1 to 24 hours). */
export function estimateMinutes(
  value: number,
  field: 'estimatedMinMinutes' | 'estimatedMaxMinutes',
): number {
  if (!Number.isInteger(value) || value < 1 || value > CATALOG_LIMITS.maxDurationMinutes) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return value;
}

export interface ServiceDurations {
  /** Internal scheduling duration: the one deterministic duration booking reserves. */
  durationMinutes: number;
  estimatedMinMinutes: number;
  estimatedMaxMinutes: number;
}

/**
 * The duration invariant (SQL enforces it too):
 * `1 <= estimatedMinMinutes <= estimatedMaxMinutes <= durationMinutes`. A booking slot
 * is therefore never shorter than the longest duration promised to the customer.
 */
export function checkServiceDurations(durations: ServiceDurations): ServiceDurations {
  if (durations.estimatedMaxMinutes < durations.estimatedMinMinutes) {
    throw new AuthError('VALIDATION_FAILED', 'estimatedMaxMinutes');
  }
  if (durations.durationMinutes < durations.estimatedMaxMinutes) {
    throw new AuthError('VALIDATION_FAILED', 'durationMinutes');
  }
  return durations;
}

/** Nonnegative integer VND carried as a decimal string and stored as bigint. */
export function priceVnd(value: string): bigint {
  if (!/^(?:0|[1-9][0-9]{0,17})$/.test(value)) throw new AuthError('VALIDATION_FAILED', 'priceVnd');
  return BigInt(value);
}

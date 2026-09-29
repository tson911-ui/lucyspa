import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 4 Step 5 money rules for the internal invoice ("Hóa đơn"). Pure and deterministic: integer VND
 * in `bigint`, no floating point, no rounding (a line's gross is exactly quantity x unit price). The
 * database re-verifies these rules (Step 4 guards); this module is the only place amounts are computed.
 *
 * `calculation_version = 1`: line gross = quantity x unit price; subtotal = sum of the priced lines'
 * gross; the benefit (Step 6) is passed in as `discountTotal` (0 in Step 5); total = subtotal - discount.
 */
export const CALCULATION_VERSION = 1;

export type PricingUnitName = 'PER_SERVICE' | 'PER_NAIL';

export interface CalcLine {
  quantity: number | null;
  unitPriceVnd: bigint | null;
}

export interface InvoiceTotals {
  subtotalVnd: bigint;
  discountTotalVnd: bigint;
  totalVnd: bigint;
  /** Lines that still lack a price or a quantity (a draft may have some; finalization needs none). */
  unpricedLines: number;
}

/** Exactly quantity x price once both are set, NULL until then. */
export function grossOf(quantity: number | null, unitPriceVnd: bigint | null): bigint | null {
  return quantity === null || unitPriceVnd === null ? null : BigInt(quantity) * unitPriceVnd;
}

/** Server-authoritative totals of an invoice. Never taken from a client. */
export function calculateTotals(lines: readonly CalcLine[], discountTotalVnd = 0n): InvoiceTotals {
  let subtotalVnd = 0n;
  let unpricedLines = 0;
  for (const line of lines) {
    const gross = grossOf(line.quantity, line.unitPriceVnd);
    if (gross === null) unpricedLines += 1;
    else subtotalVnd += gross;
  }
  if (discountTotalVnd < 0n || discountTotalVnd > subtotalVnd) {
    throw new AuthError('VALIDATION_FAILED', 'discountTotalVnd');
  }
  return { subtotalVnd, discountTotalVnd, totalVnd: subtotalVnd - discountTotalVnd, unpricedLines };
}

/** A non-negative integer VND decimal string (the API's wire format for money). */
export function parseVnd(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,17})$/.test(value)) {
    throw new AuthError('VALIDATION_FAILED', field);
  }
  return BigInt(value);
}

/** A concrete price must lie inside the historical range snapshotted on the visit line (Q1). */
export function checkPrice(price: bigint, min: bigint, max: bigint): bigint {
  if (price < min || price > max) throw new AuthError('VALIDATION_FAILED', 'unitPriceVnd');
  return price;
}

/**
 * A financial quantity is a positive integer within the limit snapshotted when the visit line was
 * established (OP-1). PER_SERVICE is exactly one unit (its snapshotted limit is 1).
 */
export function checkQuantity(quantity: unknown, limit: number): number {
  if (typeof quantity !== 'number' || !Number.isSafeInteger(quantity) || quantity < 1) {
    throw new AuthError('VALIDATION_FAILED', 'quantity');
  }
  if (quantity > limit) throw new AuthError('VALIDATION_FAILED', 'quantity');
  return quantity;
}

/**
 * What is decided automatically when a draft line is created (design 4.3): a PER_SERVICE quantity is
 * exactly 1; an exact price (min = max) is set to that price; a variable price and a PER_NAIL quantity
 * stay NULL until an authorized actor selects them.
 */
export function initialPricing(
  unit: PricingUnitName,
  min: bigint,
  max: bigint,
): { quantity: number | null; unitPriceVnd: bigint | null } {
  return {
    quantity: unit === 'PER_SERVICE' ? 1 : null,
    unitPriceVnd: min === max ? min : null,
  };
}

import { randomBytes } from 'node:crypto';

/**
 * The internal invoice code (Phase 4 design Q10, 4.10): `INV-YYMMDD-XXXXXX`.
 *
 * - `YYMMDD` is the branch-local business date of the invoice (the database validates it against
 *   `invoices.business_date`, which it validates against the branch timezone);
 * - `XXXXXX` is six characters from the same unambiguous alphabet as booking codes (no 0, 1, I, O)
 *   drawn from a cryptographic source. 256 is a multiple of the 32-letter alphabet, so the draw is
 *   unbiased.
 *
 * This is an internal commercial receipt code. It is NOT an official Vietnamese VAT/e-invoice
 * number and carries no tax or provider meaning. Uniqueness is the database's `invoices_code_key`;
 * the (later) creation command retries with a fresh code on a collision. This module only builds and
 * checks the string: it creates no invoice.
 */
export const INVOICE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** The exact shape the database CHECK accepts (`invoices_code_format`, apart from the date/code match). */
export const INVOICE_CODE_PATTERN = /^INV-[0-9]{6}-[A-HJ-NP-Z2-9]{6}$/;

const BUSINESS_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Six random bytes source; injectable so tests are deterministic. */
export type InvoiceCodeRandom = (size: number) => Uint8Array;

/**
 * Builds a code for a branch-local business date given as `YYYY-MM-DD` (a real calendar date).
 * Throws on anything else so a malformed date can never reach the database.
 */
export function generateInvoiceCode(
  businessDate: string,
  random: InvoiceCodeRandom = randomBytes,
): string {
  const match = BUSINESS_DATE.exec(businessDate);
  if (!match) throw new Error('Invoice business date must be YYYY-MM-DD.');
  const [, year, month, day] = match as unknown as [string, string, string, string];
  const parsed = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (
    parsed.getUTCFullYear() !== Number(year) ||
    parsed.getUTCMonth() !== Number(month) - 1 ||
    parsed.getUTCDate() !== Number(day)
  ) {
    throw new Error('Invoice business date must be a real calendar date.');
  }
  const bytes = random(6);
  if (bytes.length !== 6) throw new Error('Invoice code needs exactly six random bytes.');
  const suffix = [...bytes]
    .map((byte) => INVOICE_CODE_ALPHABET[byte % INVOICE_CODE_ALPHABET.length])
    .join('');
  return `INV-${year.slice(2)}${month}${day}-${suffix}`;
}

/** True when the string has the invoice code shape (it does not prove uniqueness or the date match). */
export function isInvoiceCode(value: string): boolean {
  return INVOICE_CODE_PATTERN.test(value);
}

import type {
  BranchSummary,
  CurrentAccountResponse,
  InvoiceCancelRequest,
  InvoiceLineResponse,
  InvoiceLinePriceRequest,
  InvoicePayerRequest,
  InvoiceStatusName,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { ApiError } from './api';
import { formatVnd, isVndInput } from './format';
import { canAt } from './permissions';
import { errorMessage } from './workflows';

/**
 * Invoice / POS (Phase 4 Step 5). The browser only carries the cashier's choices: a price inside the line's
 * historical range, a quantity inside its limit, the payer and the finalize/cancel commands. Totals, states,
 * ranges and limits are the server's; nothing here computes a bill (the numbers shown are the server's).
 */

/** Branches where this account may view invoices (the API decides again on every call). */
export function posBranches(
  account: CurrentAccountResponse,
  branches: ReadonlyMap<string, BranchSummary> | null,
): BranchSummary[] {
  return [...(branches?.values() ?? [])]
    .filter((branch) => branch.isActive && canAt(account, 'VIEW_INVOICES', branch.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'vi'));
}

export function invoiceTone(
  status: InvoiceStatusName,
): 'success' | 'error' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'DRAFT':
      return 'neutral';
    case 'PENDING_PAYMENT':
      return 'warning';
    case 'PAID':
      return 'success';
    case 'CANCELLED':
      return 'error';
  }
}

export type PriceLine = Pick<
  InvoiceLineResponse,
  'priceMinVnd' | 'priceMaxVnd' | 'quantityLimit' | 'pricingUnit'
>;

/** "40.000 ₫" or "5.000–10.000 ₫": the historical range of a line, shown as a reference for the choice. */
export function priceRange(line: PriceLine, locale: Locale): string {
  return line.priceMinVnd === line.priceMaxVnd
    ? formatVnd(line.priceMinVnd, locale)
    : `${formatVnd(line.priceMinVnd, locale)}–${formatVnd(line.priceMaxVnd, locale)}`;
}

/** A range means the cashier must choose; an exact price is fixed at draft creation. */
export const hasPriceRange = (line: PriceLine): boolean => line.priceMinVnd !== line.priceMaxVnd;
export const hasQuantity = (line: PriceLine): boolean => line.pricingUnit === 'PER_NAIL';

export type LineInput = { price: string; quantity: string };

/** The line's current server values as the initial form text. */
export function lineInput(line: InvoiceLineResponse): LineInput {
  return {
    price: line.unitPriceVnd ?? '',
    quantity: line.quantity === null ? '' : String(line.quantity),
  };
}

export type PriceProblem = 'price' | 'quantity' | 'unchanged';

/**
 * The price request of one line: only the choices that can be made (a price only for a range, a quantity
 * only for PER_NAIL), pre-checked against the historical range/limit (the API checks again). `unchanged`
 * when nothing differs from what the server already holds.
 */
export function priceBody(
  line: InvoiceLineResponse,
  input: LineInput,
  expectedVersion: number,
): { body: InvoiceLinePriceRequest } | { problem: PriceProblem } {
  const body: InvoiceLinePriceRequest = { expectedVersion };
  let changed = false;
  if (hasPriceRange(line)) {
    const price = input.price.trim();
    if (!isVndInput(price)) return { problem: 'price' };
    const value = BigInt(price);
    if (value < BigInt(line.priceMinVnd) || value > BigInt(line.priceMaxVnd)) {
      return { problem: 'price' };
    }
    if (price !== line.unitPriceVnd) {
      body.unitPriceVnd = price;
      changed = true;
    }
  }
  if (hasQuantity(line)) {
    const text = input.quantity.trim();
    if (!/^[1-9][0-9]{0,8}$/.test(text)) return { problem: 'quantity' };
    const quantity = Number(text);
    if (quantity > line.quantityLimit) return { problem: 'quantity' };
    if (quantity !== line.quantity) {
      body.quantity = quantity;
      changed = true;
    }
  }
  return changed ? { body } : { problem: 'unchanged' };
}

/** The payer request: a member id from the exact lookup, or null for a guest payer. */
export function payerBody(
  payerUserId: string | null,
  expectedVersion: number,
): InvoicePayerRequest {
  return { expectedVersion, payerUserId };
}

/** The cancellation body: a reason is required (1–500 characters after trimming). */
export function cancelBody(reason: string, expectedVersion: number): InvoiceCancelRequest | null {
  const trimmed = reason.normalize('NFC').trim();
  return trimmed && [...trimmed].length <= 500 ? { expectedVersion, reason: trimmed } : null;
}

/** POS outcomes are shown with their own texts; the rest as elsewhere. */
export function posErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.pos.errors as Record<string, string>;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

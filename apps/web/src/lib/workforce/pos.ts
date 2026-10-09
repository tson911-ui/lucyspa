import type {
  BranchSummary,
  CurrentAccountResponse,
  InvoiceCancelRequest,
  InvoiceLineResponse,
  InvoiceKindName,
  InvoiceLinePriceRequest,
  InvoicePayerRequest,
  InvoiceStatusName,
  PaymentPayosRequest,
  PaymentRecordRequest,
  PaymentReverseRequest,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import type { WorkforceDictionary } from '../../i18n/workforce';
import { matchesQuery } from '../search-core';
import { ApiError } from './api';
import { formatVnd, isVndInput } from './format';
import { canAt } from './permissions';
import { ReauthenticationCancelled } from './reauth';
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

/**
 * The time an invoice (or a finished visit) is listed with on the board, in branch time. The board holds a week: a
 * time alone means the shown day, an older one carries its day and month (dd/mm), so no date column repeats down the list.
 */
export function boardStamp(
  iso: string,
  businessDate: string,
  shownDate: string,
  zone: string,
  locale: string,
): string {
  const time = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
  if (businessDate === shownDate) return time;
  const [, month, day] = businessDate.split('-');
  return `${day}/${month} ${time}`;
}

/** What an invoice on the board is for, in the cashier's words (the visit code stays on the invoice itself). */
export function invoiceContent(
  invoice: {
    kind: InvoiceKindName;
    comboName: { vi: string; en: string } | null;
    products?: { quantity: number } | undefined;
  },
  t: WorkforceDictionary,
  locale: Locale,
  comboLabel: string,
): string {
  if (invoice.kind === 'COMBO_SALE') {
    const name = invoice.comboName
      ? locale === 'vi'
        ? invoice.comboName.vi
        : invoice.comboName.en
      : '—';
    return `${comboLabel}: ${name}`;
  }
  const units = String(invoice.products?.quantity ?? 0);
  if (invoice.kind === 'PRODUCT_SALE') return t.pos.typeProducts.replace('{count}', units);
  return invoice.products ? t.pos.typeServiceProducts.replace('{count}', units) : t.pos.typeService;
}

/**
 * Whether a board invoice matches what the cashier typed: its code, the customer's name, the visit code or the combo's
 * name, ignoring accents and case. The board does not carry phone numbers, so a phone cannot be matched here.
 */
export function invoiceMatchesSearch(
  invoice: {
    code: string;
    payerName: string | null;
    visitCode: string | null;
    comboName: { vi: string; en: string } | null;
  },
  query: string,
): boolean {
  return matchesQuery(
    [
      invoice.code,
      invoice.payerName,
      invoice.visitCode,
      invoice.comboName?.vi,
      invoice.comboName?.en,
    ]
      .filter(Boolean)
      .join(' '),
    query,
  );
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

/** A fresh client idempotency key: one per intended payment, kept across retries of the same choice. */
export function newPaymentKey(): string {
  return globalThis.crypto.randomUUID();
}

export type PaymentInput = { amount: string; tendered: string };

/** The form starts at "pay the whole balance, exact tender" (the server balance; the API checks again). */
export const paymentInput = (balanceVnd: string): PaymentInput => ({
  amount: balanceVnd,
  tendered: balanceVnd,
});

export type PaymentProblem = 'amount' | 'tendered' | 'tenderLow';

/**
 * The cash request: only the method, the credited amount, what was handed over and the idempotency key.
 * Pre-checked against the balance the server reported (the API decides again); no time, change, status or
 * branch can be expressed.
 */
export function paymentBody(
  input: PaymentInput,
  balanceVnd: string,
  idempotencyKey: string,
): { body: PaymentRecordRequest } | { problem: PaymentProblem } {
  const amount = input.amount.trim();
  if (!isVndInput(amount) || BigInt(amount) < 1n || BigInt(amount) > BigInt(balanceVnd)) {
    return { problem: 'amount' };
  }
  const tendered = input.tendered.trim();
  if (!isVndInput(tendered)) return { problem: 'tendered' };
  if (BigInt(tendered) < BigInt(amount)) return { problem: 'tenderLow' };
  return { body: { method: 'CASH', amountVnd: amount, tenderedVnd: tendered, idempotencyKey } };
}

/** A display-only preview of the change; the stored change is derived by the server. */
export function changePreview(input: PaymentInput): string | null {
  const amount = input.amount.trim();
  const tendered = input.tendered.trim();
  if (!isVndInput(amount) || !isVndInput(tendered) || BigInt(tendered) < BigInt(amount)) {
    return null;
  }
  return (BigInt(tendered) - BigInt(amount)).toString();
}

/**
 * The PayOS request: only the amount and the idempotency key (Q7: part or all of the balance). Pre-checked
 * against the balance the server reported; expiry, order and status are the server's.
 */
export function payosBody(
  amount: string,
  balanceVnd: string,
  idempotencyKey: string,
): { body: PaymentPayosRequest } | { problem: 'amount' } {
  const trimmed = amount.trim();
  if (!isVndInput(trimmed) || BigInt(trimmed) < 1n || BigInt(trimmed) > BigInt(balanceVnd)) {
    return { problem: 'amount' };
  }
  return { body: { amountVnd: trimmed, idempotencyKey } };
}

/** A management note or an anomaly review note: 1-500 characters after trimming. */
export function noteBody(note: string): { note: string } | null {
  const trimmed = note.normalize('NFC').trim();
  return trimmed && [...trimmed].length <= 500 ? { note: trimmed } : null;
}

/** Milliseconds until a PayOS request stops accepting payment (never negative). */
export function remainingMs(expiresAtIso: string, nowMs: number): number {
  return Math.max(0, Date.parse(expiresAtIso) - nowMs);
}

/** `m:ss` for a countdown. */
export function formatCountdown(ms: number): string {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The reversal body: a reason is required (1–500 characters after trimming). */
export function reverseBody(reason: string): PaymentReverseRequest | null {
  const trimmed = reason.normalize('NFC').trim();
  return trimmed && [...trimmed].length <= 500 ? { reason: trimmed } : null;
}

/** POS outcomes are shown with their own texts; the rest as elsewhere. */
export function posErrorMessage(error: unknown, t: WorkforceDictionary): string {
  const texts = t.pos.errors as Record<string, string>;
  if (error instanceof ReauthenticationCancelled) return t.reauth.cancelled;
  if (error instanceof ApiError && error.code in texts) return texts[error.code] as string;
  return errorMessage(error, t);
}

import type {
  InvoiceResponse,
  PreOrderContactRequest,
  ProductOrderLineStatusName,
} from '@lucy-spa/contracts';
import type { Locale } from '../../i18n/locales';
import { productOrdersDictionary } from '../../i18n/product-orders';
import { ApiError } from './api';
import { formatDate } from './format';

/**
 * Counter pre-orders (Phase 6 P6-16/P6-17), the parts that are not drawing: the tone of a status, the expected range as text, the
 * check of the customer's phone number before it is sent, the address of the ticket link and the text of a refused command. The server
 * decides every rule again; what is here only saves a round trip.
 */

export type StatusTone = 'success' | 'info' | 'warning' | 'neutral';

export function orderStatusTone(status: ProductOrderLineStatusName): StatusTone {
  switch (status) {
    case 'AWAITING_PAYMENT':
      return 'warning';
    case 'PAID':
    case 'ORDERED':
      return 'info';
    case 'ARRIVED':
      return 'warning';
    case 'HANDED_OVER':
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'neutral';
  }
}

/** The expected range of a line as one text, or the words for "decided at payment" when there is none yet. */
export function expectedText(
  line: { expectedFrom: string | null; expectedTo: string | null },
  locale: Locale,
  words: { range: string; afterPayment: string },
): string {
  if (!line.expectedFrom || !line.expectedTo) return words.afterPayment;
  if (line.expectedFrom === line.expectedTo) return formatDate(line.expectedFrom, locale);
  return words.range
    .replace('{from}', formatDate(line.expectedFrom, locale))
    .replace('{to}', formatDate(line.expectedTo, locale));
}

/** The lead time of a variant as the add dialog and the option list say it. */
export function leadTimeText(
  words: { expected: string; expectedSame: string },
  min: number,
  max: number,
): string {
  return (min === max ? words.expectedSame : words.expected)
    .replace('{min}', String(min))
    .replace('{max}', String(max));
}

/** True when the invoice has at least one pre-order line (the finalization then asks for the customer's phone number). */
export function hasPreOrderLine(invoice: Pick<InvoiceResponse, 'productLines'>): boolean {
  return invoice.productLines.some((line) => line.fulfilmentMode === 'PRE_ORDER');
}

export type ContactProblem = 'phone';

/**
 * The contact from what was typed. The phone is checked loosely here (digits, an optional leading +, spaces and the usual
 * separators; at least 9 digits); the server normalizes it to +84... and refuses what is not a real number.
 */
export function contactBody(input: {
  phone: string;
  name: string;
}): { contact: PreOrderContactRequest } | { problem: ContactProblem } {
  const phone = input.phone.trim();
  const digits = phone.replace(/\D/g, '');
  if (!/^[0-9+ ().-]+$/.test(phone) || digits.length < 9 || digits.length > 15) {
    return { problem: 'phone' };
  }
  const name = input.name.trim().replace(/\s+/g, ' ');
  return { contact: { phone, ...(name ? { name } : {}) } };
}

/** The address the customer opens for a ticket link: the website origin, the language and the secret token. */
export function ticketUrl(origin: string, locale: Locale, token: string): string {
  return `${origin.replace(/\/+$/, '')}/${locale}/ticket/${token}`;
}

/**
 * The text of a refused pre-order command. `PRODUCT_PRE_ORDER_NOT_NEEDED` names the lines the stock already covers by id in `field`;
 * they are turned into the names the cashier sees. Everything else falls back to the caller's messages.
 */
export function preOrderErrorText(
  error: unknown,
  locale: Locale,
  invoice: Pick<InvoiceResponse, 'productLines'> | null,
  nameOf: (line: InvoiceResponse['productLines'][number]) => string,
): string | null {
  if (!(error instanceof ApiError)) return null;
  const d = productOrdersDictionary(locale).errors;
  if (error.code === 'PRODUCT_PRE_ORDER_NOT_NEEDED') {
    const ids = (error.field ?? '').split(',').filter(Boolean);
    const names = ids
      .map((id) => invoice?.productLines.find((line) => line.id === id))
      .filter((line): line is NonNullable<typeof line> => line !== undefined)
      .map(nameOf);
    return d.PRODUCT_PRE_ORDER_NOT_NEEDED.replace('{names}', names.join(', ') || '…');
  }
  if (error.code === 'PRODUCT_PRE_ORDER_NOT_ALLOWED') return d.PRODUCT_PRE_ORDER_NOT_ALLOWED;
  if (error.code === 'PRE_ORDER_CONTACT_REQUIRED') return d.PRE_ORDER_CONTACT_REQUIRED;
  return null;
}

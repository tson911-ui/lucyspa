import type { CustomerInvoiceStatus } from '@lucy-spa/contracts';

/** Pure display helpers of the customer invoice history. Every amount and status comes from the server. */

/*
 * One Intl formatter per language and option set, built once (react-best-practices js-cache-function-results): the money and date
 * helpers run per table cell and per card, and the formatter constructor is the costly part.
 */
const NUMBER_FORMATS = new Map<string, Intl.NumberFormat>();
const DATE_FORMATS = new Map<string, Intl.DateTimeFormat>();

/** The grouped-number formatter of the customer side (`vi-VN` or `en-US`). */
export function numberFormat(locale: string): Intl.NumberFormat {
  let format = NUMBER_FORMATS.get(locale);
  if (!format) {
    format = new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US');
    NUMBER_FORMATS.set(locale, format);
  }
  return format;
}

/** A date formatter of the customer side (`vi-VN` or `en-GB`) for these options. */
export function dateFormat(
  locale: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${locale}|${JSON.stringify(options)}`;
  let format = DATE_FORMATS.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', options);
    DATE_FORMATS.set(key, format);
  }
  return format;
}

/** Integer VND (a decimal string from the API) as `150.000 ₫`. */
export function formatVnd(value: string, locale: string): string {
  return `${numberFormat(locale).format(BigInt(value))} ₫`;
}

const BUSINESS_DATE: Intl.DateTimeFormatOptions = {
  timeZone: 'UTC',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
};

/** A branch business date (`YYYY-MM-DD`) has no time zone: it is shown as the calendar day it names. */
export function formatBusinessDate(date: string, locale: string): string {
  return dateFormat(locale, BUSINESS_DATE).format(new Date(`${date}T00:00:00.000Z`));
}

export function invoiceTone(
  status: CustomerInvoiceStatus,
): 'success' | 'info' | 'warning' | 'neutral' | 'error' {
  switch (status) {
    case 'PAID':
      return 'success';
    case 'PENDING_PAYMENT':
      return 'warning';
    default:
      return 'neutral';
  }
}

/** Appends a further page without repeating an invoice already shown. */
export function appendPage<T extends { id: string }>(shown: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(shown.map((item) => item.id));
  return [...shown, ...page.filter((item) => !seen.has(item.id))];
}

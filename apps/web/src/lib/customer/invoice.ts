import type { CustomerInvoiceStatus } from '@lucy-spa/contracts';

/** Pure display helpers of the customer invoice history. Every amount and status comes from the server. */

/** Integer VND (a decimal string from the API) as `150.000 ₫`. */
export function formatVnd(value: string, locale: string): string {
  return `${new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US').format(BigInt(value))} ₫`;
}

/** A branch business date (`YYYY-MM-DD`) has no time zone: it is shown as the calendar day it names. */
export function formatBusinessDate(date: string, locale: string): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(new Date(`${date}T00:00:00.000Z`));
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

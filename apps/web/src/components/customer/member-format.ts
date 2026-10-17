import type { CursorPaginationLabels, PaginationLabels } from '@lucy-spa/ui';
import { fill, type CustomerDictionary } from '../../i18n/customer';
import type { Locale } from '../../i18n/locales';
import { formatBusinessDate } from '../../lib/customer/invoice';

/**
 * Small formatters and the pager state of the member area. They live here so the member pages never load the staff dictionary
 * (`i18n/workforce`, 270 KB) through the staff helpers (rbp-customer bookings.tsx:34,47, invoices.tsx:24,36, loyalty.tsx:32,46).
 */

const numberFormats = new Map<string, Intl.NumberFormat>();

function cachedFormat(key: string, make: () => Intl.NumberFormat): Intl.NumberFormat {
  let format = numberFormats.get(key);
  if (!format) {
    format = make();
    numberFormats.set(key, format);
  }
  return format;
}

/** Whole points with the locale's grouping (vi 1.774, en 1,774). */
export function formatPoints(points: number, locale: Locale): string {
  const format = cachedFormat(
    `points-${locale}`,
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US'),
  );
  return points < 0 ? `−${format.format(Math.abs(points))}` : format.format(points);
}

/** A percent through Intl (vi "3,5%", en "3.5%"), never built by hand. */
export function formatPercent(value: number, locale: Locale): string {
  const format = cachedFormat(
    `percent-${locale}`,
    () =>
      new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US', {
        style: 'percent',
        maximumFractionDigits: 2,
      }),
  );
  return format.format(value / 100);
}

const slotFormats = new Map<string, Intl.DateTimeFormat>();

/**
 * A start time the booking API gives as the branch's own wall-clock "HH:mm" (no instant, no zone) through Intl, so it reads as the
 * locale writes times (wig book.tsx:728). The clock reading is kept as is: it is formatted in UTC from a UTC date of that reading.
 */
export function formatSlotTime(value: string, locale: Locale): string {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return value;
  let format = slotFormats.get(locale);
  if (!format) {
    format = new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
      timeZone: 'UTC',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    slotFormats.set(locale, format);
  }
  return format.format(new Date(Date.UTC(2000, 0, 1, Number(match[1]), Number(match[2]))));
}

/** The expected arrival of a pre-ordered product: one day, a range, or "after payment" (an estimate, never a promise). */
export function expectedRange(
  line: { expectedFrom: string | null; expectedTo: string | null },
  locale: Locale,
  words: { range: string; afterPayment: string },
): string {
  if (!line.expectedFrom || !line.expectedTo) return words.afterPayment;
  if (line.expectedFrom === line.expectedTo) return formatBusinessDate(line.expectedFrom, locale);
  return words.range
    .replace('{from}', formatBusinessDate(line.expectedFrom, locale))
    .replace('{to}', formatBusinessDate(line.expectedTo, locale));
}

/** The state of one pre-ordered product line as a status tone (the same reading as the counter's). */
export function orderLineTone(
  status:
    | 'AWAITING_PAYMENT'
    | 'PAID'
    | 'ORDERED'
    | 'SHIPPED'
    | 'ARRIVED'
    | 'HANDED_OVER'
    | 'COMPLETED'
    | 'CANCELLED',
): 'success' | 'info' | 'warning' | 'neutral' {
  switch (status) {
    case 'AWAITING_PAYMENT':
    case 'ARRIVED':
      return 'warning';
    case 'PAID':
    case 'ORDERED':
    case 'SHIPPED':
      return 'info';
    case 'HANDED_OVER':
    case 'COMPLETED':
      return 'success';
    case 'CANCELLED':
      return 'neutral';
  }
}

/** The pager text of a member list named `list` ("Hiển thị 1–20 trong 31"). */
export function memberPagingLabels(t: CustomerDictionary, list: string): PaginationLabels {
  const text = t.list;
  return {
    nav: fill(text.pagesOf, { list }),
    first: text.firstPage,
    previous: text.previousPage,
    next: text.nextPage,
    last: text.lastPage,
    pageNumber: text.pageNumber,
    summary: text.summary,
    pageOf: text.pageOf,
    pageSize: text.pageSize,
    pageSizeOption: text.pageSizeOption,
  };
}

/** The "Xem thêm" pager text of a cursor list. */
export function memberCursorLabels(
  t: CustomerDictionary,
  list: string,
  loadMore: string,
): CursorPaginationLabels {
  return {
    nav: fill(t.list.pagesOf, { list }),
    loadMore,
    previous: t.list.previousPage,
    next: t.list.nextPage,
    loading: t.common.loading,
  };
}

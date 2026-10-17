import type { Locale } from '../../i18n/locales';

/** One formatter per locale and options, built once (creating Intl formatters is costly; they are called per row). */
const formatters = new Map<string, Intl.NumberFormat | Intl.DateTimeFormat>();
function cached<T extends Intl.NumberFormat | Intl.DateTimeFormat>(key: string, make: () => T): T {
  let formatter = formatters.get(key) as T | undefined;
  if (!formatter) {
    formatter = make();
    formatters.set(key, formatter);
  }
  return formatter;
}

/**
 * VND is carried as a decimal integer string (bigint on the server). It is formatted with Intl from a BigInt, so no amount ever
 * passes through a floating-point number; a no-break space keeps the currency sign on the amount's line.
 */
export function formatVnd(value: string, locale: Locale): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  const grouping = cached(
    `vnd-${locale}`,
    () => new Intl.NumberFormat(locale === 'vi' ? 'vi-VN' : 'en-US'),
  );
  return `${grouping.format(BigInt(value))}\u00a0₫`;
}

/** Digits-only VND input (the API's own format); leading zeros and separators rejected. */
export function isVndInput(value: string): boolean {
  return /^(?:0|[1-9][0-9]{0,17})$/.test(value);
}

/** `YYYY-MM-DD` shown as a calendar date without any timezone conversion. */
export function formatDate(value: string, locale: Locale): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  // Intl in UTC on the calendar day itself, so no timezone moves the date: vi 16/10/2026, en 2026-10-16 (en-CA).
  const calendar = cached(
    `date-${locale}`,
    () =>
      new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-CA', {
        timeZone: 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
  );
  return calendar.format(new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))));
}

/** An instant as wall-clock time in the given IANA timezone (the branch's). */
export function formatTime(instant: string, timeZone: string, locale: Locale): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return cached(
    `time-${locale}-${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  ).format(date);
}

export function formatDateTime(instant: string, timeZone: string, locale: Locale): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return cached(
    `datetime-${locale}-${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
  ).format(date);
}

/** Today's calendar date (`YYYY-MM-DD`) in an IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return cached(
    `today-${timeZone}`,
    () =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
  ).format(now);
}

/** A wall-clock parts formatter for an IANA timezone (24 h), built once per locale tag and zone. */
function wallClock(tag: 'en-US' | 'en-CA', timeZone: string): Intl.DateTimeFormat {
  return cached(
    `wall-${tag}-${timeZone}`,
    () =>
      new Intl.DateTimeFormat(tag, {
        timeZone,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      }),
  );
}

/** Inclusive calendar-day count between two `YYYY-MM-DD` dates (null when invalid). */
export function inclusiveDays(startDate: string, endDate: string): number | null {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = Date.parse(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return (end - start) / 86_400_000 + 1;
}

/**
 * The UTC instant for a wall-clock `YYYY-MM-DDTHH:MM` in an IANA timezone, as ISO-8601.
 * The offset is resolved from the timezone itself (two passes cover DST boundaries), so
 * the browser's own timezone never matters.
 */
export function zonedInstant(local: string, timeZone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (instant: number) => {
    const parts = wallClock('en-US', timeZone).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return (
      Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - instant
    );
  };
  let instant = wall - offsetAt(wall);
  instant = wall - offsetAt(instant);
  return new Date(instant).toISOString();
}

/** An instant as the `YYYY-MM-DDTHH:MM` wall clock of an IANA timezone (form inputs). */
export function zonedLocal(instant: string, timeZone: string): string {
  const parts = wallClock('en-CA', timeZone).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

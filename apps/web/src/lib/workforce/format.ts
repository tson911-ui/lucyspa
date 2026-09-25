import type { Locale } from '../../i18n/locales';

/**
 * VND is carried as a decimal integer string (bigint on the server). Formatting groups
 * digits on the string itself, so no amount ever passes through a floating-point number.
 */
export function formatVnd(value: string, locale: Locale): string {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) return value;
  const separator = locale === 'vi' ? '.' : ',';
  return `${value.replace(/\B(?=(\d{3})+(?!\d))/g, separator)} ₫`;
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
  return locale === 'vi' ? `${day}/${month}/${year}` : `${year}-${month}-${day}`;
}

/** An instant as wall-clock time in the given IANA timezone (the branch's). */
export function formatTime(instant: string, timeZone: string, locale: Locale): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function formatDateTime(instant: string, timeZone: string, locale: Locale): string {
  const date = new Date(instant);
  if (Number.isNaN(date.getTime())) return instant;
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

/** Today's calendar date (`YYYY-MM-DD`) in an IANA timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
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
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date(instant));
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
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

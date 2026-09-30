// Business-date arithmetic for the date range picker and the period comparison (contract 14.4).
// Every date is a `YYYY-MM-DD` string in the branch's business calendar. Nothing here reads the
// clock or a time zone: the caller passes `today` (the branch business date), so a range never
// drifts with the browser's zone or a UTC instant.

export interface DateRange {
  from: string;
  to: string;
}

export type ComparisonMode = 'none' | 'previous' | 'lastYear';
export type PresetId = 'today' | 'yesterday' | 'last7' | 'last30' | 'thisMonth' | 'lastMonth';

export const DEFAULT_MAX_RANGE_DAYS = 366;
export const PRESET_IDS: readonly PresetId[] = [
  'today',
  'yesterday',
  'last7',
  'last30',
  'thisMonth',
  'lastMonth',
];

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

export function isIsoDate(value: string): boolean {
  const match = ISO.exec(value);
  if (!match) return false;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return toIso(date) === value;
}

function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parse(value: string): Date {
  const match = ISO.exec(value);
  if (!match) throw new RangeError(`not a business date: ${value}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function addDays(value: string, days: number): string {
  return toIso(new Date(parse(value).getTime() + days * DAY_MS));
}

/** Whole days from `a` to `b` (negative when `b` is earlier). */
export function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY_MS);
}

/** Number of days in a range, both ends included. */
export function rangeDays(range: DateRange): number {
  return diffDays(range.from, range.to) + 1;
}

export function compareDates(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** The same calendar date one year earlier; 29 February becomes 28 February. */
export function addYears(value: string, years: number): string {
  const date = parse(value);
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const shifted = new Date(Date.UTC(date.getUTCFullYear() + years, month, day));
  if (shifted.getUTCMonth() !== month)
    return toIso(new Date(Date.UTC(date.getUTCFullYear() + years, month + 1, 0)));
  return toIso(shifted);
}

function monthStart(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

function monthEnd(value: string): string {
  const date = parse(monthStart(value));
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)));
}

export function addMonths(value: string, months: number): string {
  const date = parse(monthStart(value));
  return toIso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1)));
}

export function presetRange(id: PresetId, today: string): DateRange {
  switch (id) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDays(today, -1);
      return { from: day, to: day };
    }
    case 'last7':
      return { from: addDays(today, -6), to: today };
    case 'last30':
      return { from: addDays(today, -29), to: today };
    case 'thisMonth':
      return { from: monthStart(today), to: today };
    case 'lastMonth': {
      const previous = addMonths(today, -1);
      return { from: monthStart(previous), to: monthEnd(previous) };
    }
  }
}

export function matchPreset(range: DateRange | null, today: string): PresetId | null {
  if (!range) return null;
  return (
    PRESET_IDS.find((id) => {
      const preset = presetRange(id, today);
      return preset.from === range.from && preset.to === range.to;
    }) ?? null
  );
}

/**
 * The range to compare with: `previous` is the same number of days immediately before, `lastYear`
 * the same calendar dates one year earlier. `none` gives `null`.
 */
export function comparisonRange(range: DateRange, mode: ComparisonMode): DateRange | null {
  if (mode === 'none') return null;
  if (mode === 'previous') {
    const days = rangeDays(range);
    return { from: addDays(range.from, -days), to: addDays(range.from, -1) };
  }
  return { from: addYears(range.from, -1), to: addYears(range.to, -1) };
}

/** The two dates as a range, earliest first. */
export function normalizeRange(a: string, b: string): DateRange {
  return compareDates(a, b) <= 0 ? { from: a, to: b } : { from: b, to: a };
}

export function exceedsMax(range: DateRange, maxDays: number): boolean {
  return rangeDays(range) > maxDays;
}

export interface CalendarDay {
  date: string;
  inMonth: boolean;
}

/** Weeks of a month, each 7 days, starting on `weekStart` (0 = Sunday, 1 = Monday). */
export function monthGrid(month: string, weekStart: 0 | 1 = 1): CalendarDay[][] {
  const first = monthStart(month);
  const offset = (parse(first).getUTCDay() - weekStart + 7) % 7;
  const start = addDays(first, -offset);
  const last = monthEnd(month);
  const weeks: CalendarDay[][] = [];
  for (let cursor = start; compareDates(cursor, last) <= 0; cursor = addDays(cursor, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, index) => {
        const date = addDays(cursor, index);
        return { date, inMonth: date.slice(0, 7) === first.slice(0, 7) };
      }),
    );
  }
  return weeks;
}

/** A business date as text: `long` has the weekday ("Monday, 30 September 2026"), `medium` is short ("30 Sep 2026"). */
export function formatDay(
  value: string,
  locale: 'vi' | 'en',
  style: 'medium' | 'long' = 'medium',
): string {
  const options: Intl.DateTimeFormatOptions =
    style === 'long'
      ? { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
      : { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' };
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', options).format(parse(value));
}

/** "30 Sep 2026" or "24 Sep 2026 – 30 Sep 2026"; one date when the range is a single day. */
export function formatRange(range: DateRange, locale: 'vi' | 'en'): string {
  return range.from === range.to
    ? formatDay(range.from, locale)
    : `${formatDay(range.from, locale)} – ${formatDay(range.to, locale)}`;
}

/** Month heading ("September 2026"). */
export function formatMonth(value: string, locale: 'vi' | 'en'): string {
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parse(value));
}

/** Short weekday name (Mon, T2) for column headings. */
export function formatWeekday(weekday: number, locale: 'vi' | 'en'): string {
  // 2024-01-07 is a Sunday.
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    weekday: 'short',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(2024, 0, 7 + weekday)));
}

/** Day of week (0 = Sunday) of a business date. */
export function weekdayOf(value: string): number {
  return parse(value).getUTCDay();
}

/** Key on the calendar grid: arrows step a day or a week, PageUp/PageDown a month, Home/End the week. */
export function calendarKeyTarget(
  key: string,
  focused: string,
  weekStart: 0 | 1 = 1,
): string | null {
  switch (key) {
    case 'ArrowLeft':
      return addDays(focused, -1);
    case 'ArrowRight':
      return addDays(focused, 1);
    case 'ArrowUp':
      return addDays(focused, -7);
    case 'ArrowDown':
      return addDays(focused, 7);
    case 'PageUp':
      return clampDay(addMonths(focused, -1), focused);
    case 'PageDown':
      return clampDay(addMonths(focused, 1), focused);
    case 'Home':
      return addDays(focused, -((weekdayOf(focused) - weekStart + 7) % 7));
    case 'End':
      return addDays(focused, 6 - ((weekdayOf(focused) - weekStart + 7) % 7));
    default:
      return null;
  }
}

/** The same day number in the month of `monthDate`, or that month's last day when it is shorter. */
function clampDay(monthDate: string, original: string): string {
  const day = Number(original.slice(8, 10));
  const last = Number(monthEnd(monthDate).slice(8, 10));
  return `${monthDate.slice(0, 8)}${String(Math.min(day, last)).padStart(2, '0')}`;
}

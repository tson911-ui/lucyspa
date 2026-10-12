import { REPORT_BUCKETS, REPORT_LIMITS, type ReportBucket } from '@lucy-spa/contracts';
import { AuthError } from '../auth/auth.error.js';

/**
 * Phase 8 (P8-T2): the dates of a report. A filter is a pair of branch business dates `YYYY-MM-DD`, closed on both ends, never a UTC
 * instant and never a numeric offset. Days are counted on the calendar (UTC arithmetic on plain dates, so a daylight-saving change in
 * some other zone could never shift a day). Week = Monday to Sunday, quarter and year = calendar (OQ-P8-9).
 */

const DAY_MS = 86_400_000;

export function isBusinessDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function parseBusinessDate(value: unknown, field: string): string {
  if (!isBusinessDate(value)) throw new AuthError('VALIDATION_FAILED', field);
  return value;
}

export function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** Calendar days from `from` to `to`, both included. */
export function daysInclusive(from: string, to: string): number {
  return (
    Math.round(
      (new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime()) /
        DAY_MS,
    ) + 1
  );
}

export interface ReportRange {
  from: string;
  to: string;
  days: number;
}

export function parseRange(query: { from?: unknown; to?: unknown }): ReportRange {
  const from = parseBusinessDate(query.from, 'from');
  const to = parseBusinessDate(query.to, 'to');
  if (from > to) throw new AuthError('REPORT_RANGE_INVALID');
  const days = daysInclusive(from, to);
  if (days > REPORT_LIMITS.maxDays) throw new AuthError('REPORT_RANGE_TOO_LONG');
  return { from, to, days };
}

/** The equal-length period immediately before the range. */
export function previousRange(range: ReportRange): ReportRange {
  return {
    from: addDays(range.from, -range.days),
    to: addDays(range.from, -1),
    days: range.days,
  };
}

export function parseBucket(value: unknown, range: ReportRange): ReportBucket {
  if (value === undefined || value === '') return defaultBucket(range.days);
  if (typeof value !== 'string' || !(REPORT_BUCKETS as readonly string[]).includes(value)) {
    throw new AuthError('VALIDATION_FAILED', 'bucket');
  }
  return value as ReportBucket;
}

/** Up to 45 days by day, up to half a year by week, longer by month: a chart never needs more than ~50 points. */
export function defaultBucket(days: number): ReportBucket {
  if (days <= 45) return 'day';
  if (days <= 190) return 'week';
  return 'month';
}

/** The first day of the bucket that holds `date`. */
export function bucketStart(date: string, bucket: ReportBucket): string {
  const [year, month] = date.split('-').map(Number) as [number, number, number];
  switch (bucket) {
    case 'day':
      return date;
    case 'week': {
      const weekday = new Date(`${date}T00:00:00.000Z`).getUTCDay(); // 0 = Sunday
      return addDays(date, -((weekday + 6) % 7)); // back to Monday
    }
    case 'month':
      return `${year}-${String(month).padStart(2, '0')}-01`;
    case 'quarter':
      return `${year}-${String(Math.floor((month - 1) / 3) * 3 + 1).padStart(2, '0')}-01`;
    case 'year':
      return `${year}-01-01`;
  }
}

/** Every bucket start from the bucket of `from` to the bucket of `to` (gap filling for a chart). */
export function bucketStarts(range: ReportRange, bucket: ReportBucket): string[] {
  const out: string[] = [];
  let cursor = bucketStart(range.from, bucket);
  const last = bucketStart(range.to, bucket);
  while (cursor <= last) {
    out.push(cursor);
    cursor = nextBucket(cursor, bucket);
  }
  return out;
}

function nextBucket(start: string, bucket: ReportBucket): string {
  const [year, month] = start.split('-').map(Number) as [number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  switch (bucket) {
    case 'day':
      return addDays(start, 1);
    case 'week':
      return addDays(start, 7);
    case 'month':
      return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`;
    case 'quarter':
      return month >= 10 ? `${year + 1}-01-01` : `${year}-${pad(month + 3)}-01`;
    default:
      return `${year + 1}-01-01`;
  }
}
